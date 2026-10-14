import { ApiError } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { MAX_FILE_BYTES, MAX_FILES_PER_PROJECT, pathProblem, type FileDto, type FileSummaryDto, type ProjectDto } from "./paths";

const projectName = (name: string) => name.trim().slice(0, 80);

export async function listProjects(): Promise<ProjectDto[]> {
  const rows = await prisma.codeProject.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { files: true } } }, take: 100 });
  return rows.map((row) => ({ id: row.id, name: row.name, fileCount: row._count.files, updatedAt: row.updatedAt.toISOString() }));
}

export async function createProject(name: string): Promise<ProjectDto> {
  const clean = projectName(name);
  if (!clean) throw new ApiError(400, "invalid_name", "Give the project a name.");
  const row = await prisma.codeProject.create({ data: { name: clean } });
  return { id: row.id, name: row.name, fileCount: 0, updatedAt: row.updatedAt.toISOString() };
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = projectName(name);
  if (!clean) throw new ApiError(400, "invalid_name", "Give the project a name.");
  const result = await prisma.codeProject.updateMany({ where: { id }, data: { name: clean } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That project no longer exists.");
}

export async function deleteProject(id: string): Promise<void> {
  const result = await prisma.codeProject.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That project no longer exists.");
}

export async function listFiles(projectId: string): Promise<FileSummaryDto[]> {
  const project = await prisma.codeProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new ApiError(404, "not_found", "That project no longer exists.");
  const rows = await prisma.codeFile.findMany({ where: { projectId }, orderBy: { path: "asc" }, select: { id: true, path: true, content: true, updatedAt: true } });
  return rows.map((row) => ({ id: row.id, path: row.path, size: Buffer.byteLength(row.content), updatedAt: row.updatedAt.toISOString() }));
}

function assertContent(content: string) {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new ApiError(413, "file_too_large", `Files can be up to ${Math.round(MAX_FILE_BYTES / 1024)} KB.`);
  if (content.includes("\u0000")) throw new ApiError(400, "binary_file", "That looks like a binary file, not text.");
}

function serialize(row: { id: string; path: string; content: string; updatedAt: Date }): FileDto {
  return { id: row.id, path: row.path, content: row.content, updatedAt: row.updatedAt.toISOString() };
}

export async function getFile(id: string): Promise<FileDto & { projectId: string }> {
  const row = await prisma.codeFile.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "That file no longer exists.");
  return { ...serialize(row), projectId: row.projectId };
}

export async function createFile(projectId: string, path: string, content = ""): Promise<FileDto> {
  const problem = pathProblem(path);
  if (problem) throw new ApiError(400, "invalid_path", problem);
  assertContent(content);
  const project = await prisma.codeProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new ApiError(404, "not_found", "That project no longer exists.");
  if ((await prisma.codeFile.count({ where: { projectId } })) >= MAX_FILES_PER_PROJECT) throw new ApiError(400, "too_many_files", `A project can have up to ${MAX_FILES_PER_PROJECT} files.`);
  // A path can't be both a file and a folder: "a" and "a/b" can't both exist.
  const parts = path.split("/");
  const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  const clash = await prisma.codeFile.findFirst({ where: { projectId, OR: [{ path: { in: parents } }, { path: { startsWith: `${path}/` } }] }, select: { path: true } });
  if (clash) throw new ApiError(409, "path_conflict", `"${clash.path}" conflicts with that name: a name can't be both a file and a folder.`);
  try {
    const row = await prisma.codeFile.create({ data: { projectId, path, content } });
    await prisma.codeProject.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return serialize(row);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ApiError(409, "exists", "A file with that name already exists.");
    throw error;
  }
}

export async function saveFile(id: string, content: string): Promise<FileDto> {
  assertContent(content);
  const existing = await prisma.codeFile.findUnique({ where: { id }, select: { projectId: true } });
  if (!existing) throw new ApiError(404, "not_found", "That file no longer exists.");
  const row = await prisma.codeFile.update({ where: { id }, data: { content } });
  await prisma.codeProject.update({ where: { id: existing.projectId }, data: { updatedAt: new Date() } });
  return serialize(row);
}

export async function renameFile(id: string, path: string): Promise<FileDto> {
  const problem = pathProblem(path);
  if (problem) throw new ApiError(400, "invalid_path", problem);
  const existing = await prisma.codeFile.findUnique({ where: { id }, select: { projectId: true } });
  if (!existing) throw new ApiError(404, "not_found", "That file no longer exists.");
  const parts = path.split("/");
  const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  const clash = await prisma.codeFile.findFirst({ where: { projectId: existing.projectId, id: { not: id }, OR: [{ path }, { path: { in: parents } }, { path: { startsWith: `${path}/` } }] }, select: { path: true } });
  if (clash) throw new ApiError(409, "path_conflict", `"${clash.path}" already uses that name or conflicts with it.`);
  return serialize(await prisma.codeFile.update({ where: { id }, data: { path } }));
}

export async function deleteFile(id: string): Promise<void> {
  const result = await prisma.codeFile.deleteMany({ where: { id } });
  if (result.count === 0) throw new ApiError(404, "not_found", "That file no longer exists.");
}

export async function projectFiles(projectId: string): Promise<{ path: string; content: string }[]> {
  const project = await prisma.codeProject.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new ApiError(404, "not_found", "That project no longer exists.");
  return prisma.codeFile.findMany({ where: { projectId }, select: { path: true, content: true } });
}
