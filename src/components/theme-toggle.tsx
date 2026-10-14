"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/lib/client-hooks";
import { cn } from "@/lib/utils";

export type ThemeChoice = "light" | "system" | "dark";

export const themeOptions: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeSegmentedControl() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-xl border border-border bg-muted/60 p-1"
    >
      {themeOptions.map(({ value, label, icon: Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

const nextTheme: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

export function ThemeCycleButton() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current: ThemeChoice =
    mounted && (theme === "light" || theme === "dark") ? theme : "system";
  const option = themeOptions.find((item) => item.value === current) ?? themeOptions[1];
  const Icon = option.icon;

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme[current])}
      aria-label={`Theme: ${option.label}. Switch theme`}
      title={`Theme: ${option.label}`}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
