"use client";

import { useEffect, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { addDays } from "@/lib/dates";
import type { Recurrence } from "@/lib/calendar/recurrence";
import { zonedParts, zonedToUtc } from "@/lib/calendar/tz";
import type { EventDto, OccurrenceDto } from "@/lib/calendar/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function toFields(iso: string, zone: string) {
  const p = zonedParts(new Date(iso), zone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

function toInstant(date: string, time: string, zone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return zonedToUtc({ year, month, day, hour, minute, second: 0 }, zone);
}

interface Draft {
  title: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  repeat: "none" | Recurrence["freq"];
  interval: number;
  days: number[];
  endMode: "never" | "until" | "count";
  until: string;
  count: number;
}

function initialDraft(event: EventDto | null, occurrence: OccurrenceDto | null, defaultDate: string, zone: string, defaultHour = 9): Draft {
  if (!event) {
    return { title: "", allDay: false, startDate: defaultDate, startTime: `${pad(defaultHour)}:00`, endDate: defaultDate, endTime: defaultHour >= 23 ? "23:59" : `${pad(defaultHour + 1)}:00`, location: "", description: "", repeat: "none", interval: 1, days: [], endMode: "never", until: "", count: 10 };
  }
  // For a repeating event, show the date that was clicked rather than the first one.
  const startIso = occurrence?.start ?? event.startsAt;
  const endIso = occurrence?.end ?? event.endsAt;
  const rule = event.recurrence;
  const base = event.allDay
    ? { startDate: startIso.slice(0, 10), startTime: "09:00", endDate: addDays(endIso.slice(0, 10), -1), endTime: "10:00" }
    : (() => {
        const s = toFields(startIso, zone);
        const e = toFields(endIso, zone);
        return { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time };
      })();
  return {
    title: event.title,
    allDay: event.allDay,
    ...base,
    location: event.location,
    description: event.description,
    repeat: rule?.freq ?? "none",
    interval: rule?.interval ?? 1,
    days: rule?.byDay ?? [],
    endMode: rule?.until ? "until" : rule?.count ? "count" : "never",
    until: rule?.until ?? "",
    count: rule?.count ?? 10,
  };
}

function toRecurrence(draft: Draft): Recurrence | null {
  if (draft.repeat === "none") return null;
  return {
    freq: draft.repeat,
    interval: Math.max(1, Math.min(99, Math.round(draft.interval) || 1)),
    ...(draft.repeat === "weekly" && draft.days.length ? { byDay: [...draft.days].sort() } : {}),
    ...(draft.endMode === "until" && draft.until ? { until: draft.until } : {}),
    ...(draft.endMode === "count" ? { count: Math.max(1, Math.min(999, Math.round(draft.count) || 1)) } : {}),
  };
}

type Scope = "this" | "all";

/** Create an event, or edit/delete one. Changing a repeating event asks whether it's this date or the whole series. */
export function EventDialog({
  eventId,
  occurrence,
  defaultDate,
  defaultHour,
  onClose,
  onChanged,
}: {
  eventId: string | null;
  occurrence: OccurrenceDto | null;
  defaultDate: string;
  defaultHour?: number;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const formId = useId();
  const zone = localZone();
  const [event, setEvent] = useState<EventDto | null>(null);
  const [loading, setLoading] = useState(eventId !== null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(null, null, defaultDate, zone, defaultHour));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<"save" | "delete" | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    apiRequest<{ event: EventDto }>(`/api/calendar/${eventId}`)
      .then(({ event: loaded }) => {
        if (cancelled) return;
        setEvent(loaded);
        setDraft(initialDraft(loaded, occurrence, defaultDate, zone));
        setLoading(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof ClientApiError ? caught.message : "Couldn't load that event.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once for the event that was opened
  }, [eventId]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const repeating = event?.recurrence != null;

  function times() {
    if (draft.allDay) return { start: draft.startDate, end: draft.endDate };
    return { start: toInstant(draft.startDate, draft.startTime, zone).toISOString(), end: toInstant(draft.endDate, draft.endTime, zone).toISOString() };
  }

  function validate(): string | null {
    if (!draft.title.trim()) return "Give the event a title.";
    if (!draft.startDate || !draft.endDate) return "Choose a date.";
    const { start, end } = times();
    if (draft.allDay ? end < start : new Date(end) < new Date(start)) return "The event can't end before it starts.";
    if (draft.repeat === "weekly" && draft.endMode === "until" && !draft.until) return "Choose the date the repeats stop.";
    if (draft.endMode === "until" && draft.until && draft.until < draft.startDate) return "The repeats can't stop before the event starts.";
    return null;
  }

  async function save(scope: Scope) {
    const problem = validate();
    if (problem) {
      setError(problem);
      setAsking(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { start, end } = times();
      const fields = {
        title: draft.title.trim(),
        description: draft.description,
        location: draft.location.trim(),
        allDay: draft.allDay,
        timezone: zone,
        recurrence: toRecurrence(draft),
      };
      if (!event) {
        await apiRequest("/api/calendar", { json: { ...fields, start, end } });
        onChanged("Event added.");
      } else {
        let patch: Record<string, unknown> = { ...fields, start, end };
        if (repeating && scope === "all" && occurrence) {
          // The form shows the clicked date; move the whole series by however far the time was moved.
          if (event.allDay) {
            const days = Math.round((Date.parse(`${draft.startDate}T00:00:00Z`) - Date.parse(occurrence.start)) / 86_400_000);
            const length = Math.round((Date.parse(`${draft.endDate}T00:00:00Z`) - Date.parse(`${draft.startDate}T00:00:00Z`)) / 86_400_000);
            const first = addDays(event.startsAt.slice(0, 10), days);
            patch = { ...fields, start: first, end: addDays(first, length) };
          } else {
            const shift = new Date(start).getTime() - new Date(occurrence.start).getTime();
            const length = new Date(end).getTime() - new Date(start).getTime();
            const first = new Date(Date.parse(event.startsAt) + shift);
            patch = { ...fields, start: first.toISOString(), end: new Date(first.getTime() + length).toISOString() };
          }
        }
        if (repeating && scope === "this") delete patch.recurrence;
        await apiRequest(`/api/calendar/${event.id}`, { method: "PATCH", json: { patch, scope: repeating ? scope : "all", occurrence: occurrence?.key } });
        onChanged("Event saved.");
      }
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save the event.");
      setSaving(false);
      setAsking(null);
    }
  }

  async function remove(scope: Scope) {
    if (!event) return;
    setSaving(true);
    try {
      const query = repeating ? `?scope=${scope}${scope === "this" && occurrence ? `&occurrence=${occurrence.key}` : ""}` : "";
      await apiRequest(`/api/calendar/${event.id}${query}`, { method: "DELETE" });
      onChanged("Event deleted.");
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't delete the event.");
      setSaving(false);
      setAsking(null);
    }
  }

  if (asking) {
    return (
      <Dialog
        title={asking === "save" ? "Save changes to…" : "Delete…"}
        description="This event repeats."
        onClose={() => setAsking(null)}
        footer={
          <Button variant="outline" onClick={() => setAsking(null)}>
            Cancel
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <Button variant="outline" disabled={saving} onClick={() => void (asking === "save" ? save("this") : remove("this"))}>
            Only this event ({occurrence?.key})
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => void (asking === "save" ? save("all") : remove("all"))}>
            All events in the series
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={event ? "Edit event" : "New event"}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {event ? (
            <Button variant="ghost" className="mr-auto text-danger" disabled={saving} onClick={() => (repeating ? setAsking("delete") : void remove("all"))}>
              <Trash2 className="size-4" aria-hidden /> Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="h-40 animate-pulse rounded-md bg-muted" role="status" aria-label="Loading" />
      ) : (
        <form
          id={formId}
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            if (repeating) {
              const problem = validate();
              if (problem) setError(problem);
              else setAsking("save");
            } else void save("all");
          }}
          className="space-y-4"
        >
          <Field label="Title" htmlFor="event-title">
            <Input id="event-title" data-autofocus value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={200} />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.allDay} onChange={(e) => set("allDay", e.target.checked)} className="accent-[var(--primary)]" />
            All day
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor="event-start-date">
              <div className="flex gap-2">
                <Input id="event-start-date" type="date" value={draft.startDate} onChange={(e) => { set("startDate", e.target.value); if (draft.endDate < e.target.value) set("endDate", e.target.value); }} />
                {!draft.allDay ? <Input aria-label="Start time" type="time" value={draft.startTime} onChange={(e) => set("startTime", e.target.value)} className="w-28" /> : null}
              </div>
            </Field>
            <Field label="Ends" htmlFor="event-end-date">
              <div className="flex gap-2">
                <Input id="event-end-date" type="date" value={draft.endDate} min={draft.startDate} onChange={(e) => set("endDate", e.target.value)} />
                {!draft.allDay ? <Input aria-label="End time" type="time" value={draft.endTime} onChange={(e) => set("endTime", e.target.value)} className="w-28" /> : null}
              </div>
            </Field>
          </div>

          <Field label="Repeat" htmlFor="event-repeat" hint={draft.repeat !== "none" ? `Repeats keep the same clock time in ${zone}, even when daylight saving changes.` : undefined}>
            <Select id="event-repeat" value={draft.repeat} onChange={(e) => set("repeat", e.target.value as Draft["repeat"])}>
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </Select>
          </Field>

          {draft.repeat !== "none" ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Every</span>
                <Input aria-label="Repeat interval" type="number" min={1} max={99} value={draft.interval} onChange={(e) => set("interval", Number(e.target.value))} className="w-20" />
                <span>{{ daily: "day(s)", weekly: "week(s)", monthly: "month(s)", yearly: "year(s)" }[draft.repeat]}</span>
              </div>
              {draft.repeat === "weekly" ? (
                <div role="group" aria-label="Repeat on" className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={draft.days.includes(index)}
                      onClick={() => set("days", draft.days.includes(index) ? draft.days.filter((d) => d !== index) : [...draft.days, index])}
                      className={`h-8 w-11 rounded-md border text-xs ${draft.days.includes(index) ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-accent"}`}
                    >
                      {name}
                    </button>
                  ))}
                  <p className="basis-full text-xs text-muted-foreground">{draft.days.length ? "" : "Leave empty to repeat on the start day."}</p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Select aria-label="Repeat ends" value={draft.endMode} onChange={(e) => set("endMode", e.target.value as Draft["endMode"])} className="w-40">
                  <option value="never">Never ends</option>
                  <option value="until">Ends on a date</option>
                  <option value="count">Ends after…</option>
                </Select>
                {draft.endMode === "until" ? <Input aria-label="Repeat until" type="date" value={draft.until} min={draft.startDate} onChange={(e) => set("until", e.target.value)} className="w-44" /> : null}
                {draft.endMode === "count" ? (
                  <>
                    <Input aria-label="Number of repeats" type="number" min={1} max={999} value={draft.count} onChange={(e) => set("count", Number(e.target.value))} className="w-24" />
                    <span>times</span>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <Field label="Location" htmlFor="event-location">
            <Input id="event-location" value={draft.location} onChange={(e) => set("location", e.target.value)} maxLength={300} />
          </Field>
          <Field label="Notes" htmlFor="event-notes">
            <Textarea id="event-notes" value={draft.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          </Field>
          {event?.taskTitle ? <p className="text-xs text-muted-foreground">Time set aside for the task “{event.taskTitle}”.</p> : null}
          {error ? <ErrorBanner message={error} /> : null}
        </form>
      )}
    </Dialog>
  );
}
