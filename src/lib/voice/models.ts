// Voice models come from OpenRouter's catalog: one kind that turns speech into text ("transcription") and one that turns
// text into speech ("speech"). By default Omni uses the cheapest paid model of each kind. Free models are left out of the
// automatic choice: they are for testing and can be slow or disappear.
import { getOpenRouterBaseUrl } from "@/lib/env";

export type VoiceKind = "stt" | "tts";

export interface VoiceModel {
  id: string;
  name: string;
  /** USD per second of audio (hearing) or per character (speaking). */
  price: number;
  free: boolean;
  voices: string[];
}

/** Used when the catalog can't be reached. Both were the cheapest paid models listed when this was written. */
export const DEFAULT_VOICE_MODELS: Record<VoiceKind, string> = { stt: "qwen/qwen3-asr-0.6b", tts: "hexgrad/kokoro-82m" };
export const FALLBACK_VOICE = "af_heart";

/** The voice to use when none was chosen: a friendly one from the model's list, else the first. */
export function defaultVoiceFor(model: VoiceModel | undefined): string | null {
  if (!model || model.voices.length === 0) return model && model.id !== DEFAULT_VOICE_MODELS.tts ? null : FALLBACK_VOICE;
  return model.voices.includes(FALLBACK_VOICE) ? FALLBACK_VOICE : (model.voices.find((voice) => /^(af_|alloy|nova|kore)/.test(voice)) ?? model.voices[0]);
}

const MODALITY: Record<VoiceKind, string> = { stt: "transcription", tts: "speech" };
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; models: VoiceModel[] }>();

export function normalizeVoiceModel(raw: unknown): VoiceModel | null {
  const model = raw as { id?: unknown; name?: unknown; pricing?: { prompt?: unknown }; supported_voices?: unknown };
  if (!model || typeof model.id !== "string") return null;
  const price = Number(model.pricing?.prompt);
  if (!Number.isFinite(price) || price < 0) return null;
  return {
    id: model.id,
    name: typeof model.name === "string" ? model.name : model.id,
    price,
    free: price === 0,
    voices: Array.isArray(model.supported_voices) ? model.supported_voices.filter((voice): voice is string => typeof voice === "string") : [],
  };
}

/** Cheapest first. Free models sort last. */
export function sortByPrice(models: VoiceModel[]): VoiceModel[] {
  return [...models].sort((a, b) => Number(a.free) - Number(b.free) || a.price - b.price || a.id.localeCompare(b.id));
}

export async function listVoiceModels(kind: VoiceKind, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<VoiceModel[]> {
  const key = `${getOpenRouterBaseUrl()}|${kind}`;
  const hit = cache.get(key);
  if (!options.refresh && hit && Date.now() - hit.at < TTL_MS) return hit.models;
  try {
    const response = await fetch(`${getOpenRouterBaseUrl()}/models?output_modalities=${MODALITY[kind]}`, { signal: options.signal ?? AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { data?: unknown };
    const models = sortByPrice((Array.isArray(payload.data) ? payload.data : []).map(normalizeVoiceModel).filter((model): model is VoiceModel => model !== null));
    if (models.length === 0) throw new Error("empty");
    cache.set(key, { at: Date.now(), models });
    return models;
  } catch {
    return hit?.models ?? [];
  }
}

/** Models to try, in order: the one asked for, else the cheapest paid ones (so a failing model falls through to the next). */
export async function voiceModelChoices(kind: VoiceKind, requested?: string | null, count = 3): Promise<{ id: string; model: VoiceModel | undefined }[]> {
  const models = await listVoiceModels(kind);
  const ids = requested ? [requested] : models.filter((model) => !model.free).slice(0, count).map((model) => model.id);
  if (ids.length === 0) ids.push(DEFAULT_VOICE_MODELS[kind]);
  return ids.map((id) => ({ id, model: models.find((model) => model.id === id) }));
}

/** What a request cost, from the model's published price. An estimate: OpenRouter's own figure can differ slightly. */
export function estimateVoiceCost(model: VoiceModel | undefined, amount: number): number | null {
  return model ? Math.round(model.price * amount * 1e8) / 1e8 : null;
}
