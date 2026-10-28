import { describe, it, expect } from "vitest";

import {
  ORG_APPS_PATH,
  buildOrgAppsResponse,
  extractBearerToken,
  toA2aUrl,
} from "./org-apps-directory.js";

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
  it("keeps Dispatch for whole-fleet callers that do not request self-filtering", () => {
    const res = buildOrgAppsResponse({
      org: "acme.com",
      apps: [
        {
          id: "dispatch",
          name: "Dispatch",
          url: "https://dispatch.agent-native.com",
        },
        {
          id: "analytics",
          name: "Analytics",
          url: "https://analytics.agent-native.com",
        },
      ],
    });

    expect(res.apps.map((app) => app.id)).toEqual(["analytics", "dispatch"]);
  });

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
          description: "Agent-Native email",
          whenToUse: ["Email workflows"],
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
    expect(res.apps.map((a) => a.id)).toEqual(["calendar", "mail"]);
    const mail = res.apps.find((a) => a.id === "mail")!;
    expect(mail).toEqual({
      id: "mail",
      name: "Mail",
      description: "Agent-Native email",
      whenToUse: ["Email workflows"],
      url: "https://mail.agent-native.com",
      a2aUrl: "https://mail.agent-native.com/_agent-native/a2a",
      capabilities: "Agent-Native email",
    });
    const cal = res.apps.find((a) => a.id === "calendar")!;
    expect(cal.capabilities).toBeUndefined();
  });

  it("only references allow-listed first-party apps when fed the real registry", async () => {
    const { getBuiltinAgents } =
      await import("@agent-native/core/server/agent-discovery");
    const builtins = getBuiltinAgents();
    const res = buildOrgAppsResponse({
      org: "acme.com",
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
      "code",
      "migration",
      "starter",
    ];
    const ids = new Set(res.apps.map((a) => a.id));
    expect(ids.has("dispatch")).toBe(true);
    for (const slug of HIDDEN_SLUGS) {
      expect(ids.has(slug)).toBe(false);
    }
    expect(ids.has("dispatch")).toBe(true);
    for (const a of res.apps) {
      expect(a.a2aUrl.endsWith("/_agent-native/a2a")).toBe(true);
      expect(/^https?:\/\//.test(a.url)).toBe(true);
    }
  });
});
