import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { findCatalogModel } from "@/lib/openrouter/catalog";
import { streamChatCompletion, type UsageInfo } from "@/lib/openrouter/client";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { estimateCostUsd } from "@/lib/openrouter/models";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import {
  buildRequestMessages,
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
  type ChatMessageInput,
  type RequestMessage,
} from "./history";
import type {
  ConversationDetail,
  ConversationSummary,
  CostSource,
  MessageDto,
  MessageStatus,
  TurnEvent,
} from "./types";

export const MAX_USER_MESSAGE_CHARS = 20_000;
export const MAX_SYSTEM_PROMPT_CHARS = 8_000;
export const MAX_TITLE_CHARS = 120;
/** A reply still marked "streaming" after this long was abandoned by a crashed process. */
const STALE_STREAM_MS = 5 * 60 * 1000;

type MessageRow = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  status: MessageStatus;
  error: string | null;
  modelId: string | null;
  createdAt: Date;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
    costSource: CostSource;
  } | null;
};

function serializeMessage(row: MessageRow): MessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    error: row.error,
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
    usage: row.usage
      ? {
          promptTokens: row.usage.promptTokens,
          completionTokens: row.usage.completionTokens,
          totalTokens: row.usage.totalTokens,
          costUsd: row.usage.costUsd,
          costSource: row.usage.costSource,
        }
      : null,
  };
}

const messageInclude = { usage: true } as const;

export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = await prisma.conversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { _count: { select: { messages: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    messageCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createConversation(input: { title?: string; modelId?: string | null }): Promise<ConversationSummary> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { defaultModelId: true } });
  const row = await prisma.conversation.create({
    data: {
      title: input.title?.trim() || DEFAULT_CONVERSATION_TITLE,
      modelId: input.modelId ?? settings?.defaultModelId ?? null,
    },
  });
  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    messageCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  await prisma.message.updateMany({
    where: { conversationId: id, status: "streaming", createdAt: { lt: new Date(Date.now() - STALE_STREAM_MS) } },
    data: { status: "error", error: "Generation was interrupted before it finished." },
  });

  const row = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: { include: messageInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      _count: { select: { messages: true } },
    },
  });
  if (!row) throw new ApiError(404, "not_found", "That conversation no longer exists.");

  const usage = await prisma.usageRecord.aggregate({
    where: { conversationId: id },
    _count: { _all: true },
    _sum: { totalTokens: true, costUsd: true },
  });
  const unknownCost = await prisma.usageRecord.count({
    where: { conversationId: id, costUsd: null, status: { in: ["complete", "stopped"] } },
  });

  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    systemPrompt: row.systemPrompt,
    messageCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map(serializeMessage),
    usage: {
      requests: usage._count._all,
      totalTokens: usage._sum.totalTokens ?? 0,
      costUsd: usage._sum.costUsd ?? 0,
      unknownCostRequests: unknownCost,
    },
  };
}

export async function updateConversation(
  id: string,
  patch: { title?: string; modelId?: string | null; systemPrompt?: string | null },
): Promise<void> {
  await ensureConversation(id);
  await prisma.conversation.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim() || DEFAULT_CONVERSATION_TITLE } : {}),
      ...(patch.modelId !== undefined ? { modelId: patch.modelId } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt?.trim() || null } : {}),
    },
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await ensureConversation(id);
  await prisma.conversation.delete({ where: { id } });
}

async function ensureConversation(id: string) {
  const row = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, title: true, modelId: true, systemPrompt: true },
  });
  if (!row) throw new ApiError(404, "not_found", "That conversation no longer exists.");
  return row;
}

export interface TurnPlan {
  conversationId: string;
  modelId: string;
  apiKey: string;
  requestMessages: RequestMessage[];
  assistantMessageId: string;
  userMessage: MessageDto | null;
}

