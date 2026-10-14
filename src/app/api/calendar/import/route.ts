import { ApiError } from "@/lib/api-error";
import { errorResponse } from "@/lib/api-route";
import { isValidTimeZone } from "@/lib/calendar/tz";
import { importIcs } from "@/lib/calendar/service";

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => {
      throw new ApiError(400, "invalid_upload", "The upload couldn't be read.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "no_file", "Choose an .ics file to import.");
    if (file.size > MAX_BYTES) throw new ApiError(413, "file_too_large", "Calendar files can be up to 2 MB.");
    const zone = String(form.get("timezone") ?? "UTC");
    return Response.json(await importIcs(await file.text(), isValidTimeZone(zone) ? zone : "UTC"));
  } catch (error) {
    return errorResponse(error);
  }
}
