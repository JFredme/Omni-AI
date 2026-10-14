import { Badge } from "@/components/ui/badge";
import type { AgentRunStatus, AgentStepStatus } from "@/lib/agents/types";
import { cn } from "@/lib/utils";

const runLabels: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Needs your approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const runClasses: Record<AgentRunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-accent text-accent-foreground",
  awaiting_approval: "bg-warning/25 text-foreground",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-muted text-muted-foreground",
};

export function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  return <Badge className={cn(runClasses[status], status === "running" && "animate-pulse")}>{runLabels[status]}</Badge>;
}

const stepLabels: Record<AgentStepStatus, string> = {
  pending_approval: "Waiting for approval",
  approved: "Approved",
  running: "Running",
  rejected: "Declined",
  ok: "Done",
  error: "Failed",
};

const stepClasses: Record<AgentStepStatus, string> = {
  pending_approval: "bg-warning/25 text-foreground",
  approved: "bg-accent text-accent-foreground",
  running: "bg-accent text-accent-foreground",
  rejected: "bg-muted text-muted-foreground",
  ok: "bg-success/15 text-success",
  error: "bg-danger/15 text-danger",
};

export function StepStatusBadge({ status }: { status: AgentStepStatus }) {
  return <Badge className={stepClasses[status]}>{stepLabels[status]}</Badge>;
}

export function formatCost(value: number): string {
  return value === 0 ? "$0.00" : value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(2)}`;
}
