import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { runResearch, MAX_QUESTION } from "@/lib/research/engine";
import { listReports } from "@/lib/research/service";
import { DEPTHS } from "@/lib/research/types";
import { encodeSseEvent } from "@/lib/sse";

const schema = z.object({ question: z.string().max(MAX_QUESTION * 2), depth: z.enum(DEPTHS).default("quick") });

export async function GET() {
  try {
    return Response.json({ reports: await listReports() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Runs a piece of research, streaming progress and then the report as server-sent events. */
export async function POST(request: Request) {
  try {
    const { question, depth } = await readBody(request, schema);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const events = runResearch({ question, depth, signal: controller.signal });
    // The first event is pulled before streaming so setup problems (no provider, no key) become ordinary error responses.
    const first = await events.next();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        const send = (event: { type: string }) => {
          const { type, ...payload } = event;
          try {
            streamController.enqueue(encoder.encode(encodeSseEvent(type, payload)));
          } catch {
            // The client left; the run is already being stopped.
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
