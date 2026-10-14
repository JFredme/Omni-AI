"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { describeError } from "@/components/chat/use-model-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { ErrorBanner, Spinner } from "@/components/ui/states";
import type { ApplyRequest, ProposeRequest } from "@/lib/ai/schemas";
import type {
  ApplyResponse,
  NoteSummaryProposal,
  OrganizeNotesProposal,
  OrganizeTasksProposal,
  ProjectPlanProposal,
  Proposal,
  ProposeResponse,
  TaskPrioritiesProposal,
} from "@/lib/ai/types";
import { apiRequest, ClientApiError, isAbortError } from "@/lib/client/api";
import { formatDateKey } from "@/lib/dates";
import { PRIORITY_LABELS } from "@/lib/tasks/types";

export interface SummaryChoice {
  summary: string;
  keyPoints: string[];
  tags: string[];
}

const DIALOG_TITLES: Record<Proposal["kind"], string> = {
  project_plan: "Project plan",
  note_summary: "Note summary",
  task_priorities: "Suggested priorities",
  organize_tasks: "Organize tasks",
  organize_notes: "Organize notes",
};

/**
 * Asks the assistant for a proposal and shows it for review. Nothing is saved until the user presses the
 * apply button, and only the items still ticked are sent.
 */
export function ProposalDialog({
  request,
  onClose,
  onApplied,
  onInsertSummary,
}: {
  request: ProposeRequest;
  onClose: () => void;
  /** Called after changes were saved, so the page can reload its data. */
  onApplied: (result: ApplyResponse) => void;
  /** Called for a note summary the user accepted; the note editor saves it. */
  onInsertSummary?: (choice: SummaryChoice) => Promise<void>;
}) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "error"; error: unknown } | { phase: "ready"; data: ProposeResponse } | { phase: "done"; message: string }
  >({ phase: "loading" });
  const [kindTitle, setKindTitle] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const requestRef = useRef(request);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    apiRequest<ProposeResponse>("/api/ai/propose", { json: requestRef.current, signal: controller.signal })
      .then((data) => {
        setKindTitle(DIALOG_TITLES[data.proposal.kind]);
        setState({ phase: "ready", data });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) setState({ phase: "error", error });
      });
  }, []);

  useEffect(() => {
    start();
    return () => abortRef.current?.abort();
  }, [start]);

  function retry() {
    setState({ phase: "loading" });
    setApplyError(null);
    start();
  }

  async function apply(payload: ApplyRequest) {
    setApplying(true);
    setApplyError(null);
    try {
      const result = await apiRequest<ApplyResponse>("/api/ai/apply", { json: payload });
      setState({ phase: "done", message: result.message });
      onApplied(result);
    } catch (error) {
      setApplyError(describeError(error));
    } finally {
      setApplying(false);
    }
  }

  async function insertSummary(choice: SummaryChoice) {
    if (!onInsertSummary) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onInsertSummary(choice);
      onClose();
    } catch (error) {
      setApplyError(describeError(error));
    } finally {
      setApplying(false);
    }
  }

  const title = kindTitle ?? "AI assistant";

  return (
    <Dialog
      title={title}
      size="lg"
      description={
        state.phase === "ready"
          ? `Review what the assistant suggests. Nothing is saved until you apply it. Model: ${state.data.modelId}`
          : "The assistant only proposes changes. You decide what is saved."
      }
      onClose={onClose}
    >
      {state.phase === "loading" ? (
        <div className="flex flex-col items-center gap-4 py-10">
          <Spinner label="Asking the assistant…" />
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      ) : null}

      {state.phase === "error" ? <ProposalError error={state.error} onRetry={retry} onClose={onClose} /> : null}

      {state.phase === "done" ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p role="status" className="font-medium">
            {state.message}
          </p>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <div className="space-y-4">
          {applyError ? <ErrorBanner message={applyError} onDismiss={() => setApplyError(null)} /> : null}
          <ProposalBody
            proposal={state.data.proposal}
            applying={applying}
            onApply={apply}
            onInsertSummary={onInsertSummary ? insertSummary : undefined}
            onCancel={onClose}
          />
        </div>
      ) : null}
    </Dialog>
  );
}

