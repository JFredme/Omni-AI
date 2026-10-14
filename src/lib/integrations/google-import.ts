import { createEvent, updateEvent } from "@/lib/calendar/service";
import { createEventSchema, updateEventSchema } from "@/lib/calendar/schemas";
import { prisma } from "@/lib/db";
import { addText } from "@/lib/knowledge/service";
import { googleApi } from "./providers/google";

/** Copies upcoming Google Calendar events into Omni. Events already imported are updated, so running it again never duplicates. */
export async function importGoogleEvents(accessToken: string, days: number, signal?: AbortSignal) {
  const events = await googleApi.listEvents(accessToken, days, signal);
  let created = 0;
  let updated = 0;
  for (const event of events) {
    const uid = `google-${event.id}`;
    const common = {
      title: event.title.slice(0, 200),
      description: event.description,
      location: event.location,
      allDay: event.allDay,
      timezone: event.timezone,
    };
    const times = event.allDay
      ? { start: event.start, end: new Date(new Date(`${event.end}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) }
      : { start: new Date(event.start).toISOString(), end: new Date(event.end).toISOString() };
    const existing = await prisma.calendarEvent.findUnique({ where: { uid }, select: { id: true } });
    try {
      if (existing) {
        await updateEvent(existing.id, updateEventSchema.parse({ ...common, ...times }), { scope: "all" });
        updated += 1;
      } else {
        const made = await createEvent(createEventSchema.parse({ ...common, ...times }));
        await prisma.calendarEvent.update({ where: { id: made.id }, data: { uid } });
        created += 1;
      }
    } catch {
      // An event with odd times is skipped rather than stopping the whole import.
    }
  }
  return { found: events.length, created, updated };
}

export async function importDriveFile(accessToken: string, fileId: string, signal?: AbortSignal) {
  const { name, text } = await googleApi.readDriveText(accessToken, fileId, signal);
  const document = await addText({ name: `Drive: ${name}`, text: text.slice(0, 190_000) });
  return { documentId: document.id, name: document.name, characters: Math.min(text.length, 190_000), truncated: text.length > 190_000 };
}
