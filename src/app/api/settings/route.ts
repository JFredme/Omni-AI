import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { getSettingsView, updateSettings } from "@/lib/settings";

const patchSchema = z.object({
  defaultModelId: z.string().trim().min(1).max(200).nullable().optional(),
  favoriteModelIds: z.array(z.string().trim().min(1).max(200)).max(300).optional(),
  monthlyBudgetUsd: z.number().min(0).max(100_000).nullable().optional(),
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
    return Response.json(await updateSettings(patch));
  } catch (error) {
    return errorResponse(error);
  }
}
