import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/tasks",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

function renderShell() {
  render(
    <AppShell>
      <p>Page body</p>
    </AppShell>,
  );
  return userEvent.setup();
}

function sidebar() {
  return screen.getByRole("complementary", { name: "Sidebar" });
}

describe("AppShell", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it("renders the page content and the current section title", () => {
    renderShell();
    expect(screen.getByText("Page body")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(within(screen.getByRole("banner")).getByText("Tasks")).toBeTruthy();
  });

  it("marks the current route in the sidebar", () => {
    renderShell();
    const link = within(sidebar()).getByRole("link", { name: /^Tasks/ });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens the command palette with Ctrl+K", async () => {
    const user = renderShell();
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("collapses and persists the sidebar with Ctrl+B", async () => {
    const user = renderShell();
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");

    await user.keyboard("{Control>}b{/Control}");
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
    expect(window.localStorage.getItem("omni-sidebar-collapsed")).toBe("true");

    await user.keyboard("{Control>}b{/Control}");
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
  });

  it("navigates to settings with Ctrl+,", async () => {
    const user = renderShell();
    await user.keyboard("{Control>},{/Control}");
    expect(pushMock).toHaveBeenCalledWith("/settings");
  });

  it("opens the mobile navigation drawer from the menu button", async () => {
    const user = renderShell();
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  });
});
