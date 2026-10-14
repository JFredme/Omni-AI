import { errorResponse, readBody } from "@/lib/api-route";
import { exportRequestSchema } from "@/lib/documents/model";
import { fileResponse } from "@/lib/documents/respond";

/** Turns a document, deck, or spreadsheet into a downloadable file. Nothing is stored. */
export async function POST(request: Request) {
  try {
    return await fileResponse(await readBody(request, exportRequestSchema));
  } catch (error) {
    return errorResponse(error);
  }
}
