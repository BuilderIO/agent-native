import { signA2AToken } from "@agent-native/core/a2a";
import { describe, it, expect } from "vitest";

import {
  ORG_APPS_PATH,
  buildOrgAppsResponse,
  decodeJwtUnverified,
  extractBearerToken,
  toA2aUrl,
  verifyA2ABearerToken,
} from "./org-apps-directory.js";

const GLOBAL_SECRET = "test-global-a2a-secret";
const ORG_SECRET = "org-scoped-secret-xyz";

async function signGlobal(
  email: string,
  orgDomain?: string,
  expiresIn = "5m",
): Promise<string> {
  const prev = process.env.A2A_SECRET;
  process.env.A2A_SECRET = GLOBAL_SECRET;
  try {
    return await signA2AToken(email, orgDomain, undefined, {
      preferGlobalSecret: true,
      expiresIn,
    });
  } finally {
    if (prev === undefined) delete process.env.A2A_SECRET;
    else process.env.A2A_SECRET = prev;
  }
}

describe("ORG_APPS_PATH", () => {
  it("is the exact directory route", () => {
    expect(ORG_APPS_PATH).toBe("/_agent-native/org/apps");
  });
});

describe("extractBearerToken", () => {
  it("reads a Bearer token", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(extractBearerToken("bearer   xyz")).toBe("xyz");
  });
  it("rejects missing / malformed headers", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Token abc")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
  });
});

describe("decodeJwtUnverified", () => {
  it("decodes a real signed token without verifying", async () => {
    const tok = await signGlobal("a@acme.com", "acme.com");
    const decoded = decodeJwtUnverified(tok);
    expect(decoded).not.toBeNull();
    expect(decoded!.header.alg).toBe("HS256");
    expect(decoded!.payload.sub).toBe("a@acme.com");
    expect(decoded!.payload.org_domain).toBe("acme.com");
  });
  it("returns null for non-JWT input", () => {
    expect(decodeJwtUnverified("not-a-jwt")).toBeNull();
    expect(decodeJwtUnverified("a.b")).toBeNull();
    expect(decodeJwtUnverified("a.b.c.d")).toBeNull();
    expect(decodeJwtUnverified("@@.@@.@@")).toBeNull();
  });
});

describe("verifyA2ABearerToken — reuses the A2A peer auth recipe", () => {
  it("ACCEPTS a token signed with the deployment global A2A_SECRET", async () => {
    const tok = await signGlobal("alice@acme.com", "acme.com");
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: GLOBAL_SECRET,
      resolveOrgSecretByDomain: async () => null,
    });
    expect(v).toEqual({ email: "alice@acme.com", orgDomain: "acme.com" });
  });

  it("ACCEPTS a token signed with the org's per-domain a2a_secret", async () => {
    const tok = await signA2AToken("bob@acme.com", "acme.com", ORG_SECRET, {
      expiresIn: "5m",
    });
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: undefined,
      resolveOrgSecretByDomain: async (d) =>
        d === "acme.com" ? ORG_SECRET : null,
    });
    expect(v).toEqual({ email: "bob@acme.com", orgDomain: "acme.com" });
  });

  it("REJECTS a token signed with a different secret (bad signature)", async () => {
    const tok = await signGlobal("eve@acme.com", "acme.com");
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: "the-wrong-secret",
      resolveOrgSecretByDomain: async () => "also-wrong",
    });
    expect(v).toBeNull();
  });

  it("REJECTS a cross-org token (domain resolves to a different org secret)", async () => {
    // Signed with ORG A's secret, but the verifier only knows ORG B's secret
    // for that domain and there is no matching global secret. Nothing the
    // verifier holds can validate it -> rejected (no cross-org disclosure).
    const tok = await signA2AToken(
      "mallory@orga.com",
      "orga.com",
      "org-a-secret",
      { expiresIn: "5m" },
    );
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: undefined,
      resolveOrgSecretByDomain: async () => "org-b-secret",
    });
    expect(v).toBeNull();
  });

  it("REJECTS an expired token", async () => {
    const tok = await signGlobal("late@acme.com", "acme.com", "1s");
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: GLOBAL_SECRET,
      resolveOrgSecretByDomain: async () => null,
      nowSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(v).toBeNull();
  });

  it("REJECTS a token with no org_domain (cannot be org-scoped)", async () => {
    const tok = await signGlobal("nobody@x.com", undefined);
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: GLOBAL_SECRET,
      resolveOrgSecretByDomain: async () => null,
    });
    expect(v).toBeNull();
  });

  it("REJECTS when no candidate secrets exist (unauthenticated)", async () => {
    const tok = await signGlobal("a@acme.com", "acme.com");
    const v = await verifyA2ABearerToken({
      token: tok,
      globalSecret: undefined,
      resolveOrgSecretByDomain: async () => null,
    });
    expect(v).toBeNull();
  });

  it("REJECTS a garbage token", async () => {
    const v = await verifyA2ABearerToken({
      token: "garbage",
      globalSecret: GLOBAL_SECRET,
      resolveOrgSecretByDomain: async () => null,
    });
    expect(v).toBeNull();
  });
});

