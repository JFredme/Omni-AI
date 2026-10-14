import { ApiError } from "@/lib/api-error";

function invalid(): ApiError {
  return new ApiError(
    502,
    "ai_invalid_response",
    "The model's reply wasn't in the expected format. Try again, or pick a different default model.",
  );
}

/**
 * Pulls a JSON object out of a model reply. Models often wrap JSON in a code fence or add a sentence
 * before it, so this tries the whole text, then a fenced block, then the outermost braces.
 */
export function extractJson(text: string): unknown {
  const candidates: string[] = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  throw invalid();
}

export { invalid as invalidAiResponse };