function ProposalError({ error, onRetry, onClose }: { error: unknown; onRetry: () => void; onClose: () => void }) {
  const code = error instanceof ClientApiError ? error.code : null;
  const needsSetup = code === "api_key_missing" || code === "model_required";
  return (
    <div className="space-y-4">
      <ErrorBanner message={describeError(error)} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {needsSetup ? (
          <Link href="/settings" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Open settings
          </Link>
        ) : (
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

function ProposalBody(props: {
  proposal: Proposal;
  applying: boolean;
  onApply: (payload: ApplyRequest) => void;
  onInsertSummary?: (choice: SummaryChoice) => void;
  onCancel: () => void;
}) {
  const { proposal } = props;
  switch (proposal.kind) {
    case "project_plan":
      return <PlanReview {...props} proposal={proposal} />;
    case "task_priorities":
      return <PrioritiesReview {...props} proposal={proposal} />;
    case "organize_tasks":
      return <OrganizeTasksReview {...props} proposal={proposal} />;
    case "organize_notes":
      return <OrganizeNotesReview {...props} proposal={proposal} />;
    case "note_summary":
      return <SummaryReview {...props} proposal={proposal} />;
  }
}

/* ---------- shared pieces ---------- */

function useSelection(count: number) {
  const [selected, setSelected] = useState<boolean[]>(() => Array.from({ length: count }, () => true));
  return {
    selected,
    count: selected.filter(Boolean).length,
    toggle: (index: number) => setSelected((prev) => prev.map((value, position) => (position === index ? !value : value))),
    setAll: (value: boolean) => setSelected((prev) => prev.map(() => value)),
  };
}

function ReviewFooter({
  selectedCount,
  total,
  applying,
  noun,
  onApply,
  onCancel,
  onSelectAll,
}: {
  selectedCount: number;
  total: number;
  applying: boolean;
  noun: string;
  onApply: () => void;
  onCancel: () => void;
  onSelectAll: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => onSelectAll(selectedCount < total)}
        className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        {selectedCount < total ? "Select all" : "Select none"}
      </button>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={applying}>
          Discard
        </Button>
        <Button variant="primary" onClick={onApply} disabled={applying || selectedCount === 0}>
          {applying ? "Applying…" : `Apply ${selectedCount} ${noun}${selectedCount === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ checked, onToggle, label, children }: { checked: boolean; onToggle: () => void; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card/60 p-3">
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={label} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </li>
  );
}

function Summary({ text }: { text: string }) {
  return text ? (
    <p className="flex gap-2 rounded-xl bg-accent/60 px-3 py-2 text-sm text-accent-foreground">
      <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  ) : null;
}

function NothingToChange({ reviewed, noun, onClose }: { reviewed: number; noun: string; onClose: () => void }) {
  return (
    <div className="space-y-4 py-6 text-center">
      <p className="font-medium">No changes suggested</p>
      <p className="text-sm text-muted-foreground">
        The assistant reviewed {reviewed} {noun}
        {reviewed === 1 ? "" : "s"} and found nothing worth changing.
      </p>
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

type ReviewProps<P extends Proposal> = {
  proposal: P;
  applying: boolean;
  onApply: (payload: ApplyRequest) => void;
  onCancel: () => void;
};

/* ---------- project plan ---------- */

function PlanReview({ proposal, applying, onApply, onCancel }: ReviewProps<ProjectPlanProposal>) {
  const milestones = useSelection(proposal.milestones.length);
  const tasks = useSelection(proposal.tasks.length);
  const total = milestones.selected.length + tasks.selected.length;
  const count = milestones.count + tasks.count;

  function apply() {
    const chosenMilestones = proposal.milestones.filter((_, index) => milestones.selected[index]);
    onApply({
      kind: "project_plan",
      projectId: proposal.projectId,
      milestones: chosenMilestones,
      tasks: proposal.tasks.filter((_, index) => tasks.selected[index]),
    });
  }

  return (
    <div className="space-y-4">
      <Summary text={proposal.summary} />
      {proposal.milestones.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Milestones</h3>
          <ul className="space-y-2">
            {proposal.milestones.map((milestone, index) => (
              <ReviewRow key={milestone.title} checked={milestones.selected[index]} onToggle={() => milestones.toggle(index)} label={`Milestone: ${milestone.title}`}>
                <p className="text-sm font-medium">{milestone.title}</p>
                {milestone.dueDate ? <p className="text-xs text-muted-foreground">Due {formatDateKey(milestone.dueDate)}</p> : null}
              </ReviewRow>
            ))}
          </ul>
        </section>
      ) : null}
      {proposal.tasks.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Tasks</h3>
          <ul className="space-y-2">
            {proposal.tasks.map((task, index) => (
              <ReviewRow key={task.title} checked={tasks.selected[index]} onToggle={() => tasks.toggle(index)} label={`Task: ${task.title}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium">{task.title}</p>
                  <Badge tone={task.priority === "urgent" || task.priority === "high" ? "accent" : "neutral"}>{PRIORITY_LABELS[task.priority]}</Badge>
                  {task.dueDate ? <Badge>Due {formatDateKey(task.dueDate)}</Badge> : null}
                  {task.milestone ? <Badge>{task.milestone}</Badge> : null}
                </div>
                {task.description ? <p className="text-xs text-muted-foreground">{task.description}</p> : null}
                {task.subtasks.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                    {task.subtasks.map((subtask) => (
                      <li key={subtask}>{subtask}</li>
                    ))}
                  </ul>
                ) : null}
              </ReviewRow>
            ))}
          </ul>
        </section>
      ) : null}
      <ReviewFooter
        selectedCount={count}
        total={total}
        applying={applying}
        noun="item"
        onApply={apply}
        onCancel={onCancel}
        onSelectAll={(value) => {
          milestones.setAll(value);
          tasks.setAll(value);
        }}
      />
    </div>
  );
}

