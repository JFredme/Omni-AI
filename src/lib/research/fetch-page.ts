import { assertPublicUrl, BlockedUrlError } from "@/lib/automations/ssrf";
import { extractReadable } from "./html";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  title: string;
  text: string;
}

export class PageError extends Error {}

/** Whether pages on this machine or network may be fetched. Off unless you turn it on for testing. */
const allowPrivate = () => process.env.RESEARCH_ALLOW_PRIVATE_HOSTS === "1";

/**
 * Downloads a web page and returns its readable text. The address is checked first and again at every redirect, so a page
 * a search result points at can't be used to reach your own machine or network. Pages are cut off after 1.5 MB.
 */
export async function fetchPage(rawUrl: string, signal?: AbortSignal): Promise<FetchedPage> {
  let url: URL;
  try {
    url = await assertPublicUrl(rawUrl, { allowPrivate: allowPrivate() });
  } catch (error) {
    throw new PageError(error instanceof BlockedUrlError ? error.message : "That address couldn't be checked.");
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      response = await fetch(url, { redirect: "manual", signal: combined, headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "Mozilla/5.0 (compatible; OmniResearch/1.0)" } });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new PageError(timeout.aborted ? "The page took too long to load." : "The page couldn't be reached.");
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        url = await assertPublicUrl(new URL(location, url).toString(), { allowPrivate: allowPrivate() });
      } catch {
        throw new PageError("The page redirected somewhere that isn't allowed.");
      }
      continue;
    }
    break;
  }
  if (!response) throw new PageError("The page couldn't be reached.");
  if (!response.ok) throw new PageError(`The site answered with HTTP ${response.status}.`);
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new PageError(type.includes("pdf") ? "This is a PDF, which research doesn't read yet." : "This isn't a web page Omni can read.");

  const reader = response.body?.getReader();
  if (!reader) throw new PageError("The page was empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const html = new TextDecoder("utf-8").decode(Buffer.concat(chunks)).slice(0, MAX_BYTES);
  const page = type.includes("text/plain") ? { title: "", text: html.trim().slice(0, 20_000) } : extractReadable(html);
  if (page.text.length < 80) throw new PageError("There wasn't enough readable text on the page.");
  return page;
}
