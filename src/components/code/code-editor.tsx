"use client";

import dynamic from "next/dynamic";
import { loader, type BeforeMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

// The editor's files are served by this app (see scripts/copy-monaco.mjs), not from a CDN.
loader.config({ paths: { vs: "/monaco/vs" } });

const Loading = () => <div className="h-full min-h-40 animate-pulse bg-muted" role="status" aria-label="Loading the editor" />;
const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((module) => module.default), { ssr: false, loading: Loading });
const MonacoDiff = dynamic(() => import("@monaco-editor/react").then((module) => module.DiffEditor), { ssr: false, loading: Loading });

const defineThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("omni-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8a857b", fontStyle: "italic" },
      { token: "keyword", foreground: "a8402e" },
      { token: "string", foreground: "2f6b4f" },
      { token: "number", foreground: "9a6a1a" },
    ],
    colors: { "editor.background": "#fbf9f4", "editor.foreground": "#2a2723", "editorLineNumber.foreground": "#b5afa3", "editor.lineHighlightBackground": "#f1ede4", "editorGutter.background": "#fbf9f4" },
  });
  monaco.editor.defineTheme("omni-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8b867b", fontStyle: "italic" },
      { token: "keyword", foreground: "e89a8a" },
      { token: "string", foreground: "8fcfae" },
      { token: "number", foreground: "e2c07a" },
    ],
    colors: { "editor.background": "#1d1b18", "editor.foreground": "#e8e4da", "editorLineNumber.foreground": "#5d584f", "editor.lineHighlightBackground": "#26231f", "editorGutter.background": "#1d1b18" },
  });
};

const OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderLineHighlight: "line" as const,
  padding: { top: 12, bottom: 12 },
};

export function CodeEditor({ path, language, value, onChange, readOnly = false }: { path: string; language: string; value: string; onChange?: (value: string) => void; readOnly?: boolean }) {
  const { resolvedTheme } = useTheme();
  return (
    <MonacoEditor
      path={path}
      language={language}
      value={value}
      theme={resolvedTheme === "dark" ? "omni-dark" : "omni-light"}
      beforeMount={defineThemes}
      onChange={(next) => onChange?.(next ?? "")}
      options={{ ...OPTIONS, readOnly }}
    />
  );
}

export function CodeDiff({ original, modified, language }: { original: string; modified: string; language: string }) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<{ setModel: (model: null) => void } | null>(null);
  // Detach the models before the editor goes away; otherwise Monaco throws "TextModel got disposed before DiffEditorWidget model got reset".
  useEffect(() => () => editorRef.current?.setModel(null), []);
  return (
    <MonacoDiff
      original={original}
      modified={modified}
      language={language}
      theme={resolvedTheme === "dark" ? "omni-dark" : "omni-light"}
      beforeMount={defineThemes}
      onMount={(editor) => {
        editorRef.current = editor;
      }}
      options={{ ...OPTIONS, readOnly: true, renderSideBySide: false }}
    />
  );
}