describe("toA2aUrl", () => {
  it("appends the canonical agent-native A2A endpoint path", () => {
    expect(toA2aUrl("https://mail.agent-native.com")).toBe(
      "https://mail.agent-native.com/_agent-native/a2a",
    );
    expect(toA2aUrl("https://mail.agent-native.com/")).toBe(
      "https://mail.agent-native.com/_agent-native/a2a",
    );
  });
});

describe("buildOrgAppsResponse", () => {
  it("shapes the response, drops self + non-http, dedupes, and sorts", () => {
    const res = buildOrgAppsResponse({
      org: "acme.com",
      selfId: "dispatch",
      apps: [
        {
          id: "dispatch",
          name: "Dispatch",
          url: "https://dispatch.agent-native.com",
        },
        {
          id: "mail",
          name: "Mail",
          description: "Agent-native email",
          url: "https://mail.agent-native.com/",
        },
        {
          id: "calendar",
          name: "Calendar",
          url: "https://calendar.agent-native.com",
        },
        { id: "mail", name: "Mail dup", url: "https://mail.agent-native.com" },
        { id: "bad", name: "Bad scheme", url: "ftp://nope" },
        { id: "", name: "Empty id", url: "https://x.agent-native.com" },
      ],
    });

    expect(res.org).toBe("acme.com");
    // dispatch (self), the dup, the ftp, and the empty-id are all excluded.
    expect(res.apps.map((a) => a.id)).toEqual(["calendar", "mail"]);
    const mail = res.apps.find((a) => a.id === "mail")!;
    expect(mail).toEqual({
      id: "mail",
      name: "Mail",
      url: "https://mail.agent-native.com",
      a2aUrl: "https://mail.agent-native.com/_agent-native/a2a",
      capabilities: "Agent-native email",
    });
    const cal = res.apps.find((a) => a.id === "calendar")!;
    expect(cal.capabilities).toBeUndefined();
  });

  it("only references allow-listed first-party apps when fed the real registry", async () => {
    // Source of truth = Dispatch's existing connected-apps registry
    // (discoverAgents -> getBuiltinAgents -> BUILTIN_AGENTS), which already
    // excludes hidden templates. Assert no hidden first-party slug leaks.
    const { getBuiltinAgents } =
      await import("@agent-native/core/server/agent-discovery");
    const builtins = getBuiltinAgents("dispatch");
    const res = buildOrgAppsResponse({
      org: "acme.com",
      selfId: "dispatch",
      apps: builtins.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        url: a.url,
      })),
    });
    const HIDDEN_SLUGS = [
      "calls",
      "meeting-notes",
      "voice",
      "scheduling",
      "issues",
      "recruiting",
      "macros",
      "code",
      "migration",
      "starter",
    ];
    const ids = new Set(res.apps.map((a) => a.id));
    for (const slug of HIDDEN_SLUGS) {
      expect(ids.has(slug)).toBe(false);
    }
    // dispatch (self) is excluded; every entry has a valid a2aUrl.
    expect(ids.has("dispatch")).toBe(false);
    for (const a of res.apps) {
      expect(a.a2aUrl.endsWith("/_agent-native/a2a")).toBe(true);
      expect(/^https?:\/\//.test(a.url)).toBe(true);
    }
  });
});
