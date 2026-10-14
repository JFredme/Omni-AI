"use client";

import { useEffect, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { describeError } from "@/components/chat/use-model-catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { TagInput } from "@/components/ui/tag-input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest } from "@/lib/client/api";
import type { ProjectDetailDto, ProjectDto } from "@/lib/projects/types";
import {
  MAX_TASK_DESCRIPTION,
  MAX_TASK_TITLE,
} from "@/lib/tasks/schemas";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/types";
import { cn } from "@/lib/utils";

export interface TaskDefaults {
  projectId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
}

/** Creates a task (when `task` is null) or edits one. Subtasks are saved as they're added, toggled, or removed. */
export function TaskDialog({
  task,
  defaults,
  projects,
  onClose,
  onSaved,
  onDeleted,
  onSubtasksChanged,
}: {
  task: TaskDto | null;
  defaults?: TaskDefaults;
  projects: ProjectDto[];
  onClose: () => void;
  onSaved: (task: TaskDto) => void;
  onDeleted: (id: string) => void;
  onSubtasksChanged?: () => void;
}) {
  const formId = useId();
  const editing = task !== null;

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? defaults?.status ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? defaults?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [tags, setTags] = useState<string[]>(task?.tags ?? []);
  const [projectId, setProjectId] = useState(task?.projectId ?? defaults?.projectId ?? "");
  const [milestoneId, setMilestoneId] = useState(task?.milestoneId ?? "");
  const [milestones, setMilestones] = useState<{ projectId: string; items: ProjectDetailDto["milestones"] } | null>(null);

  const [subtasks, setSubtasks] = useState<TaskDto[]>(task?.subtasks ?? []);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    apiRequest<{ project: ProjectDetailDto }>(`/api/projects/${projectId}`)
      .then(({ project }) => {
        if (active) setMilestones({ projectId, items: project.milestones });
      })
      .catch(() => {
        if (active) setMilestones({ projectId, items: [] });
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const projectMilestones = projectId && milestones?.projectId === projectId ? milestones.items : [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Give the task a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        description,
        status,
        priority,
        dueDate: dueDate || null,
        tags,
        projectId: projectId || null,
        milestoneId: projectId && milestoneId ? milestoneId : null,
      };
      const result = editing
        ? await apiRequest<{ task: TaskDto }>(`/api/tasks/${task.id}`, { method: "PATCH", json: body })
        : await apiRequest<{ task: TaskDto }>("/api/tasks", { json: body });
      onSaved(result.task);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!task) return;
    setSaving(true);
    try {
      await apiRequest(`/api/tasks/${task.id}`, { method: "DELETE" });
      onDeleted(task.id);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
      setConfirmingDelete(false);
    } finally {
      setSaving(false);
    }
  }

  async function addSubtask() {
    const text = subtaskTitle.trim();
    if (!text || !task) return;
    setError(null);
    try {
      const { task: created } = await apiRequest<{ task: TaskDto }>("/api/tasks", { json: { title: text, parentId: task.id } });
      setSubtasks((prev) => [...prev, created]);
      setSubtaskTitle("");
      onSubtasksChanged?.();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  async function toggleSubtask(subtask: TaskDto) {
    const next: TaskStatus = subtask.status === "done" ? "todo" : "done";
    setSubtasks((prev) => prev.map((item) => (item.id === subtask.id ? { ...item, status: next } : item)));
    try {
      await apiRequest(`/api/tasks/${subtask.id}`, { method: "PATCH", json: { status: next } });
      onSubtasksChanged?.();
    } catch (caught) {
      setSubtasks((prev) => prev.map((item) => (item.id === subtask.id ? subtask : item)));
      setError(describeError(caught));
    }
  }

  async function removeSubtask(subtask: TaskDto) {
    try {
      await apiRequest(`/api/tasks/${subtask.id}`, { method: "DELETE" });
      setSubtasks((prev) => prev.filter((item) => item.id !== subtask.id));
      onSubtasksChanged?.();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <Dialog
      title={editing ? "Edit task" : "New task"}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {editing ? (
            confirmingDelete ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Delete this task{subtasks.length ? " and its subtasks" : ""}?</span>
                <Button size="sm" className="bg-danger text-white hover:opacity-90" onClick={remove} disabled={saving}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="size-4" aria-hidden />
                Delete
              </Button>
            )
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        <Field label="Title" htmlFor={`${formId}-title`}>
          <Input id={`${formId}-title`} data-autofocus value={title} maxLength={MAX_TASK_TITLE} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" />
        </Field>
        <Field label="Description" htmlFor={`${formId}-description`}>
          <Textarea id={`${formId}-description`} rows={3} value={description} maxLength={MAX_TASK_DESCRIPTION} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status" htmlFor={`${formId}-status`}>
            <Select id={`${formId}-status`} value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
              {TASK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor={`${formId}-priority`}>
            <Select id={`${formId}-priority`} value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor={`${formId}-due`}>
            <Input id={`${formId}-due`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" htmlFor={`${formId}-project`}>
            <Select
              id={`${formId}-project`}
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setMilestoneId("");
              }}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Milestone" htmlFor={`${formId}-milestone`}>
            <Select id={`${formId}-milestone`} value={milestoneId} disabled={!projectId} onChange={(event) => setMilestoneId(event.target.value)}>
              <option value="">{projectId ? "No milestone" : "Choose a project first"}</option>
              {projectMilestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Tags" htmlFor={`${formId}-tags`} hint="Press Enter or comma to add a tag.">
          <TagInput id={`${formId}-tags`} tags={tags} onChange={setTags} />
        </Field>
      </form>

      <section className="mt-6 space-y-3 border-t border-border pt-4" aria-labelledby={`${formId}-subtasks`}>
        <h3 id={`${formId}-subtasks`} className="text-sm font-semibold">
          Subtasks
        </h3>
        {!editing ? (
          <p className="text-sm text-muted-foreground">Create the task first, then break it into subtasks.</p>
        ) : (
          <>
            {subtasks.length === 0 ? <p className="text-sm text-muted-foreground">No subtasks yet.</p> : null}
            <ul className="space-y-1">
              {subtasks.map((subtask) => (
                <li key={subtask.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/40">
                  <input
                    type="checkbox"
                    checked={subtask.status === "done"}
                    onChange={() => toggleSubtask(subtask)}
                    aria-label={`Subtask: ${subtask.title}`}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <span className={cn("min-w-0 flex-1 break-words text-sm", subtask.status === "done" && "text-muted-foreground line-through")}>{subtask.title}</span>
                  <button
                    type="button"
                    onClick={() => removeSubtask(subtask)}
                    aria-label={`Delete subtask ${subtask.title}`}
                    className="rounded-md p-1 text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={subtaskTitle}
                aria-label="New subtask"
                maxLength={MAX_TASK_TITLE}
                placeholder="Add a subtask"
                onChange={(event) => setSubtaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addSubtask();
                  }
                }}
              />
              <Button variant="outline" onClick={addSubtask} disabled={!subtaskTitle.trim()}>
                <Plus className="size-4" aria-hidden />
                Add
              </Button>
            </div>
          </>
        )}
      </section>
    </Dialog>
  );
}
