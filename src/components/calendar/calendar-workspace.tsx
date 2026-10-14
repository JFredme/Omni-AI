"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Flag, Plus, Upload, Wand2 } from "lucide-react";
import { ProposalDialog } from "@/components/ai/proposal-dialog";
import { EventDialog, localZone } from "@/components/calendar/event-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { addDays, localDateKey } from "@/lib/dates";
import type { CalendarMilestoneDto, CalendarRangeDto, CalendarTaskDto, OccurrenceDto } from "@/lib/calendar/types";
import { formatTimeRange, layoutLanes, minutesIntoDay, monthGrid, occurrenceDays, rangeForView, sameMonth, shiftMonth, startOfWeek, weekDays, type CalendarView } from "@/lib/calendar/view";
import { cn } from "@/lib/utils";

const VIEWS: { id: CalendarView; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];
const HOUR_PX = 48;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayLabel = (key: string, options: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...options });

interface Item {
  kind: "event";
  occurrence: OccurrenceDto;
}

type Editing = { eventId: string | null; occurrence: OccurrenceDto | null; defaultDate: string; defaultHour?: number };

export function CalendarWorkspace() {
  const zone = useMemo(() => localZone(), []);
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(() => localDateKey());
  const [data, setData] = useState<CalendarRangeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState<"setup" | "review" | null>(null);
  const [plan, setPlan] = useState({ days: 5, workStart: "09:00", workEnd: "17:00" });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const today = localDateKey();

  const load = useCallback(async () => {
    const { from, to } = rangeForView(view, cursor, zone);
    try {
      const result = await apiRequest<CalendarRangeDto>(`/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't load your calendar.");
    }
  }, [view, cursor, zone]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when the visible range changes
    void load();
  }, [load]);

  const { byDay, tasksByDay, milestonesByDay } = useMemo(() => {
    const events = new Map<string, Item[]>();
    const tasks = new Map<string, CalendarTaskDto[]>();
    const milestones = new Map<string, CalendarMilestoneDto[]>();
    for (const occurrence of data?.occurrences ?? []) {
      for (const day of occurrenceDays(occurrence, zone)) events.set(day, [...(events.get(day) ?? []), { kind: "event", occurrence }]);
    }
    for (const task of data?.tasks ?? []) tasks.set(task.dueDate, [...(tasks.get(task.dueDate) ?? []), task]);
    for (const milestone of data?.milestones ?? []) milestones.set(milestone.dueDate, [...(milestones.get(milestone.dueDate) ?? []), milestone]);
    for (const [day, items] of events) {
      events.set(day, items.sort((a, b) => Number(b.occurrence.allDay) - Number(a.occurrence.allDay) || a.occurrence.start.localeCompare(b.occurrence.start)));
    }
    return { byDay: events, tasksByDay: tasks, milestonesByDay: milestones };
  }, [data, zone]);

  function step(direction: -1 | 1) {
    setCursor((current) => (view === "month" ? shiftMonth(current, direction) : addDays(current, direction * (view === "week" ? 7 : 30))));
  }

  const title =
    view === "month"
      ? dayLabel(cursor, { month: "long", year: "numeric" })
      : view === "week"
        ? `${dayLabel(weekDays(cursor)[0], { month: "short", day: "numeric" })} – ${dayLabel(weekDays(cursor)[6], { month: "short", day: "numeric", year: "numeric" })}`
        : `From ${dayLabel(cursor, { month: "long", day: "numeric" })}`;

  async function importFile(file: File) {
    setNotice(null);
    setWarnings([]);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("timezone", zone);
      const response = await fetch("/api/calendar/import", { method: "POST", body: form });
      const body = (await response.json()) as { created?: number; updated?: number; warnings?: string[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The import failed.");
      setNotice(`Imported ${body.created} new and ${body.updated} updated event${(body.created ?? 0) + (body.updated ?? 0) === 1 ? "" : "s"}.`);
      setWarnings(body.warnings ?? []);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import failed.");
    }
  }

  const openNew = (day: string) => setEditing({ eventId: null, occurrence: null, defaultDate: day });
  const openEvent = (occurrence: OccurrenceDto) => setEditing({ eventId: occurrence.eventId, occurrence, defaultDate: cursor });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Calendar"
        title={title}
        description="Events, repeats, and the tasks and milestones that are due. Times are shown in your time zone."
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".ics,text/calendar"
              hidden
              aria-label="Choose a calendar file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" aria-hidden /> Import .ics
            </Button>
            <a href="/api/calendar/export" download className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-4 text-sm font-medium transition-colors hover:bg-accent">
              <Download className="size-4" aria-hidden /> Export
            </a>
            <Button variant="outline" onClick={() => setScheduling("setup")}>
              <Wand2 className="size-4" aria-hidden /> Plan my tasks
            </Button>
            <Button variant="primary" onClick={() => openNew(cursor === today || sameMonth(cursor, today) ? today : cursor)}>
              <Plus className="size-4" aria-hidden /> New event
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" onClick={() => step(-1)} aria-label={`Previous ${view === "month" ? "month" : view === "week" ? "week" : "30 days"}`}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button size="icon" variant="outline" onClick={() => step(1)} aria-label={`Next ${view === "month" ? "month" : view === "week" ? "week" : "30 days"}`}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setCursor(today)}>
            Today
          </Button>
        </div>
        <div role="tablist" aria-label="Calendar view" className="ml-auto flex rounded-lg border border-input p-0.5">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              type="button"
              aria-selected={view === entry.id}
              onClick={() => setView(entry.id)}
              className={cn("rounded-md px-3 py-1 text-sm", view === entry.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <div role="status" className="space-y-1 text-sm">
          <p className="text-success">{notice}</p>
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-warning">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {view === "month" ? (
        <MonthView cursor={cursor} today={today} byDay={byDay} tasksByDay={tasksByDay} milestonesByDay={milestonesByDay} onDay={openNew} onEvent={openEvent} onMore={(day) => { setCursor(day); setView("week"); }} loaded={data !== null} />
      ) : view === "week" ? (
        <WeekView cursor={cursor} today={today} zone={zone} byDay={byDay} tasksByDay={tasksByDay} milestonesByDay={milestonesByDay} onSlot={(day, hour) => setEditing({ eventId: null, occurrence: null, defaultDate: day, defaultHour: hour })} onEvent={openEvent} />
      ) : (
        <AgendaView cursor={cursor} today={today} byDay={byDay} tasksByDay={tasksByDay} milestonesByDay={milestonesByDay} onEvent={openEvent} loaded={data !== null} />
      )}

      {scheduling === "setup" ? (
        <Dialog
          title="Plan time for your tasks"
          description="The assistant suggests when to work on your open tasks, around what's already on your calendar. Nothing is added until you review and confirm."
          onClose={() => setScheduling(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setScheduling(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={plan.workEnd <= plan.workStart} onClick={() => setScheduling("review")}>
                Suggest a plan
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Plan the next" htmlFor="plan-days">
              <Select id="plan-days" value={plan.days} onChange={(e) => setPlan({ ...plan, days: Number(e.target.value) })}>
                {[1, 3, 5, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {n} day{n === 1 ? "" : "s"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work starts" htmlFor="plan-start">
              <Input id="plan-start" type="time" value={plan.workStart} onChange={(e) => setPlan({ ...plan, workStart: e.target.value })} />
            </Field>
            <Field label="Work ends" htmlFor="plan-end">
              <Input id="plan-end" type="time" value={plan.workEnd} onChange={(e) => setPlan({ ...plan, workEnd: e.target.value })} />
            </Field>
          </div>
          {plan.workEnd <= plan.workStart ? <p role="alert" className="mt-2 text-xs text-danger">Work should end after it starts.</p> : null}
        </Dialog>
      ) : null}
      {scheduling === "review" ? (
        <ProposalDialog
          request={{ kind: "schedule_tasks", from: today, days: plan.days, timezone: zone, workStart: plan.workStart, workEnd: plan.workEnd }}
          onClose={() => setScheduling(null)}
          onApplied={(result) => {
            setScheduling(null);
            setNotice(result.message);
            setWarnings([]);
            void load();
          }}
        />
      ) : null}

      {editing ? (
        <EventDialog
          eventId={editing.eventId}
          occurrence={editing.occurrence}
          defaultDate={editing.defaultDate}
          defaultHour={editing.defaultHour}
          onClose={() => setEditing(null)}
          onChanged={(message) => {
            setEditing(null);
            setNotice(message);
            setWarnings([]);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

interface ViewProps {
  cursor: string;
  today: string;
  byDay: Map<string, Item[]>;
  tasksByDay: Map<string, CalendarTaskDto[]>;
  milestonesByDay: Map<string, CalendarMilestoneDto[]>;
  onEvent: (occurrence: OccurrenceDto) => void;
}

function TaskChip({ task }: { task: CalendarTaskDto }) {
  return (
    <Link href="/tasks" title={`Task due: ${task.title}`} className={cn("flex items-center gap-1 truncate rounded-sm border border-dashed border-border px-1.5 py-0.5 text-[11px] hover:bg-accent", task.status === "done" && "text-muted-foreground line-through")}>
      <span aria-hidden>☐</span>
      <span className="truncate">{task.title}</span>
    </Link>
  );
}

function MilestoneChip({ milestone }: { milestone: CalendarMilestoneDto }) {
  return (
    <Link href={`/projects/${milestone.projectId}`} title={`Milestone in ${milestone.projectName}`} className="flex items-center gap-1 truncate rounded-sm bg-accent px-1.5 py-0.5 text-[11px] hover:bg-accent/70">
      <Flag className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{milestone.title}</span>
    </Link>
  );
}

function EventChip({ occurrence, zone, onClick }: { occurrence: OccurrenceDto; zone?: string; onClick: () => void }) {
  const time = occurrence.allDay ? null : new Date(occurrence.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone });
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={`${occurrence.title} · ${formatTimeRange(occurrence.start, occurrence.end, occurrence.allDay)}`}
      className={cn("flex w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-left text-[11px]", occurrence.allDay ? "bg-primary text-primary-foreground" : "bg-primary/15 hover:bg-primary/25")}
    >
      {time ? <span className="num shrink-0 text-muted-foreground">{time}</span> : null}
      <span className="truncate font-medium">{occurrence.title}</span>
    </button>
  );
}

function MonthView({ cursor, today, byDay, tasksByDay, milestonesByDay, onDay, onEvent, onMore, loaded }: ViewProps & { onDay: (day: string) => void; onMore: (day: string) => void; loaded: boolean }) {
  const grid = monthGrid(cursor);
  const zone = useMemo(() => localZone(), []);
  return (
    <div className="overflow-hidden rounded-lg border border-border" aria-busy={!loaded}>
      <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center">
        {WEEKDAY_NAMES.map((name) => (
          <div key={name} className="eyebrow py-1.5">
            {name}
          </div>
        ))}
      </div>
      {grid.map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
          {week.map((day) => {
            const events = byDay.get(day) ?? [];
            const tasks = tasksByDay.get(day) ?? [];
            const milestones = milestonesByDay.get(day) ?? [];
            const total = events.length + tasks.length + milestones.length;
            const visible = [
              ...events.map((item) => <EventChip key={`${item.occurrence.eventId}-${item.occurrence.key}`} occurrence={item.occurrence} zone={zone} onClick={() => onEvent(item.occurrence)} />),
              ...milestones.map((m) => <MilestoneChip key={m.id} milestone={m} />),
              ...tasks.map((t) => <TaskChip key={t.id} task={t} />),
            ];
            return (
              <div
                key={day}
                role="gridcell"
                aria-label={dayLabel(day, { weekday: "long", month: "long", day: "numeric" })}
                onClick={() => onDay(day)}
                className={cn("min-h-24 cursor-pointer space-y-0.5 border-r border-border p-1 last:border-r-0 hover:bg-accent/30 sm:min-h-28", !sameMonth(day, cursor) && "bg-muted/30 text-muted-foreground")}
              >
                <p className={cn("num mb-0.5 inline-flex size-6 items-center justify-center rounded-full text-xs", day === today && "bg-primary font-semibold text-primary-foreground")}>{Number(day.slice(8))}</p>
                {visible.slice(0, 3)}
                {total > 3 ? (
                  <button type="button" onClick={(event) => { event.stopPropagation(); onMore(day); }} className="px-1 text-[11px] text-muted-foreground hover:text-foreground">
                    +{total - 3} more
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekView({ cursor, today, zone, byDay, tasksByDay, milestonesByDay, onEvent, onSlot }: ViewProps & { zone: string; onSlot: (day: string, hour: number) => void }) {
  const days = weekDays(startOfWeek(cursor));
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7.5 * HOUR_PX;
  }, [cursor]);
  const nowMinutes = minutesIntoDay(new Date().toISOString(), zone);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/40">
        <div />
        {days.map((day) => (
          <div key={day} className="border-l border-border px-1 py-1.5 text-center">
            <p className="eyebrow">{dayLabel(day, { weekday: "short" })}</p>
            <p className={cn("num mx-auto mt-0.5 inline-flex size-7 items-center justify-center rounded-full text-sm", day === today && "bg-primary font-semibold text-primary-foreground")}>{Number(day.slice(8))}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-border">
        <div className="eyebrow px-1 py-1 text-right">all-day</div>
        {days.map((day) => (
          <div key={day} className="min-h-7 space-y-0.5 border-l border-border p-0.5">
            {(byDay.get(day) ?? []).filter((item) => item.occurrence.allDay).map((item) => <EventChip key={`${item.occurrence.eventId}-${item.occurrence.key}`} occurrence={item.occurrence} onClick={() => onEvent(item.occurrence)} />)}
            {(milestonesByDay.get(day) ?? []).map((m) => <MilestoneChip key={m.id} milestone={m} />)}
            {(tasksByDay.get(day) ?? []).map((t) => <TaskChip key={t.id} task={t} />)}
          </div>
        ))}
      </div>

      <div ref={scroller} className="max-h-[32rem] overflow-y-auto">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="num absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: hour * HOUR_PX }}>
                {hour === 0 ? "" : new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" })}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const timed = (byDay.get(day) ?? []).filter((item) => !item.occurrence.allDay);
            const blocks = timed.map((item) => {
              const start = minutesIntoDay(item.occurrence.start, zone);
              const length = Math.max(20, (Date.parse(item.occurrence.end) - Date.parse(item.occurrence.start)) / 60_000);
              return { id: `${item.occurrence.eventId}-${item.occurrence.key}`, start, end: Math.min(24 * 60, start + length), item };
            });
            const lanes = layoutLanes(blocks);
            return (
              <div key={day} className="relative border-l border-border" onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                onSlot(day, Math.min(23, Math.max(0, Math.floor((event.clientY - box.top) / HOUR_PX))));
              }}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="absolute inset-x-0 border-t border-border/60" style={{ top: hour * HOUR_PX }} />
                ))}
                {day === today ? <div className="absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: (nowMinutes / 60) * HOUR_PX }} aria-hidden /> : null}
                {blocks.map((block) => {
                  const position = lanes.get(block.id)!;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      onClick={(event) => { event.stopPropagation(); onEvent(block.item.occurrence); }}
                      title={`${block.item.occurrence.title} · ${formatTimeRange(block.item.occurrence.start, block.item.occurrence.end, false)}`}
                      className="absolute overflow-hidden rounded-sm border border-primary/40 bg-primary/20 px-1.5 py-0.5 text-left text-[11px] hover:bg-primary/30"
                      style={{ top: (block.start / 60) * HOUR_PX, height: Math.max(18, ((block.end - block.start) / 60) * HOUR_PX - 1), left: `${(position.lane / position.lanes) * 100}%`, width: `${100 / position.lanes}%` }}
                    >
                      <span className="block truncate font-medium">{block.item.occurrence.title}</span>
                      <span className="num block truncate text-muted-foreground">{formatTimeRange(block.item.occurrence.start, block.item.occurrence.end, false)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgendaView({ cursor, today, byDay, tasksByDay, milestonesByDay, onEvent, loaded }: ViewProps & { loaded: boolean }) {
  const days = Array.from({ length: 30 }, (_, i) => addDays(cursor, i)).filter((day) => (byDay.get(day)?.length ?? 0) + (tasksByDay.get(day)?.length ?? 0) + (milestonesByDay.get(day)?.length ?? 0) > 0);
  if (!loaded) return <div className="h-40 animate-pulse rounded-lg bg-muted" role="status" aria-label="Loading" />;
  if (days.length === 0) return <p className="border-y border-dashed border-border py-10 text-center text-sm text-muted-foreground">Nothing scheduled in the next 30 days.</p>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {days.map((day) => (
        <li key={day} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[9rem_1fr]">
          <p className={cn("text-sm font-medium", day === today && "text-primary")}>
            {dayLabel(day, { weekday: "short", month: "short", day: "numeric" })}
            {day === today ? <span className="eyebrow ml-2">today</span> : null}
          </p>
          <ul className="space-y-1">
            {(byDay.get(day) ?? []).map((item) => (
              <li key={`${item.occurrence.eventId}-${item.occurrence.key}`}>
                <button type="button" onClick={() => onEvent(item.occurrence)} className="flex w-full items-baseline gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-accent">
                  <span className="num w-36 shrink-0 text-xs text-muted-foreground">{formatTimeRange(item.occurrence.start, item.occurrence.end, item.occurrence.allDay)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.occurrence.title}</span>
                  {item.occurrence.location ? <span className="hidden truncate text-xs text-muted-foreground sm:block">{item.occurrence.location}</span> : null}
                </button>
              </li>
            ))}
            {(milestonesByDay.get(day) ?? []).map((m) => (
              <li key={m.id} className="px-2 py-1 text-sm"><MilestoneChip milestone={m} /></li>
            ))}
            {(tasksByDay.get(day) ?? []).map((t) => (
              <li key={t.id} className="px-2 py-1 text-sm"><TaskChip task={t} /></li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