/* ---------- priorities ---------- */

function PrioritiesReview({ proposal, applying, onApply, onCancel }: ReviewProps<TaskPrioritiesProposal>) {
  const selection = useSelection(proposal.suggestions.length);
  if (proposal.suggestions.length === 0) return <NothingToChange reviewed={proposal.reviewed} noun="task" onClose={onCancel} />;
  return (
    <div className="space-y-4">
      <Summary text={proposal.summary} />
      <ul className="space-y-2">
        {proposal.suggestions.map((suggestion, index) => (
          <ReviewRow key={suggestion.taskId} checked={selection.selected[index]} onToggle={() => selection.toggle(index)} label={`Change priority of ${suggestion.title}`}>
            <p className="text-sm font-medium">{suggestion.title}</p>
            <p className="flex items-center gap-1.5 text-xs">
              <Badge>{PRIORITY_LABELS[suggestion.current]}</Badge>
              <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
              <Badge tone="accent">{PRIORITY_LABELS[suggestion.suggested]}</Badge>
            </p>
            {suggestion.reason ? <p className="text-xs text-muted-foreground">{suggestion.reason}</p> : null}
          </ReviewRow>
        ))}
      </ul>
      <ReviewFooter
        selectedCount={selection.count}
        total={proposal.suggestions.length}
        applying={applying}
        noun="change"
        onCancel={onCancel}
        onSelectAll={selection.setAll}
        onApply={() =>
          onApply({
            kind: "task_priorities",
            changes: proposal.suggestions
              .filter((_, index) => selection.selected[index])
              .map((suggestion) => ({ taskId: suggestion.taskId, priority: suggestion.suggested })),
          })
        }
      />
    </div>
  );
}

/* ---------- organize ---------- */