async function resolveModelId(conversationModelId: string | null, requested: string | undefined): Promise<string> {
  if (requested) return requested;
  if (conversationModelId) return conversationModelId;
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { defaultModelId: true } });
  if (settings?.defaultModelId) return settings.defaultModelId;
  throw new ApiError(400, "model_required", "Choose a model before sending a message.");
}

async function assertIdle(conversationId: string) {
  const busy = await prisma.message.findFirst({
    where: { conversationId, status: "streaming", createdAt: { gte: new Date(Date.now() - STALE_STREAM_MS) } },
    select: { id: true },
  });
  if (busy) throw new ApiError(409, "generation_in_progress", "A reply is still being generated in this conversation.");
}

async function loadRequestHistory(conversationId: string): Promise<ChatMessageInput[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true, content: true, status: true },
  });
  return rows.filter((row): row is ChatMessageInput & { role: "user" | "assistant" } => row.role !== "system");
}

export async function prepareSend(
  conversationId: string,
  input: { content: string; modelId?: string },
): Promise<TurnPlan> {
  const content = input.content.trim();
  if (!content) throw new ApiError(400, "empty_message", "Type a message before sending.");
  if (content.length > MAX_USER_MESSAGE_CHARS) {
    throw new ApiError(400, "message_too_long", `Messages can be up to ${MAX_USER_MESSAGE_CHARS.toLocaleString()} characters.`);
  }

  const conversation = await ensureConversation(conversationId);
  await assertIdle(conversationId);
  const { key } = await requireApiKey();
  const modelId = await resolveModelId(conversation.modelId, input.modelId);
  await assertWithinBudget();

  const history = await loadRequestHistory(conversationId);
  const requestMessages = buildRequestMessages({
    systemPrompt: conversation.systemPrompt,
    history: [...history, { role: "user", content, status: "complete" }],
  });

  const { user, assistant } = await prisma.$transaction(async (tx) => {
    const userRow = await tx.message.create({
      data: { conversationId, role: "user", content, status: "complete" },
      include: messageInclude,
    });
    const assistantRow = await tx.message.create({
      data: { conversationId, role: "assistant", content: "", modelId, status: "streaming" },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        modelId,
        ...(conversation.title === DEFAULT_CONVERSATION_TITLE ? { title: deriveTitle(content) } : {}),
      },
    });
    return { user: userRow, assistant: assistantRow };
  });

  return {
    conversationId,
    modelId,
    apiKey: key,
    requestMessages,
    assistantMessageId: assistant.id,
    userMessage: serializeMessage({ ...user, usage: null }),
  };
}

export async function prepareRegenerate(conversationId: string, input: { modelId?: string }): Promise<TurnPlan> {
  const conversation = await ensureConversation(conversationId);
  await assertIdle(conversationId);
  const { key } = await requireApiKey();

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, role: true, content: true, status: true },
  });
  const last = messages.at(-1);
  if (!last) throw new ApiError(400, "nothing_to_regenerate", "There is no message to regenerate yet.");

  const replacedId = last.role === "assistant" ? last.id : null;
  const history = replacedId ? messages.slice(0, -1) : messages;
  if (history.at(-1)?.role !== "user") {
    throw new ApiError(400, "nothing_to_regenerate", "Send a message before regenerating a reply.");
  }

  const modelId = await resolveModelId(conversation.modelId, input.modelId);
  await assertWithinBudget();

  const requestMessages = buildRequestMessages({
    systemPrompt: conversation.systemPrompt,
    history: history.map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      status: message.status,
    })),
  });

  const assistant = await prisma.$transaction(async (tx) => {
    if (replacedId) {
      await tx.message.delete({ where: { id: replacedId } });
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { modelId } });
    return tx.message.create({
      data: { conversationId, role: "assistant", content: "", modelId, status: "streaming" },
    });
  });

  return {
    conversationId,
    modelId,
    apiKey: key,
    requestMessages,
    assistantMessageId: assistant.id,
    userMessage: null,
  };
}

