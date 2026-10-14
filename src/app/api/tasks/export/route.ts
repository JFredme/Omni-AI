import { ApiError } from "@/lib/api-error";
import { errorResponse } from "@/lib/api-route";
import { SHEET_FORMATS, type SheetFormat } from "@/lib/documents/model";
import { fileResponse } from "@/lib/documents/respond";
import { tasksSheet } from "@/lib/documents/sources";

export async function GET(request: Request) {
  try {
    const format = (new URL(request.url).searchParams.get("format") ?? "xlsx") as SheetFormat;
    if (!SHEET_FORMATS.includes(format)) throw new ApiError(400, "invalid_format", "Choose xlsx or csv.");
    return await fileResponse({ kind: "sheet", format, sheet: await tasksSheet() });
  } catch (error) {
    return errorResponse(error);
  }
}
