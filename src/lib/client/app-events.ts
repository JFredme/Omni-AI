// Small signals between parts of the screen that don't share a parent: the sidebar, the chat, and the app shell.
export const NEW_CHAT_EVENT = "omni:new-chat";
export const OPEN_MENU_EVENT = "omni:open-menu";
export const OPEN_PALETTE_EVENT = "omni:open-palette";

export function announce(name: string): void {
  window.dispatchEvent(new Event(name));
}
