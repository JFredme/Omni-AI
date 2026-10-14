import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { clearApiKey, getSettingsView, saveApiKey } from "@/lib/settings";

const saveSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(12, "The API key looks too short.")
    .max(300)
    .refine((value) => !/\s/.test(value), "The API key must not contain spaces.")
    .refine((value) => value.startsWith("sk-or-"), "OpenRouter API keys start with sk-or-."),
});

export async function PUT(request: Request) {
  try {
    const { apiKey } = await readBody(request, saveSchema);
    await saveApiKey(apiKey);
    return Response.json(await getSettingsView());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    await clearApiKey();
    return Response.json(await getSettingsView());
  } catch (error) {
    return errorResponse(error);
  }
}
