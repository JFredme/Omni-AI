import { errorResponse } from "@/lib/api-route";
import { defaultVoiceFor, listVoiceModels } from "@/lib/voice/models";

/** The voice models OpenRouter lists, cheapest first, and the ones Omni uses by default. */
export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const [stt, tts] = await Promise.all([listVoiceModels("stt", { refresh }), listVoiceModels("tts", { refresh })]);
    const paid = <T extends { free: boolean }>(models: T[]) => models.filter((model) => !model.free);
    return Response.json({
      stt: stt.slice(0, 40),
      tts: tts.slice(0, 40),
      defaults: { stt: paid(stt)[0]?.id ?? null, tts: paid(tts)[0]?.id ?? null, voice: defaultVoiceFor(paid(tts)[0]) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
