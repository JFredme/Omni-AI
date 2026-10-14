"use client";

import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { describeError } from "@/components/chat/use-model-catalog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/states";
import { apiRequest } from "@/lib/client/api";
import { MAX_MILESTONE_TITLE } from "@/lib/projects/schemas";
import type { MilestoneDto } from "@/lib/projects/types";

export function MilestoneDialog({
  projectId,
  milestone,
  onClose,
  onChanged,
}: {
  projectId: string;
  milestone: MilestoneDto | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const formId = useId();
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Give the milestone a title.");
      return;
    }
    setSaving(true);
    try {
      const body = { title: title.trim(), dueDate: dueDate || null };
      if (milestone) await apiRequest(`/api/milestones/${milestone.id}`, { method: "PATCH", json: body });
      else await apiRequest(`/api/projects/${projectId}/milestones`, { json: body });
      onChanged();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!milestone) return;
    setSaving(true);
    try {
      await apiRequest(`/api/milestones/${milestone.id}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (caught) {
      setError(describeError(caught));
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={milestone ? "Edit milestone" : "New milestone"}
      onClose={onClose}
      footer={
        <>
          {milestone ? (
            confirming ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Its tasks stay in the project.</span>
                <Button size="sm" className="bg-danger text-white hover:opacity-90" onClick={remove} disabled={saving}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => setConfirming(true)}>
                <Trash2 className="size-4" aria-hidden />
                Delete
              </Button>
            )
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? "Saving…" : milestone ? "Save changes" : "Add milestone"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
        <Field label="Title" htmlFor={`${formId}-title`}>
          <Input id={`${formId}-title`} data-autofocus value={title} maxLength={MAX_MILESTONE_TITLE} onChange={(event) => setTitle(event.target.value)} placeholder="Beta release" />
        </Field>
        <Field label="Target date" htmlFor={`${formId}-date`}>
          <Input id={`${formId}-date`} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
