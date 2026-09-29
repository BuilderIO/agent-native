import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoverAgents,
  discoverOrgDirectoryAgents,
  getBuiltinAgents,
  getBuiltinAgentsForSeeding,
} from "./agent-discovery.js";
import { resetBuiltinAgentsConfigForTests } from "./builtin-agents.js";
import { runWithRequestContext } from "./request-context.js";

const mocks = vi.hoisted(() => ({
  resourceList: vi.fn(),
  resourceGet: vi.fn(),
  resourceListContentByOwnersAndPrefixes: vi.fn(),
  getSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("../resources/store.js", () => ({
  resourceGet: mocks.resourceGet,
  resourceList: mocks.resourceList,
  resourceListContentByOwnersAndPrefixes:
    mocks.resourceListContentByOwnersAndPrefixes,
  SHARED_OWNER: "__shared__",
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../settings/index.js", () => ({
  getSetting: mocks.getSetting,
  putSetting: vi.fn(),
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
}));

const ENV_KEYS = [
  "NODE_ENV",
  "AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "AGENT_NATIVE_BUILTIN_AGENTS_JSON",
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
  "APP_URL",
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "VERCEL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NETLIFY",
  "NETLIFY_LOCAL",
  "AWS_LAMBDA_FUNCTION_NAME",
];

function builderConfig(value: unknown): void {
  vi.stubEnv("AGENT_NATIVE_BUILTIN_AGENTS_JSON", JSON.stringify(value));
}

function orgSettings(byOrg: Record<string, unknown>): void {
  mocks.getOrgSetting.mockImplementation(async (orgId: string, key: string) =>
    key === "builtin-agents-enabled" ? (byOrg[orgId] ?? null) : null,
  );
}

function seededManifest(id: string) {
  return {
    id: `resource-${id}`,
    owner: "__shared__",
    path: `remote-agents/${id}.json`,
    content: JSON.stringify({
      id,
      name: id,
      url: `https://${id}.agent-native.com`,
    }),
  };
}

function ids(agents: Array<{ id: string }>): string[] {
  return agents.map((agent) => agent.id).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_URL", "https://workspace.example.test");
  resetBuiltinAgentsConfigForTests();
  mocks.resourceList.mockResolvedValue([]);
  mocks.resourceGet.mockResolvedValue(null);
  mocks.resourceListContentByOwnersAndPrefixes.mockResolvedValue([]);
  mocks.getSetting.mockResolvedValue(null);
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.getUserSetting.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetBuiltinAgentsConfigForTests();
});

describe("getBuiltinAgents builder config", () => {
  it('offers the framework default when unconfigured ("all")', () => {
    const offered = ids(getBuiltinAgents("dispatch"));
    expect(offered).toEqual(
      expect.arrayContaining([
        "calendar",
        "clips",
        "content",
        "design",
        "mail",
      ]),
    );
    expect(offered).not.toContain("dispatch");
  });

  it('offers nothing in mode "none"', () => {
    builderConfig({ mode: "none" });
    expect(getBuiltinAgents("dispatch")).toEqual([]);
    expect(getBuiltinAgentsForSeeding()).toEqual([]);
  });

  it('offers only included built-ins in mode "selected"', () => {
    builderConfig({ mode: "selected", include: ["mail", "nope"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(ids(getBuiltinAgents("dispatch"))).toEqual(["mail"]);
    expect(ids(getBuiltinAgentsForSeeding())).toEqual(["mail"]);
  });
});

describe("discoverAgents with builder config and admin setting", () => {
  it("starts an org with defaultEnabled", async () => {
    builderConfig({
      mode: "selected",
      include: ["mail", "calendar"],
      defaultEnabled: ["mail"],
    });

    const agents = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverAgents("dispatch"),
    );
    expect(ids(agents)).toEqual(["mail"]);
  });

  it("applies each org's admin setting to that org only", async () => {
    builderConfig({ mode: "selected", include: ["mail", "calendar"] });
    orgSettings({
      "org-a": { enabledIds: ["calendar"], offeredIds: ["mail", "calendar"] },
    });

    const orgA = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverAgents("dispatch"),
    );
    const orgB = await runWithRequestContext({ orgId: "org-b" }, () =>
      discoverAgents("dispatch"),
    );
    expect(ids(orgA)).toEqual(["calendar"]);
    expect(ids(orgB)).toEqual(["calendar", "mail"]);
  });

  it("falls back to the user-scoped setting without an org", async () => {
    builderConfig({ mode: "selected", include: ["mail", "calendar"] });
    mocks.getUserSetting.mockResolvedValue({ enabledIds: ["mail"] });

    const agents = await runWithRequestContext(
      { userEmail: "solo@example.test" },
      () => discoverAgents("dispatch"),
    );
    expect(ids(agents)).toEqual(["mail"]);
  });

  it("never lets an admin enable a built-in the builder did not include", async () => {
    builderConfig({ mode: "selected", include: ["mail"] });
    orgSettings({ "org-a": { enabledIds: ["mail", "calendar"] } });

    const agents = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverAgents("dispatch"),
    );
    expect(ids(agents)).toEqual(["mail"]);
  });

  it("does not let seeded manifests re-add disabled built-ins", async () => {
    builderConfig({ mode: "selected", include: ["mail", "calendar"] });
    orgSettings({ "org-a": { enabledIds: ["mail"] } });
    const manifests = [seededManifest("calendar"), seededManifest("slides")];
    mocks.resourceList.mockImplementation(async (owner: string) =>
      owner === "__shared__" ? manifests : [],
    );
    mocks.resourceGet.mockImplementation(async (id: string) =>
      manifests.find((manifest) => manifest.id === id),
    );

    const agents = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverAgents("dispatch"),
    );
    expect(ids(agents)).toEqual(["mail"]);
  });

  it('shows only workspace apps and connected agents in mode "none"', async () => {
    builderConfig({ mode: "none" });
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify({
        apps: [
          { id: "dispatch", name: "Dispatch", path: "/dispatch" },
          { id: "crm", name: "CRM", path: "/crm" },
          { id: "mail", name: "Our Mail", path: "/mail" },
        ],
      }),
    );
    const manifests = [
      seededManifest("content"),
      {
        id: "resource-partner",
        owner: "__shared__",
        path: "remote-agents/partner.json",
        content: JSON.stringify({
          id: "partner",
          name: "Partner",
          url: "https://partner.example.test",
        }),
      },
    ];
    mocks.resourceList.mockImplementation(async (owner: string) =>
      owner === "__shared__" ? manifests : [],
    );
    mocks.resourceGet.mockImplementation(async (id: string) =>
      manifests.find((manifest) => manifest.id === id),
    );

    const agents = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverAgents("dispatch"),
    );
    expect(ids(agents)).toEqual(["crm", "mail", "partner"]);
    expect(agents.find((agent) => agent.id === "mail")?.url).toBe(
      "https://workspace.example.test/mail",
    );
  });

  it("falls back to defaultEnabled when the setting is unreadable", async () => {
    builderConfig({
      mode: "selected",
      include: ["mail", "calendar"],
      defaultEnabled: ["calendar"],
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getOrgSetting.mockRejectedValue(new Error("db down"));

    const agents = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverAgents("dispatch"),
    );
    expect(ids(agents)).toEqual(["calendar"]);
  });
});

