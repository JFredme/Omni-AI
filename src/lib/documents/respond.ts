import { exportFile } from "./export";
import type { ExportRequest } from "./model";

/** Builds the download response for an export. Warnings travel in a header so the page can show them. */
export async function fileResponse(request: ExportRequest): Promise<Response> {
  const file = await exportFile(request);
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Warnings": encodeURIComponent(JSON.stringify(file.warnings)),
      "Access-Control-Expose-Headers": "X-Export-Warnings, Content-Disposition",
    },
  });
}
