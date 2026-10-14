import { errorResponse } from "@/lib/api-route";
import { sandboxConfig, sandboxStatus } from "@/lib/code/sandbox";

export async function GET() {
  try {
    const config = sandboxConfig();
    return Response.json({ ...(await sandboxStatus()), timeoutSeconds: Math.round(config.timeoutMs / 1000), memory: config.memory });
  } catch (error) {
    return errorResponse(error);
  }
}
