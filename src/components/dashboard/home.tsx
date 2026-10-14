"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import type { DashboardDto, DashboardTask } from "@/lib/dashboard-types";
import { formatDateKey, localDateKey } from "@/lib/dates";
import { formatRelativeDate, formatUsd } from "@/lib/format";
import { getGreeting } from "@/lib/greeting";
import { cn } from "@/lib/utils";

const PRIORITY_DOT: Record<DashboardTask["priority"], string> = {
  low: "bg-muted-foreground/40",
  medium: "bg-muted-foreground",
  high: "bg-warning",
  urgent: "bg-danger",
};

export function HomeDashboard() {
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<{ dashboard: DashboardDto }>(`/api/dashboard?today=${localDateKey()}&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);
      setData(result.dashboard);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't load your dashboard.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the date is only known on the client
    setNow(new Date());
    void load();
  }, [load]);

  const focus = data ? [...data.overdue, ...data.dueToday.filter((task) => !data.overdue.some((late) => late.id === task.id))] : [];

  return (
    <div className="min-w-0 space-y-10">
      <header className="flex flex-col gap-1">
        <p className="eyebrow" suppressHydrationWarning>
          {now ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : " "}
        </p>
        <h1 className="font-display text-4xl font-medium leading-tight sm:text-5xl" suppressHydrationWarning>
          {now ? getGreeting(now) : "Welcome"}.
        </h1>
        {data ? <Summary data={data} /> : null}
      </header>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-10">
          {data ? <WeekStrip week={data.week} today={data.today} /> : null}
          {data && data.events.length > 0 ? (
            <section aria-labelledby="schedule-heading" className="space-y-3">
              <SectionTitle id="schedule-heading" title="Today's schedule" href="/calendar" linkLabel="Calendar" />
              <ul className="divide-y divide-border border-y border-border">
                {data.events.map((event) => (
                  <li key={event.id} className="flex items-baseline gap-4 py-2.5">
                    <span className="num w-32 shrink-0 text-xs text-muted-foreground">
                      {event.allDay ? "All day" : `${new Date(event.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${new Date(event.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}
                    </span>
                    <Link href="/calendar" className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                      {event.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="focus-heading" className="space-y-3">
            <SectionTitle id="focus-heading" title="Needs your attention" href="/tasks" linkLabel="All tasks" />
            <QuickAdd onAdded={load} />
            {!data ? (
              <Placeholder rows={3} />
            ) : focus.length === 0 ? (
              <p className="border-y border-dashed border-border py-6 text-sm text-muted-foreground">
                Nothing is due today and nothing is overdue.
                {data.counts.inProgress > 0 ? " Pick up something in progress below." : ""}
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {focus.map((task) => (
                  <TaskLine key={task.id} task={task} today={data.today} onDone={load} />
                ))}
              </ul>
            )}
          </section>

          {data && data.inProgress.length > 0 ? (
            <section aria-labelledby="progress-heading" className="space-y-3">
              <SectionTitle id="progress-heading" title="In progress" />
              <ul className="divide-y divide-border border-y border-border">
                {data.inProgress.map((task) => (
                  <TaskLine key={task.id} task={task} today={data.today} onDone={load} />
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="notes-heading" className="space-y-3">
            <SectionTitle id="notes-heading" title="Recent notes" href="/notes" linkLabel="All notes" />
            {!data ? (
              <Placeholder rows={2} />
            ) : data.notes.length === 0 ? (
              <p className="border-y border-dashed border-border py-6 text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {data.notes.map((note) => (
                  <li key={note.id}>
                    <Link href={`/notes/${note.id}`} className="flex items-baseline gap-4 py-2.5 hover:text-primary">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{note.title || "Untitled"}</span>
                        {note.excerpt ? <span className="ml-2 text-sm text-muted-foreground">{note.excerpt}</span> : null}
                      </span>
                      <span className="num shrink-0 text-xs text-muted-foreground">{formatRelativeDate(note.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-10">
          <section aria-labelledby="projects-heading" className="space-y-3">
            <SectionTitle id="projects-heading" title="Active projects" href="/projects" linkLabel="All projects" />
            {!data ? (
              <Placeholder rows={2} />
            ) : data.projects.length === 0 ? (
              <p className="border-y border-dashed border-border py-6 text-sm text-muted-foreground">No active projects.</p>
            ) : (
              <ul className="space-y-4">
                {data.projects.map((project) => (
                  <li key={project.id}>
                    <Link href={`/projects/${project.id}`} className="group block">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium group-hover:text-primary">{project.name}</span>
                        <span className="num shrink-0 text-sm text-muted-foreground">{project.progress}%</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={project.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${project.name} progress`}>
                        <div className="h-full bg-primary" style={{ width: `${project.progress}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {project.done} of {project.total} tasks
                        {project.overdue > 0 ? <span className="text-danger"> · {project.overdue} overdue</span> : null}
                        {project.dueDate ? ` · due ${formatDateKey(project.dueDate)}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="runs-heading" className="space-y-3">
            <SectionTitle id="runs-heading" title="Agent runs" href="/agents" linkLabel="Agents" />
            {!data ? (
              <Placeholder rows={2} />
            ) : data.runs.length === 0 ? (
              <p className="border-y border-dashed border-border py-6 text-sm text-muted-foreground">No agent has run yet.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {data.runs.map((run) => (
                  <li key={run.id}>
                    <Link href={`/agents/runs/${run.id}`} className="block py-2.5 hover:text-primary">
                      <p className="truncate text-sm font-medium">{run.objective}</p>
                      <p className="mt-0.5 flex gap-2 text-xs text-muted-foreground">
                        <span>{run.agentName}</span>
                        <span aria-hidden>·</span>
                        <span className="capitalize">{run.status.replaceAll("_", " ")}</span>
                        <span aria-hidden>·</span>
                        <span>{formatRelativeDate(run.createdAt)}</span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data ? (
            <section aria-labelledby="spend-heading" className="space-y-1">
              <SectionTitle id="spend-heading" title="AI spend this month" href="/settings" linkLabel="Usage" />
              <p className="font-display num text-3xl">{formatUsd(data.spend.monthUsd)}</p>
              <p className="text-xs text-muted-foreground">
                {data.spend.budgetUsd !== null ? `of your ${formatUsd(data.spend.budgetUsd)} limit` : "No monthly limit set"}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Summary({ data }: { data: DashboardDto }) {
  const parts: string[] = [];
  if (data.counts.overdue > 0) parts.push(`${data.counts.overdue} overdue`);
  if (data.counts.dueToday > 0) parts.push(`${data.counts.dueToday} due today`);
  parts.push(`${data.counts.open} open ${data.counts.open === 1 ? "task" : "tasks"}`);
  return <p className="num mt-1 text-sm text-muted-foreground">{parts.join(" · ")}</p>;
}

function SectionTitle({ id, title, href, linkLabel }: { id: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="eyebrow">
        {title}
      </h2>
      {href ? (
        <Link href={href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {linkLabel} <ArrowRight className="size-3" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function Placeholder({ rows }: { rows: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-9 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function TaskLine({ task, today, onDone }: { task: DashboardTask; today: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const late = task.dueDate !== null && task.dueDate < today;

  async function complete() {
    setBusy(true);
    try {
      await apiRequest(`/api/tasks/${task.id}`, { method: "PATCH", json: { status: "done" } });
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={() => void complete()}
        disabled={busy}
        aria-label={`Mark "${task.title}" done`}
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-input text-transparent transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
      >
        <Check className="size-3" aria-hidden />
      </button>
      <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} title={`${task.priority} priority`} />
      <Link href="/tasks" className="min-w-0 flex-1 truncate hover:text-primary">
        {task.title}
      </Link>
      {task.projectName ? <span className="hidden truncate text-xs text-muted-foreground sm:block sm:max-w-32">{task.projectName}</span> : null}
      {task.dueDate ? (
        <span className={cn("num shrink-0 text-xs", late ? "text-danger" : "text-muted-foreground")}>{late ? "Overdue · " : ""}{formatDateKey(task.dueDate).replace(/, \d{4}$/, "")}</span>
      ) : null}
    </li>
  );
}

function QuickAdd({ onAdded }: { onAdded: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/tasks", { json: { title: trimmed, dueDate: localDateKey() } });
      setTitle("");
      await onAdded();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't add that task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex gap-2">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task for today" aria-label="New task for today" maxLength={200} />
        <Button type="submit" variant="outline" disabled={busy || !title.trim()}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </form>
  );
}

function WeekStrip({ week, today }: { week: DashboardDto["week"]; today: string }) {
  return (
    <section aria-labelledby="week-heading" className="space-y-3">
      <SectionTitle id="week-heading" title="This week" href="/calendar" linkLabel="Calendar" />
      <ol className="grid grid-cols-7 overflow-hidden rounded-lg border border-border bg-card">
        {week.map((day, index) => {
          const date = new Date(`${day.date}T12:00:00`);
          const isToday = day.date === today;
          const busy = day.tasksDue + day.events;
          return (
            <li key={day.date} className={`min-w-0 px-1.5 py-3 text-center sm:px-3 ${index > 0 ? "border-l border-border" : ""} ${isToday ? "bg-primary/[0.06]" : ""}`}>
              <p className="eyebrow">{date.toLocaleDateString(undefined, { weekday: "short" })}</p>
              <p className={`num mt-1 font-display text-2xl leading-none ${isToday ? "text-primary" : ""}`}>{date.getDate()}</p>
              <p className="mt-2 flex h-4 items-center justify-center gap-1" aria-label={busy ? `${day.tasksDue} due, ${day.events} events` : "Nothing scheduled"}>
                {busy === 0 ? <span className="size-1 rounded-full bg-border" aria-hidden /> : null}
                {Array.from({ length: Math.min(day.tasksDue, 3) }, (_, i) => <span key={`t${i}`} className="size-1.5 rounded-full bg-primary" aria-hidden />)}
                {Array.from({ length: Math.min(day.events, 3) }, (_, i) => <span key={`e${i}`} className="size-1.5 rounded-full border border-primary" aria-hidden />)}
              </p>
              <p className="num mt-1 hidden text-[11px] text-muted-foreground sm:block">{busy ? `${day.tasksDue ? `${day.tasksDue} due` : ""}${day.tasksDue && day.events ? " · " : ""}${day.events ? `${day.events} ev` : ""}` : "\u00a0"}</p>
            </li>
          );
        })}
      </ol>
      <p className="flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-primary" aria-hidden />Task due</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full border border-primary" aria-hidden />Event</span>
      </p>
    </section>
  );
}
