import { encodeSseEvent } from "@/lib/sse";
import { runTurn, type TurnPlan } from "./service";
import type { TurnEvent } from "./types";

/**
 * Streams a planned turn as server-sent events. The upstream request is aborted when the
 * client disconnects (request signal or stream cancellation).
 */
export function turnStreamResponse(plan: TurnPlan, requestSignal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (requestSignal.aborted) abort();
  requestSignal.addEventListener("abort", abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const send = (event: TurnEvent) => {
        const { type, ...payload } = event;
        try {
          streamController.enqueue(encoder.encode(encodeSseEvent(type, payload)));
        } catch {
          // The client has gone away; the upstream request is already being aborted.
        }
      };
      try {
        for await (const event of runTurn(plan, controller.signal)) {
          send(event);
        }
      } finally {
        requestSignal.removeEventListener("abort", abort);
        try {
          streamController.close();
        } catch {
          // Already closed by cancellation.
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
