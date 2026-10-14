import { z } from "zod";
import { errorResponse, readBody } from "@/lib/api-route";
import { getSearchSettings, saveSearchSettings } from "@/lib/research/settings";
import { SEARCH_PROVIDERS } from "@/lib/research/types";

const schema = z.object({
  provider: z.enum(SEARCH_PROVIDERS).nullable(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(300).nullable().optional(),
});

export async function GET() {
  try {
    return Response.json({ settings: await getSearchSettings() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The key is write-only: it is encrypted on save and never sent back to the browser. */
export async function PUT(request: Request) {
  try {
    return Response.json({ settings: await saveSearchSettings(await readBody(request, schema)) });
  } catch (error) {
    return errorResponse(error);
  }
}
