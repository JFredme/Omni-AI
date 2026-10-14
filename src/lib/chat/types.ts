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

export interface MessageDto {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  error: string | null;
  modelId: string | null;
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
  messages: MessageDto[];
  usage: {
    requests: number;
    totalTokens: number;
    costUsd: number;
    unknownCostRequests: number;
  };
}

export type TurnEvent =
  | { type: "start"; userMessage: MessageDto | null; assistantMessageId: string; modelId: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: MessageDto }
  | { type: "stopped"; message: MessageDto }
  | { type: "error"; code: string; message: string; messageId: string };
