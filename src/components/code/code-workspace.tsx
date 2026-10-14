"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FilePlus2, FileText, FolderGit2, Loader2, Pencil, Play, Plus, Trash2, Wand2 } from "lucide-react";
import { CodeDiff, CodeEditor } from "@/components/code/code-editor";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner } from "@/components/ui/states";
import { apiRequest, ClientApiError } from "@/lib/client/api";
import { useAutosave, type SaveStatus } from "@/lib/client/use-autosave";
import { buildTree, languageFor, pathProblem, type FileDto, type FileSummaryDto, type ProjectDto, type TreeNode } from "@/lib/code/paths";
import type { AssistMode, AssistResult } from "@/lib/code/assist";
import type { RunResult } from "@/lib/code/sandbox";
import { cn } from "@/lib/utils";

const message = (error: unknown, fallback: string) => (error instanceof ClientApiError ? error.message : fallback);
const STATUS_LABEL: Record<SaveStatus, string> = { idle: "", dirty: "Unsaved changes…", saving: "Saving…", saved: "Saved", error: "Couldn't save" };
const MODE_LABELS: Record<AssistMode, string> = { explain: "Explain this file", review: "Review for problems", edit: "Make a change", tests: "Write tests" };

interface Sandbox {
  available: boolean;
  reason: string | null;
  timeoutSeconds: number;
  memory: string;
}

