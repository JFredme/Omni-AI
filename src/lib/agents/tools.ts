import { z, type ZodType } from "zod";
import { dateKeySchema, localDateKey } from "@/lib/dates";
import { MAX_NOTE_CONTENT } from "@/lib/notes/schemas";
import { tagsSchema } from "@/lib/tags";
import { DUE_FILTERS, TASK_PRIORITIES, TASK_STATUSES, type TaskDto } from "@/lib/tasks/types";

// The services create the database client when they load. They are imported only when a tool runs, so this
// file (the tool list and argument schemas) can be used and tested without a database.
const tasks = () => import("@/lib/tasks/service");
const notes = () => import("@/lib/notes/service");
const projects = () => import("@/lib/projects/service");

export interface ToolContext {
  runId: string;
  depth: number;
  signal?: AbortSignal;
  /** Runs another agent on a sub-objective. Provided by the engine. */
  delegate?: (agentName: string, objective: string) => Promise<string>;
}

export interface ToolDef {
  name: string;
  description: string;
  /** "write" tools change the user's data or spend money; built-in agents ask before running them. */
  risk: "read" | "write";
  /** A one-line description of the arguments, shown to the model. */
  usage: string;
  args: ZodType<unknown>;
  run: (args: never, context: ToolContext) => Promise<unknown>;
}

function tool<A>(
  def: Omit<ToolDef, "args" | "run"> & { args: ZodType<A>; run: (args: A, context: ToolContext) => Promise<unknown> },
): ToolDef {
  return def as unknown as ToolDef;
}

const id = z.string().trim().min(1).max(60);
const priority = z.enum(TASK_PRIORITIES);

const compactTask = (task: TaskDto) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  project: task.projectName,
  tags: task.tags,
  subtasks: task.subtasks.length,
});

