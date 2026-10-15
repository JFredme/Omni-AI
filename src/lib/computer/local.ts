/** True when the request came to this computer's own address (localhost), not over a network such as Wi-Fi or the internet. */
export function isThisComputer(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}
