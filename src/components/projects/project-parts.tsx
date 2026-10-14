import { Badge } from "@/components/ui/badge";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

const statusClasses: Record<ProjectStatus, string> = {
  planning: "bg-muted text-muted-foreground",
  active: "bg-accent text-accent-foreground",
  on_hold: "bg-warning/25 text-foreground",
  completed: "bg-success/15 text-success",
  archived: "bg-muted text-muted-foreground",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge className={statusClasses[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

export function ProgressBar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full transition-[width]", percent === 100 ? "bg-success" : "bg-primary")} style={{ width: `${percent}%` }} />
    </div>
  );
}
