import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "accent" | "success";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-accent text-accent-foreground",
  success: "bg-success/15 text-success",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
