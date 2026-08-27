import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATES } from "../cli/templates-meta.js";
import {
  BUILTIN_AGENTS_FOR_SEEDING,
  discoverAgents,
  discoverOrgDirectoryAgents,
  findWorkspaceDispatchAgent,
  getBuiltinAgents,
  normalizeAgentId,
  shouldIncludeRemoteAgentManifest,
} from "./agent-discovery.js";
import { runWithRequestContext } from "./request-context.js";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListAccessibleMock = vi.hoisted(() => vi.fn());
const resourceGetMock = vi.hoisted(() => vi.fn());
const resourceListContentByOwnersAndPrefixesMock = vi.hoisted(() => vi.fn());
const getSettingMock = vi.hoisted(() => vi.fn());
const DISCOVERY_ENV_KEYS = [
  "NODE_ENV",
  "AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "WORKSPACE_GATEWAY_URL",
  "VITE_WORKSPACE_GATEWAY_URL",
  "APP_URL",
  "WORKSPACE_OAUTH_ORIGIN",
  "VITE_WORKSPACE_OAUTH_ORIGIN",
  "BETTER_AUTH_URL",
  "VITE_BETTER_AUTH_URL",
  "URL",
  "DEPLOY_URL",
  "VERCEL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NETLIFY",
  "NETLIFY_LOCAL",
  "AWS_LAMBDA_FUNCTION_NAME",
] as const;
let previousEnv: Record<
  (typeof DISCOVERY_ENV_KEYS)[number],
  string | undefined
>;

vi.mock("../resources/store.js", () => ({
  resourceGet: resourceGetMock,
  resourceListContentByOwnersAndPrefixes:
    resourceListContentByOwnersAndPrefixesMock,
  resourceList: resourceListMock,
  resourceListAccessible: resourceListAccessibleMock,
  SHARED_OWNER: "__shared__",
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
}));

vi.mock("../settings/index.js", () => ({
  getSetting: getSettingMock,
  putSetting: vi.fn(),
}));