export function CodeWorkspace() {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSummaryDto[]>([]);
  const [fileId, setFileId] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "project" } | { kind: "rename-project" } | { kind: "delete-project" } | { kind: "file" } | { kind: "rename-file"; file: FileSummaryDto } | { kind: "delete-file"; file: FileSummaryDto }>(null);
  const [text, setText] = useState("");

  const project = projects?.find((entry) => entry.id === projectId) ?? null;

  const loadProjects = useCallback(async (select?: string) => {
    try {
      const { projects: list } = await apiRequest<{ projects: ProjectDto[] }>("/api/code/projects");
      setProjects(list);
      setProjectId((current) => select ?? (current && list.some((p) => p.id === current) ? current : (list[0]?.id ?? null)));
    } catch (caught) {
      setError(message(caught, "Couldn't load your projects."));
    }
  }, []);

  const loadFiles = useCallback(async (id: string) => {
    try {
      const { files: list } = await apiRequest<{ files: FileSummaryDto[] }>(`/api/code/projects/${id}/files`);
      setFiles(list);
      setFileId((current) => (current && list.some((f) => f.id === current) ? current : (list[0]?.id ?? null)));
    } catch (caught) {
      setError(message(caught, "Couldn't load that project's files."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetches on mount
    void loadProjects();
    apiRequest<Sandbox>("/api/code/status").then(setSandbox).catch(() => undefined);
  }, [loadProjects]);

  useEffect(() => {
    if (projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reload files when the project changes
      void loadFiles(projectId);
    } else {
      setFiles([]);
      setFileId(null);
    }
  }, [projectId, loadFiles]);

  async function submitDialog() {
    if (!dialog) return;
    setError(null);
    try {
      if (dialog.kind === "project") {
        const { project: created } = await apiRequest<{ project: ProjectDto }>("/api/code/projects", { json: { name: text } });
        await loadProjects(created.id);
      } else if (dialog.kind === "rename-project" && projectId) {
        await apiRequest(`/api/code/projects/${projectId}`, { method: "PATCH", json: { name: text } });
        await loadProjects();
      } else if (dialog.kind === "delete-project" && projectId) {
        await apiRequest(`/api/code/projects/${projectId}`, { method: "DELETE" });
        setProjectId(null);
        await loadProjects();
      } else if (dialog.kind === "file" && projectId) {
        const { file } = await apiRequest<{ file: FileDto }>(`/api/code/projects/${projectId}/files`, { json: { path: text } });
        await loadFiles(projectId);
        await loadProjects();
        setFileId(file.id);
      } else if (dialog.kind === "rename-file" && projectId) {
        await apiRequest(`/api/code/files/${dialog.file.id}`, { method: "PATCH", json: { path: text } });
        await loadFiles(projectId);
      } else if (dialog.kind === "delete-file" && projectId) {
        await apiRequest(`/api/code/files/${dialog.file.id}`, { method: "DELETE" });
        await loadFiles(projectId);
        await loadProjects();
      }
      setDialog(null);
    } catch (caught) {
      setError(message(caught, "That didn't work."));
    }
  }

  function open(kind: NonNullable<typeof dialog>["kind"], initial = "", file?: FileSummaryDto) {
    setText(initial);
    setError(null);
    setDialog((file ? { kind, file } : { kind }) as typeof dialog);
  }

  const dialogProblem = dialog && (dialog.kind === "file" || dialog.kind === "rename-file") && text ? pathProblem(text) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Code"
        title="Workspace"
        description="Write and edit code with an AI assistant that proposes changes you review. Programs run only when you press Run, and only inside a locked-down Docker container."
        actions={
          <Button variant="primary" onClick={() => open("project")}>
            <Plus className="size-4" aria-hidden /> New project
          </Button>
        }
      />
      {error && !dialog ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {projects && projects.length === 0 ? (
        <EmptyState icon={FolderGit2} title="No projects yet" description="A project is a folder of files. Create one to start writing code." action={<Button variant="primary" onClick={() => open("project")}>Create a project</Button>} />
      ) : null}

      {project ? (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside aria-label="Files" className="space-y-3">
            <div className="flex items-center gap-1">
              <Select aria-label="Project" value={project.id} onChange={(e) => { setProjectId(e.target.value); setFileId(null); }} className="min-w-0 flex-1">
                {projects?.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
              <Button size="icon" variant="ghost" aria-label="Rename project" onClick={() => open("rename-project", project.name)}>
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Delete project" onClick={() => open("delete-project")}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => open("file", "")}>
              <FilePlus2 className="size-4" aria-hidden /> New file
            </Button>
            {files.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">No files yet. Create one, like <code className="font-mono text-xs">main.py</code> or <code className="font-mono text-xs">src/app.js</code>.</p>
            ) : (
              <FileTree nodes={buildTree(files)} selected={fileId} onSelect={setFileId} onRename={(file) => open("rename-file", file.path, file)} onDelete={(file) => open("delete-file", "", file)} />
            )}
          </aside>

          <section aria-label="Editor" className="min-w-0">
            {fileId ? (
              <FileEditor key={fileId} fileId={fileId} projectId={project.id} sandbox={sandbox} files={files} onFilesChanged={async () => { await loadFiles(project.id); await loadProjects(); }} onSelect={setFileId} />
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">Select or create a file to start.</div>
            )}
          </section>
        </div>
      ) : null}

      {dialog ? (
        <Dialog
          title={dialog.kind === "project" ? "New project" : dialog.kind === "rename-project" ? "Rename project" : dialog.kind === "delete-project" ? "Delete this project?" : dialog.kind === "file" ? "New file" : dialog.kind === "rename-file" ? "Rename file" : "Delete this file?"}
          description={dialog.kind === "delete-project" ? `"${project?.name}" and all ${project?.fileCount ?? 0} of its files will be removed. This can't be undone.` : dialog.kind === "delete-file" ? `"${dialog.file.path}" will be removed. This can't be undone.` : undefined}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button variant="primary" className={dialog.kind.startsWith("delete") ? "bg-danger hover:bg-danger/90" : undefined} disabled={!dialog.kind.startsWith("delete") && (!text.trim() || Boolean(dialogProblem))} onClick={() => void submitDialog()}>
                {dialog.kind.startsWith("delete") ? "Delete" : dialog.kind.startsWith("rename") ? "Rename" : "Create"}
              </Button>
            </>
          }
        >
          {dialog.kind.startsWith("delete") ? null : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim() && !dialogProblem) void submitDialog();
              }}
            >
              <Field label={dialog.kind.endsWith("project") || dialog.kind === "project" ? "Name" : "Path"} htmlFor="code-dialog-name" hint={dialog.kind === "file" || dialog.kind === "rename-file" ? "For example main.py or src/app.js. Letters, numbers, dots, dashes, and underscores." : undefined}>
                <Input id="code-dialog-name" data-autofocus value={text} onChange={(e) => setText(e.target.value)} maxLength={dialog.kind.includes("file") ? 160 : 80} />
              </Field>
              {dialogProblem ? <p role="alert" className="mt-1 text-xs text-danger">{dialogProblem}</p> : null}
            </form>
          )}
          {error ? <ErrorBanner message={error} className="mt-3" /> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function FileTree({ nodes, selected, onSelect, onRename, onDelete, depth = 0 }: { nodes: TreeNode[]; selected: string | null; onSelect: (id: string) => void; onRename: (file: FileSummaryDto) => void; onDelete: (file: FileSummaryDto) => void; depth?: number }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  return (
    <ul role={depth === 0 ? "tree" : "group"} className="space-y-0.5">
      {nodes.map((node) =>
        node.file ? (
          <li key={node.path} role="treeitem" aria-selected={selected === node.file.id} className="group">
            <div className={cn("flex items-center rounded-md pr-1 text-sm", selected === node.file.id ? "bg-accent font-medium" : "hover:bg-accent/60")} style={{ paddingLeft: depth * 12 + 4 }}>
              <button type="button" onClick={() => onSelect(node.file!.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{node.name}</span>
              </button>
              <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" aria-label={`Rename ${node.file.path}`} onClick={() => onRename(node.file!)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3" aria-hidden />
                </button>
                <button type="button" aria-label={`Delete ${node.file.path}`} onClick={() => onDelete(node.file!)} className="rounded p-1 text-muted-foreground hover:text-danger">
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </span>
            </div>
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-expanded={!closed.has(node.path)} aria-selected={false}>
            <button
              type="button"
              onClick={() => setClosed((prev) => { const next = new Set(prev); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next; })}
              className="flex w-full items-center gap-1 rounded-md py-1 text-left text-sm text-muted-foreground hover:bg-accent/60"
              style={{ paddingLeft: depth * 12 + 2 }}
            >
              {closed.has(node.path) ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
              <span className="truncate">{node.name}</span>
            </button>
            {closed.has(node.path) ? null : <FileTree nodes={node.children} selected={selected} onSelect={onSelect} onRename={onRename} onDelete={onDelete} depth={depth + 1} />}
          </li>
        ),
      )}
    </ul>
  );
}

function FileEditor({ fileId, projectId, sandbox, files, onFilesChanged, onSelect }: { fileId: string; projectId: string; sandbox: Sandbox | null; files: FileSummaryDto[]; onFilesChanged: () => Promise<void>; onSelect: (id: string) => void }) {
  const [file, setFile] = useState<FileDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ file: FileDto }>(`/api/code/files/${fileId}`)
      .then((data) => !cancelled && setFile(data.file))
      .catch((caught) => !cancelled && setLoadError(message(caught, "Couldn't open that file.")));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!file) return <div className="h-96 animate-pulse rounded-lg bg-muted" role="status" aria-label="Loading the file" />;
  return <Loaded file={file} projectId={projectId} sandbox={sandbox} files={files} onFilesChanged={onFilesChanged} onSelect={onSelect} />;
}

function Loaded({ file, projectId, sandbox, files, onFilesChanged, onSelect }: { file: FileDto; projectId: string; sandbox: Sandbox | null; files: FileSummaryDto[]; onFilesChanged: () => Promise<void>; onSelect: (id: string) => void }) {
  const [content, setContent] = useState(file.content);
  const [panel, setPanel] = useState<"output" | "assistant">("output");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const language = useMemo(() => languageFor(file.path), [file.path]);

  const { status, error, flush } = useAutosave<string>({
    value: content,
    initial: file.content,
    save: async (value) => {
      await apiRequest(`/api/code/files/${file.id}`, { method: "PUT", json: { content: value } });
    },
  });

  async function run() {
    setRunning(true);
    setRunError(null);
    setResult(null);
    setPanel("output");
    try {
      if (!(await flush())) throw new Error("Save your changes first: they couldn't be saved.");
      const data = await apiRequest<{ result: RunResult }>(`/api/code/projects/${projectId}/run`, { json: { entry: file.path } });
      setResult(data.result);
    } catch (caught) {
      setRunError(message(caught, caught instanceof Error ? caught.message : "The run failed."));
    } finally {
      setRunning(false);
    }
  }

  const canRun = language.run !== null && sandbox?.available === true;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{file.path}</h2>
        <span className="eyebrow">{language.label}</span>
        <span role="status" className={cn("num text-xs", status === "error" ? "text-danger" : "text-muted-foreground")}>
          {STATUS_LABEL[status]}
        </span>
        <Button size="sm" variant="outline" onClick={() => setPanel(panel === "assistant" ? "output" : "assistant")} aria-pressed={panel === "assistant"}>
          <Wand2 className="size-3.5" aria-hidden /> Assistant
        </Button>
        <Button size="sm" variant="primary" disabled={!canRun || running} onClick={() => void run()} title={language.run === null ? "Only .js, .mjs, .cjs and .py files can be run" : (sandbox?.reason ?? undefined)}>
          {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />} Run
        </Button>
      </div>
      {error ? <ErrorBanner message={error} onRetry={() => void flush()} /> : null}

      <div className="h-[24rem] overflow-hidden rounded-lg border border-border" data-testid="editor">
        <CodeEditor path={`omni:///${file.id}/${file.path}`} language={language.monaco} value={content} onChange={setContent} />
      </div>

      {sandbox && !sandbox.available ? (
        <p role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <strong className="font-medium">Run is switched off.</strong> {sandbox.reason} Omni never runs code directly on this computer.
        </p>
      ) : language.run === null ? (
        <p className="text-xs text-muted-foreground">Only JavaScript (.js, .mjs, .cjs) and Python (.py) files can be run.</p>
      ) : sandbox ? (
        <p className="text-xs text-muted-foreground">
          Run starts a Docker container with no network, a read-only file system, {sandbox.memory} of memory, and a {sandbox.timeoutSeconds}-second limit. Your project&apos;s files are copied in; nothing else is reachable.
        </p>
      ) : null}

      <div role="tablist" aria-label="Output and assistant" className="flex gap-5 border-b border-border">
        {(["output", "assistant"] as const).map((id) => (
          <button key={id} role="tab" type="button" aria-selected={panel === id} onClick={() => setPanel(id)} className={cn("-mb-px border-b-2 pb-2 text-sm font-medium", panel === id ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {id === "output" ? "Output" : "Assistant"}
          </button>
        ))}
      </div>

      {panel === "output" ? (
        <OutputPanel running={running} result={result} error={runError} />
      ) : (
        <AssistantPanel
          file={file}
          content={content}
          files={files}
          projectId={projectId}
          onApply={(next) => {
            setContent(next);
            setPanel("output");
          }}
          onCreated={async (id) => {
            await onFilesChanged();
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function OutputPanel({ running, result, error }: { running: boolean; result: RunResult | null; error: string | null }) {
  if (running) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Running in the sandbox…</p>;
  if (error) return <ErrorBanner message={error} />;
  if (!result) return <p className="text-sm text-muted-foreground">Run output appears here.</p>;
  return (
    <div className="space-y-2 text-sm" aria-label="Run output">
      <p className="num text-xs text-muted-foreground">
        {result.timedOut ? "Stopped: it ran longer than the time limit." : `Finished with exit code ${result.exitCode}`} · {(result.durationMs / 1000).toFixed(1)}s{result.truncated ? " · output was cut off" : ""}
      </p>
      {result.stdout ? <pre aria-label="Standard output" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs">{result.stdout}</pre> : null}
      {result.stderr ? <pre aria-label="Error output" className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-danger/30 bg-danger/5 p-3 font-mono text-xs text-danger">{result.stderr}</pre> : null}
      {!result.stdout && !result.stderr ? <p className="text-muted-foreground">The program printed nothing.</p> : null}
    </div>
  );
}

function AssistantPanel({ file, content, files, projectId, onApply, onCreated }: { file: FileDto; content: string; files: FileSummaryDto[]; projectId: string; onApply: (content: string) => void; onCreated: (fileId: string) => Promise<void> }) {
  const [mode, setMode] = useState<AssistMode>("explain");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(AssistResult & { forMode: AssistMode }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testPath, setTestPath] = useState(() => (file.path.includes(".") ? file.path.replace(/(\.[^.]+)$/, ".test$1") : `${file.path}.test`));
  const language = languageFor(file.path);
  const unsaved = content !== file.content;

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiRequest<{ result: AssistResult }>("/api/code/assist", { json: { fileId: file.id, mode, instruction } });
      setResult({ ...data.result, forMode: mode });
    } catch (caught) {
      setError(message(caught, "The assistant couldn't answer."));
    } finally {
      setBusy(false);
    }
  }

  async function createTests() {
    if (!result?.proposed) return;
    setError(null);
    try {
      const data = await apiRequest<{ file: FileDto }>(`/api/code/projects/${projectId}/files`, { json: { path: testPath, content: result.proposed } });
      await onCreated(data.file.id);
    } catch (caught) {
      setError(message(caught, "Couldn't create the test file."));
    }
  }

  const testProblem = pathProblem(testPath) ?? (files.some((f) => f.path === testPath) ? "A file with that name already exists." : null);

  return (
    <div className="space-y-4">
      <form onSubmit={ask} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <Field label="What should it do?" htmlFor="assist-mode">
            <Select id="assist-mode" value={mode} onChange={(e) => setMode(e.target.value as AssistMode)}>
              {(Object.keys(MODE_LABELS) as AssistMode[]).map((id) => (
                <option key={id} value={id}>
                  {MODE_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>
          {mode === "edit" || mode === "tests" ? (
            <Field label={mode === "edit" ? "Describe the change" : "Anything to focus on? (optional)"} htmlFor="assist-instruction">
              <Textarea id="assist-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={2} maxLength={2000} placeholder={mode === "edit" ? "For example: handle an empty list, and add type hints" : "For example: cover the error cases"} />
            </Field>
          ) : null}
        </div>
        {unsaved ? <p className="text-xs text-warning">The assistant sees the last saved version of this file, so wait for “Saved” first.</p> : null}
        <Button type="submit" variant="primary" disabled={busy || (mode === "edit" && instruction.trim().length < 3)}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />} Ask
        </Button>
        <p className="text-xs text-muted-foreground">Your file is sent to your default model. Nothing it suggests changes your files until you apply it.</p>
      </form>

      {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null}

      {result ? (
        <div className="space-y-3" aria-label="Assistant reply">
          <p className="whitespace-pre-wrap text-sm leading-6">{result.explanation}</p>
          {result.proposed !== null && result.forMode === "edit" ? (
            <>
              <p className="eyebrow">Proposed change</p>
              <div className="h-80 overflow-hidden rounded-lg border border-border">
                <CodeDiff original={result.original} modified={result.proposed} language={language.monaco} />
              </div>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => { onApply(result.proposed!); setResult(null); }}>
                  Apply to this file
                </Button>
                <Button variant="outline" onClick={() => setResult(null)}>
                  Discard
                </Button>
              </div>
            </>
          ) : null}
          {result.proposed !== null && result.forMode === "tests" ? (
            <>
              <p className="eyebrow">Proposed test file</p>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-xs">{result.proposed}</pre>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Save as" htmlFor="assist-test-path" className="w-64">
                  <Input id="assist-test-path" value={testPath} onChange={(e) => setTestPath(e.target.value)} />
                </Field>
                <Button variant="primary" disabled={Boolean(testProblem)} onClick={() => void createTests()}>
                  Create this file
                </Button>
              </div>
              {testProblem ? <p role="alert" className="text-xs text-danger">{testProblem}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
