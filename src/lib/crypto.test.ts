// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, lastFourCharacters } from "@/lib/crypto";

const SECRET = "test-encryption-secret-that-is-long-enough";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    const encrypted = encryptSecret("sk-or-v1-abcdef123456", SECRET);
    expect(decryptSecret(encrypted, SECRET)).toBe("sk-or-v1-abcdef123456");
  });

  it("never includes the plaintext in the ciphertext", () => {
    const encrypted = encryptSecret("sk-or-v1-abcdef123456", SECRET);
    expect(encrypted).not.toContain("sk-or-v1");
    expect(encrypted.startsWith("v1:")).toBe(true);
  });

  it("uses a fresh IV for every encryption", () => {
    expect(encryptSecret("same", SECRET)).not.toBe(encryptSecret("same", SECRET));
  });

  it("fails with the wrong secret", () => {
    const encrypted = encryptSecret("value", SECRET);
    expect(() => decryptSecret(encrypted, "another-secret-that-is-also-long-enough")).toThrow(
      /Could not decrypt/,
    );
  });

  it("detects tampering", () => {
    const encrypted = encryptSecret("value", SECRET);
    const [version, iv, tag, data] = encrypted.split(":");
    const flipped = `${data.slice(0, -2)}${data.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => decryptSecret([version, iv, tag, flipped].join(":"), SECRET)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptSecret("not-a-payload", SECRET)).toThrow(/unrecognized format/);
  });

  it("refuses secrets shorter than 32 characters", () => {
    expect(() => encryptSecret("value", "short")).toThrow(/at least 32 characters/);
  });
});

describe("lastFourCharacters", () => {
  it("returns the final four characters", () => {
    expect(lastFourCharacters("sk-or-v1-abcd1234")).toBe("1234");
  });
});
