import { errorResponse, readBody } from "@/lib/api-route";
import { createAgentSchema } from "@/lib/agents/schemas";
import { createAgent, listAgents } from "@/lib/agents/service";

export async function GET() {
  try {
    return Response.json({ agents: await listAgents() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readBody(request, createAgentSchema);
    return Response.json({ agent: await createAgent(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
