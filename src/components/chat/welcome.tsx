"use client";

import Link from "next/link";
import { BookOpenText, Brain, CalendarDays, Lightbulb, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getGreeting } from "@/lib/greeting";

interface Starter {
  icon: LucideIcon;
  title: string;
  prompt: string;
}

const STARTERS: Starter[] = [
  { icon: CalendarDays, title: "Plan my week", prompt: "Help me plan my week. I'll list what I need to get done, and you suggest a realistic schedule.\n\nHere's my list: " },
  { icon: Lightbulb, title: "Explain it simply", prompt: "Explain a concept in simple terms, then quiz me with three questions to check I understood. The topic is: " },
  { icon: BookOpenText, title: "Draft something", prompt: "Draft a clear, polite message for this situation, with a shorter version too: " },
  { icon: Brain, title: "Think it through", prompt: "I'm weighing a decision. Ask me questions one at a time to help me think it through. The decision is: " },
];

/** The top of an empty chat: a greeting, what to try, and a hint about slash commands. The message box sits right below it. */
export function WelcomeHero({ ready }: { ready: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-7 text-center sm:px-6">
      <svg viewBox="0 0 24 24" className="animate-rise mb-6 size-9 text-primary" aria-hidden>
        <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="3.6" fill="currentColor" />
      </svg>
      <p className="eyebrow animate-rise" style={{ "--i": 1 } as React.CSSProperties} suppressHydrationWarning>
        {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </p>
      <h1 className="animate-rise font-display mt-3 text-balance text-4xl font-medium leading-[1.1] tracking-tight sm:text-5xl" style={{ "--i": 2 } as React.CSSProperties} suppressHydrationWarning>
        {`${getGreeting(new Date())}.`}
        <span className="mt-1 block text-muted-foreground">{ready ? "What should we work on?" : "Let's get you set up."}</span>
      </h1>
    </div>
  );
}

export function StarterGrid({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
      <ul className="grid gap-2.5 sm:grid-cols-2" aria-label="Ways to start">
        {STARTERS.map((starter, index) => {
          const Icon = starter.icon;
          return (
            <li key={starter.title} className="animate-rise h-full" style={{ "--i": index + 4 } as React.CSSProperties}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(starter.prompt)}
                className="group flex h-full w-full items-start gap-3 rounded-2xl border border-border bg-card/60 px-4 py-3.5 text-left transition-[border-color,background-color,transform] hover:border-primary/40 hover:bg-card active:translate-y-px disabled:opacity-50"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-accent text-primary transition-colors group-hover:bg-primary/10">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{starter.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">{starter.prompt.split("\n")[0]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="animate-rise mt-5 text-center text-[13px] text-muted-foreground" style={{ "--i": 8 } as React.CSSProperties}>
        Type <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">/</kbd> to add a task or note, or jump to anything in Omni.
      </p>
    </div>
  );
}

export function ConnectHero() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">Omni talks to models through OpenRouter. Add your key once and every model is available. It&apos;s encrypted before it&apos;s stored and never leaves the server.</p>
      <Link href="/settings" className={buttonVariants({ variant: "primary" })}>
        Open settings
      </Link>
    </div>
  );
}
