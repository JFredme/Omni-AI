import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeCycleButton, ThemeSegmentedControl } from "@/components/theme-toggle";

const { setThemeMock, themeState } = vi.hoisted(() => ({
  setThemeMock: vi.fn(),
  themeState: { theme: "system" as string | undefined },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: setThemeMock }),
}));

describe("theme controls", () => {
  beforeEach(() => {
    setThemeMock.mockReset();
    themeState.theme = "system";
  });

  it("shows the active theme as checked", () => {
    themeState.theme = "dark";
    render(<ThemeSegmentedControl />);
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("false");
  });

  it("switches theme from the segmented control", async () => {
    render(<ThemeSegmentedControl />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Dark" }));
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("cycles light, then dark, then system from the icon button", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ThemeCycleButton />);
    await user.click(screen.getByRole("button", { name: /Theme: System/ }));
    expect(setThemeMock).toHaveBeenLastCalledWith("light");
    unmount();

    themeState.theme = "light";
    render(<ThemeCycleButton />);
    await user.click(screen.getByRole("button", { name: /Theme: Light/ }));
    expect(setThemeMock).toHaveBeenLastCalledWith("dark");
  });
});
