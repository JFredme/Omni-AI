import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { ApiError } from "@/lib/api-error";
import { isThisComputer } from "@/lib/computer/local";
import { getSettingsView, updateSettings } from "@/lib/settings";

const patchSchema = z.object({
  defaultModelId: z.string().trim().min(1).max(200).nullable().optional(),
  favoriteModelIds: z.array(z.string().trim().min(1).max(200)).max(300).optional(),
  monthlyBudgetUsd: z.number().min(0).max(100_000).nullable().optional(),
  computerControl: z.boolean().optional(),
});

export async function GET() {
  try {
    return Response.json(await getSettingsView());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const patch = await readBody(request, patchSchema);
    if (patch.computerControl !== undefined && !isThisComputer(request)) {
      throw new ApiError(403, "local_only", "Computer control can only be changed on the computer OMNI is running on, not from a phone or over a network.");
    }
    return Response.json(await updateSettings(patch));
  } catch (error) {
    return errorResponse(error);
  }
}
