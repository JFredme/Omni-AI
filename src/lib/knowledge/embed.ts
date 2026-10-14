import { prisma } from "@/lib/db";
import { resolveCost } from "@/lib/chat/service";
import { createEmbeddings } from "@/lib/openrouter/client";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import { normalize } from "./vectors";

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
const BATCH_SIZE = 48;
const MAX_INPUT_CHARS = 8_000;

export async function getEmbeddingModel(): Promise<string> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { embeddingModelId: true } });
  return settings?.embeddingModelId?.trim() || DEFAULT_EMBEDDING_MODEL;
}

/**
 * Embeds texts through OpenRouter, in batches, recording usage for each call. Returns unit-length vectors in the
 * same order as `texts`. Throws if the key is missing, the budget is spent, or the model fails.
 */
export async function embedTexts(texts: string[], options: { signal?: AbortSignal; model?: string } = {}): Promise<{ vectors: Float32Array[]; model: string }> {
  const { key } = await requireApiKey();
  const model = options.model ?? (await getEmbeddingModel());
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    options.signal?.throwIfAborted();
    await assertWithinBudget();
    const batch = texts.slice(start, start + BATCH_SIZE).map((text) => text.slice(0, MAX_INPUT_CHARS) || " ");
    try {
      const result = await createEmbeddings({ apiKey: key, model, input: batch, signal: options.signal });
      const cost = await resolveCost(model, key, result.usage);
      await prisma.usageRecord.create({
        data: {
          modelId: model,
          promptTokens: result.usage.promptTokens,
          completionTokens: 0,
          totalTokens: result.usage.totalTokens,
          costUsd: cost.costUsd,
          costSource: cost.source,
          status: "complete",
        },
      });
      for (const vector of result.vectors) vectors.push(normalize(vector));
    } catch (error) {
      await prisma.usageRecord.create({ data: { modelId: model, status: "error" } }).catch(() => undefined);
      throw error;
    }
  }
  return { vectors, model };
}
