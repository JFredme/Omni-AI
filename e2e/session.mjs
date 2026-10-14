// The runner (scripts/e2e.mjs) signs in once and hands the session cookie to every suite.
const baseUrl = process.env.OMNI_BASE_URL ?? "http://localhost:3100";
export const sessionToken = process.env.E2E_SESSION ?? "";

/** Adds the signed-in session to a browser context. */
export async function addSession(context) {
  if (!sessionToken) return;
  await context.addCookies([{ name: "omni_session", value: sessionToken, url: baseUrl }]);
}

/** Headers for direct API calls from the test script. */
export function sessionHeaders(extra = {}) {
  return { ...(sessionToken ? { Cookie: `omni_session=${sessionToken}` } : {}), ...extra };
}
