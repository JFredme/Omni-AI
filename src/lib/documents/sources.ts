import { getNote } from "@/lib/notes/service";
import { getProject } from "@/lib/projects/service";
import { getReport } from "@/lib/research/service";
import { listTasks } from "@/lib/tasks/service";
import { STATUS_LABELS as TASK_STATUS_LABELS } from "@/lib/tasks/types";
import { PROJECT_STATUS_LABELS } from "@/lib/projects/types";
import { markdownToBlocks } from "./markdown";
import type { Block, DocumentModel, SheetModel } from "./model";

// Builds exportable documents from things already in Omni: notes, research reports, projects, and the task list.

export async function noteDocument(id: string): Promise<DocumentModel> {
  const note = await getNote(id);
  return { title: note.title || "Untitled note", blocks: markdownToBlocks(note.content).slice(0, 600) };
}

export async function researchDocument(id: string): Promise<DocumentModel> {
  const report = await getReport(id);
  const blocks: Block[] = markdownToBlocks(report.report);
  const sources = report.sources.map((source) => `[${source.title}](${source.url})${source.read ? "" : " (search snippet only)"}`);
  return {
    title: report.question.slice(0, 200),
    blocks: ([...blocks, { type: "heading", level: 2, text: "Sources" }, { type: "numbered", items: sources }] as Block[]).slice(0, 600),
  };
}

export async function projectDocument(id: string): Promise<DocumentModel> {
  const project = await getProject(id);
  const tasks = (await listTasks({ projectId: id, sort: "due" })).slice(0, 200);
  const blocks: Block[] = [
    { type: "paragraph", text: `**Status:** ${PROJECT_STATUS_LABELS[project.status]}${project.dueDate ? ` · **Due:** ${project.dueDate}` : ""} · **Progress:** ${project.stats.progress}% (${project.stats.done} of ${project.stats.total} tasks done${project.stats.overdue ? `, ${project.stats.overdue} overdue` : ""})` },
  ];
  if (project.description.trim()) blocks.push({ type: "heading", level: 2, text: "About" }, ...markdownToBlocks(project.description));
  if (project.milestones.length) {
    blocks.push({ type: "heading", level: 2, text: "Milestones" }, { type: "table", header: ["Milestone", "Due", "Done"], rows: project.milestones.map((m) => [m.title, m.dueDate ?? "", m.completedAt ? "Yes" : "No"]) });
  }
  if (tasks.length) {
    blocks.push({ type: "heading", level: 2, text: "Tasks" }, { type: "table", header: ["Task", "Status", "Priority", "Due"], rows: tasks.map((t) => [t.title, TASK_STATUS_LABELS[t.status], t.priority, t.dueDate ?? ""]) });
  }
  return { title: project.name, blocks: blocks.slice(0, 600) };
}

export async function tasksSheet(): Promise<SheetModel> {
  const tasks = await listTasks({ sort: "due" });
  return {
    title: "Tasks",
    sheets: [
      {
        name: "Tasks",
        header: ["Title", "Status", "Priority", "Due date", "Project", "Milestone", "Tags", "Subtasks", "Description"],
        rows: tasks.slice(0, 5000).map((t) => [t.title, TASK_STATUS_LABELS[t.status], t.priority, t.dueDate ?? "", t.projectName ?? "", t.milestoneTitle ?? "", t.tags.join(", "), t.subtasks.map((s) => s.title).join("; "), t.description.slice(0, 2000)]),
      },
    ],
  };
}
