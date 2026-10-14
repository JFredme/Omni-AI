import { ApiError } from "@/lib/api-error";
import { errorResponse } from "@/lib/api-route";
import { DOCUMENT_FORMATS, type DocumentFormat } from "@/lib/documents/model";
import { fileResponse } from "@/lib/documents/respond";
import { noteDocument } from "@/lib/documents/sources";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const format = (new URL(request.url).searchParams.get("format") ?? "pdf") as DocumentFormat;
    if (!DOCUMENT_FORMATS.includes(format)) throw new ApiError(400, "invalid_format", "Choose pdf, docx, md, or txt.");
    return await fileResponse({ kind: "document", format, document: await noteDocument((await params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}
