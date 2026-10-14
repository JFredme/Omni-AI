/** A small, dependency-free way to turn a web page into readable text. Good enough for articles; not a browser. */

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", middot: "·", bull: "•" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

const REMOVE_WHOLE = ["script", "style", "noscript", "svg", "iframe", "canvas", "template", "form", "button", "select", "textarea"];
const CHROME = ["nav", "footer", "header", "aside"];
const BLOCKS = "address|article|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|h[1-6]|hr|li|main|ol|p|pre|section|table|td|th|tr|ul";

function stripTags(html: string, names: string[]): string {
  let out = html;
  for (const name of names) out = out.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}\\s*>`, "gi"), " ");
  return out;
}

function innerOf(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(html);
  return match ? match[1] : null;
}

export interface Readable {
  title: string;
  text: string;
}

/** Pulls the title and main text out of an HTML page. Prefers <article> or <main>; drops menus, scripts, and forms. */
export function extractReadable(html: string, maxChars = 20_000): Readable {
  const title = decodeEntities((innerOf(html, "title") ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300);
  let body = html.replace(/<!--[\s\S]*?-->/g, " ");
  body = stripTags(body, REMOVE_WHOLE);
  const focused = innerOf(body, "article") ?? innerOf(body, "main") ?? innerOf(body, "body") ?? body;
  const cleaned = stripTags(focused, CHROME);
  const withBreaks = cleaned.replace(new RegExp(`<\\/?(?:${BLOCKS})\\b[^>]*>`, "gi"), "\n").replace(/<[^>]+>/g, "");
  const lines = decodeEntities(withBreaks)
    .replace(/[\t\r\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Menus and button labels are short lines; keep a short line only if it ends like a sentence or heading text.
  const kept = lines.filter((line) => line.length >= 40 || /[.!?:]$/.test(line) || (line.length >= 12 && /^[A-Z0-9]/.test(line) && lines.length < 40));
  const text = (kept.length >= 3 ? kept : lines).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text };
}
