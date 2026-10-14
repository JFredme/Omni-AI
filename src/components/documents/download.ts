import type { ExportRequest } from "@/lib/documents/model";

/** Asks the server for the file and hands it to the browser as a download. Returns any warnings about what couldn't be kept. */
export async function downloadExport(request: ExportRequest): Promise<string[]> {
  const response = await fetch("/api/documents/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `The export failed (HTTP ${response.status}).`);
  }
  const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "download";
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  try {
    return JSON.parse(decodeURIComponent(response.headers.get("x-export-warnings") ?? "[]")) as string[];
  } catch {
    return [];
  }
}
