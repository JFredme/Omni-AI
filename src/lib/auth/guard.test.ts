import { describe, expect, it } from "vitest";
import { decideAccess, originProblem, safeNextPath } from "./guard";

const base = { method: "GET", origin: null, host: "localhost:3000", hasSession: false };

describe("decideAccess", () => {
  it("lets signed-in requests through", () => {
    expect(decideAccess({ ...base, pathname: "/tasks", hasSession: true })).toEqual({ kind: "allow" });
    expect(decideAccess({ ...base, pathname: "/api/tasks", hasSession: true })).toEqual({ kind: "allow" });
  });

  it("sends signed-out page requests to the login page, remembering where they were going", () => {
    expect(decideAccess({ ...base, pathname: "/notes/abc", search: "?x=1" })).toEqual({ kind: "login", next: "/notes/abc?x=1" });
  });

  it("answers signed-out API requests with 401 instead of a redirect", () => {
    expect(decideAccess({ ...base, pathname: "/api/tasks" })).toEqual({ kind: "unauthorized" });
    expect(decideAccess({ ...base, pathname: "/api/auth/password", method: "POST" })).toEqual({ kind: "unauthorized" });
    expect(decideAccess({ ...base, pathname: "/api/audit" })).toEqual({ kind: "unauthorized" });
  });

  it("keeps only the sign-in routes public", () => {
    for (const pathname of ["/login", "/api/auth/status", "/api/auth/login", "/api/auth/setup"]) {
      expect(decideAccess({ ...base, pathname })).toEqual({ kind: "allow" });
    }
    expect(decideAccess({ ...base, pathname: "/api/auth/logout", method: "POST" })).toEqual({ kind: "unauthorized" });
    expect(decideAccess({ ...base, pathname: "/login/../tasks" }).kind).not.toBe("allow");
  });

  it("blocks cross-site writes, even for public routes and signed-in users", () => {
    const cross = { origin: "https://evil.example", method: "POST", hasSession: true };
    expect(decideAccess({ ...base, ...cross, pathname: "/api/tasks" }).kind).toBe("forbidden");
    expect(decideAccess({ ...base, ...cross, pathname: "/api/auth/login" }).kind).toBe("forbidden");
  });
});

describe("originProblem", () => {
  it("allows same-origin, missing-origin, and safe methods", () => {
    expect(originProblem("POST", "http://localhost:3000", "localhost:3000")).toBeNull();
    expect(originProblem("POST", null, "localhost:3000")).toBeNull();
    expect(originProblem("GET", "https://evil.example", "localhost:3000")).toBeNull();
  });

  it("rejects mismatched or malformed origins on writes", () => {
    expect(originProblem("DELETE", "https://evil.example", "localhost:3000")).not.toBeNull();
    expect(originProblem("PATCH", "http://localhost:3001", "localhost:3000")).not.toBeNull();
    expect(originProblem("POST", "null", "localhost:3000")).not.toBeNull();
  });
});

describe("safeNextPath", () => {
  it("accepts only same-site paths", () => {
    expect(safeNextPath("/tasks?x=1")).toBe("/tasks?x=1");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
