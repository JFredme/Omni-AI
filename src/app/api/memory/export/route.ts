import { errorResponse } from "@/lib/api-route";
import { listMemories } from "@/lib/knowledge/memory";

/** Downloads every memory as JSON. */
export async function GET() {
  try {
    const memories = await listMemories();
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), memories }, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="omni-memories.json"' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
