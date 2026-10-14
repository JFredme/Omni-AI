import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/command-palette";

const { pushMock, setThemeMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  setThemeMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: setThemeMock }),
}));

function renderPalette() {
  const onClose = vi.fn();
  render(<CommandPalette onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
}

function options() {
  return within(screen.getByRole("listbox")).getAllByRole("option");
}

describe("CommandPalette", () => {
  beforeEach(() => {
    pushMock.mockReset();
    setThemeMock.mockReset();
  });

  it("lists every page and the built-in actions", () => {
    renderPalette();
    const labels = options().map((option) => option.textContent);
    expect(labels).toContain("AI Chat");
    expect(labels).toContain("Settings");
    expect(labels).toContain("Use dark theme");
    expect(labels).toContain("Toggle sidebar");
  });

  it("filters results as the user types", async () => {
    const { user } = renderPalette();
    await user.type(screen.getByRole("combobox"), "theme dark");
    expect(options().map((option) => option.textContent)).toEqual(["Use dark theme"]);
  });

  it("shows an empty state when nothing matches", async () => {
    const { user } = renderPalette();
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText(/No matches for/)).toBeTruthy();
  });

  it("runs the highlighted command with Enter and closes", async () => {
    const { user, onClose } = renderPalette();
    await user.type(screen.getByRole("combobox"), "settings");
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/settings");
  });

  it("moves the highlight with arrow keys", async () => {
    const { user } = renderPalette();
    const input = screen.getByRole("combobox");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowDown}");
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(options()[options().length - 1].getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape", async () => {
    const { user, onClose } = renderPalette();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs theme actions", async () => {
    const { user, onClose } = renderPalette();
    await user.click(screen.getByRole("option", { name: "Use dark theme" }));
    expect(setThemeMock).toHaveBeenCalledWith("dark");
    expect(onClose).toHaveBeenCalled();
  });
});
