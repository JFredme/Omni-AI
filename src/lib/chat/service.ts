import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { findCatalogModel } from "@/lib/openrouter/catalog";
import { streamChatCompletion, type UsageInfo, type WebSource } from "@/lib/openrouter/client";
import { shouldSearchWeb, webCitations, type WebMode } from "@/lib/chat/web";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { estimateCostUsd } from "@/lib/openrouter/models";
import { requireApiKey } from "@/lib/settings";
import { assertWithinBudget } from "@/lib/usage";
import { retrieveContext } from "@/lib/knowledge/context";
import { attachmentPromptText, claimableAttachments, toAttachmentDto } from "./attachments";
import { activePath, deepestLatest, pathTo, siblingsOf } from "./tree";
import type { Citation } from "@/lib/knowledge/types";
import {
  buildRequestMessages,
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
  type ChatMessageInput,
  type RequestMessage,
} from "./history";
import type {
  AttachmentDto,
  BranchInfo,
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
  citations?: unknown;
  parentId?: string | null;
  attachments?: { id: string; name: string; kind: string; mimeType: string; sizeBytes: number }[];
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

function serializeMessage(row: MessageRow, branch?: BranchInfo): MessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    error: row.error,
    modelId: row.modelId,
    citations: Array.isArray(row.citations) ? (row.citations as unknown as Citation[]) : null,
    parentId: row.parentId ?? null,
    attachments: (row.attachments ?? []).map((attachment): AttachmentDto => toAttachmentDto(attachment)),
    branch: branch ?? { index: 0, count: 1, ids: [row.id] },
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

/** Attachment rows without the file bytes, which can be large. */
const attachmentSelect = { select: { id: true, name: true, kind: true, mimeType: true, sizeBytes: true } } as const;
const messageInclude = { usage: true, attachments: attachmentSelect } as const;

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
  const path = activePath(row.messages, row.leafId);
  const shown = path.map((message) => {
    const siblings = siblingsOf(row.messages, message);
    return serializeMessage(message, { index: Math.max(0, siblings.findIndex((s) => s.id === message.id)), count: siblings.length, ids: siblings.map((s) => s.id) });
  });

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
    leafId: path.at(-1)?.id ?? null,
    messageCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: shown,
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
    select: { id: true, title: true, modelId: true, systemPrompt: true, leafId: true },
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
  citations: Citation[];
  /** True when this reply may look at the live web. */
  web: boolean;
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

/** The model-ready history for the branch that ends at `leafId`: text, attached documents inlined, images as data URLs. */
async function loadRequestHistory(conversationId: string, leafId: string | null): Promise<ChatMessageInput[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true, parentId: true, role: true, content: true, status: true, createdAt: true },
  });
  const path = pathTo(rows, leafId).filter((row): row is typeof row & { role: "user" | "assistant" } => row.role !== "system");
  if (path.length === 0) return [];
  const attachments = await prisma.attachment.findMany({ where: { messageId: { in: path.map((row) => row.id) } }, orderBy: { createdAt: "asc" } });
  return path.map((row) => {
    const own = attachments.filter((attachment) => attachment.messageId === row.id);
    const images = own.filter((a) => a.kind === "image").map((a) => `data:${a.mimeType};base64,${Buffer.from(a.data).toString("base64")}`);
    return { role: row.role, status: row.status, content: row.content + attachmentPromptText(own), images };
  });
}

