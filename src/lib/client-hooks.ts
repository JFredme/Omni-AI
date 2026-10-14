import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** False during server rendering and hydration, true after the client has mounted. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

/** The platform's primary modifier key label, e.g. "⌘" on macOS and "Ctrl" elsewhere. */
export function useModifierLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => (isApplePlatform(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}
