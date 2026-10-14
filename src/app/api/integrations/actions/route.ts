import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { errorResponse, readBody } from "@/lib/api-route";
import { audit } from "@/lib/auth/service";
import { actionById } from "@/lib/integrations/catalog";
import { runIntegrationAction } from "@/lib/integrations/actions";

const schema = z.object({ action: z.string().max(60), params: z.record(z.string(), z.unknown()).default({}), confirm: z.boolean().default(false) });

/**
 * Runs an action from the Integrations page. Anything that changes something outside Omni must be sent with confirm: true,
 * which the page only does after showing exactly what will be sent and getting a click.
 */
export async function POST(request: Request) {
  try {
    const { action, params, confirm } = await readBody(request, schema);
    const info = actionById(action);
    if (!info) throw new ApiError(404, "unknown_action", "That action doesn't exist.");
    if (info.risk === "write" && !confirm) throw new ApiError(400, "confirmation_required", "This changes something outside Omni, so it has to be confirmed first.");
    const result = await runIntegrationAction(action, params, request.signal);
    if (info.risk === "write") await audit("integration.action", action);
    return Response.json({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
