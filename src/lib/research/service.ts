import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import type { ResearchReport } from "@/generated/prisma/client";
import type { Depth, ReportDto, SourceDto } from "./types";

export function toReportDto(row: ResearchReport): ReportDto {
  return {
    id: row.id,
    question: row.question,
    depth: row.depth as Depth,
    status: row.status,
    report: row.report,
    sources: Array.isArray(row.sources) ? (row.sources as unknown as SourceDto[]) : [],
    queries: row.queries,
    modelId: row.modelId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Reports left "running" by a restart can never finish; show them as failed. */
async function settleAbandoned() {
  await prisma.researchReport.updateMany({
    where: { status: "running", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "failed", error: "The server restarted while this was running." },
  });
}

export async function listReports(limit = 50): Promise<ReportDto[]> {
  await settleAbandoned();
  const rows = await prisma.researchReport.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(100, limit) });
  return rows.map(toReportDto);
}

export async function getReport(id: string): Promise<ReportDto> {
  const row = await prisma.researchReport.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "That report no longer exists.");
  return toReportDto(row);
}

export async function deleteReport(id: string): Promise<void> {
  const result = await prisma.researchReport.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That report no longer exists.");
}
