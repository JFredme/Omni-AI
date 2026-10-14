import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setSidebarCollapsed, toggleSidebarCollapsed, useSidebarCollapsed } from "@/lib/sidebar-store";

describe("sidebar store", () => {
  it("defaults to expanded", () => {
    const { result } = renderHook(() => useSidebarCollapsed());
    expect(result.current).toBe(false);
  });

  it("toggles and persists the collapsed state", () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    act(() => toggleSidebarCollapsed());
    expect(result.current).toBe(true);
    expect(window.localStorage.getItem("omni-sidebar-collapsed")).toBe("true");

    act(() => toggleSidebarCollapsed());
    expect(result.current).toBe(false);
    expect(window.localStorage.getItem("omni-sidebar-collapsed")).toBe("false");
  });

  it("notifies subscribers when set explicitly", () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    act(() => setSidebarCollapsed(true));
    expect(result.current).toBe(true);
  });
});
