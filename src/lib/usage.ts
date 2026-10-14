import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getMonthSpend(now: Date = new Date()): Promise<{ spendUsd: number; unknownCostRequests: number }> {
  const since = startOfUtcMonth(now);
  const [sum, unknown] = await Promise.all([
    prisma.usageRecord.aggregate({
      where: { createdAt: { gte: since }, costUsd: { not: null } },
      _sum: { costUsd: true },
    }),
    prisma.usageRecord.count({
      where: { createdAt: { gte: since }, costUsd: null, status: { in: ["complete", "stopped"] } },
    }),
  ]);
  return { spendUsd: sum._sum.costUsd ?? 0, unknownCostRequests: unknown };
}

/** Blocks new requests once the monthly limit has been reached. Requests with unknown cost are not counted. */
export async function assertWithinBudget(now: Date = new Date()): Promise<void> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { monthlyBudgetUsd: true } });
  const budget = settings?.monthlyBudgetUsd ?? null;
  if (budget === null) return;

  const { spendUsd } = await getMonthSpend(now);
  if (spendUsd >= budget) {
    throw new ApiError(
      402,
      "budget_exceeded",
      `Monthly spending limit reached: $${spendUsd.toFixed(4)} of $${budget.toFixed(2)} used this month. Raise the limit in Settings to continue.`,
    );
  }
}

export interface UsageSummary {
  windowDays: number;
  totals: {
    requests: number;
    failedRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    unknownCostRequests: number;
  };
  byModel: { modelId: string; requests: number; totalTokens: number; costUsd: number }[];
  daily: { date: string; requests: number; totalTokens: number; costUsd: number }[];
  month: { spendUsd: number; budgetUsd: number | null; unknownCostRequests: number };
}

export async function getUsageSummary(now: Date = new Date(), windowDays = 30): Promise<UsageSummary> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (windowDays - 1)));
  const [records, month, settings] = await Promise.all([
    prisma.usageRecord.findMany({
      where: { createdAt: { gte: since } },
      select: {
        createdAt: true,
        modelId: true,
        status: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        costUsd: true,
      },
    }),
    getMonthSpend(now),
    prisma.appSettings.findUnique({ where: { id: 1 }, select: { monthlyBudgetUsd: true } }),
  ]);

  const totals: UsageSummary["totals"] = {
    requests: 0,
    failedRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unknownCostRequests: 0,
  };
  const byModelMap = new Map<string, UsageSummary["byModel"][number]>();
  const dailyMap = new Map<string, UsageSummary["daily"][number]>();

  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = new Date(since.getTime() + offset * 86_400_000);
    dailyMap.set(utcDateKey(date), { date: utcDateKey(date), requests: 0, totalTokens: 0, costUsd: 0 });
  }

  for (const record of records) {
    totals.requests += 1;
    if (record.status === "error") totals.failedRequests += 1;
    totals.promptTokens += record.promptTokens ?? 0;
    totals.completionTokens += record.completionTokens ?? 0;
    totals.totalTokens += record.totalTokens ?? 0;
    totals.costUsd += record.costUsd ?? 0;
    if (record.costUsd === null && record.status !== "error") totals.unknownCostRequests += 1;

    const model = byModelMap.get(record.modelId) ?? { modelId: record.modelId, requests: 0, totalTokens: 0, costUsd: 0 };
    model.requests += 1;
    model.totalTokens += record.totalTokens ?? 0;
    model.costUsd += record.costUsd ?? 0;
    byModelMap.set(record.modelId, model);

    const day = dailyMap.get(utcDateKey(record.createdAt));
    if (day) {
      day.requests += 1;
      day.totalTokens += record.totalTokens ?? 0;
      day.costUsd += record.costUsd ?? 0;
    }
  }

  return {
    windowDays,
    totals,
    byModel: [...byModelMap.values()].sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens),
    daily: [...dailyMap.values()],
    month: {
      spendUsd: month.spendUsd,
      budgetUsd: settings?.monthlyBudgetUsd ?? null,
      unknownCostRequests: month.unknownCostRequests,
    },
  };
}
