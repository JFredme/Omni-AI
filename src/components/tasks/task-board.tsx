"use client";

import { useState } from "react";
import { Select } from "@/components/ui/input";
import { endPosition, planDrop, sortByPosition } from "@/lib/tasks/board";
import { STATUS_LABELS, TASK_STATUSES, type TaskDto, type TaskStatus } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { TaskMeta } from "./task-badges";

type DropTarget = { status: TaskStatus; index: number };

export function TaskBoard({
  tasks,
  today,
  onOpen,
  onMove,
}: {
  tasks: TaskDto[];
  today: string;
  onOpen: (task: TaskDto) => void;
  onMove: (task: TaskDto, status: TaskStatus, position: number) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);

  const columns = TASK_STATUSES.map((status) => ({ status, tasks: sortByPosition(tasks.filter((task) => task.status === status)) }));

  function drop(status: TaskStatus) {
    const dragged = tasks.find((task) => task.id === dragId);
    const target = over;
    setDragId(null);
    setOver(null);
    if (!dragged || !target || target.status !== status) return;

    const column = columns.find((candidate) => candidate.status === status)?.tasks ?? [];
    const plan = planDrop(column, dragged.id, target.index);
    if (plan.unchanged && dragged.status === status) return;
    onMove(dragged, status, plan.position);
  }

  return (
    <div className="grid gap-4 md:grid-cols-3" role="group" aria-label="Task board">
      {columns.map((column) => (
        <section
          key={column.status}
          aria-label={`${STATUS_LABELS[column.status]} column`}
          onDragOver={(event) => {
            if (!dragId) return;
            event.preventDefault();
            setOver((prev) => (prev?.status === column.status ? prev : { status: column.status, index: column.tasks.length }));
          }}
          onDrop={(event) => {
            event.preventDefault();
            drop(column.status);
          }}
          className={cn(
            "flex min-h-40 flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-3 transition-colors",
            over?.status === column.status && "border-ring bg-accent/40",
          )}
        >
          <h3 className="flex items-center justify-between px-1 text-sm font-semibold">
            {STATUS_LABELS[column.status]}
            <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">{column.tasks.length}</span>
          </h3>
          <ul className="flex flex-1 flex-col gap-2">
            {column.tasks.length === 0 ? (
              <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                {dragId ? "Drop here" : "Nothing here"}
              </li>
            ) : null}
            {column.tasks.map((task, index) => (
              <li
                key={task.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", task.id);
                  setDragId(task.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOver(null);
                }}
                onDragOver={(event) => {
                  if (!dragId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const before = event.clientY < rect.top + rect.height / 2;
                  const index2 = before ? index : index + 1;
                  setOver((prev) => (prev?.status === column.status && prev.index === index2 ? prev : { status: column.status, index: index2 }));
                }}
                className={cn(
                  "relative cursor-grab rounded-xl border border-border bg-card p-3 active:cursor-grabbing",
                  dragId === task.id && "opacity-40",
                  over?.status === column.status && over.index === index && dragId !== task.id && "before:absolute before:-top-1.5 before:left-0 before:right-0 before:h-0.5 before:rounded before:bg-primary",
                  over?.status === column.status && over.index === column.tasks.length && index === column.tasks.length - 1 && dragId !== task.id && "after:absolute after:-bottom-1.5 after:left-0 after:right-0 after:h-0.5 after:rounded after:bg-primary",
                )}
              >
                <button type="button" onClick={() => onOpen(task)} className="block w-full space-y-2 rounded-md text-left">
                  <span className={cn("block break-words text-sm font-medium", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</span>
                  <TaskMeta task={task} today={today} />
                </button>
                <Select
                  aria-label={`Move "${task.title}" to another column`}
                  value={task.status}
                  onChange={(event) => {
                    const status = event.target.value as TaskStatus;
                    const target = columns.find((candidate) => candidate.status === status)?.tasks ?? [];
                    onMove(task, status, endPosition(target));
                  }}
                  className="mt-2 h-7 text-xs"
                >
                  {TASK_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
