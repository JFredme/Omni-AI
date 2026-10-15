import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { MAX_AUDIO_BASE64_CHARS, transcribe } from "@/lib/voice/service";

const schema = z.object({
  /** Base64 audio, without a "data:" prefix. */
  audio: z.string().min(100).max(MAX_AUDIO_BASE64_CHARS + 100),
  format: z.enum(["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"]).default("wav"),
  seconds: z.number().min(0).max(300).default(10),
  model: z.string().trim().max(200).nullish(),
  language: z.string().trim().max(10).nullish(),
});

export async function POST(request: Request) {
  try {
    const input = await readBody(request, schema);
    return Response.json(await transcribe(input, request.signal));
  } catch (error) {
    return errorResponse(error);
  }
}
