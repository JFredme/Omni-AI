import type { ConversationDetail, MessageDto } from "./types";

export const EXPORT_FORMATS = ["md", "txt", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

function slug(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "conversation";
}

function speaker(message: MessageDto): string {
  return message.role === "user" ? "You" : message.modelId ? `Assistant (${message.modelId})` : "Assistant";
}

function sourcesLine(message: MessageDto): string[] {
  const sources = (message.citations ?? []).filter((c) => c.kind === "source");
  if (sources.length === 0) return [];
  return ["Sources:", ...sources.map((c) => `  [${c.n}] ${c.name}${c.page ? `, page ${c.page}` : ""}`)];
}

function attachmentsLine(message: MessageDto): string[] {
  return message.attachments.length ? [`Attached: ${message.attachments.map((a) => a.name).join(", ")}`] : [];
}

/** Turns the branch currently shown into a downloadable file. Other branches are not included. */
export function exportConversation(conversation: ConversationDetail, format: ExportFormat, now: Date = new Date()): { filename: string; contentType: string; body: string } {
  const filename = `${slug(conversation.title)}.${format}`;

  if (format === "json") {
    return {
      filename,
      contentType: "application/json",
      body: JSON.stringify(
        {
          title: conversation.title,
          model: conversation.modelId,
          systemPrompt: conversation.systemPrompt,
          exportedAt: now.toISOString(),
          messages: conversation.messages.map((message) => ({
            role: message.role,
            content: message.content,
            model: message.modelId,
            createdAt: message.createdAt,
            status: message.status,
            attachments: message.attachments.map((a) => ({ name: a.name, kind: a.kind, mimeType: a.mimeType })),
            sources: message.citations,
          })),
        },
        null,
        2,
      ),
    };
  }

  const lines: string[] = [];
  if (format === "md") {
    lines.push(`# ${conversation.title}`, "", `*Exported ${now.toISOString().slice(0, 10)}${conversation.modelId ? ` · ${conversation.modelId}` : ""}*`, "");
    if (conversation.systemPrompt) lines.push("> **Instructions:** " + conversation.systemPrompt.replace(/\n/g, "\n> "), "");
    for (const message of conversation.messages) {
      lines.push(`## ${speaker(message)}`, "", message.content || (message.status === "error" ? `*(failed: ${message.error ?? "error"})*` : "*(no text)*"), "");
      for (const extra of [...attachmentsLine(message), ...sourcesLine(message)]) lines.push(`*${extra.trim()}*`.replace(/\n/g, " "), "");
    }
  } else {
    lines.push(conversation.title, `Exported ${now.toISOString().slice(0, 10)}`, "");
    for (const message of conversation.messages) {
      lines.push(`${speaker(message)}:`, message.content || "(no text)", ...attachmentsLine(message), ...sourcesLine(message), "");
    }
  }
  return { filename, contentType: format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8", body: `${lines.join("\n").trimEnd()}\n` };
}
