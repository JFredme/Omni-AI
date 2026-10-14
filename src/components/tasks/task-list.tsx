"use client";

import { cn } from "@/lib/utils";
import type { TaskDto } from "@/lib/tasks/types";
import { TaskMeta } from "./task-badges";

export function TaskRow({
  task,
  today,
  onOpen,
  onToggle,
  showProject = true,
}: {
  task: TaskDto;
  today: string;
  onOpen: (task: TaskDto) => void;
  onToggle: (task: TaskDto) => void;
  showProject?: boolean;
}) {
  const done = task.status === "done";
  return (
    <li className="group flex items-start gap-3 rounded-xl border border-border bg-card/70 px-3 py-2.5 transition-colors hover:bg-accent/40">
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
      />
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 space-y-1 rounded-md text-left">
        <span className={cn("block break-words text-sm font-medium", done && "text-muted-foreground line-through")}>{task.title}</span>
        <TaskMeta task={task} today={today} showProject={showProject} />
      </button>
    </li>
  );
}

export function TaskList({
  tasks,
  today,
  onOpen,
  onToggle,
  showProject,
}: {
  tasks: TaskDto[];
  today: string;
  onOpen: (task: TaskDto) => void;
  onToggle: (task: TaskDto) => void;
  showProject?: boolean;
}) {
  return (
    <ul className="space-y-2" aria-label="Tasks">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} today={today} onOpen={onOpen} onToggle={onToggle} showProject={showProject} />
      ))}
    </ul>
  );
}