describe("agent discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceListMock.mockResolvedValue([]);
    resourceListAccessibleMock.mockResolvedValue([]);
    resourceGetMock.mockResolvedValue(null);
    resourceListContentByOwnersAndPrefixesMock.mockResolvedValue([]);
    getSettingMock.mockResolvedValue(null);
    previousEnv = Object.fromEntries(
      DISCOVERY_ENV_KEYS.map((key) => [key, process.env[key]]),
    ) as typeof previousEnv;
    for (const key of DISCOVERY_ENV_KEYS) delete process.env[key];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const key of DISCOVERY_ENV_KEYS) restoreEnv(key, previousEnv[key]);
  });

  it("derives built-in connected agents from public and default-agent production templates", () => {
    const expected = TEMPLATES.filter(
      (template) =>
        (!template.hidden || template.defaultAgent) &&
        template.prodUrl &&
        template.name !== "dispatch",
    ).map((template) => template.name);

    expect(getBuiltinAgents("dispatch").map((agent) => agent.id)).toEqual(
      expected,
    );
  });

  it("includes current public agents and excludes hidden production agents", () => {
    const ids = getBuiltinAgents("dispatch").map((agent) => agent.id);

    expect(ids).toContain("clips");
    expect(ids).toContain("design");
    expect(ids).toContain("assets");
    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).not.toContain("calls");
    expect(ids).not.toContain("meeting-notes");
    expect(ids).not.toContain("scheduling");
    expect(ids).not.toContain("voice");
  });

  it("exposes the remote-agent visibility predicate used by list views", () => {
    expect(
      shouldIncludeRemoteAgentManifest({ id: "dispatch" }, "dispatch"),
    ).toBe(false);
    expect(shouldIncludeRemoteAgentManifest({ id: "assets" }, "dispatch")).toBe(
      true,
    );
    expect(shouldIncludeRemoteAgentManifest({ id: "images" }, "assets")).toBe(
      false,
    );
    expect(shouldIncludeRemoteAgentManifest({ id: "issues" }, "dispatch")).toBe(
      false,
    );
    expect(
      shouldIncludeRemoteAgentManifest({ id: "custom-qa" }, "dispatch"),
    ).toBe(true);
  });

  it("maps the retired videos agent to the current clips agent", () => {
    expect(normalizeAgentId("videos")).toBe("clips");
  });

  it("seeds built-in remote agents with production URLs only", () => {
    for (const agent of BUILTIN_AGENTS_FOR_SEEDING) {
      expect(agent.url).toMatch(/^https:\/\/.+\.agent-native\.com$/);
      expect(agent.url).not.toContain("localhost");
      expect(agent.url).not.toContain("127.0.0.1");
    }
  });

  it("uses local built-in agent URLs only for truly local runtimes", () => {
    const slides = getBuiltinAgents("content").find(
      (agent) => agent.id === "slides",
    );

    expect(slides?.url).toBe("http://localhost:8086");
  });

  it("allows an explicit local URL preference for an isolated dev directory", () => {
    process.env.NODE_ENV = "production";

    const slides = getBuiltinAgents("content", {
      preferLocalUrls: true,
    }).find((agent) => agent.id === "slides");

    expect(slides?.url).toBe("http://localhost:8086");
  });

  it("uses production built-in agent URLs when a public app URL is configured", () => {
    process.env.APP_URL = "https://content.agent-native.com";

    const slides = getBuiltinAgents("content").find(
      (agent) => agent.id === "slides",
    );

    expect(slides?.url).toBe("https://slides.agent-native.com");
  });

  it("keeps localhost built-in agent URLs when only a loopback app URL is configured", () => {
    process.env.APP_URL = "http://localhost:8080";

    const slides = getBuiltinAgents("content").find(
      (agent) => agent.id === "slides",
    );

    expect(slides?.url).toBe("http://localhost:8086");
  });

  it("does not treat generic URL env vars alone as hosted runtime signals", () => {
    process.env.URL = "https://branch-preview.example.test";
    process.env.DEPLOY_URL = "https://deploy-preview.example.test";

    const slides = getBuiltinAgents("content").find(
      (agent) => agent.id === "slides",
    );

    expect(slides?.url).toBe("http://localhost:8086");
  });

  it("keeps local URLs when netlify dev marks the runtime local", () => {
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";
    process.env.APP_URL = "https://content.agent-native.com";

    const slides = getBuiltinAgents("content").find(
      (agent) => agent.id === "slides",
    );

    expect(slides?.url).toBe("http://localhost:8086");
  });

  it("ignores stale hidden first-party remote-agent resources", async () => {
    resourceListMock.mockResolvedValue([
      { id: "dispatch-resource", path: "remote-agents/dispatch.json" },
      { id: "issues-resource", path: "remote-agents/issues.json" },
      { id: "recruiting-resource", path: "remote-agents/recruiting.json" },
      { id: "custom-resource", path: "remote-agents/custom-qa.json" },
    ]);
    resourceGetMock.mockImplementation(async (id: string) => {
      const contentById: Record<string, string> = {
        "dispatch-resource": JSON.stringify({
          id: "dispatch",
          name: "Dispatch",
          url: "https://dispatch.agent-native.com",
        }),
        "issues-resource": JSON.stringify({
          id: "issues",
          name: "Issues",
          url: "https://issues.agent-native.com",
        }),
        "recruiting-resource": JSON.stringify({
          id: "recruiting",
          name: "Recruiting",
          url: "https://recruiting.agent-native.com",
        }),
        "custom-resource": JSON.stringify({
          id: "custom-qa",
          name: "Custom QA",
          url: "https://custom.example.com",
        }),
      };
      return { id, content: contentById[id] ?? "{}" };
    });

    const ids = (await discoverAgents("dispatch")).map((agent) => agent.id);

    expect(ids).not.toContain("dispatch");
    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).toContain("custom-qa");
  });

  it("ignores stale loopback custom agents on public runtimes", async () => {
    process.env.APP_URL = "https://design.agent-native.com";
    resourceListMock.mockResolvedValue([
      { id: "codex-resource", path: "remote-agents/codex.json" },
      {
        id: "codex-mapped-resource",
        path: "remote-agents/codex-mapped.json",
      },
    ]);
    resourceGetMock.mockImplementation(async (id: string) => ({
      id,
      content: JSON.stringify({
        id: "codex",
        name: "Codex",
        url:
          id === "codex-mapped-resource"
            ? "http://[::ffff:127.0.0.1]:8789"
            : "http://127.0.0.1:8789",
      }),
    }));

    const agents = await discoverAgents("design");

    expect(agents.find((agent) => agent.id === "codex")).toBeUndefined();
  });

  it("discovers legacy agents/*.json remote-agent resources", async () => {
    resourceListMock.mockImplementation(
      async (_owner: string, prefix: string) => {
        if (prefix === "agents/") {
          return [{ id: "legacy-resource", path: "agents/external-qa.json" }];
        }
        return [];
      },
    );
    resourceGetMock.mockResolvedValue({
      id: "legacy-resource",
      content: JSON.stringify({
        name: "External QA",
        url: "https://qa.example.com",
      }),
    });

    const agents = await discoverAgents("dispatch");

    expect(resourceListMock).toHaveBeenCalledWith(
      "__shared__",
      "remote-agents/",
    );
    expect(resourceListMock).toHaveBeenCalledWith("__shared__", "agents/");
    expect(agents.find((agent) => agent.id === "external-qa")).toMatchObject({
      id: "external-qa",
      name: "External QA",
      url: "https://qa.example.com",
    });
  });

  it("discovers organization-owned agents with legacy shared fallback", async () => {
    const manifests = new Map([
      [
        "legacy-resource",
        JSON.stringify({
          id: "shared-qa",
          name: "Legacy QA",
          url: "https://legacy.example.com",
        }),
      ],
      [
        "organization-resource",
        JSON.stringify({
          id: "org-qa",
          name: "Organization QA",
          url: "https://org.example.com",
        }),
      ],
    ]);
    resourceListMock.mockImplementation(
      async (owner: string, prefix: string) => {
        if (prefix !== "remote-agents/") return [];
        if (owner === "__shared__") {
          return [{ id: "legacy-resource", path: "remote-agents/legacy.json" }];
        }
        return [
          {
            id: "organization-resource",
            path: "remote-agents/organization.json",
          },
        ];
      },
    );
    resourceGetMock.mockImplementation(async (id: string) => ({
      id,
      content: manifests.get(id) ?? "{}",
    }));

    const agents = await runWithRequestContext({ orgId: "org-123" }, () =>
      discoverAgents("dispatch"),
    );

    expect(resourceListMock).toHaveBeenCalledWith(
      "__organization__:org-123",
      "remote-agents/",
    );
    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "shared-qa",
          url: "https://legacy.example.com",
        }),
        expect.objectContaining({
          id: "org-qa",
          url: "https://org.example.com",
        }),
      ]),
    );
  });

  it("prefers the organization manifest and reads each scoped resource once", async () => {
    resourceListMock.mockImplementation(
      async (owner: string, prefix: string) => {
        if (prefix !== "remote-agents/") return [];
        return [
          {
            id: owner === "__shared__" ? "shared-resource" : "org-resource",
            path: "remote-agents/same-agent.json",
          },
        ];
      },
    );
    resourceGetMock.mockImplementation(async (id: string) => ({
      id,
      content: JSON.stringify({
        id: "same-agent",
        name: id === "org-resource" ? "Organization Agent" : "Legacy Agent",
        url:
          id === "org-resource"
            ? "https://org.example.com"
            : "https://legacy.example.com",
      }),
    }));

    const agents = await runWithRequestContext({ orgId: "org-123" }, () =>
      discoverAgents("dispatch"),
    );

    expect(agents.filter((agent) => agent.id === "same-agent")).toHaveLength(1);
    expect(agents.find((agent) => agent.id === "same-agent")).toMatchObject({
      name: "Organization Agent",
      url: "https://org.example.com",
    });
    expect(resourceGetMock).toHaveBeenCalledTimes(2);
  });

  it("keeps local built-in URLs ahead of seeded production resources", async () => {
    process.env.NODE_ENV = "production";
    resourceListMock.mockResolvedValue([
      { id: "clips-resource", path: "remote-agents/clips.json" },
    ]);
    resourceGetMock.mockResolvedValue({
      id: "clips-resource",
      content: JSON.stringify({
        id: "clips",
        name: "Clips",
        url: "https://clips.agent-native.com",
      }),
    });

    const clips = (
      await discoverAgents("dispatch", { preferLocalUrls: true })
    ).find((agent) => agent.id === "clips");

    expect(clips?.url).toBe("http://localhost:8094");
  });

  it("discovers sibling workspace apps from the workspace manifest", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "dispatch",
          name: "Dispatch",
          path: "/dispatch",
          isDispatch: true,
        },
        {
          id: "starter",
          name: "Starter",
          description: "Workspace starter",
          path: "/starter",
          isDispatch: false,
        },
        {
          id: "mail",
          name: "Workspace Mail",
          description: "Workspace-specific mail app",
          path: "/mail",
          isDispatch: false,
        },
      ],
    });

    const agents = await discoverAgents("dispatch");
    const starter = agents.find((agent) => agent.id === "starter");
    const mail = agents.find((agent) => agent.id === "mail");

    expect(agents.map((agent) => agent.id)).not.toContain("dispatch");
    expect(starter).toMatchObject({
      id: "starter",
      name: "Starter",
      description: "Workspace starter",
      url: "https://workspace.example.test/starter",
    });
    expect(mail).toMatchObject({
      id: "mail",
      name: "Workspace Mail",
      description: "Workspace-specific mail app",
      url: "https://workspace.example.test/mail",
    });
  });

  it("resolves the trusted Dispatch callback only from the workspace manifest", () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [
        {
          id: "control-plane",
          name: "Workspace Dispatch",
          path: "/dispatch",
          isDispatch: true,
        },
        {
          id: "content",
          name: "Content",
          path: "/content",
          isDispatch: false,
        },
      ],
    });

    expect(findWorkspaceDispatchAgent()).toMatchObject({
      id: "control-plane",
      name: "Workspace Dispatch",
      url: "https://workspace.example.test/dispatch",
    });

    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [
        {
          id: "content",
          name: "Content",
          path: "/content",
          isDispatch: false,
        },
      ],
    });
    expect(findWorkspaceDispatchAgent()).toBeUndefined();
  });

  it("uses explicit workspace manifest URLs without falling back to built-ins", async () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "mail",
          name: "Workspace Mail",
          description: "Custom workspace mail app",
          path: "/mail",
          url: "https://mail.workspace.example.test/",
        },
      ],
    });

    const agents = await discoverAgents("dispatch");
    expect(agents.find((agent) => agent.id === "mail")).toMatchObject({
      id: "mail",
      name: "Workspace Mail",
      description: "Custom workspace mail app",
      url: "https://mail.workspace.example.test/",
    });
  });

  it("keeps preferred local built-in URLs ahead of workspace manifests", async () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "mail",
          name: "Workspace Mail",
          path: "/mail",
          url: "https://mail.workspace.example.test/",
        },
      ],
    });

    const agents = await discoverAgents("dispatch", {
      preferLocalUrls: true,
    });
    expect(agents.find((agent) => agent.id === "mail")?.url).toBe(
      "http://localhost:8085",
    );
  });

  it("ignores stale localhost workspace URLs for first-party agents on public runtimes", async () => {
    process.env.APP_URL = "https://content.agent-native.com";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "slides",
          name: "Slides",
          description: "Slides workspace app",
          path: "/slides",
          url: "http://localhost:8086",
        },
      ],
    });

    const agents = await discoverAgents("content");

    expect(agents.find((agent) => agent.id === "slides")).toMatchObject({
      url: "https://slides.agent-native.com",
    });
  });

  it("normalizes retired workspace app IDs", async () => {
    process.env.APP_URL = "https://content.agent-native.com";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "videos",
          name: "Videos",
          description: "Retired videos app",
          path: "/videos",
          url: "http://localhost:8087",
        },
      ],
    });

    const agents = await discoverAgents("content");

    expect(agents.some((agent) => agent.id === "videos")).toBe(false);
    expect(agents.find((agent) => agent.id === "clips")).toMatchObject({
      id: "clips",
      url: "https://clips.agent-native.com",
    });
  });

  it("applies legacy metadata overrides to normalized workspace app IDs", async () => {
    process.env.APP_URL = "https://content.agent-native.com";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "videos",
          name: "Videos",
          description: "Retired videos app",
          path: "/videos",
        },
      ],
    });
    getSettingMock.mockResolvedValue({
      apps: {
        videos: {
          name: "Clips workspace",
          description: "Edited clips description",
        },
      },
    });

    const agents = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => discoverAgents("content"),
    );

    expect(agents.find((agent) => agent.id === "clips")).toMatchObject({
      id: "clips",
      name: "Clips workspace",
      description: "Edited clips description",
    });
  });

  it("ignores stale IPv6 loopback workspace URLs on public runtimes", async () => {
    process.env.APP_URL = "https://content.agent-native.com";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "slides",
          name: "Slides",
          description: "Slides workspace app",
          path: "/slides",
          url: "http://[::1]:8086",
        },
      ],
    });

    const agents = await discoverAgents("content");

    expect(agents.find((agent) => agent.id === "slides")).toMatchObject({
      url: "https://slides.agent-native.com",
    });
  });

  it("applies human-edited workspace app metadata to A2A discovery", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "briefs",
          name: "Briefs",
          description: "Original app description",
          path: "/briefs",
        },
      ],
    });
    getSettingMock.mockResolvedValue({
      apps: {
        briefs: {
          name: "Research Briefs",
          description: "Turns research notes into field-ready briefs",
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
      },
    });

    const agents = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => discoverAgents("dispatch"),
    );

    expect(getSettingMock).toHaveBeenCalledWith(
      "workspace-app-metadata:user:dev@example.test",
    );
    expect(agents.find((agent) => agent.id === "briefs")).toMatchObject({
      id: "briefs",
      name: "Research Briefs",
      description: "Turns research notes into field-ready briefs",
      url: "https://workspace.example.test/briefs",
    });
  });

  it("uses generated metadata only as a fallback for blank descriptions", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      version: 1,
      apps: [
        {
          id: "docs",
          name: "Docs",
          description: "Package description",
          path: "/docs",
        },
        {
          id: "briefs",
          name: "Briefs",
          description: "",
          path: "/briefs",
        },
      ],
    });
    getSettingMock.mockResolvedValue({
      apps: {
        docs: {
          description: "Seeded generated description",
          generated: true,
        },
        briefs: {
          description: "Seeded briefs description",
          generated: true,
        },
      },
    });

    const agents = await runWithRequestContext(
      { userEmail: "dev@example.test" },
      () => discoverAgents("dispatch"),
    );

    expect(agents.find((agent) => agent.id === "docs")).toMatchObject({
      description: "Package description",
    });
    expect(agents.find((agent) => agent.id === "briefs")).toMatchObject({
      description: "Seeded briefs description",
    });
  });

  it("builds a complete strict directory with one manifest-store read", async () => {
    resourceListContentByOwnersAndPrefixesMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        id: `resource-${index}`,
        owner: "__shared__",
        path: `remote-agents/custom-${index}.json`,
        content: JSON.stringify({
          id: `custom-${index}`,
          name: `Custom ${index}`,
          url: `https://custom-${index}.example.test`,
        }),
      })),
    );

    const result = await discoverOrgDirectoryAgents("dispatch");

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "custom-0" }),
          expect.objectContaining({ id: "custom-24" }),
        ]),
      );
    }
    expect(resourceListContentByOwnersAndPrefixesMock).toHaveBeenCalledTimes(1);
    expect(resourceGetMock).not.toHaveBeenCalled();
  });

  it("preserves shared, organization, and workspace precedence in strict discovery", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [
        {
          id: "same-agent",
          name: "Workspace Agent",
          path: "/same-agent",
        },
      ],
    });
    resourceListContentByOwnersAndPrefixesMock.mockResolvedValue([
      {
        id: "org-current",
        owner: "__organization__:org-123",
        path: "remote-agents/same-agent.json",
        content: JSON.stringify({
          id: "same-agent",
          name: "Organization Agent",
          url: "https://organization.example.test",
        }),
      },
      {
        id: "shared-legacy",
        owner: "__shared__",
        path: "agents/same-agent.json",
        content: JSON.stringify({
          id: "same-agent",
          name: "Shared Agent",
          url: "https://shared.example.test",
        }),
      },
    ]);

    const result = await runWithRequestContext({ orgId: "org-123" }, () =>
      discoverOrgDirectoryAgents("dispatch"),
    );

    expect(result).toMatchObject({
      status: "available",
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: "same-agent",
          name: "Workspace Agent",
          url: "https://workspace.example.test/same-agent",
        }),
      ]),
    });
  });

  it("reports strict manifest failure while legacy discovery stays best-effort", async () => {
    resourceListContentByOwnersAndPrefixesMock.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
      status: "unavailable",
      reason: "remote-manifests",
    });
    await expect(discoverAgents("dispatch")).resolves.toEqual(
      getBuiltinAgents("dispatch"),
    );
  });

  it("rejects a malformed remote manifest instead of caching a partial strict directory", async () => {
    resourceListContentByOwnersAndPrefixesMock.mockResolvedValue([
      {
        id: "valid",
        owner: "__shared__",
        path: "remote-agents/valid.json",
        content: JSON.stringify({
          id: "valid",
          name: "Valid",
          url: "https://valid.example.test",
        }),
      },
      {
        id: "malformed",
        owner: "__shared__",
        path: "remote-agents/malformed.json",
        content: "{not-json",
      },
    ]);

    await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
      status: "unavailable",
      reason: "remote-manifests",
    });
  });

  it("rejects invalid remote manifest fields on the strict directory path", async () => {
    resourceListContentByOwnersAndPrefixesMock.mockResolvedValue([
      {
        id: "valid",
        owner: "__shared__",
        path: "remote-agents/valid.json",
        content: JSON.stringify({
          id: "valid",
          name: "Valid",
          url: "https://valid.example.test",
        }),
      },
      {
        id: "invalid-url",
        owner: "__shared__",
        path: "remote-agents/invalid-url.json",
        content: JSON.stringify({ id: "invalid-url", url: 123 }),
      },
    ]);

    await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
      status: "unavailable",
      reason: "remote-manifests",
    });
  });

  it("reports strict workspace metadata failure instead of returning a partial directory", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [{ id: "briefs", name: "Briefs", path: "/briefs" }],
    });
    getSettingMock.mockRejectedValue(new Error("settings unavailable"));

    await runWithRequestContext({ orgId: "org-123" }, async () => {
      await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
        status: "unavailable",
        reason: "workspace-metadata",
      });
      await expect(discoverAgents("dispatch")).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "briefs" })]),
      );
    });
  });

  it("rejects a malformed workspace app instead of caching a partial strict directory", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [
        { id: "briefs", name: "Briefs", path: "/briefs" },
        { id: "missing-path", name: "Missing Path" },
      ],
    });

    await runWithRequestContext({ orgId: "org-123" }, async () => {
      await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
        status: "unavailable",
        reason: "workspace-metadata",
      });
    });
  });

  it("rejects a malformed explicit workspace URL on the strict directory path", async () => {
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [
        {
          id: "briefs",
          name: "Briefs",
          path: "/briefs",
          url: "not-an-absolute-url",
        },
      ],
    });

    await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
      status: "unavailable",
      reason: "workspace-metadata",
    });
  });

  it("rejects malformed workspace metadata on the strict directory path", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [{ id: "briefs", name: "Briefs", path: "/briefs" }],
    });
    getSettingMock.mockResolvedValue({
      apps: { briefs: { description: 42 } },
    });

    await runWithRequestContext({ orgId: "org-123" }, async () => {
      await expect(discoverOrgDirectoryAgents("dispatch")).resolves.toEqual({
        status: "unavailable",
        reason: "workspace-metadata",
      });
    });
  });

  it("starts remote manifests and workspace metadata concurrently", async () => {
    process.env.APP_URL = "https://workspace.example.test";
    process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
      apps: [{ id: "briefs", name: "Briefs", path: "/briefs" }],
    });
    let resolveRemote!: (value: never[]) => void;
    let resolveMetadata!: (value: null) => void;
    resourceListContentByOwnersAndPrefixesMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRemote = resolve;
      }),
    );
    getSettingMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve;
      }),
    );

    const pending = runWithRequestContext({ orgId: "org-123" }, () =>
      discoverOrgDirectoryAgents("dispatch"),
    );
    await vi.waitFor(() => {
      expect(resourceListContentByOwnersAndPrefixesMock).toHaveBeenCalledOnce();
      expect(getSettingMock).toHaveBeenCalledOnce();
    });
    resolveRemote([]);
    resolveMetadata(null);

    await expect(pending).resolves.toMatchObject({ status: "available" });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