/** Refuses image attachments for a model the catalog says can't read images. Unknown models are given the benefit of the doubt. */
async function assertCanReadImages(modelId: string, apiKey: string, hasImages: boolean) {
  if (!hasImages) return;
  try {
    const model = await findCatalogModel(modelId, apiKey);
    if (model && !model.capabilities.imageInput) {
      throw new ApiError(400, "model_cannot_read_images", `${model.name} can't read images. Choose a model that supports image input, or remove the image.`);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
}

/** The branch a new message continues: the conversation's saved leaf, or its newest message. */
async function currentLeaf(conversationId: string, savedLeafId: string | null): Promise<string | null> {
  if (savedLeafId && (await prisma.message.findFirst({ where: { id: savedLeafId, conversationId }, select: { id: true } }))) return savedLeafId;
  const newest = await prisma.message.findFirst({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  return newest?.id ?? null;
}

export async function prepareSend(
  conversationId: string,
  input: {
    content: string;
    modelId?: string;
    useKnowledge?: boolean;
    web?: WebMode;
    attachmentIds?: string[];
    /** Edit: send this as a new version of the given user message, keeping the original as another branch. */
    replaceMessageId?: string;
  },
  signal?: AbortSignal,
): Promise<TurnPlan> {
  const content = input.content.trim();
  const attachmentRows = await claimableAttachments(input.attachmentIds ?? []);
  if (!content && attachmentRows.length === 0) throw new ApiError(400, "empty_message", "Type a message before sending.");
  if (content.length > MAX_USER_MESSAGE_CHARS) {
    throw new ApiError(400, "message_too_long", `Messages can be up to ${MAX_USER_MESSAGE_CHARS.toLocaleString()} characters.`);
  }

  const conversation = await ensureConversation(conversationId);
  await assertIdle(conversationId);
  const { key } = await requireApiKey();
  const modelId = await resolveModelId(conversation.modelId, input.modelId);
  await assertWithinBudget();
  await assertCanReadImages(modelId, key, attachmentRows.some((row) => row.kind === "image"));

  let parentId: string | null;
  if (input.replaceMessageId) {
    const replaced = await prisma.message.findFirst({ where: { id: input.replaceMessageId, conversationId }, select: { role: true, parentId: true } });
    if (!replaced || replaced.role !== "user") throw new ApiError(400, "cannot_edit", "Only your own messages can be edited.");
    parentId = replaced.parentId;
  } else {
    parentId = await currentLeaf(conversationId, conversation.leafId);
  }

  const history = await loadRequestHistory(conversationId, parentId);
  const text = content || "(see attached files)";
  const context = await retrieveContext(text, { useKnowledge: input.useKnowledge ?? false, signal });
  const images = attachmentRows.filter((row) => row.kind === "image").map((row) => `data:${row.mimeType};base64,${Buffer.from(row.data).toString("base64")}`);
  const requestMessages = buildRequestMessages({
    systemPrompt: [conversation.systemPrompt, context.prompt].filter(Boolean).join("\n\n") || null,
    history: [...history, { role: "user", content: text + attachmentPromptText(attachmentRows), status: "complete", images }],
  });

  const { user, assistant } = await prisma.$transaction(async (tx) => {
    const userRow = await tx.message.create({
      data: { conversationId, role: "user", content, status: "complete", parentId },
    });
    if (attachmentRows.length) {
      await tx.attachment.updateMany({ where: { id: { in: attachmentRows.map((row) => row.id) } }, data: { messageId: userRow.id, conversationId } });
    }
    const assistantRow = await tx.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: "",
        modelId,
        status: "streaming",
        parentId: userRow.id,
        ...(context.citations.length ? { citations: context.citations as unknown as object } : {}),
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        modelId,
        leafId: assistantRow.id,
        ...(conversation.title === DEFAULT_CONVERSATION_TITLE ? { title: deriveTitle(content || attachmentRows[0]?.name || "") } : {}),
      },
    });
    return { user: userRow, assistant: assistantRow };
  });

  const siblings = parentId
    ? await prisma.message.findMany({ where: { parentId, role: "user" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } })
    : await prisma.message.findMany({ where: { conversationId, parentId: null, role: "user" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });

  return {
    conversationId,
    modelId,
    apiKey: key,
    requestMessages,
    assistantMessageId: assistant.id,
    userMessage: serializeMessage(
      { ...user, usage: null, attachments: attachmentRows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, mimeType: row.mimeType, sizeBytes: row.sizeBytes })) },
      { index: Math.max(0, siblings.findIndex((s) => s.id === user.id)), count: Math.max(1, siblings.length), ids: siblings.map((s) => s.id) },
    ),
    citations: context.citations,
    web: shouldSearchWeb(text, input.web ?? "auto"),
  };
}

/**
 * Generates another reply to the same message. The earlier reply is kept as an alternative the user can switch back to.
 * `messageId` picks which assistant reply to redo; by default it is the end of the current branch.
 */
