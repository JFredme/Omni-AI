import { ApiError } from "@/lib/api-error";
import { decryptSecret, encryptSecret, MIN_SECRET_LENGTH } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getEncryptionSecret } from "@/lib/env";
import { PROVIDER_INFO, PROVIDERS, type ConnectionDto, type Provider } from "./catalog";
import { googleClient } from "./providers/google";

export type Credentials = { token: string } | { url: string } | { accessToken: string; refreshToken: string | null; expiresAt: number };

function secret(): string {
  const value = getEncryptionSecret();
  if (!value || value.length < MIN_SECRET_LENGTH) throw new ApiError(500, "encryption_not_configured", `Set ENCRYPTION_KEY (at least ${MIN_SECRET_LENGTH} characters) in .env before connecting a service.`);
  return value;
}

export async function listConnections(): Promise<ConnectionDto[]> {
  const rows = await prisma.integration.findMany();
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      connected: Boolean(row),
      account: row?.account ?? null,
      scopes: row?.scopes ?? [],
      lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      configured: PROVIDER_INFO[provider].auth === "oauth" ? googleClient() !== null : true,
    };
  });
}

export async function saveConnection(provider: Provider, credentials: Credentials, details: { account: string; scopes?: string[]; expiresAt?: Date | null }): Promise<void> {
  const encryptedCredentials = encryptSecret(JSON.stringify(credentials), secret());
  const data = { account: details.account, encryptedCredentials, scopes: details.scopes ?? [], expiresAt: details.expiresAt ?? null, lastError: null };
  await prisma.integration.upsert({ where: { provider }, update: data, create: { provider, ...data } });
}

export async function loadCredentials(provider: Provider): Promise<Credentials> {
  const row = await prisma.integration.findUnique({ where: { provider }, select: { encryptedCredentials: true } });
  if (!row) throw new ApiError(400, "not_connected", `${PROVIDER_INFO[provider].label} isn't connected. Connect it in Integrations first.`);
  try {
    return JSON.parse(decryptSecret(row.encryptedCredentials, secret())) as Credentials;
  } catch {
    throw new ApiError(500, "credentials_unreadable", `The saved ${PROVIDER_INFO[provider].label} credentials can't be read (ENCRYPTION_KEY may have changed). Reconnect it.`);
  }
}

export async function deleteConnection(provider: Provider): Promise<void> {
  await prisma.integration.deleteMany({ where: { provider } });
}

export async function recordUse(provider: Provider, error: string | null): Promise<void> {
  await prisma.integration.updateMany({ where: { provider }, data: error ? { lastError: error.slice(0, 500) } : { lastUsedAt: new Date(), lastError: null } }).catch(() => undefined);
}