async function resolveCost(
  modelId: string,
  apiKey: string,
  usage: UsageInfo | null,
): Promise<{ costUsd: number | null; source: CostSource }> {
  if (!usage) return { costUsd: null, source: "unknown" };
  if (usage.cost !== null) return { costUsd: usage.cost, source: "openrouter" };

  try {
    const model = await findCatalogModel(modelId, apiKey);
    const estimate = model
      ? estimateCostUsd(
          { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens },
          { promptPrice: model.promptPrice, completionPrice: model.completionPrice },
        )
      : null;
    return estimate === null ? { costUsd: null, source: "unknown" } : { costUsd: estimate, source: "estimated" };
  } catch {
    return { costUsd: null, source: "unknown" };
  }
}

async function finalizeTurn(
  plan: TurnPlan,
  result: {
    content: string;
    status: MessageStatus;
    error: string | null;
    usage: UsageInfo | null;
    costUsd: number | null;
    costSource: CostSource;
    usageStatus: "complete" | "stopped" | "error";
  },
): Promise<MessageDto> {
  const [message] = await prisma.$transaction([
    prisma.message.update({
      where: { id: plan.assistantMessageId },
      data: { content: result.content, status: result.status, error: result.error },
      include: messageInclude,
    }),
    prisma.usageRecord.create({
      data: {
        conversationId: plan.conversationId,
        messageId: plan.assistantMessageId,
        modelId: plan.modelId,
        promptTokens: result.usage?.promptTokens ?? null,
        completionTokens: result.usage?.completionTokens ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
        costUsd: result.costUsd,
        costSource: result.costSource,
        status: result.usageStatus,
      },
    }),
    prisma.conversation.update({ where: { id: plan.conversationId }, data: { updatedAt: new Date() } }),
  ]);
  return serializeMessage(message);
}

function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof OpenRouterError) return { code: error.kind, message: userMessageFor(error) };
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  console.error("Unexpected error while generating a reply:", error);
  return { code: "internal", message: "Something went wrong while generating the reply." };
}

/**
 * Streams one assistant reply, persisting the outcome. Yields events for the client.
 * Stopping (abort) keeps the partial text; upstream failures are stored on the message.
 */
export async function* runTurn(plan: TurnPlan, signal: AbortSignal): AsyncGenerator<TurnEvent> {
  yield {
    type: "start",
    userMessage: plan.userMessage,
    assistantMessageId: plan.assistantMessageId,
    modelId: plan.modelId,
  };

  let text = "";
  let usage: UsageInfo | null = null;

  try {
    for await (const event of streamChatCompletion({
      apiKey: plan.apiKey,
      body: { model: plan.modelId, messages: plan.requestMessages },
      signal,
    })) {
      if (event.type === "delta") {
        text += event.text;
        yield { type: "delta", text: event.text };
      } else if (event.type === "usage") {
        usage = event.usage;
      }
    }

    const cost = await resolveCost(plan.modelId, plan.apiKey, usage);
    const message = await finalizeTurn(plan, {
      content: text,
      status: "complete",
      error: null,
      usage,
      costUsd: cost.costUsd,
      costSource: cost.source,
      usageStatus: "complete",
    });
    yield { type: "done", message };
  } catch (error) {
    if (signal.aborted) {
      const cost = await resolveCost(plan.modelId, plan.apiKey, usage);
      const message = await finalizeTurn(plan, {
        content: text,
        status: "stopped",
        error: null,
        usage,
        costUsd: cost.costUsd,
        costSource: cost.source,
        usageStatus: "stopped",
      });
      yield { type: "stopped", message };
      return;
    }

    const failure = describeFailure(error);
    const message = await finalizeTurn(plan, {
      content: text,
      status: "error",
      error: failure.message,
      usage,
      costUsd: null,
      costSource: "unknown",
      usageStatus: "error",
    });
    yield { type: "error", code: failure.code, message: failure.message, messageId: message.id };
  }
}
