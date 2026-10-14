"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/** A fenced code block with its language and a copy button. Syntax colors come from `.hljs-*` rules in globals.css. */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);
  const element = Array.isArray(children) ? children[0] : children;
  const className = (element as { props?: { className?: string } } | null)?.props?.className ?? "";
  const language = /language-([\w+-]+)/.exec(className)?.[1];

  async function copy() {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-muted/60">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1 text-xs text-muted-foreground">
        <span className="font-mono">{language ?? "text"}</span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied code" : "Copy code"} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref} className="overflow-x-auto p-3 font-mono text-[13px] leading-6">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-2 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-base font-semibold">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold">{children}</h4>,
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      // A link to another part of the same page, such as a citation pointing at its source.
      <a href={href} className="align-super text-[0.7em] font-medium text-primary no-underline hover:underline">
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
        {children}
      </a>
    ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border px-3 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/60 px-3 py-1.5">{children}</td>,
  hr: () => <hr className="my-4 border-border" />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
