import { z } from "zod";

export interface ModelCapabilities {
  tools: boolean;
  jsonOutput: boolean;
  imageInput: boolean;
  reasoning: boolean;
}

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  /** USD per token, or null when OpenRouter does not publish a price. */
  promptPrice: number | null;
  /** USD per token, or null when OpenRouter does not publish a price. */
  completionPrice: number | null;
  isFree: boolean;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  capabilities: ModelCapabilities;
  createdAt: number | null;
}

const rawModelSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().nullish(),
  created: z.number().nullish(),
  context_length: z.number().nullish(),
  pricing: z
    .looseObject({
      prompt: z.union([z.string(), z.number()]).nullish(),
      completion: z.union([z.string(), z.number()]).nullish(),
    })
    .nullish(),
  architecture: z
    .looseObject({
      input_modalities: z.array(z.string()).nullish(),
      output_modalities: z.array(z.string()).nullish(),
    })
    .nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  top_provider: z
    .looseObject({
      max_completion_tokens: z.number().nullish(),
    })
    .nullish(),
  reasoning: z.unknown().optional(),
});

export function parsePrice(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function detectCapabilities(
  inputModalities: string[],
  supportedParameters: string[],
  hasReasoningConfig: boolean,
): ModelCapabilities {
  const params = new Set(supportedParameters);
  return {
    tools: params.has("tools"),
    jsonOutput: params.has("response_format") || params.has("structured_outputs"),
    imageInput: inputModalities.includes("image"),
    reasoning: hasReasoningConfig || params.has("reasoning") || params.has("include_reasoning"),
  };
}

export function isFreeModel(id: string, promptPrice: number | null, completionPrice: number | null): boolean {
  if (id.endsWith(":free")) return true;
  return promptPrice === 0 && completionPrice === 0;
}

export function normalizeModel(raw: unknown): CatalogModel | null {
  const parsed = rawModelSchema.safeParse(raw);
  if (!parsed.success) return null;
  const model = parsed.data;

  const promptPrice = parsePrice(model.pricing?.prompt);
  const completionPrice = parsePrice(model.pricing?.completion);
  const inputModalities = model.architecture?.input_modalities ?? [];
  const supportedParameters = model.supported_parameters ?? [];

  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    description: model.description ?? "",
    contextLength: model.context_length ?? null,
    maxCompletionTokens: model.top_provider?.max_completion_tokens ?? null,
    promptPrice,
    completionPrice,
    isFree: isFreeModel(model.id, promptPrice, completionPrice),
    inputModalities,
    outputModalities: model.architecture?.output_modalities ?? [],
    supportedParameters,
    capabilities: detectCapabilities(inputModalities, supportedParameters, model.reasoning !== undefined),
    createdAt: typeof model.created === "number" ? model.created * 1000 : null,
  };
}

export function estimateCostUsd(
  tokens: { promptTokens: number; completionTokens: number },
  prices: { promptPrice: number | null; completionPrice: number | null },
): number | null {
  if (prices.promptPrice === null || prices.completionPrice === null) return null;
  return tokens.promptTokens * prices.promptPrice + tokens.completionTokens * prices.completionPrice;
}
