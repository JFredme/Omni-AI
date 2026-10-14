import { unstable_rethrow } from "next/navigation";
import { z, type ZodType } from "zod";
import { ApiError, errorResponseBody } from "@/lib/api-error";
import { OpenRouterError, userMessageFor } from "@/lib/openrouter/errors";
import { SearchError } from "@/lib/research/providers";

const statusForOpenRouterKind: Record<string, number> = {
  invalid_key: 401,
  payment_required: 402,
  budget_exceeded: 402,
  rate_limited: 429,
  forbidden: 403,
  bad_request: 400,
  model_unavailable: 404,
  provider_error: 502,
  timeout: 504,
  network: 502,
  unknown: 502,
};

export function errorResponse(error: unknown): Response {
  unstable_rethrow(error);
  if (error instanceof ApiError) {
    return Response.json(errorResponseBody(error.code, error.message), { status: error.status });
  }
  if (error instanceof OpenRouterError) {
    const status = statusForOpenRouterKind[error.kind] ?? 502;
    return Response.json(errorResponseBody(error.kind, userMessageFor(error)), { status });
  }
  if (error instanceof SearchError) {
    const status = error.kind === "rate_limited" ? 429 : error.kind === "key_rejected" ? 400 : 502;
    return Response.json(errorResponseBody(`search_${error.kind}`, error.message), { status });
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".") || "input";
    return Response.json(errorResponseBody("invalid_input", `${path}: ${issue?.message ?? "is invalid"}`), {
      status: 400,
    });
  }
  console.error("API request failed:", error);
  return Response.json(errorResponseBody("internal", "Something went wrong on the server. Check the server logs."), {
    status: 500,
  });
}

/** Parses the request body with the schema. An empty body is treated as `{}`. */
export async function readBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const text = await request.text();
  let raw: unknown = {};
  if (text.trim().length > 0) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
    }
  }
  return schema.parse(raw);
}
