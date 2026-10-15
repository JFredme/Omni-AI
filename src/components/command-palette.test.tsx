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
    expect(labels).toContain("Chat");
    expect(labels).toContain("Today");
    expect(labels).toContain("New chat");
    expect(labels).toContain("Settings");
    expect(labels).toContain("Use dark theme");
    expect(labels).toContain("Toggle sidebar");
  });

  it("filters pages and actions as the user types, then offers to ask or add what was typed", async () => {
    const { user } = renderPalette();
    await user.type(screen.getByRole("combobox"), "theme dark");
    expect(options().map((option) => option.textContent)).toEqual(["Use dark theme", "Ask AI: theme dark", "Add task: theme dark", "Add note: theme dark"]);
  });

  it("still offers to ask or add when nothing matches a page", async () => {
    const { user } = renderPalette();
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(options().map((option) => option.textContent)).toEqual(["Ask AI: zzzz", "Add task: zzzz", "Add note: zzzz"]);
  });

  it("'Ask AI' fills the chat box for you to send, and does not send", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/tasks"); // somewhere other than the chat, so it has to open the chat
    const { user, onClose } = renderPalette();
    await user.type(screen.getByRole("combobox"), "what is due zzzz");
    await user.click(screen.getByRole("option", { name: /Ask AI/ }));
    expect(sessionStorage.getItem("omni.chatDraft")).toBe("what is due zzzz");
    expect(pushMock).toHaveBeenCalledWith("/");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("'Ask AI' stays put when you're already in the chat", async () => {
    window.history.pushState({}, "", "/chat/abc");
    const { user } = renderPalette();
    await user.type(screen.getByRole("combobox"), "and another thing zzzz");
    await user.click(screen.getByRole("option", { name: /Ask AI/ }));
    expect(sessionStorage.getItem("omni.chatDraft")).toBe("and another thing zzzz");
    expect(pushMock).not.toHaveBeenCalled();
    sessionStorage.clear();
    window.history.pushState({}, "", "/");
  });

  it("'Add task' creates the task, and stays open with the reason if that fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Nope." } }), { status: 400 })).mockResolvedValueOnce(new Response(JSON.stringify({ task: {} }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const { user, onClose } = renderPalette();
    await user.type(screen.getByRole("combobox"), "pay rent zzzz");
    await user.click(screen.getByRole("option", { name: /Add task/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: /Add task/ }));
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith("/tasks"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ title: "pay rent zzzz" });
    vi.unstubAllGlobals();
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
