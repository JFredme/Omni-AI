// Client-safe helpers for file paths and languages in the code workspace.

export const MAX_FILES_PER_PROJECT = 200;
export const MAX_FILE_BYTES = 500 * 1024;
export const MAX_PATH_DEPTH = 6;
export const MAX_PATH_LENGTH = 160;

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Returns a message when the path can't be used, otherwise null. Paths are relative, plain, and can't climb out of the project. */
export function pathProblem(path: string): string | null {
  if (!path) return "Give the file a name.";
  if (path.length > MAX_PATH_LENGTH) return `Paths can be up to ${MAX_PATH_LENGTH} characters.`;
  if (path.startsWith("/") || path.endsWith("/")) return "Use a relative path like src/main.py.";
  const segments = path.split("/");
  if (segments.length > MAX_PATH_DEPTH) return `Folders can be nested up to ${MAX_PATH_DEPTH} levels deep.`;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return "A path can't contain empty parts, '.' or '..'.";
    if (!SEGMENT.test(segment)) return "Use only letters, numbers, dots, dashes, and underscores in names.";
    if (segment.startsWith(".") && segments.length === 1 && segment.length === 1) return "Give the file a real name.";
  }
  return null;
}

export const LANGUAGES: Record<string, { monaco: string; label: string; run: "node" | "python" | null }> = {
  js: { monaco: "javascript", label: "JavaScript", run: "node" },
  mjs: { monaco: "javascript", label: "JavaScript", run: "node" },
  cjs: { monaco: "javascript", label: "JavaScript", run: "node" },
  jsx: { monaco: "javascript", label: "JavaScript (JSX)", run: null },
  ts: { monaco: "typescript", label: "TypeScript", run: null },
  tsx: { monaco: "typescript", label: "TypeScript (TSX)", run: null },
  py: { monaco: "python", label: "Python", run: "python" },
  json: { monaco: "json", label: "JSON", run: null },
  md: { monaco: "markdown", label: "Markdown", run: null },
  html: { monaco: "html", label: "HTML", run: null },
  css: { monaco: "css", label: "CSS", run: null },
  sql: { monaco: "sql", label: "SQL", run: null },
  sh: { monaco: "shell", label: "Shell", run: null },
  yml: { monaco: "yaml", label: "YAML", run: null },
  yaml: { monaco: "yaml", label: "YAML", run: null },
  go: { monaco: "go", label: "Go", run: null },
  rs: { monaco: "rust", label: "Rust", run: null },
  java: { monaco: "java", label: "Java", run: null },
  c: { monaco: "c", label: "C", run: null },
  cpp: { monaco: "cpp", label: "C++", run: null },
  txt: { monaco: "plaintext", label: "Text", run: null },
};

export function extensionOf(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "";
}

export function languageFor(path: string) {
  return LANGUAGES[extensionOf(path)] ?? { monaco: "plaintext", label: "Text", run: null as null };
}

export interface FileDto {
  id: string;
  path: string;
  content: string;
  updatedAt: string;
}

export interface FileSummaryDto {
  id: string;
  path: string;
  size: number;
  updatedAt: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  fileCount: number;
  updatedAt: string;
}

export interface TreeNode {
  name: string;
  path: string;
  /** Present for files. */
  file?: FileSummaryDto;
  children: TreeNode[];
}

/** Arranges flat paths into folders, folders first and everything sorted by name. */
export function buildTree(files: FileSummaryDto[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    let node = root;
    const segments = file.path.split("/");
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = node.children.find((candidate) => candidate.name === segment && Boolean(candidate.file) === (index === segments.length - 1));
      if (!child) {
        child = { name: segment, path, children: [], ...(index === segments.length - 1 ? { file } : {}) };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}
