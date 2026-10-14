"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Saves `value` shortly after it stops changing. Saves never overlap: edits made while a save is in flight
 * are saved right after it finishes, so the last edit always wins. A failed save keeps the edit and reports
 * the error; `flush()` (or the next edit) tries again.
 */
export function useAutosave<T>({
  value,
  initial,
  save,
  delayMs = 800,
  isEqual = Object.is,
}: {
  value: T;
  /** The last-saved value; edits are measured against it. */
  initial: T;
  save: (value: T) => Promise<void>;
  delayMs?: number;
  isEqual?: (a: T, b: T) => boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(value);
  const saved = useRef(initial);
  const saveRef = useRef(save);
  const equalRef = useRef(isEqual);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    saveRef.current = save;
    equalRef.current = isEqual;
    latest.current = value;
  });

  const run = useCallback((): Promise<void> => {
    if (running.current) return running.current;
    running.current = (async () => {
      try {
        while (!equalRef.current(latest.current, saved.current)) {
          const snapshot = latest.current;
          if (mounted.current) setStatus("saving");
          await saveRef.current(snapshot);
          saved.current = snapshot;
        }
        if (mounted.current) {
          setError(null);
          setStatus("saved");
        }
      } catch (caught) {
        if (mounted.current) {
          setError(caught instanceof Error ? caught.message : "Couldn't save your changes.");
          setStatus("error");
        }
      } finally {
        running.current = null;
      }
    })();
    return running.current;
  }, []);

  useEffect(() => {
    if (equalRef.current(value, saved.current)) return;
    // A save that is already running picks up the newer value when it finishes its current write.
    if (running.current) return;
    setStatus("dirty");
    timer.current = setTimeout(() => void run(), delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delayMs, run]);

  /** Saves any pending change now and resolves once nothing is left to save (or a save failed). */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await run();
  }, [run]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      // Leaving with unsaved edits (closing a note, navigating away): save them in the background.
      if (!equalRef.current(latest.current, saved.current)) void run();
    };
  }, [run]);

  const pending = status === "dirty" || status === "saving" || status === "error";

  useEffect(() => {
    if (!pending) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  return { status, error, flush, pending };
}
