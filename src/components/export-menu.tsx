"use client";

import { useEffect, useRef } from "react";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A small menu of download links. Each one is a plain link to a server route, so the browser handles the download. */
export function ExportMenu({ label = "Export", options, align = "right" }: { label?: string; options: { label: string; href: string }[]; align?: "left" | "right" }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary aria-label={label} className={cn(buttonVariants({ variant: "outline", size: "md" }), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        <Download className="size-4" aria-hidden /> {label}
      </summary>
      <div className={cn("absolute z-30 mt-1 w-44 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground", align === "right" ? "right-0" : "left-0")}>
        {options.map((option) => (
          <a key={option.href} href={option.href} download onClick={close} className="block rounded-md px-3 py-1.5 hover:bg-accent">
            {option.label}
          </a>
        ))}
      </div>
    </details>
  );
}
