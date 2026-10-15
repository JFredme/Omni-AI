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
    <div className="my-4 overflow-hidden rounded-2xl border border-border bg-muted/50">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/60 px-4 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{language ?? "text"}</span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied code" : "Copy code"} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={ref} className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-muted-foreground/60">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  h1: ({ children }) => <h3 className="font-display mt-6 mb-2 text-2xl font-medium leading-tight first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="font-display mt-6 mb-2 text-xl font-medium leading-tight first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-5 mb-1.5 text-base font-semibold first:mt-0">{children}</h4>,
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
    <blockquote className="my-4 border-l-2 border-primary/40 pl-4 text-muted-foreground italic">{children}</blockquote>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b border-border/60 px-3 py-2">{children}</td>,
  hr: () => <hr className="my-4 border-border" />,
};

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Wraps each word of ordinary text (not code) in a span that fades in when it first appears. Used while a reply is being written. */
function rehypeWordFade() {
  const wrap = (node: HastNode) => {
    if (!node.children) return;
    if (node.type === "element" && (node.tagName === "pre" || node.tagName === "code")) return;
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && child.value) {
        for (const part of child.value.split(/(\s+)/)) {
          if (!part) continue;
          next.push(/^\s+$/.test(part) ? { type: "text", value: part } : { type: "element", tagName: "span", properties: { className: ["w-in"] }, children: [{ type: "text", value: part }] });
        }
      } else {
        wrap(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: HastNode) => wrap(tree);
}

/** `animate` is for a reply that is still being written: words fade in as they arrive. */
export function Markdown({ children, animate = false }: { children: string; animate?: boolean }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }], ...(animate ? [rehypeWordFade] : [])]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