export const TOOLS: ToolDef[] = [
  tool({
    name: "current_date",
    description: "Today's date.",
    risk: "read",
    usage: "{}",
    args: z.object({}),
    run: async () => ({ today: localDateKey() }),
  }),
  tool({
    name: "list_tasks",
    description: "List tasks, optionally filtered. Returns at most 40.",
    risk: "read",
    usage:
      '{ "q"?: text, "status"?: "todo"|"in_progress"|"done", "priority"?: "low"|"medium"|"high"|"urgent", "projectId"?: id|"none", "due"?: "overdue"|"today"|"week"|"none" }',
    args: z.object({
      q: z.string().max(200).optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: priority.optional(),
      projectId: id.optional(),
      due: z.enum(DUE_FILTERS).optional(),
    }),
    run: async (args) => (await (await tasks()).listTasks(args)).slice(0, 40).map(compactTask),
  }),
  tool({
    name: "create_task",
    description: "Create a task.",
    risk: "write",
    usage:
      '{ "title": text, "description"?: text, "priority"?: "low"|"medium"|"high"|"urgent", "dueDate"?: "YYYY-MM-DD", "tags"?: [text], "projectId"?: id }',
    args: z.object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(10_000).optional(),
      priority: priority.optional(),
      dueDate: dateKeySchema.optional(),
      tags: tagsSchema.optional(),
      projectId: id.optional(),
    }),
    run: async (args) => compactTask(await (await tasks()).createTask(args)),
  }),
  tool({
    name: "update_task",
    description: "Change a task: its title, description, status, priority, due date (null clears it), or tags.",
    risk: "write",
    usage:
      '{ "taskId": id, "title"?: text, "description"?: text, "status"?: "todo"|"in_progress"|"done", "priority"?: "low"|"medium"|"high"|"urgent", "dueDate"?: "YYYY-MM-DD"|null, "tags"?: [text] }',
    args: z.object({
      taskId: id,
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(10_000).optional(),
      status: z.enum(TASK_STATUSES).optional(),
      priority: priority.optional(),
      dueDate: dateKeySchema.nullable().optional(),
      tags: tagsSchema.optional(),
    }),
    run: async ({ taskId, ...patch }) => compactTask(await (await tasks()).updateTask(taskId, patch)),
  }),
  tool({
    name: "list_projects",
    description: "List active projects with their progress.",
    risk: "read",
    usage: "{}",
    args: z.object({}),
    run: async () =>
      (await (await projects()).listProjects()).map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        dueDate: project.dueDate,
        progress: project.stats.progress,
        tasks: project.stats.total,
        overdue: project.stats.overdue,
      })),
  }),
  tool({
    name: "get_project",
    description: "A project's description, milestones, and progress.",
    risk: "read",
    usage: '{ "projectId": id }',
    args: z.object({ projectId: id }),
    run: async ({ projectId }) => {
      const project = await (await projects()).getProject(projectId);
      return {
        id: project.id,
        name: project.name,
        description: project.description.slice(0, 2_000),
        status: project.status,
        dueDate: project.dueDate,
        stats: project.stats,
        milestones: project.milestones.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate, done: Boolean(m.completedAt) })),
      };
    },
  }),
  tool({
    name: "create_project",
    description: "Create a project.",
    risk: "write",
    usage: '{ "name": text, "description"?: text, "dueDate"?: "YYYY-MM-DD" }',
    args: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(10_000).optional(),
      dueDate: dateKeySchema.optional(),
    }),
    run: async (args) => {
      const project = await (await projects()).createProject(args);
      return { id: project.id, name: project.name };
    },
  }),
  tool({
    name: "add_milestone",
    description: "Add a milestone to a project.",
    risk: "write",
    usage: '{ "projectId": id, "title": text, "dueDate"?: "YYYY-MM-DD" }',
    args: z.object({ projectId: id, title: z.string().trim().min(1).max(160), dueDate: dateKeySchema.optional() }),
    run: async ({ projectId, ...input }) => {
      const milestone = await (await projects()).createMilestone(projectId, input);
      return { id: milestone.id, title: milestone.title };
    },
  }),
  tool({
    name: "search_notes",
    description: "Search notes by text or tag. Returns titles and short excerpts (at most 20).",
    risk: "read",
    usage: '{ "q"?: text, "tag"?: text }',
    args: z.object({ q: z.string().max(200).optional(), tag: z.string().max(60).optional() }),
    run: async (args) =>
      (await (await notes()).listNotes(args)).slice(0, 20).map((note) => ({ id: note.id, title: note.title || "Untitled", excerpt: note.excerpt, tags: note.tags })),
  }),
  tool({
    name: "read_note",
    description: "Read a note's full text (long notes are cut off at 6000 characters).",
    risk: "read",
    usage: '{ "noteId": id }',
    args: z.object({ noteId: id }),
    run: async ({ noteId }) => {
      const note = await (await notes()).getNote(noteId);
      return { id: note.id, title: note.title, tags: note.tags, content: note.content.slice(0, 6_000), truncated: note.content.length > 6_000 };
    },
  }),
  tool({
    name: "create_note",
    description: "Create a note (Markdown).",
    risk: "write",
    usage: '{ "title": text, "content": markdown, "tags"?: [text] }',
    args: z.object({ title: z.string().trim().max(200), content: z.string().max(MAX_NOTE_CONTENT), tags: tagsSchema.optional() }),
    run: async (args) => {
      const note = await (await notes()).createNote(args);
      return { id: note.id, title: note.title };
    },
  }),
  tool({
    name: "append_to_note",
    description: "Add text to the end of an existing note.",
    risk: "write",
    usage: '{ "noteId": id, "text": markdown }',
    args: z.object({ noteId: id, text: z.string().min(1).max(50_000) }),
    run: async ({ noteId, text }) => {
      const service = await notes();
      const note = await service.getNote(noteId);
      const content = `${note.content}${note.content.endsWith("\n") || !note.content ? "" : "\n"}\n${text}`;
      if (content.length > MAX_NOTE_CONTENT) throw new Error("The note would become too long.");
      await service.updateNote(noteId, { content });
      return { id: noteId, appended: text.length };
    },
  }),
  tool({
    name: "delegate",
    description: "Hand a self-contained sub-task to another agent and get its answer back. Use sparingly.",
    risk: "read",
    usage: '{ "agent": the other agent\'s exact name, "objective": text }',
    args: z.object({ agent: z.string().trim().min(1).max(100), objective: z.string().trim().min(1).max(4_000) }),
    run: async ({ agent, objective }, context) => {
      if (!context.delegate) throw new Error("Delegation is not available here.");
      return { answer: await context.delegate(agent, objective) };
    },
  }),
];

const byName = new Map(TOOLS.map((definition) => [definition.name, definition]));

export function getTool(name: string): ToolDef | undefined {
  return byName.get(name);
}

export function toolCatalog() {
  return TOOLS.map(({ name, description, risk, usage }) => ({ name, description, risk, usage }));
}