describe("discoverOrgDirectoryAgents with builder config and admin setting", () => {
  it("applies both layers and gates seeded manifests", async () => {
    builderConfig({ mode: "selected", include: ["mail", "calendar"] });
    orgSettings({ "org-a": { enabledIds: ["mail"] } });
    mocks.resourceListContentByOwnersAndPrefixes.mockResolvedValue([
      seededManifest("calendar"),
      seededManifest("content"),
    ]);

    const result = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverOrgDirectoryAgents("dispatch"),
    );
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(ids(result.agents)).toEqual(["mail"]);
    }
  });

  it("reports an unreadable setting instead of guessing", async () => {
    builderConfig({ mode: "selected", include: ["mail"] });
    orgSettings({ "org-a": { enabledIds: "mail" } });

    const result = await runWithRequestContext({ orgId: "org-a" }, () =>
      discoverOrgDirectoryAgents("dispatch"),
    );
    expect(result).toEqual({
      status: "unavailable",
      reason: "builtin-settings",
    });
  });
});

describe("built-in URLs in local development", () => {
  it("uses prodUrl outside the framework monorepo", () => {
    vi.stubEnv("APP_URL", "");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-workspace-"));
    try {
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      const mail = getBuiltinAgents("dispatch").find(
        (agent) => agent.id === "mail",
      );
      expect(mail?.url).toBe("https://mail.agent-native.com");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps dev-port URLs inside the framework monorepo", () => {
    vi.stubEnv("APP_URL", "");
    const mail = getBuiltinAgents("dispatch").find(
      (agent) => agent.id === "mail",
    );
    expect(mail?.url).toMatch(/^http:\/\/localhost:\d+$/);
  });
});