function OrganizeTasksReview({ proposal, applying, onApply, onCancel }: ReviewProps<OrganizeTasksProposal>) {
  const selection = useSelection(proposal.suggestions.length);
  if (proposal.suggestions.length === 0) return <NothingToChange reviewed={proposal.reviewed} noun="task" onClose={onCancel} />;
  return (
    <div className="space-y-4">
      <Summary text={proposal.summary} />
      <ul className="space-y-2">
        {proposal.suggestions.map((suggestion, index) => (
          <ReviewRow key={suggestion.taskId} checked={selection.selected[index]} onToggle={() => selection.toggle(index)} label={`Organize ${suggestion.title}`}>
            <p className="text-sm font-medium">{suggestion.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {suggestion.projectName ? <Badge tone="accent">Move to {suggestion.projectName}</Badge> : null}
              {suggestion.addTags.map((tag) => (
                <Badge key={tag}>+#{tag}</Badge>
              ))}
            </div>
            {suggestion.reason ? <p className="text-xs text-muted-foreground">{suggestion.reason}</p> : null}
          </ReviewRow>
        ))}
      </ul>
      <ReviewFooter
        selectedCount={selection.count}
        total={proposal.suggestions.length}
        applying={applying}
        noun="change"
        onCancel={onCancel}
        onSelectAll={selection.setAll}
        onApply={() =>
          onApply({
            kind: "organize_tasks",
            changes: proposal.suggestions
              .filter((_, index) => selection.selected[index])
              .map((suggestion) => ({ taskId: suggestion.taskId, projectId: suggestion.projectId, addTags: suggestion.addTags })),
          })
        }
      />
    </div>
  );
}

function OrganizeNotesReview({ proposal, applying, onApply, onCancel }: ReviewProps<OrganizeNotesProposal>) {
  const selection = useSelection(proposal.suggestions.length);
  if (proposal.suggestions.length === 0) return <NothingToChange reviewed={proposal.reviewed} noun="note" onClose={onCancel} />;
  return (
    <div className="space-y-4">
      <Summary text={proposal.summary} />
      <ul className="space-y-2">
        {proposal.suggestions.map((suggestion, index) => (
          <ReviewRow key={suggestion.noteId} checked={selection.selected[index]} onToggle={() => selection.toggle(index)} label={`Organize ${suggestion.title || "untitled note"}`}>
            <p className="text-sm font-medium">{suggestion.title || "Untitled"}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {suggestion.folder ? (
                <Badge tone="accent">
                  {suggestion.newFolder ? "New folder: " : "Folder: "}
                  {suggestion.folder}
                </Badge>
              ) : null}
              {suggestion.addTags.map((tag) => (
                <Badge key={tag}>+#{tag}</Badge>
              ))}
            </div>
            {suggestion.reason ? <p className="text-xs text-muted-foreground">{suggestion.reason}</p> : null}
          </ReviewRow>
        ))}
      </ul>
      <ReviewFooter
        selectedCount={selection.count}
        total={proposal.suggestions.length}
        applying={applying}
        noun="change"
        onCancel={onCancel}
        onSelectAll={selection.setAll}
        onApply={() =>
          onApply({
            kind: "organize_notes",
            changes: proposal.suggestions
              .filter((_, index) => selection.selected[index])
              .map((suggestion) => ({ noteId: suggestion.noteId, folder: suggestion.folder, addTags: suggestion.addTags })),
          })
        }
      />
    </div>
  );
}

/* ---------- note summary ---------- */

function SummaryReview({
  proposal,
  applying,
  onInsertSummary,
  onCancel,
}: {
  proposal: NoteSummaryProposal;
  applying: boolean;
  onInsertSummary?: (choice: SummaryChoice) => void;
  onCancel: () => void;
}) {
  const [summary, setSummary] = useState(proposal.summary);
  const [points, setPoints] = useState(proposal.keyPoints.join("\n"));
  const [tags, setTags] = useState<string[]>(proposal.suggestedTags);

  const keyPoints = points
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {proposal.truncated ? (
        <p className="rounded-xl bg-warning/15 px-3 py-2 text-sm">This note is long, so only the beginning was summarized.</p>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="summary-text" className="text-xs font-medium text-muted-foreground">
          Summary (you can edit it)
        </label>
        <Textarea id="summary-text" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="summary-points" className="text-xs font-medium text-muted-foreground">
          Key points (one per line)
        </label>
        <Textarea id="summary-points" rows={5} value={points} onChange={(event) => setPoints(event.target.value)} />
      </div>
      {proposal.suggestedTags.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Add these tags to the note</p>
          <div className="flex flex-wrap gap-1.5">
            {proposal.suggestedTags.map((tag) => {
              const on = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTags((prev) => (on ? prev.filter((existing) => existing !== tag) : [...prev, tag]))}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="outline" onClick={onCancel} disabled={applying}>
          Discard
        </Button>
        <Button
          variant="primary"
          disabled={applying || !summary.trim() || !onInsertSummary}
          onClick={() => onInsertSummary?.({ summary: summary.trim(), keyPoints, tags })}
        >
          {applying ? "Inserting…" : "Insert into note"}
        </Button>
      </div>
    </div>
  );
}