export async function prepareRegenerate(
  conversationId: string,
  input: { modelId?: string; useKnowledge?: boolean; web?: WebMode; messageId?: string },
  signal?: AbortSignal,
): Promise<TurnPlan> {
  const conversation = await ensureConversation(conversationId);
  await assertIdle(conversationId);
  const { key } = await requireApiKey();

  const leafId = input.messageId ?? (await currentLeaf(conversationId, conversation.leafId));
  const target = leafId ? await prisma.message.findFirst({ where: { id: leafId, conversationId }, select: { id: true, role: true, parentId: true } }) : null;
  if (!target) throw new ApiError(400, "nothing_to_regenerate", "There is no message to regenerate yet.");

  // Redoing an assistant reply replies to the same user message; a branch that ends on a user message just gets a reply.
  const replyTo = target.role === "assistant" ? target.parentId : target.id;
  if (!replyTo) throw new ApiError(400, "nothing_to_regenerate", "Send a message before regenerating a reply.");
  const replyToRow = await prisma.message.findFirst({ where: { id: replyTo, conversationId }, select: { role: true, content: true } });
  if (replyToRow?.role !== "user") throw new ApiError(400, "nothing_to_regenerate", "Send a message before regenerating a reply.");

  const modelId = await resolveModelId(conversation.modelId, input.modelId);
  await assertWithinBudget();
  const history = await loadRequestHistory(conversationId, replyTo);
  await assertCanReadImages(modelId, key, history.some((message) => (message.images?.length ?? 0) > 0));

  const context = await retrieveContext(replyToRow.content, { useKnowledge: input.useKnowledge ?? false, signal });
  const requestMessages = buildRequestMessages({
    systemPrompt: [conversation.systemPrompt, context.prompt].filter(Boolean).join("\n\n") || null,
    history,
  });

  const assistant = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: "",
        modelId,
        status: "streaming",
        parentId: replyTo,
        ...(context.citations.length ? { citations: context.citations as unknown as object } : {}),
      },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { modelId, leafId: created.id } });
    return created;
  });

  return {
    conversationId,
    modelId,
    apiKey: key,
    requestMessages,
    assistantMessageId: assistant.id,
    userMessage: null,
    citations: context.citations,
    web: shouldSearchWeb(replyToRow.content, input.web ?? "auto"),
  };
}

/** Switches the conversation to another branch, landing on the newest end of it. */
export async function selectBranch(conversationId: string, messageId: string): Promise<void> {
  await ensureConversation(conversationId);
  const rows = await prisma.message.findMany({ where: { conversationId }, select: { id: true, parentId: true, createdAt: true } });
  if (!rows.some((row) => row.id === messageId)) throw new ApiError(404, "not_found", "That message no longer exists.");
  await prisma.conversation.update({ where: { id: conversationId }, data: { leafId: deepestLatest(rows, messageId) } });
}

export async function resolveCost(
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
    citations?: Citation[];
  },
): Promise<MessageDto> {
  const [message] = await prisma.$transaction([
    prisma.message.update({
      where: { id: plan.assistantMessageId },
      data: { content: result.content, status: result.status, error: result.error, ...(result.citations ? { citations: result.citations as unknown as object } : {}) },
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
    citations: plan.citations,
  };

  let text = "";
  let usage: UsageInfo | null = null;
  const webSources: WebSource[] = [];
  const allCitations = () => [...plan.citations, ...webCitations(webSources, plan.citations)];

  try {
    for await (const event of streamChatCompletion({
      apiKey: plan.apiKey,
      body: { model: plan.modelId, messages: plan.requestMessages, ...(plan.web ? { plugins: [{ id: "web", max_results: 5 }] } : {}) },
      signal,
    })) {
      if (event.type === "delta") {
        text += event.text;
        yield { type: "delta", text: event.text };
      } else if (event.type === "usage") {
        usage = event.usage;
      } else if (event.type === "web") {
        webSources.push(...event.sources);
        yield { type: "web", citations: allCitations() };
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
      ...(webSources.length ? { citations: allCitations() } : {}),
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
        ...(webSources.length ? { citations: allCitations() } : {}),
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
