import { ApiError } from "@/lib/api-error";
import { decryptSecret, encryptSecret, lastFourCharacters, MIN_SECRET_LENGTH } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getEncryptionSecret, getEnvironmentApiKey } from "@/lib/env";

export type ApiKeySource = "settings" | "environment";

export interface SettingsView {
  apiKey: {
    configured: boolean;
    source: ApiKeySource | null;
    last4: string | null;
    updatedAt: string | null;
    /** False when ENCRYPTION_KEY is unset, so a key cannot be saved from the UI. */
    canStoreKey: boolean;
  };
  defaultModelId: string | null;
  favoriteModelIds: string[];
  monthlyBudgetUsd: number | null;
  /** Whether agents may ask to use this computer. */
  computerControl: boolean;
}

export interface SettingsPatch {
  defaultModelId?: string | null;
  favoriteModelIds?: string[];
  monthlyBudgetUsd?: number | null;
  computerControl?: boolean;
}

const SETTINGS_ID = 1;

/** Ensures the singleton row exists. Safe under concurrent requests, unlike upsert. */
async function loadRow() {
  await prisma.appSettings.createMany({ data: { id: SETTINGS_ID }, skipDuplicates: true });
  return prisma.appSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
}

export async function getSettingsView(): Promise<SettingsView> {
  const row = await loadRow();
  const hasStoredKey = Boolean(row.encryptedApiKey);
  const hasEnvironmentKey = Boolean(getEnvironmentApiKey());
  const source: ApiKeySource | null = hasStoredKey ? "settings" : hasEnvironmentKey ? "environment" : null;

  return {
    apiKey: {
      configured: source !== null,
      source,
      last4: hasStoredKey ? row.apiKeyLast4 : source === "environment" ? lastFourCharacters(getEnvironmentApiKey() ?? "") : null,
      updatedAt: row.apiKeyUpdatedAt?.toISOString() ?? null,
      canStoreKey: Boolean(getEncryptionSecret()),
    },
    defaultModelId: row.defaultModelId,
    favoriteModelIds: row.favoriteModelIds,
    monthlyBudgetUsd: row.monthlyBudgetUsd,
    computerControl: row.computerControl,
  };
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const secret = getEncryptionSecret();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new ApiError(
      503,
      "encryption_not_configured",
      `Set ENCRYPTION_KEY in .env to at least ${MIN_SECRET_LENGTH} characters before saving an API key. Alternatively, set OPENROUTER_API_KEY.`,
    );
  }
  const encrypted = encryptSecret(apiKey, secret);
  await loadRow();
  await prisma.appSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      encryptedApiKey: encrypted,
      apiKeyLast4: lastFourCharacters(apiKey),
      apiKeyUpdatedAt: new Date(),
    },
  });
}

export async function clearApiKey(): Promise<void> {
  await loadRow();
  await prisma.appSettings.update({
    where: { id: SETTINGS_ID },
    data: { encryptedApiKey: null, apiKeyLast4: null, apiKeyUpdatedAt: null },
  });
}

/** Returns the key to use for OpenRouter calls: the saved key first, then the environment fallback. */
export async function resolveApiKey(): Promise<{ key: string; source: ApiKeySource } | null> {
  const row = await loadRow();
  if (row.encryptedApiKey) {
    const secret = getEncryptionSecret();
    if (!secret) {
      throw new ApiError(
        503,
        "encryption_not_configured",
        "A saved API key exists, but ENCRYPTION_KEY is not set, so it cannot be decrypted. Restore ENCRYPTION_KEY in .env.",
      );
    }
    try {
      return { key: decryptSecret(row.encryptedApiKey, secret), source: "settings" };
    } catch (error) {
      throw new ApiError(503, "decryption_failed", error instanceof Error ? error.message : "Could not decrypt the saved key.");
    }
  }
  const environmentKey = getEnvironmentApiKey();
  return environmentKey ? { key: environmentKey, source: "environment" } : null;
}

export async function requireApiKey(): Promise<{ key: string; source: ApiKeySource }> {
  const resolved = await resolveApiKey();
  if (!resolved) {
    throw new ApiError(401, "api_key_missing", "Add your OpenRouter API key in Settings to use AI features.");
  }
  return resolved;
}

export async function updateSettings(patch: SettingsPatch): Promise<SettingsView> {
  await loadRow();
  await prisma.appSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      ...(patch.defaultModelId !== undefined ? { defaultModelId: patch.defaultModelId } : {}),
      ...(patch.favoriteModelIds !== undefined ? { favoriteModelIds: [...new Set(patch.favoriteModelIds)] } : {}),
      ...(patch.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: patch.monthlyBudgetUsd } : {}),
      ...(patch.computerControl !== undefined ? { computerControl: patch.computerControl } : {}),
    },
  });
  return getSettingsView();
}
