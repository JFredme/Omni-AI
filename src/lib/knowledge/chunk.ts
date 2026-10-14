export interface TextChunk {
  content: string;
  heading: string | null;
  page: number | null;
}

interface ChunkOptions {
  /** Aim for chunks about this long (characters). */
  target?: number;
  /** Characters repeated from the end of one chunk at the start of the next, so ideas aren't cut in half. */
  overlap?: number;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

function splitLong(block: string, limit: number): string[] {
  if (block.length <= limit) return [block];
  const sentences = block.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$/g) ?? [block];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      if (current) parts.push(current);
      current = "";
      for (let i = 0; i < sentence.length; i += limit) parts.push(sentence.slice(i, i + limit));
      continue;
    }
    if (current.length + sentence.length > limit && current) {
      parts.push(current);
      current = "";
    }
    current += sentence;
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap > 0 ? text : "";
  const slice = text.slice(-overlap);
  const space = slice.search(/\s/);
  return (space >= 0 ? slice.slice(space + 1) : slice).trim();
}

/** Splits prose or Markdown on paragraph boundaries, remembering the nearest Markdown heading for each chunk. */
export function chunkText(text: string, options: ChunkOptions & { page?: number | null } = {}): TextChunk[] {
  const target = options.target ?? 1000;
  const overlap = options.overlap ?? 120;
  const page = options.page ?? null;
  const limit = Math.round(target * 1.4);

  const chunks: TextChunk[] = [];
  let heading: string | null = null;
  let buffer = "";
  let bufferHeading: string | null = null;
  // False while the buffer holds only overlap carried over from the previous chunk.
  let hasNewText = false;

  const flush = () => {
    const content = buffer.trim();
    if (content) chunks.push({ content, heading: bufferHeading, page });
    buffer = overlap > 0 ? tail(content, overlap) : "";
    bufferHeading = heading;
    hasNewText = false;
  };

  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const firstLine = block.split("\n", 1)[0];
    const match = HEADING.exec(firstLine);
    if (match) {
      heading = match[2];
      // A new section starts a new chunk, so a heading is never separated from what follows it.
      if (buffer.trim() && buffer.length > overlap * 2) flush();
      if (!buffer.trim()) bufferHeading = heading;
    }
    for (const piece of splitLong(block, limit)) {
      if (buffer && buffer.length + piece.length + 2 > target) flush();
      if (!buffer.trim()) bufferHeading = heading;
      buffer += (buffer ? "\n\n" : "") + piece;
      hasNewText = true;
    }
  }
  const last = buffer.trim();
  if (last && hasNewText) chunks.push({ content: last, heading: bufferHeading, page });
  return chunks;
}

/** One chunk list for a paged document, keeping page numbers so citations can point to them. */
export function chunkPages(pages: { page: number; text: string }[], options: ChunkOptions = {}): TextChunk[] {
  return pages.flatMap((entry) => chunkText(entry.text, { ...options, page: entry.page }));
}

/** Groups table rows into chunks, repeating the header so every chunk makes sense on its own. */
export function chunkTable(rows: string[][], options: { name?: string; target?: number } = {}): TextChunk[] {
  const target = options.target ?? 1000;
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const headerLine = header.join(" | ");
  const chunks: TextChunk[] = [];
  let lines: string[] = [];
  let size = headerLine.length;
  const flush = () => {
    if (lines.length) chunks.push({ content: [headerLine, ...lines].join("\n"), heading: options.name ?? null, page: null });
    lines = [];
    size = headerLine.length;
  };
  for (const row of body) {
    const line = row.join(" | ");
    if (size + line.length > target && lines.length) flush();
    // A single enormous row still has to fit somewhere.
    lines.push(line.length > target * 2 ? `${line.slice(0, target * 2)}…` : line);
    size += line.length + 1;
  }
  flush();
  if (chunks.length === 0) chunks.push({ content: headerLine, heading: options.name ?? null, page: null });
  return chunks;
}
