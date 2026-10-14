import { FREQUENCIES, type Frequency, type Recurrence } from "./recurrence";
import { dateKeyOf, isValidTimeZone, zonedParts, zonedToUtc } from "./tz";

/** The fields of an event that an .ics file can carry. */
export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timezone: string;
  recurrence: Recurrence | null;
  exdates: string[];
}

export interface IcsParseResult {
  events: IcsEvent[];
  /** Things that couldn't be carried over exactly, for the user to read. */
  warnings: string[];
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Splits `NAME;PARAM=x:value` into its pieces. */
function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf("=");
    if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

interface ParsedTime {
  instant: Date;
  allDay: boolean;
  zone: string | null;
}

function parseTime(value: string, params: Record<string, string>, fallbackZone: string): ParsedTime | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return { instant: new Date(Date.UTC(+date[1], +date[2] - 1, +date[3])), allDay: true, zone: null };
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!time) return null;
  const parts = { year: +time[1], month: +time[2], day: +time[3], hour: +time[4], minute: +time[5], second: +time[6] };
  if (time[7]) return { instant: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)), allDay: false, zone: "UTC" };
  const zone = params.TZID && isValidTimeZone(params.TZID) ? params.TZID : fallbackZone;
  return { instant: zonedToUtc(parts, zone), allDay: false, zone: params.TZID && isValidTimeZone(params.TZID) ? params.TZID : null };
}

function parseDuration(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return null;
  const [, w, d, h, m, s] = match.map((part) => Number(part ?? 0));
  return (((w * 7 + d) * 24 + h) * 60 + m) * 60_000 + s * 1000;
}

function parseRule(value: string, warnings: string[], title: string): Recurrence | null {
  const parts = Object.fromEntries(value.split(";").map((piece) => piece.split("=") as [string, string]));
  const freq = String(parts.FREQ ?? "").toLowerCase() as Frequency;
  if (!FREQUENCIES.includes(freq)) {
    warnings.push(`"${title}" repeats in a way Omni doesn't support (${parts.FREQ ?? "unknown"}), so only its first occurrence was imported.`);
    return null;
  }
  const unsupported = Object.keys(parts).filter((key) => !["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"].includes(key));
  if (unsupported.length) warnings.push(`"${title}" uses repeat options Omni ignores (${unsupported.join(", ")}), so its schedule may differ slightly.`);
  const rule: Recurrence = { freq, interval: Math.min(99, Math.max(1, Number(parts.INTERVAL) || 1)) };
  if (parts.COUNT && Number(parts.COUNT) > 0) rule.count = Math.min(999, Number(parts.COUNT));
  if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (m) rule.until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (freq === "weekly" && parts.BYDAY) {
    const days = parts.BYDAY.split(",").map((day) => DAY_CODES.indexOf(day.replace(/^[+-]?\d*/, "")));
    if (days.every((day) => day >= 0)) rule.byDay = days;
  }
  return rule;
}

export function parseIcs(text: string, defaultZone: string): IcsParseResult {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  const warnings: string[] = [];
  let current: { name: string; params: Record<string, string>; value: string }[] | null = null;

  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) current = [];
    else if (/^END:VEVENT$/i.test(line) && current) {
      const props = current;
      current = null;
      const get = (name: string) => props.find((prop) => prop.name === name);
      const title = unescapeText(get("SUMMARY")?.value ?? "").trim() || "Untitled event";
      const start = get("DTSTART");
      const parsedStart = start ? parseTime(start.value, start.params, defaultZone) : null;
      if (!parsedStart) {
        warnings.push(`Skipped "${title}": it has no valid start time.`);
        continue;
      }
      const zone = parsedStart.zone && parsedStart.zone !== "UTC" ? parsedStart.zone : parsedStart.zone === "UTC" ? defaultZone : defaultZone;
      const end = get("DTEND");
      const parsedEnd = end ? parseTime(end.value, end.params, defaultZone) : null;
      const durationProp = get("DURATION");
      let endsAt: Date;
      if (parsedEnd) endsAt = parsedEnd.instant;
      else if (durationProp && parseDuration(durationProp.value) !== null) endsAt = new Date(parsedStart.instant.getTime() + parseDuration(durationProp.value)!);
      else endsAt = new Date(parsedStart.instant.getTime() + (parsedStart.allDay ? 86_400_000 : 0));
      if (endsAt < parsedStart.instant) endsAt = parsedStart.instant;

      const rule = get("RRULE") ? parseRule(get("RRULE")!.value, warnings, title) : null;
      const exdates: string[] = [];
      for (const prop of props.filter((p) => p.name === "EXDATE")) {
        for (const value of prop.value.split(",")) {
          const t = parseTime(value.trim(), prop.params, zone);
          if (t) exdates.push(t.allDay ? t.instant.toISOString().slice(0, 10) : dateKeyOf(zonedParts(t.instant, zone)));
        }
      }
      events.push({
        uid: get("UID")?.value.trim() || `${title}-${parsedStart.instant.toISOString()}`,
        title: title.slice(0, 200),
        description: unescapeText(get("DESCRIPTION")?.value ?? "").slice(0, 10_000),
        location: unescapeText(get("LOCATION")?.value ?? "").slice(0, 300),
        startsAt: parsedStart.instant,
        endsAt,
        allDay: parsedStart.allDay,
        timezone: zone,
        recurrence: rule,
        exdates,
      });
    } else if (current) {
      const parsed = splitLine(line);
      if (parsed) current.push(parsed);
    }
  }
  return { events, warnings };
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateStamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

/** Folds long lines at 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char) > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = char;
    } else current += char;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function generateIcs(events: IcsEvent[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Omni//Calendar//EN", "CALSCALE:GREGORIAN"];
  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${utcStamp(now)}`);
    if (event.allDay) lines.push(`DTSTART;VALUE=DATE:${dateStamp(event.startsAt)}`, `DTEND;VALUE=DATE:${dateStamp(event.endsAt)}`);
    else lines.push(`DTSTART:${utcStamp(event.startsAt)}`, `DTEND:${utcStamp(event.endsAt)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.recurrence) {
      const rule = event.recurrence;
      const parts = [`FREQ=${rule.freq.toUpperCase()}`, `INTERVAL=${rule.interval}`];
      if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.map((day) => DAY_CODES[day]).join(",")}`);
      if (rule.count) parts.push(`COUNT=${rule.count}`);
      if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, "")}`);
      lines.push(`RRULE:${parts.join(";")}`);
      for (const key of event.exdates) {
        const [y, m, d] = key.split("-").map(Number);
        if (event.allDay) lines.push(`EXDATE;VALUE=DATE:${key.replace(/-/g, "")}`);
        else {
          const local = zonedParts(event.startsAt, event.timezone);
          lines.push(`EXDATE:${utcStamp(zonedToUtc({ year: y, month: m, day: d, hour: local.hour, minute: local.minute, second: local.second }, event.timezone))}`);
        }
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
