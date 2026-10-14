// How the command bar hands text to the chat box: stored for the next chat page, and announced to one already open.
export const CHAT_DRAFT_KEY = "omni.chatDraft";
export const CHAT_DRAFT_EVENT = "omni:chat-draft";

export function leaveChatDraft(text: string): void {
  try {
    sessionStorage.setItem(CHAT_DRAFT_KEY, text);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHAT_DRAFT_EVENT));
}
