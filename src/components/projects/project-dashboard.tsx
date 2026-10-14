"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Flag, FolderKanban, ListTree, Pencil, Plus, Wand2, Trash2 } from "lucide-react";
import { ProposalDialog } from "@/components/ai/proposal-dialog";
import { describeError } from "@/components/chat/use-model-catalog";
import { ExportMenu } from "@/components/export-menu";
import { PageHeader } from "@/components/page-header";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/states";
import type { ProposeRequest } from "@/lib/ai/schemas";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { formatDateKey, localDateKey } from "@/lib/dates";
import { milestoneState } from "@/lib/projects/logic";
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type MilestoneDto, type ProjectDetailDto, type ProjectDto, type ProjectStatus } from "@/lib/projects/types";
import type { TaskDto, TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { MilestoneDialog } from "./milestone-dialog";
import { ProjectDialog } from "./project-dialog";
import { ProgressBar, ProjectStatusBadge } from "./project-parts";

export function ProjectDashboard({ id }: { id: string }) {
  const router = useRouter();
  const today = useMemo(() => localDateKey(), []);
  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectDto[]>([]);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState(false);
  const [taskDialog, setTaskDialog] = useState<{ task: TaskDto | null } | null>(null);
  const [milestoneDialog, setMilestoneDialog] = useState<{ milestone: MilestoneDto | null } | null>(null);
  const [planning, setPlanning] = useState<"tasks" | "plan" | null>(null);
  const [ai, setAi] = useState<ProposeRequest | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiRequest<{ project: ProjectDetailDto }>(`/api/projects/${id}?today=${today}`, { signal: controller.signal }),
      apiRequest<{ tasks: TaskDto[] }>(`/api/tasks?projectId=${id}&today=${today}`, { signal: controller.signal }),
    ])
      .then(([projectResult, taskResult]) => {
        setProject(projectResult.project);
        setTasks(taskResult.tasks);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError({ message: describeError(caught), notFound: caught instanceof ClientApiError && caught.status === 404 });
      });
    return () => controller.abort();
  }, [id, today, reloadToken]);

  useEffect(() => {
    apiRequest<{ projects: ProjectDto[] }>("/api/projects?archived=1")
      .then((result) => setAllProjects(result.projects))
      .catch(() => undefined);
  }, [reloadToken]);

  async function setStatus(status: ProjectStatus) {
    try {
      await apiRequest(`/api/projects/${id}`, { method: "PATCH", json: { status } });
      reload();
    } catch (caught) {
      setBanner(describeError(caught));
    }
  }

  async function toggleTask(task: TaskDto) {
    const status: TaskStatus = task.status === "done" ? "todo" : "done";
    setTasks((prev) => prev?.map((item) => (item.id === task.id ? { ...item, status } : item)) ?? prev);
    try {
      await apiRequest(`/api/tasks/${task.id}`, { method: "PATCH", json: { status } });
    } catch (caught) {
      setBanner(describeError(caught));
    }
    reload();
  }

  async function toggleMilestone(milestone: MilestoneDto) {
    const completedAt = milestone.completedAt ? null : new Date().toISOString();
    setProject((prev) =>
      prev
        ? {
            ...prev,
            milestoneDone: prev.milestoneDone + (completedAt ? 1 : -1),
            milestones: prev.milestones.map((item) => (item.id === milestone.id ? { ...item, completedAt } : item)),
          }
        : prev,
    );
    try {
      await apiRequest(`/api/milestones/${milestone.id}`, { method: "PATCH", json: { completed: Boolean(completedAt) } });
    } catch (caught) {
      setBanner(describeError(caught));
    }
    reload();
  }

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    try {
      await apiRequest("/api/tasks", { json: { title, projectId: id } });
      setQuickTitle("");
      reload();
    } catch (caught) {
      setBanner(describeError(caught));
    }
  }

  async function deleteProject() {
    try {
      await apiRequest(`/api/projects/${id}`, { method: "DELETE" });
      router.push("/projects");
    } catch (caught) {
      setBanner(describeError(caught));
      setConfirmingDelete(false);
    }
  }

  if (error && !project) {
    return (
      <div className="space-y-4">
        <Link href="/projects" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft className="size-4" aria-hidden />
          Projects
        </Link>
        {error.notFound ? (
          <EmptyState icon={FolderKanban} title="Project not found" description="It may have been deleted." />
        ) : (
          <ErrorBanner message={error.message} onRetry={reload} />
        )}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <SkeletonRows count={3} />
      </div>
    );
  }

  const stats = project.stats;

  return (
    <div className="space-y-6">
      <Link href="/projects" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2" })}>
        <ArrowLeft className="size-4" aria-hidden />
        Projects
      </Link>

      <PageHeader
        title={project.name}
        description={project.description || "No description yet. Add one so the assistant can plan well."}
        actions={
          <>
            <Button variant="outline" onClick={() => setPlanning("tasks")}>
              <ListTree className="size-4" aria-hidden />
              Break into tasks
            </Button>
            <Button variant="outline" onClick={() => setPlanning("plan")}>
              <Wand2 className="size-4" aria-hidden />
              Generate plan
            </Button>
            <ExportMenu
              label="Report"
              options={[
                { label: "PDF", href: `/api/projects/${project.id}/export?format=pdf` },
                { label: "Word (.docx)", href: `/api/projects/${project.id}/export?format=docx` },
                { label: "Markdown", href: `/api/projects/${project.id}/export?format=md` },
              ]}
            />
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Button>
          </>
        }
      />

      {banner ? <ErrorBanner message={banner} onDismiss={() => setBanner(null)} /> : null}
      {error ? <ErrorBanner message={error.message} onRetry={reload} /> : null}

      <section aria-label="Project overview" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="col-span-2 space-y-2 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">Progress</p>
          <p className="text-3xl font-semibold tabular-nums">{stats.progress}%</p>
          <ProgressBar percent={stats.progress} label="Project progress" />
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Tasks</p>
          <p className="text-3xl font-semibold tabular-nums">
            {stats.done}
            <span className="text-lg text-muted-foreground">/{stats.total}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {stats.inProgress} in progress · {stats.todo} to do
          </p>
        </Card>
        <Card className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Overdue</p>
          <p className={cn("text-3xl font-semibold tabular-nums", stats.overdue > 0 && "text-danger")}>{stats.overdue}</p>
          <p className="text-xs text-muted-foreground">{stats.overdue === 0 ? "Nothing late" : "Unfinished and past due"}</p>
        </Card>
        <Card className="col-span-2 space-y-2 lg:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Status</p>
            <ProjectStatusBadge status={project.status} />
          </div>
          <Select aria-label="Project status" value={project.status} onChange={(event) => setStatus(event.target.value as ProjectStatus)} className="h-8 text-xs">
            {PROJECT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PROJECT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="size-3" aria-hidden />
            {project.dueDate ? `Due ${formatDateKey(project.dueDate)}` : "No due date"}
          </p>
        </Card>
      </section>

      <section aria-labelledby="milestones-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="milestones-heading" className="text-base font-semibold">
            Milestones{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({project.milestoneDone}/{project.milestoneTotal})
            </span>
          </h2>
          <Button variant="outline" size="sm" onClick={() => setMilestoneDialog({ milestone: null })}>
            <Plus className="size-4" aria-hidden />
            Add milestone
          </Button>
        </div>
        {project.milestones.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No milestones yet. Add one, or let the assistant generate a plan.
          </p>
        ) : (
          <ul className="space-y-2">
            {project.milestones.map((milestone) => {
              const state = milestoneState(milestone, today);
              const percent = milestone.taskTotal === 0 ? (milestone.completedAt ? 100 : 0) : Math.round((milestone.taskDone / milestone.taskTotal) * 100);
              return (
                <li key={milestone.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/70 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(milestone.completedAt)}
                    onChange={() => toggleMilestone(milestone)}
                    aria-label={`Mark milestone "${milestone.title}" ${milestone.completedAt ? "incomplete" : "complete"}`}
                    className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("break-words text-sm font-medium", state === "done" && "text-muted-foreground line-through")}>{milestone.title}</span>
                      {milestone.dueDate ? (
                        <Badge className={cn(state === "overdue" && "bg-danger/15 text-danger")}>
                          <Flag className="size-3" aria-hidden />
                          {state === "overdue" ? "Overdue · " : ""}
                          {formatDateKey(milestone.dueDate)}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {milestone.taskDone}/{milestone.taskTotal} tasks
                      </span>
                    </div>
                    <ProgressBar percent={percent} label={`${milestone.title} progress`} className="h-1.5" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMilestoneDialog({ milestone })}
                    aria-label={`Edit milestone ${milestone.title}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="project-tasks-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="project-tasks-heading" className="text-base font-semibold">
            Tasks
          </h2>
          <Button variant="outline" size="sm" onClick={() => setTaskDialog({ task: null })}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        </div>
        <form onSubmit={quickAdd} className="flex gap-2">
          <Input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Add a task to this project" aria-label="Quick add task to project" maxLength={200} />
          <Button type="submit" variant="secondary" disabled={!quickTitle.trim()}>
            Add
          </Button>
        </form>
        {tasks === null ? (
          <SkeletonRows count={3} />
        ) : tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No tasks in this project yet. Add one above, or break the project into tasks with the assistant.
          </p>
        ) : (
          <TaskList tasks={tasks} today={today} showProject={false} onOpen={(task) => setTaskDialog({ task })} onToggle={toggleTask} />
        )}
      </section>

      <section className="border-t border-border pt-4">
        {confirmingDelete ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Delete this project and its milestones? Its tasks are kept, without a project.</span>
            <Button size="sm" className="bg-danger text-white hover:opacity-90" onClick={deleteProject}>
              Delete project
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="size-4" aria-hidden />
            Delete project
          </Button>
        )}
      </section>

      {editing ? <ProjectDialog project={project} onClose={() => setEditing(false)} onSaved={reload} /> : null}
      {taskDialog ? (
        <TaskDialog
          key={taskDialog.task?.id ?? "new"}
          task={taskDialog.task}
          defaults={{ projectId: id }}
          projects={allProjects}
          onClose={() => setTaskDialog(null)}
          onSaved={reload}
          onDeleted={reload}
          onSubtasksChanged={reload}
        />
      ) : null}
      {milestoneDialog ? <MilestoneDialog projectId={id} milestone={milestoneDialog.milestone} onClose={() => setMilestoneDialog(null)} onChanged={reload} /> : null}
      {planning ? (
        <PlanGoalDialog
          mode={planning}
          onClose={() => setPlanning(null)}
          onSubmit={(goal) => {
            setPlanning(null);
            setAi({ kind: "project_plan", projectId: id, mode: planning, goal: goal || undefined });
          }}
        />
      ) : null}
      {ai ? <ProposalDialog request={ai} onClose={() => setAi(null)} onApplied={reload} /> : null}
    </div>
  );
}

function PlanGoalDialog({ mode, onClose, onSubmit }: { mode: "tasks" | "plan"; onClose: () => void; onSubmit: (goal: string) => void }) {
  const [goal, setGoal] = useState("");
  return (
    <Dialog
      title={mode === "plan" ? "Generate a project plan" : "Break this project into tasks"}
      description="The assistant reads the project's description, milestones, and existing tasks, then proposes what to add. You review everything before it is saved."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSubmit(goal.trim())}>
            <Wand2 className="size-4" aria-hidden />
            {mode === "plan" ? "Generate plan" : "Suggest tasks"}
          </Button>
        </>
      }
    >
      <Field label="Anything specific to focus on? (optional)" htmlFor="plan-goal" hint="For example: launch before the end of the quarter, or keep it to a two-person team.">
        <Textarea id="plan-goal" data-autofocus rows={3} value={goal} maxLength={2000} onChange={(event) => setGoal(event.target.value)} />
      </Field>
    </Dialog>
  );
}
