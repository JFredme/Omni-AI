import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FORMAT_VERSION = "v1";
export const MIN_SECRET_LENGTH = 32;

function deriveKey(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters long.`);
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypts with AES-256-GCM. Output: v1:<iv>:<authTag>:<ciphertext>, all base64. */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(":");
  if (version !== FORMAT_VERSION || !ivPart || !tagPart || !dataPart) {
    throw new Error("Stored secret has an unrecognized format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt the stored secret. ENCRYPTION_KEY may have changed.");
  }
}

export function lastFourCharacters(value: string): string {
  return value.slice(-4);
}
