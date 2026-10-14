import { CalendarDays, Flag, FolderKanban, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dueState, formatDateKey } from "@/lib/dates";
import { PRIORITY_LABELS, subtaskProgress, type TaskDto, type TaskPriority } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

const priorityClasses: Record<TaskPriority, string> = {
  urgent: "bg-danger/15 text-danger",
  high: "bg-warning/25 text-foreground",
  medium: "bg-accent text-accent-foreground",
  low: "bg-muted text-muted-foreground",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge className={priorityClasses[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function DueBadge({ task, today }: { task: Pick<TaskDto, "dueDate" | "status">; today: string }) {
  if (!task.dueDate) return null;
  const state = task.status === "done" ? "later" : dueState(task.dueDate, today);
  const label = state === "today" ? "Due today" : state === "overdue" ? `Overdue · ${formatDateKey(task.dueDate)}` : formatDateKey(task.dueDate);
  return (
    <Badge className={cn(state === "overdue" && "bg-danger/15 text-danger", state === "today" && "bg-warning/25 text-foreground")}>
      <CalendarDays className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

/** Priority, due date, project, subtask progress and tags, shown the same way in the list and on the board. */
export function TaskMeta({ task, today, showProject = true }: { task: TaskDto; today: string; showProject?: boolean }) {
  const progress = subtaskProgress(task);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <PriorityBadge priority={task.priority} />
      <DueBadge task={task} today={today} />
      {showProject && task.projectName ? (
        <Badge>
          <FolderKanban className="size-3" aria-hidden />
          {task.projectName}
        </Badge>
      ) : null}
      {!showProject && task.milestoneTitle ? (
        <Badge>
          <Flag className="size-3" aria-hidden />
          {task.milestoneTitle}
        </Badge>
      ) : null}
      {progress.total > 0 ? (
        <Badge>
          <ListChecks className="size-3" aria-hidden />
          {progress.done}/{progress.total}
        </Badge>
      ) : null}
      {task.tags.map((tag) => (
        <span key={tag} className="text-xs text-muted-foreground">
          #{tag}
        </span>
      ))}
    </div>
  );
}
