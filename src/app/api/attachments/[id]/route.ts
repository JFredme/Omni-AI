import { errorResponse } from "@/lib/api-route";
import { getAttachmentFile } from "@/lib/chat/attachments";

type Context = { params: Promise<{ id: string }> };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Serves an attached file. Only validated image types are shown inline; anything else downloads. The sandbox policy
 * means that even if something unexpected were stored, the browser would not run it.
 */
export async function GET(_request: Request, { params }: Context) {
  try {
    const file = await getAttachmentFile((await params).id);
    const inline = file.kind === "image" && IMAGE_TYPES.has(file.mimeType);
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": inline ? file.mimeType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
