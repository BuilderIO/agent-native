import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLATES } from "../cli/templates-meta.js";
import {
  BUILTIN_AGENTS_FOR_SEEDING,
  discoverAgents,
  getBuiltinAgents,
  shouldIncludeRemoteAgentManifest,
} from "./agent-discovery.js";
import { runWithRequestContext } from "./request-context.js";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListAccessibleMock = vi.hoisted(() => vi.fn());
const resourceGetMock = vi.hoisted(() => vi.fn());
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
  "AWS_LAMBDA_FUNCTION_NAME",
] as const;
let previousEnv: Record<
  (typeof DISCOVERY_ENV_KEYS)[number],
  string | undefined
>;

vi.mock("../resources/store.js", () => ({
  resourceGet: resourceGetMock,
  resourceList: resourceListMock,
  resourceListAccessible: resourceListAccessibleMock,
  SHARED_OWNER: "__shared__",
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
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
