export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function getOpenRouterBaseUrl(): string {
  const configured = process.env.OPENROUTER_BASE_URL?.trim();
  return (configured || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
}

/** Server-side secret used to encrypt the API key stored in the database. */
export function getEncryptionSecret(): string | null {
  const value = process.env.ENCRYPTION_KEY?.trim();
  return value ? value : null;
}

export function getEnvironmentApiKey(): string | null {
  const value = process.env.OPENROUTER_API_KEY?.trim();
  return value ? value : null;
}
