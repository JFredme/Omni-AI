import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { streamChatCompletion, type UsageInfo } from "@/lib/openrouter/client";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import { resolveCost } from "./service";

export const MAX_COMPARE_MODELS = 4;
export const MAX_COMPARE_PROMPT = 20_000;

export type CompareEvent =
  | { type: "delta"; modelId: string; text: string }
  | { type: "done"; modelId: string; usage: { promptTokens: number; completionTokens: number } | null; costUsd: number | null; costSource: string; ms: number }
  | { type: "error"; modelId: string; message: string; ms: number };

/**
 * Sends one prompt to several models at once and yields their replies as they stream in, interleaved.
 * Each reply is recorded in usage like any other call. Nothing is saved as a conversation.
 */
export async function* compareModels(input: { prompt: string; modelIds: string[]; signal: AbortSignal }): AsyncGenerator<CompareEvent> {
  const prompt = input.prompt.trim();
  const modelIds = [...new Set(input.modelIds)];
  if (!prompt) throw new ApiError(400, "empty_message", "Type a prompt to compare.");
  if (prompt.length > MAX_COMPARE_PROMPT) throw new ApiError(400, "message_too_long", `Prompts can be up to ${MAX_COMPARE_PROMPT.toLocaleString()} characters.`);
  if (modelIds.length < 2 || modelIds.length > MAX_COMPARE_MODELS) throw new ApiError(400, "invalid_models", `Choose between 2 and ${MAX_COMPARE_MODELS} different models.`);
  const { key } = await requireApiKey();
  await assertWithinBudget();

  const queue: CompareEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (event: CompareEvent) => {
    queue.push(event);
    wake?.();
  };

  const runOne = async (modelId: string) => {
    const started = Date.now();
    let usage: UsageInfo | null = null;
    try {
      for await (const event of streamChatCompletion({ apiKey: key, body: { model: modelId, messages: [{ role: "user", content: prompt }] }, signal: input.signal })) {
        if (event.type === "delta") push({ type: "delta", modelId, text: event.text });
        else if (event.type === "usage") usage = event.usage;
      }
      const cost = await resolveCost(modelId, key, usage);
      await prisma.usageRecord.create({
        data: {
          modelId,
          promptTokens: usage?.promptTokens ?? null,
          completionTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          costUsd: cost.costUsd,
          costSource: cost.source,
          status: "complete",
        },
      });
      push({ type: "done", modelId, usage: usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } : null, costUsd: cost.costUsd, costSource: cost.source, ms: Date.now() - started });
    } catch (error) {
      await prisma.usageRecord.create({ data: { modelId, status: input.signal.aborted ? "stopped" : "error" } }).catch(() => undefined);
      if (input.signal.aborted) return;
      push({ type: "error", modelId, message: error instanceof OpenRouterError ? userMessageFor(error) : "Something went wrong with this model.", ms: Date.now() - started });
    }
  };

  const running = modelIds.map((modelId) => runOne(modelId));
  let finished = 0;
  void Promise.all(running).finally(() => {
    finished = modelIds.length;
    wake?.();
  });

  while (finished < modelIds.length || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (queue.length > 0 || finished >= modelIds.length) resolve();
      });
      wake = null;
      continue;
    }
    yield queue.shift()!;
  }
}
