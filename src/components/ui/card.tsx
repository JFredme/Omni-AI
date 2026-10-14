import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass rounded-2xl border border-border p-5 shadow-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
