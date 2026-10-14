"use client";

import { useId, useState } from "react";
import { describeError } from "@/components/chat/use-model-catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest } from "@/lib/client/api";
import { MAX_PROJECT_DESCRIPTION, MAX_PROJECT_NAME } from "@/lib/projects/schemas";
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectDetailDto, type ProjectDto, type ProjectStatus } from "@/lib/projects/types";

/** Creates a project, or edits one when `project` is given. */
export function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectDto | null;
  onClose: () => void;
  onSaved: (project: ProjectDetailDto) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "planning");
  const [dueDate, setDueDate] = useState(project?.dueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), description, status, dueDate: dueDate || null };
      const result = project
        ? await apiRequest<{ project: ProjectDetailDto }>(`/api/projects/${project.id}`, { method: "PATCH", json: body })
        : await apiRequest<{ project: ProjectDetailDto }>("/api/projects", { json: body });
      onSaved(result.project);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={project ? "Edit project" : "New project"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? "Saving…" : project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        <Field label="Name" htmlFor={`${formId}-name`}>
          <Input id={`${formId}-name`} data-autofocus value={name} maxLength={MAX_PROJECT_NAME} onChange={(event) => setName(event.target.value)} placeholder="Website redesign" />
        </Field>
        <Field label="Description" htmlFor={`${formId}-description`} hint="Goals, scope, and anything the AI assistant should know when planning.">
          <Textarea id={`${formId}-description`} rows={4} value={description} maxLength={MAX_PROJECT_DESCRIPTION} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor={`${formId}-status`}>
            <Select id={`${formId}-status`} value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PROJECT_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor={`${formId}-due`}>
            <Input id={`${formId}-due`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
