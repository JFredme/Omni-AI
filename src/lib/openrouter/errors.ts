export type OpenRouterErrorKind =
  | "invalid_key"
  | "payment_required"
  | "rate_limited"
  | "budget_exceeded"
  | "forbidden"
  | "bad_request"
  | "model_unavailable"
  | "provider_error"
  | "timeout"
  | "network"
  | "unknown";

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind;
  readonly status: number | null;
  readonly errorType: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: {
      kind: OpenRouterErrorKind;
      status?: number | null;
      errorType?: string | null;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message);
    this.name = "OpenRouterError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.errorType = options.errorType ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

const KIND_BY_ERROR_TYPE: Record<string, OpenRouterErrorKind> = {
  authentication: "invalid_key",
  payment_required: "payment_required",
  rate_limit_exceeded: "rate_limited",
  permission_denied: "forbidden",
  content_policy_violation: "forbidden",
  refusal: "forbidden",
  context_length_exceeded: "bad_request",
  max_tokens_exceeded: "bad_request",
  token_limit_exceeded: "bad_request",
  string_too_long: "bad_request",
  invalid_request: "bad_request",
  invalid_prompt: "bad_request",
  invalid_image: "bad_request",
  image_too_large: "bad_request",
  image_too_small: "bad_request",
  unsupported_image_format: "bad_request",
  image_download_failed: "bad_request",
  image_not_found: "bad_request",
  not_found: "model_unavailable",
  provider_overloaded: "provider_error",
  provider_unavailable: "provider_error",
  server: "provider_error",
  unmapped: "provider_error",
  timeout: "timeout",
};

export function classifyOpenRouterError(
  status: number | null,
  errorType: string | null,
  limitSource?: string | null,
): OpenRouterErrorKind {
  if (limitSource?.startsWith("openrouter_")) return "budget_exceeded";
  if (errorType && KIND_BY_ERROR_TYPE[errorType]) return KIND_BY_ERROR_TYPE[errorType];

  switch (status) {
    case 400:
    case 413:
    case 422:
      return "bad_request";
    case 401:
      return "invalid_key";
    case 402:
      return "payment_required";
    case 403:
      return "forbidden";
    case 404:
      return "model_unavailable";
    case 408:
      return "timeout";
    case 429:
      return "rate_limited";
    case 502:
    case 503:
    case 529:
      return "provider_error";
    case 504:
      return "timeout";
    default:
      return status !== null && status >= 500 ? "provider_error" : "unknown";
  }
}

export function userMessageFor(error: OpenRouterError): string {
  switch (error.kind) {
    case "invalid_key":
      return "OpenRouter rejected the API key. Check it in Settings.";
    case "payment_required":
      return "Your OpenRouter account has no credits left. Add credits at openrouter.ai and try again.";
    case "rate_limited":
      return "OpenRouter's rate limit was reached. Wait a moment and try again.";
    case "budget_exceeded":
      return "A spending limit on your OpenRouter key or workspace was reached.";
    case "forbidden":
      return `OpenRouter blocked this request. ${error.message}`.trim();
    case "bad_request":
      return `OpenRouter rejected the request: ${error.message}`;
    case "model_unavailable":
      return "This model isn't available right now. Choose another model.";
    case "provider_error":
      return "The model provider failed to respond. Try again, or choose another model.";
    case "timeout":
      return "The request timed out. Try again.";
    case "network":
      return "Could not reach OpenRouter. Check your internet connection.";
    case "unknown":
      return error.message || "Something went wrong while contacting OpenRouter.";
  }
}

export interface ParsedErrorBody {
  message: string;
  errorType: string | null;
  limitSource: string | null;
}

export function parseErrorBody(body: unknown, fallbackMessage: string): ParsedErrorBody {
  const error = (body as { error?: unknown } | null)?.error as
    | { message?: unknown; metadata?: { error_type?: unknown; limit_source?: unknown } }
    | undefined;
  const message = typeof error?.message === "string" && error.message ? error.message : fallbackMessage;
  const errorType = typeof error?.metadata?.error_type === "string" ? error.metadata.error_type : null;
  const limitSource = typeof error?.metadata?.limit_source === "string" ? error.metadata.limit_source : null;
  return { message, errorType, limitSource };
}
