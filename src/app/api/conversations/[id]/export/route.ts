import { ApiError } from "@/lib/api-error";
import { errorResponse } from "@/lib/api-route";
import { EXPORT_FORMATS, exportConversation, type ExportFormat } from "@/lib/chat/export";
import { getConversation } from "@/lib/chat/service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const format = (new URL(request.url).searchParams.get("format") ?? "md") as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) throw new ApiError(400, "invalid_format", "Choose md, txt, or json.");
    const file = exportConversation(await getConversation((await params).id), format);
    return new Response(file.body, {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"` },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
