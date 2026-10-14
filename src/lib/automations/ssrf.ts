import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True for loopback, private, link-local, carrier-grade NAT, multicast, and other addresses a server shouldn't be pointed at. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      a >= 224
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true;
}

export class BlockedUrlError extends Error {}

/** Checks a URL is safe to call from the server: http(s), no embedded credentials, and no private destination. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("That isn't a valid web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BlockedUrlError("Only http and https addresses can be called.");
  if (url.username || url.password) throw new BlockedUrlError("Addresses can't contain a username or password.");
  if (process.env.AUTOMATION_ALLOW_PRIVATE_HOSTS === "1") return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new BlockedUrlError("Addresses on this machine or your local network are blocked.");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (addresses.length === 0) throw new BlockedUrlError("That address couldn't be found.");
  if (addresses.some(isPrivateAddress)) throw new BlockedUrlError("Addresses on this machine or your local network are blocked.");
  return url;
}
