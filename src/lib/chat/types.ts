import type { Citation } from "@/lib/knowledge/types";

export type MessageRole = "system" | "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "stopped" | "error";
export type CostSource = "openrouter" | "estimated" | "unknown";

export interface MessageUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costSource: CostSource;
}

export interface AttachmentDto {
  id: string;
  name: string;
  kind: "image" | "document";
  mimeType: string;
  sizeBytes: number;
}

/** Where a message sits among alternatives made by editing or regenerating. */
export interface BranchInfo {
  index: number;
  count: number;
  /** Ids of every alternative, oldest first. */
  ids: string[];
}

export interface MessageDto {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  error: string | null;
  modelId: string | null;
  /** Sources and memories the model was given for this reply. */
  citations: Citation[] | null;
  parentId: string | null;
  attachments: AttachmentDto[];
  branch: BranchInfo;
  createdAt: string;
  usage: MessageUsage | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  modelId: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  systemPrompt: string | null;
  leafId: string | null;
  messages: MessageDto[];
  usage: {
    requests: number;
    totalTokens: number;
    costUsd: number;
    unknownCostRequests: number;
  };
}

export type TurnEvent =
  | { type: "start"; userMessage: MessageDto | null; assistantMessageId: string; modelId: string; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "done"; message: MessageDto }
  | { type: "stopped"; message: MessageDto }
  | { type: "error"; code: string; message: string; messageId: string };
