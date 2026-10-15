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
    <li className={cn("group flex items-start gap-3 px-2 py-3 transition-[background-color,opacity] duration-200 hover:bg-accent/40", done && "opacity-60")}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(task)}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className="mt-1"
      />
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 space-y-1 rounded-md text-left">
        <span className={cn("block break-words text-sm font-medium transition-colors duration-200", done && "text-muted-foreground line-through decoration-muted-foreground/50")}>{task.title}</span>
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
    <ul className="divide-y divide-border border-y border-border" aria-label="Tasks">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} today={today} onOpen={onOpen} onToggle={onToggle} showProject={showProject} />
      ))}
    </ul>
  );
}
