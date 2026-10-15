import { AlertCircle, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ErrorBanner({ message, onRetry, onDismiss, className }: { message: string; onRetry?: () => void; onDismiss?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger", className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2">
          Retry
        </button>
      ) : null}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 font-medium underline underline-offset-2">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="animate-rise flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <span className="relative flex size-14 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full border border-border" />
        <span className="absolute inset-2 rounded-full bg-accent" />
        <Icon className="relative size-5 text-accent-foreground" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? <span className="sr-only">Loading</span>}
    </span>
  );
}

export function SkeletonRows({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton h-14 rounded-xl" style={{ animationDelay: `${index * 120}ms` }} />
      ))}
    </div>
  );
}
