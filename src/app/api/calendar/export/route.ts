import { errorResponse } from "@/lib/api-route";
import { exportIcs } from "@/lib/calendar/service";

/** Downloads every event as a standard .ics file that Google Calendar, Apple Calendar, and Outlook can import. */
export async function GET() {
  try {
    return new Response(await exportIcs(), {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="omni-calendar.ics"' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
