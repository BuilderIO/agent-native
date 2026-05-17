import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuth } from "./build-server.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";
import type { MCPConfig } from "./build-server.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ACCESS_TOKEN;
  delete process.env.ACCESS_TOKENS;
  delete process.env.A2A_SECRET;
  delete process.env.AGENT_NATIVE_OWNER_EMAIL;
}

beforeEach(resetEnv);
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------------
// Issue 1 — ACCESS_TOKEN auth must not lose caller identity
// ---------------------------------------------------------------------------

describe("verifyAuth — static-token caller identity", () => {
  it("dev-open with no owner hint has no identity (unchanged behavior)", async () => {
    const res = await verifyAuth(undefined);
    expect(res.authed).toBe(true);
    expect(res.identity).toBeUndefined();
  });

  it("dev-open derives identity from AGENT_NATIVE_OWNER_EMAIL env", async () => {
    process.env.AGENT_NATIVE_OWNER_EMAIL = "owner@example.com";
    const res = await verifyAuth(undefined);
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("owner@example.com");
  });

  it("dev-open derives identity from the forwarded owner-email header", async () => {
    const res = await verifyAuth(undefined, "hdr@example.com");
    expect(res.identity?.userEmail).toBe("hdr@example.com");
  });

  it("static ACCESS_TOKEN match derives identity from owner env", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    process.env.AGENT_NATIVE_OWNER_EMAIL = "env-owner@example.com";
    const res = await verifyAuth("Bearer tok-123");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("env-owner@example.com");
  });

  it("server env wins over the forwarded header on the static-token path (no impersonation via a leaked token)", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    process.env.AGENT_NATIVE_OWNER_EMAIL = "env-owner@example.com";
    const res = await verifyAuth("Bearer tok-123", "attacker@evil.com");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("env-owner@example.com");
  });

  it("forwarded header is used only as a fallback when the owner env is unset", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    delete process.env.AGENT_NATIVE_OWNER_EMAIL;
    const res = await verifyAuth("Bearer tok-123", "header-owner@example.com");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("header-owner@example.com");
  });

  it("rejects an unknown token regardless of owner hint", async () => {
    process.env.ACCESS_TOKEN = "tok-123";
    const res = await verifyAuth("Bearer wrong", "owner@example.com");
    expect(res.authed).toBe(false);
    expect(res.identity).toBeUndefined();
  });

  it("a valid JWT identity is not overridden by the owner header", async () => {
    process.env.A2A_SECRET = "jwt-secret";
    const jose = await import("jose");
    const token = await new jose.SignJWT({
      sub: "jwt-user@example.com",
      org_domain: "acme.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("jwt-secret"));
    const res = await verifyAuth(`Bearer ${token}`, "spoof@evil.com");
    expect(res.authed).toBe(true);
    expect(res.identity?.userEmail).toBe("jwt-user@example.com");
    expect(res.identity?.orgDomain).toBe("acme.com");
  });
});

// ---------------------------------------------------------------------------
// Issue 2 / 3 — open_app + ask_app honesty for same-app / standalone
// (cross-app workspace resolution needs a real workspace dir and is covered
//  by the workspace-resolve path; here we lock the deterministic behavior.)
// ---------------------------------------------------------------------------

function baseConfig(over: Partial<MCPConfig> = {}): MCPConfig {
  return {
    name: "Mail",
    appId: "mail",
    description: "test",
    actions: {},
    ...over,
  };
}

describe("open_app — same-app / standalone keeps a relative deep link", () => {
  it("returns a relative /_agent-native/open path for the current app", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    const result: any = await tools.open_app.run({
      app: "mail",
      view: "inbox",
      params: { threadId: "abc" },
    });
    expect(result.url).toBe(
      "/_agent-native/open?app=mail&view=inbox&threadId=abc",
    );
    expect(result.url.startsWith("/")).toBe(true);
  });
});

describe("ask_app — honest routing metadata", () => {
  it("answers locally and reports routedVia:local for the current app", async () => {
    let received: string | undefined;
    const tools = getBuiltinCrossAppTools(
      baseConfig({
        askAgent: async (m: string) => {
          received = m;
          return "local-answer";
        },
      }),
    );
    const result: any = await tools.ask_app.run({
      app: "mail",
      message: "hello",
    });
    expect(received).toBe("hello");
    expect(result.routedVia).toBe("local");
    expect(result.app).toBe("mail");
    expect(result.response).toBe("local-answer");
    expect(result.note).toBeUndefined();
  });

  it("does not falsely claim delegation when the target is unreachable", async () => {
    const tools = getBuiltinCrossAppTools(
      baseConfig({
        askAgent: async () => "local-answer",
      }),
    );
    // "calendar" is not a resolvable workspace app in this test env, so it
    // falls back to local but must say so honestly.
    const result: any = await tools.ask_app.run({
      app: "calendar",
      message: "hi",
    });
    expect(result.routedVia).toBe("local");
    expect(result.app).toBe("mail");
    expect(typeof result.note).toBe("string");
    expect(result.note).toContain("calendar");
  });

  it("throws when no agent handler exists and target is local", async () => {
    const tools = getBuiltinCrossAppTools(baseConfig());
    await expect(tools.ask_app.run({ message: "hi" })).rejects.toThrow(
      /does not expose an agent/,
    );
  });
});
