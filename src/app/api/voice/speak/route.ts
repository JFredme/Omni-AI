import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { MAX_SPEECH_CHARS, speak } from "@/lib/voice/service";

const schema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEECH_CHARS),
  model: z.string().trim().max(200).nullish(),
  voice: z.string().trim().max(100).nullish(),
  speed: z.number().min(0.5).max(2).optional(),
});

/** Returns the spoken text as an MP3. */
export async function POST(request: Request) {
  try {
    const input = await readBody(request, schema);
    const result = await speak(input, request.signal);
    return new Response(result.audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Model": result.model } });
  } catch (error) {
    return errorResponse(error);
  }
}
