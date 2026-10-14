// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { assertPublicUrl, BlockedUrlError, isPrivateAddress } from "./ssrf";

afterEach(() => {
  delete process.env.AUTOMATION_ALLOW_PRIVATE_HOSTS;
});

describe("isPrivateAddress", () => {
  it("flags addresses a server shouldn't call", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("treats anything that isn't an address as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it("refuses other schemes, embedded credentials, and local names", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("ftp://example.com")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("https://user:pass@example.com")).rejects.toThrow(/username/);
    await expect(assertPublicUrl("http://localhost:3000/api")).rejects.toThrow(/local/);
    await expect(assertPublicUrl("http://printer.local")).rejects.toThrow(/local/);
    await expect(assertPublicUrl("garbage")).rejects.toThrow(/valid/);
  });

  it("refuses private IP literals, including cloud metadata and IPv6 loopback", async () => {
    for (const url of ["http://127.0.0.1", "http://10.0.0.5/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://192.168.0.1"]) {
      await expect(assertPublicUrl(url), url).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });

  it("accepts a public address literal, and can be relaxed on purpose for self-hosted services", async () => {
    expect((await assertPublicUrl("https://8.8.8.8/path")).hostname).toBe("8.8.8.8");
    process.env.AUTOMATION_ALLOW_PRIVATE_HOSTS = "1";
    expect((await assertPublicUrl("http://localhost:8080/hook")).port).toBe("8080");
  });
});
