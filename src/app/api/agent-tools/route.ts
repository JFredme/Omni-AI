import { toolCatalog } from "@/lib/agents/tools";

export async function GET() {
  return Response.json({ tools: toolCatalog() });
}
