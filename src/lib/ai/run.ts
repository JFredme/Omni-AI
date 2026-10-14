import type { ZodType } from "zod";
import { ApiError } from "@/lib/api-error";
import { resolveCost } from "@/lib/chat/service";
import { prisma } from "@/lib/db";
import { streamChatCompletion, type UsageInfo } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import { extractJson, invalidAiResponse } from "./json";

/** A single AI request may not run longer than this, so a stalled model can't hold a request open. */
const AI_REQUEST_TIMEOUT_MS = 120_000;

async function resolveModel(requested?: string): Promise<string> {
  if (requested) return requested;
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { defaultModelId: true } });
  if (settings?.defaultModelId) return settings.defaultModelId;
  throw new ApiError(400, "model_required", "Choose a default model in Settings or AI Chat before using AI features.");
}

async function recordUsage(params: {
  modelId: string;
  apiKey: string;
  usage: UsageInfo | null;
  status: "complete" | "error";
}) {
  const cost =
    params.status === "complete" ? await resolveCost(params.modelId, params.apiKey, params.usage) : { costUsd: null, source: "unknown" as const };
  await prisma.usageRecord.create({
    data: {
      modelId: params.modelId,
      promptTokens: params.usage?.promptTokens ?? null,
      completionTokens: params.usage?.completionTokens ?? null,
      totalTokens: params.usage?.totalTokens ?? null,
      costUsd: cost.costUsd,
      costSource: cost.source,
      status: params.status,
    },
  });
}

/**
 * Asks the model for a JSON object and validates it. Uses the same OpenRouter client, key, budget check,
 * and usage records as chat; the reply is collected rather than shown token by token.
 */
export async function runAiJson<T>(params: {
  system: string;
  user: string;
  schema: ZodType<T>;
  modelId?: string;
  signal?: AbortSignal;
}): Promise<{ data: T; modelId: string }> {
  const { key } = await requireApiKey();
  const modelId = await resolveModel(params.modelId);
  await assertWithinBudget();

  const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;

  let text = "";
  let usage: UsageInfo | null = null;
  try {
    for await (const event of streamChatCompletion({
      apiKey: key,
      body: {
        model: modelId,
        temperature: 0.3,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
      },
      signal,
    })) {
      if (event.type === "delta") text += event.text;
      else if (event.type === "usage") usage = event.usage;
    }
  } catch (error) {
    await recordUsage({ modelId, apiKey: key, usage, status: "error" }).catch(() => undefined);
    if (timeout.aborted && !params.signal?.aborted) {
      throw new OpenRouterError("The request to OpenRouter timed out.", { kind: "timeout" });
    }
    throw error;
  }

  await recordUsage({ modelId, apiKey: key, usage, status: "complete" });

  const parsed = params.schema.safeParse(extractJson(text));
  if (!parsed.success) throw invalidAiResponse();
  return { data: parsed.data, modelId };
}
