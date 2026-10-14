import { ApiError } from "@/lib/api-error";
import { errorResponse, readBody } from "@/lib/api-route";
import { addFile, addText, listDocuments } from "@/lib/knowledge/service";
import { pasteSchema } from "@/lib/knowledge/schemas";
import { MAX_UPLOAD_BYTES } from "@/lib/knowledge/types";
import { normalizeTags } from "@/lib/tags";

export async function GET() {
  try {
    return Response.json({ documents: await listDocuments() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Upload a file (multipart/form-data with a `file` field) or paste text (JSON). */
export async function POST(request: Request) {
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const declared = Number(request.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
        throw new ApiError(413, "file_too_large", `Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
      }
      const form = await request.formData().catch(() => {
        throw new ApiError(400, "invalid_upload", "The upload couldn't be read.");
      });
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(400, "no_file", "Choose a file to upload.");
      const tags = normalizeTags(String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean));
      const document = await addFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), tags, signal: request.signal });
      return Response.json({ document }, { status: 201 });
    }
    const input = await readBody(request, pasteSchema);
    return Response.json({ document: await addText(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
