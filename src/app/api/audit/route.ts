import { errorResponse } from "@/lib/api-route";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return Response.json({ entries: rows.map((row) => ({ id: row.id, action: row.action, detail: row.detail, createdAt: row.createdAt.toISOString() })) });
  } catch (error) {
    return errorResponse(error);
  }
}
