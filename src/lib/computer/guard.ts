// Safety rules for letting an agent use this computer. These are a second line of defence: every action is also shown to the
// person and waits for their approval. Nothing here makes an action safe by itself.
import os from "node:os";
import path from "node:path";

export const MAX_OUTPUT_CHARS = 8_000;
export const MAX_FILE_READ_CHARS = 30_000;
export const MAX_FILE_WRITE_CHARS = 200_000;
export const COMMAND_TIMEOUT_MS = 60_000;

/** Commands that are never run, whatever the agent says. They would wipe data, take over the system, or run unseen code. */
const BLOCKED_COMMANDS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bsudo\b|\bdoas\b|\bsu\s+-?\w*/i, reason: "Commands that act as an administrator are not allowed." },
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(\/|~|\$HOME|\*|\.)(\s|$|\/\*?)/i, reason: "Deleting a whole folder tree like this is not allowed." },
  { pattern: /\b(mkfs|fdisk|diskutil\s+(erase|partition|zero)|format\s+[a-z]:|dd\s+if=)/i, reason: "Commands that erase or rewrite disks are not allowed." },
  { pattern: /:\(\)\s*\{.*\};\s*:/, reason: "That looks like a fork bomb." },
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i, reason: "Downloading and running a script in one step is not allowed." },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "Shutting the computer down is not allowed." },
  { pattern: /\bchmod\s+(-R\s+)?[0-7]*777\s+\//i, reason: "Opening up system permissions is not allowed." },
  { pattern: /\b(security\s+(find|dump|export)-|keychain)\b/i, reason: "Reading the keychain is not allowed." },
  { pattern: /\.ssh\b|\.aws\b|\.gnupg\b|id_rsa|id_ed25519|secrets\.json|(^|[\s/])\.env(\.|\s|$)/i, reason: "Secret files (keys, passwords, .env) are off limits." },
];

export function checkCommand(command: string): { ok: true } | { ok: false; reason: string } {
  const text = command.trim();
  if (!text) return { ok: false, reason: "The command is empty." };
  if (text.length > 4_000) return { ok: false, reason: "The command is too long." };
  for (const rule of BLOCKED_COMMANDS) if (rule.pattern.test(text)) return { ok: false, reason: rule.reason };
  return { ok: true };
}

/** Folders and files an agent may not read or change, wherever they are. */
const PROTECTED_NAMES = [".ssh", ".aws", ".gnupg", ".kube", ".docker", "Keychains", "Library/Application Support/OMNI AI", "AppData/Roaming/OMNI AI", ".env", ".netrc", "secrets.json", "id_rsa", "id_ed25519"];

export class ComputerAccessError extends Error {}

/** Turns what the agent wrote (maybe "~/Desktop/a.txt") into a full path, or refuses it. Relative paths start in the home folder. */
export function resolveUserPath(input: string, home = os.homedir()): string {
  const raw = input.trim();
  if (!raw) throw new ComputerAccessError("A path is required.");
  if (raw.includes("\0")) throw new ComputerAccessError("That path is not valid.");
  const expanded = raw === "~" ? home : raw.startsWith("~/") || raw.startsWith("~\\") ? path.join(home, raw.slice(2)) : raw;
  const full = path.resolve(path.isAbsolute(expanded) ? expanded : path.join(home, expanded));
  const normalized = full.split(path.sep).join("/");
  for (const name of PROTECTED_NAMES) {
    const needle = `/${name}`;
    if (normalized.endsWith(needle) || normalized.includes(`${needle}/`) || normalized.split("/").pop()?.startsWith(".env")) {
      throw new ComputerAccessError("That location holds secrets or this app's own data, so it is off limits.");
    }
  }
  if (full === path.parse(full).root) throw new ComputerAccessError("The top of the disk is off limits.");
  return full;
}

/** The environment a command runs in: the person's normal one, without OMNI's own secrets. */
export function cleanEnvironment(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(DATABASE_URL|ENCRYPTION_KEY|OPENROUTER_|OMNI_|NEXT_|PG|AUTH_|SESSION_)/i.test(key)) continue;
    if (/(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function clip(text: string, max = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  return text.length > max ? { text: `${text.slice(0, max)}\n…(cut off)`, truncated: true } : { text, truncated: false };
}
