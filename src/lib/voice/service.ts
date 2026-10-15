import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { getOpenRouterBaseUrl } from "@/lib/env";
import { errorFromResponse, headersFor, networkError } from "@/lib/openrouter/client";
import { OpenRouterError } from "@/lib/openrouter/errors";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import { defaultVoiceFor, estimateVoiceCost, voiceModelChoices, type VoiceKind, type VoiceModel } from "./models";

export const MAX_AUDIO_BASE64_CHARS = 8_000_000; // about 4 minutes of 16 kHz speech
export const MAX_SPEECH_CHARS = 1_500;
const REQUEST_TIMEOUT_MS = 40_000;

/** A model that is down, busy, or not serving this kind of request is replaced by the next cheapest one. */
function worthTryingAnother(error: unknown): boolean {
  return error instanceof OpenRouterError && ["provider_error", "model_unavailable", "timeout", "network", "rate_limited", "unknown"].includes(error.kind);
}

async function post(path: string, body: unknown, signal: AbortSignal | undefined, apiKey: string): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(`${getOpenRouterBaseUrl()}${path}`, { method: "POST", headers: headersFor(apiKey, true), body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) throw await errorFromResponse(response);
    return response;
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    if (signal?.aborted) throw error;
    throw networkError(error, timedOut);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function recordUsage(kind: VoiceKind, modelId: string, model: VoiceModel | undefined, amount: number, ok: boolean) {
  try {
    await prisma.usageRecord.create({
      data: { modelId, costUsd: ok ? estimateVoiceCost(model, amount) : null, costSource: ok && model ? "estimated" : "unknown", status: ok ? "complete" : "error" },
    });
  } catch (error) {
    console.error(`Could not record ${kind} usage:`, error);
  }
}

/** Speech to text. `seconds` is the length of the recording, used for the cost estimate. */
export async function transcribe(input: { audio: string; format: string; seconds: number; model?: string | null; language?: string | null }, signal?: AbortSignal): Promise<{ text: string; model: string }> {
  if (input.audio.length > MAX_AUDIO_BASE64_CHARS) throw new ApiError(413, "audio_too_long", "That recording is too long. Try a shorter one.");
  const { key } = await requireApiKey();
  await assertWithinBudget();
  let last: unknown = null;
  for (const choice of await voiceModelChoices("stt", input.model)) {
    try {
      const response = await post("/audio/transcriptions", { model: choice.id, input_audio: { data: input.audio, format: input.format }, ...(input.language ? { language: input.language } : {}) }, signal, key);
      const result = (await response.json()) as { text?: unknown };
      await recordUsage("stt", choice.id, choice.model, input.seconds, true);
      return { text: typeof result.text === "string" ? result.text.trim() : "", model: choice.id };
    } catch (error) {
      last = error;
      await recordUsage("stt", choice.id, choice.model, input.seconds, false);
      if (!worthTryingAnother(error)) throw error;
    }
  }
  throw last instanceof Error ? last : new OpenRouterError("Speech-to-text isn't available right now.", { kind: "provider_error" });
}

/** Text to speech. Returns an MP3. */
export async function speak(input: { text: string; model?: string | null; voice?: string | null; speed?: number }, signal?: AbortSignal): Promise<{ audio: ArrayBuffer; model: string; voice: string | null }> {
  const text = input.text.trim();
  if (!text) throw new ApiError(400, "empty_text", "There is nothing to say.");
  if (text.length > MAX_SPEECH_CHARS) throw new ApiError(400, "text_too_long", "That is too long to speak in one piece.");
  const { key } = await requireApiKey();
  await assertWithinBudget();
  let last: unknown = null;
  for (const choice of await voiceModelChoices("tts", input.model)) {
    // A voice belongs to one model: use the requested one only if this model lists it, else this model's default.
    const voice = input.voice && (choice.model?.voices.length ? choice.model.voices.includes(input.voice) : true) ? input.voice : defaultVoiceFor(choice.model);
    try {
      const response = await post("/audio/speech", { model: choice.id, input: text, ...(voice ? { voice } : {}), response_format: "mp3", ...(input.speed && input.speed !== 1 ? { speed: input.speed } : {}) }, signal, key);
      const audio = await response.arrayBuffer();
      await recordUsage("tts", choice.id, choice.model, text.length, true);
      return { audio, model: choice.id, voice };
    } catch (error) {
      last = error;
      await recordUsage("tts", choice.id, choice.model, text.length, false);
      if (!worthTryingAnother(error)) throw error;
    }
  }
  throw last instanceof Error ? last : new OpenRouterError("Text-to-speech isn't available right now.", { kind: "provider_error" });
}
