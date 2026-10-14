import { ApiError } from "@/lib/api-error";
import { decryptSecret, encryptSecret, lastFourCharacters, MIN_SECRET_LENGTH } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getEncryptionSecret } from "@/lib/env";
import { PROVIDER_INFO, type SearchProvider, type SearchSettingsDto } from "./types";
import type { SearchConfig } from "./providers";

const ID = 1;

export async function getSearchSettings(): Promise<SearchSettingsDto> {
  const row = await prisma.appSettings.findUnique({ where: { id: ID } });
  const provider = (row?.searchProvider as SearchProvider | null) ?? null;
  const keyConfigured = Boolean(row?.encryptedSearchKey);
  const info = provider ? PROVIDER_INFO[provider] : null;
  return {
    provider,
    keyConfigured,
    keyLast4: keyConfigured ? row?.searchKeyLast4 ?? null : null,
    baseUrl: row?.searchBaseUrl ?? null,
    ready: Boolean(provider && info && (!info.needsKey || keyConfigured) && (!info.needsUrl || row?.searchBaseUrl)),
  };
}

export async function saveSearchSettings(input: { provider: SearchProvider | null; apiKey?: string; baseUrl?: string | null }): Promise<SearchSettingsDto> {
  const data: Record<string, unknown> = { searchProvider: input.provider };
  if (input.apiKey !== undefined) {
    const secret = getEncryptionSecret();
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      throw new ApiError(500, "encryption_not_configured", `Set ENCRYPTION_KEY (at least ${MIN_SECRET_LENGTH} characters) in .env before saving a key.`);
    }
    const key = input.apiKey.trim();
    data.encryptedSearchKey = key ? encryptSecret(key, secret) : null;
    data.searchKeyLast4 = key ? lastFourCharacters(key) : null;
  }
  if (input.baseUrl !== undefined) {
    const base = input.baseUrl?.trim() ?? "";
    if (base && !/^https?:\/\/[^\s]+$/i.test(base)) throw new ApiError(400, "invalid_url", "The address must start with http:// or https://.");
    data.searchBaseUrl = base || null;
  }
  await prisma.appSettings.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
  return getSearchSettings();
}

/** The credentials to search with. Throws a plain message when search isn't set up. */
export async function resolveSearchConfig(): Promise<SearchConfig> {
  const row = await prisma.appSettings.findUnique({ where: { id: ID } });
  const provider = row?.searchProvider as SearchProvider | null | undefined;
  if (!provider) throw new ApiError(400, "search_not_configured", "Choose a web search provider in Settings to use Research.");
  const info = PROVIDER_INFO[provider];
  if (info.needsKey && !row?.encryptedSearchKey) throw new ApiError(400, "search_not_configured", `Add your ${info.label} API key in Settings to use Research.`);
  if (info.needsUrl && !row?.searchBaseUrl) throw new ApiError(400, "search_not_configured", `Add the address of your ${info.label} instance in Settings to use Research.`);
  let apiKey: string | null = null;
  if (row?.encryptedSearchKey) {
    const secret = getEncryptionSecret();
    if (!secret) throw new ApiError(500, "encryption_not_configured", "ENCRYPTION_KEY is missing, so the saved search key can't be read.");
    apiKey = decryptSecret(row.encryptedSearchKey, secret);
  }
  return { provider, apiKey, baseUrl: row?.searchBaseUrl ?? null };
}
