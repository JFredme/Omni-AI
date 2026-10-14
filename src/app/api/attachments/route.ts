import { ApiError } from "@/lib/api-error";
import { errorResponse } from "@/lib/api-route";
import { createAttachment, MAX_DOCUMENT_BYTES } from "@/lib/chat/attachments";

export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES + 1024 * 1024) {
      throw new ApiError(413, "file_too_large", `Files can be up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`);
    }
    const form = await request.formData().catch(() => {
      throw new ApiError(400, "invalid_upload", "The upload couldn't be read.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "no_file", "Choose a file to attach.");
    return Response.json({ attachment: await createAttachment({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
