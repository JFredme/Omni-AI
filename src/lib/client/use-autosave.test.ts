import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./use-autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(save: (value: string) => Promise<void>, delayMs = 500) {
  return renderHook(({ value }) => useAutosave({ value, initial: "start", save, delayMs }), {
    initialProps: { value: "start" },
  });
}

describe("useAutosave", () => {
  it("does nothing until the value changes", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(save);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("waits for typing to pause, then saves only the latest value", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: "a" });
    expect(result.current.status).toBe("dirty");
    await act(() => vi.advanceTimersByTimeAsync(300));
    rerender({ value: "ab" });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(save).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(result.current.status).toBe("saved");
  });

  it("never overlaps saves and finishes with the newest edit", async () => {
    let release: () => void = () => undefined;
    const calls: string[] = [];
    const save = vi.fn((value: string) => {
      calls.push(value);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const { result, rerender } = setup(save);

    rerender({ value: "one" });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(result.current.status).toBe("saving");

    rerender({ value: "two" });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(calls).toEqual(["one"]);

    await act(async () => release());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toEqual(["one", "two"]);

    await act(async () => release());
    expect(result.current.status).toBe("saved");
  });

  it("keeps the edit and reports the error when a save fails, then recovers on flush", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Network down")).mockResolvedValue(undefined);
    const { result, rerender } = setup(save);

    rerender({ value: "x" });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Network down");
    expect(result.current.pending).toBe(true);

    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("flush saves immediately without waiting for the delay", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = setup(save);
    rerender({ value: "now" });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledWith("now");
  });

  it("saves pending edits when the editor is closed", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender, unmount } = setup(save);
    rerender({ value: "unsaved" });
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledWith("unsaved");
  });

  it("warns before the tab closes while changes are unsaved", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = setup(save);
    rerender({ value: "typing" });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(500));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
