"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Columns3, FilterX, ListTodo, Plus, Search, Sparkles, Wand2 } from "lucide-react";
import { ProposalDialog } from "@/components/ai/proposal-dialog";
import { describeError } from "@/components/chat/use-model-catalog";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import type { ProposeRequest } from "@/lib/ai/schemas";
import { apiRequest } from "@/lib/client/api";
import { localDateKey } from "@/lib/dates";
import type { ProjectDto } from "@/lib/projects/types";
import {
  DUE_FILTERS,
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  TASK_SORT_LABELS,
  TASK_SORTS,
  type DueFilter,
  type TaskDto,
  type TaskFilters,
  type TaskSort,
  type TaskStatus,
} from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { TaskDialog } from "./task-dialog";

type View = "list" | "board";

const DUE_LABELS: Record<DueFilter, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Next 7 days",
  none: "No due date",
};

const STATUS_FILTERS: { value: TaskStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

function queryFor(filters: TaskFilters, view: View, today: string): string {
  const params = new URLSearchParams({ today });
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (view === "board" && (key === "status" || key === "sort")) continue;
    params.set(key, value);
  }
  return params.toString();
}

export function TasksWorkspace() {
  const [view, setView] = useState<View>("list");
  const [filters, setFilters] = useState<TaskFilters>({});
  const [search, setSearch] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<{ key: string; tasks: TaskDto[] } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [dialog, setDialog] = useState<{ task: TaskDto | null } | null>(null);
  const [ai, setAi] = useState<ProposeRequest | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const today = useMemo(() => localDateKey(), []);

  const query = useMemo(() => `${queryFor(filters, view, today)}#${reloadToken}`, [filters, view, today, reloadToken]);

  const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

  // Debounce the search box into the filters.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((prev) => (prev.q === (search.trim() || undefined) ? prev : { ...prev, q: search.trim() || undefined })), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const key = query;
    apiRequest<{ tasks: TaskDto[] }>(`/api/tasks?${key.split("#")[0]}`, { signal: controller.signal })
      .then((result) => {
        setData({ key, tasks: result.tasks });
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError({ key, message: describeError(error) });
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    apiRequest<{ projects: ProjectDto[] }>("/api/projects")
      .then((result) => setProjects(result.projects))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    apiRequest<{ tags: { tag: string; count: number }[] }>("/api/tasks/tags")
      .then((result) => setTags(result.tags))
      .catch(() => undefined);
  }, [reloadToken]);

  const tasks = data?.tasks ?? null;
  const stale = data !== null && data.key !== query;
  const hasFilters = Boolean(filters.q || (view === "list" && filters.status) || filters.priority || filters.projectId || filters.tag || filters.due);

  function setFilter<K extends keyof TaskFilters>(key: K, value: TaskFilters[K] | "") {
    setFilters((prev) => ({ ...prev, [key]: value || undefined }));
  }

  function clearFilters() {
    setSearch("");
    setFilters((prev) => ({ sort: prev.sort }));
  }

  const patchTask = useCallback(
    async (task: TaskDto, patch: Record<string, unknown>, optimistic: Partial<TaskDto>) => {
      setData((prev) => (prev ? { ...prev, tasks: prev.tasks.map((item) => (item.id === task.id ? { ...item, ...optimistic } : item)) } : prev));
      try {
        await apiRequest(`/api/tasks/${task.id}`, { method: "PATCH", json: patch });
        refresh();
      } catch (error) {
        setBanner(describeError(error));
        refresh();
      }
    },
    [refresh],
  );

  function toggleDone(task: TaskDto) {
    const status: TaskStatus = task.status === "done" ? "todo" : "done";
    void patchTask(task, { status }, { status });
  }

  function moveTask(task: TaskDto, status: TaskStatus, position: number) {
    void patchTask(task, { status, position }, { status, position });
  }

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    setQuickBusy(true);
    try {
      await apiRequest("/api/tasks", {
        json: {
          title,
          ...(filters.projectId && filters.projectId !== "none" ? { projectId: filters.projectId } : {}),
          ...(filters.priority ? { priority: filters.priority } : {}),
          ...(filters.tag ? { tags: [filters.tag] } : {}),
        },
      });
      setQuickTitle("");
      refresh();
    } catch (error) {
      setBanner(describeError(error));
    } finally {
      setQuickBusy(false);
    }
  }

  const sort: TaskSort = filters.sort ?? "manual";
  const defaults = {
    projectId: filters.projectId && filters.projectId !== "none" ? filters.projectId : null,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CheckSquare}
        title="Tasks"
        description="Priorities, deadlines, subtasks, and a Kanban board."
        actions={
          <>
            <Button variant="outline" onClick={() => setAi({ kind: "task_priorities" })}>
              <Sparkles className="size-4" aria-hidden />
              Suggest priorities
            </Button>
            <Button variant="outline" onClick={() => setAi({ kind: "organize_tasks" })}>
              <Wand2 className="size-4" aria-hidden />
              Organize
            </Button>
            <Button variant="primary" onClick={() => setDialog({ task: null })}>
              <Plus className="size-4" aria-hidden />
              New task
            </Button>
          </>
        }
      />

      {banner ? <ErrorBanner message={banner} onDismiss={() => setBanner(null)} /> : null}

      <form onSubmit={quickAdd} className="flex gap-2">
        <Input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Add a task and press Enter" aria-label="Quick add task" maxLength={200} />
        <Button type="submit" variant="secondary" disabled={quickBusy || !quickTitle.trim()}>
          Add
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="pl-8" />
        </div>
        {view === "list" ? (
          <Select aria-label="Filter by status" value={filters.status ?? ""} onChange={(event) => setFilter("status", event.target.value as TaskStatus)} className="w-auto">
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : null}
        <Select aria-label="Filter by priority" value={filters.priority ?? ""} onChange={(event) => setFilter("priority", event.target.value as TaskFilters["priority"])} className="w-auto">
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {PRIORITY_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by project" value={filters.projectId ?? ""} onChange={(event) => setFilter("projectId", event.target.value)} className="w-auto max-w-44">
          <option value="">All projects</option>
          <option value="none">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by due date" value={filters.due ?? ""} onChange={(event) => setFilter("due", event.target.value as DueFilter)} className="w-auto">
          <option value="">Any due date</option>
          {DUE_FILTERS.map((value) => (
            <option key={value} value={value}>
              {DUE_LABELS[value]}
            </option>
          ))}
        </Select>
        {tags.length > 0 ? (
          <Select aria-label="Filter by tag" value={filters.tag ?? ""} onChange={(event) => setFilter("tag", event.target.value)} className="w-auto">
            <option value="">All tags</option>
            {tags.map((item) => (
              <option key={item.tag} value={item.tag}>
                #{item.tag} ({item.count})
              </option>
            ))}
          </Select>
        ) : null}
        {view === "list" ? (
          <Select aria-label="Sort tasks" value={sort} onChange={(event) => setFilter("sort", event.target.value as TaskSort)} className="w-auto">
            {TASK_SORTS.map((value) => (
              <option key={value} value={value}>
                {TASK_SORT_LABELS[value]}
              </option>
            ))}
          </Select>
        ) : null}
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <FilterX className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}
        <div role="group" aria-label="View" className="ml-auto inline-flex rounded-lg border border-border bg-card p-0.5">
          {(
            [
              ["list", "List", ListTodo],
              ["board", "Board", Columns3],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {loadError && loadError.key === query ? <ErrorBanner message={loadError.message} onRetry={refresh} /> : null}

      <div aria-busy={stale} className={cn("transition-opacity", stale && "opacity-60")}>
        {tasks === null ? (
          loadError ? null : (
            <SkeletonRows />
          )
        ) : tasks.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={Search}
              title="No tasks match these filters"
              description="Try a different search or clear the filters."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={CheckSquare}
              title="No tasks yet"
              description="Add your first task above, or create one with all the details."
              action={
                <Button variant="primary" onClick={() => setDialog({ task: null })}>
                  <Plus className="size-4" aria-hidden />
                  New task
                </Button>
              }
            />
          )
        ) : view === "list" ? (
          <TaskList tasks={tasks} today={today} onOpen={(task) => setDialog({ task })} onToggle={toggleDone} />
        ) : (
          <TaskBoard tasks={tasks} today={today} onOpen={(task) => setDialog({ task })} onMove={moveTask} />
        )}
      </div>

      {dialog ? (
        <TaskDialog
          key={dialog.task?.id ?? "new"}
          task={dialog.task}
          defaults={defaults}
          projects={projects}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          onDeleted={refresh}
          onSubtasksChanged={refresh}
        />
      ) : null}

      {ai ? <ProposalDialog request={ai} onClose={() => setAi(null)} onApplied={refresh} /> : null}
    </div>
  );
}
