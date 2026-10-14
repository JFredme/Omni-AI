import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { compareModels, MAX_COMPARE_MODELS, MAX_COMPARE_PROMPT } from "@/lib/chat/compare";
import { encodeSseEvent } from "@/lib/sse";

const schema = z.object({
  prompt: z.string().max(MAX_COMPARE_PROMPT * 2),
  modelIds: z.array(z.string().trim().min(1).max(200)).min(2).max(MAX_COMPARE_MODELS),
});

export async function POST(request: Request) {
  try {
    const { prompt, modelIds } = await readBody(request, schema);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const events = compareModels({ prompt, modelIds, signal: controller.signal });
    // Pull the first event before streaming so validation errors become normal error responses.
    const first = await events.next();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        const send = (event: { type: string }) => {
          const { type, ...payload } = event;
          try {
            streamController.enqueue(encoder.encode(encodeSseEvent(type, payload)));
          } catch {
            // The client left.
          }
        };
        try {
          if (!first.done) send(first.value);
          for await (const event of events) send(event);
        } finally {
          request.signal.removeEventListener("abort", abort);
          try {
            streamController.close();
          } catch {
            // Already closed.
          }
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return errorResponse(error);
  }
}
