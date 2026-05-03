import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_AGENTS_FOR_SEEDING,
  discoverAgents,
  getBuiltinAgents,
} from "./agent-discovery.js";
import { visibleTemplates } from "../cli/templates-meta.js";

const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListAccessibleMock = vi.hoisted(() => vi.fn());
const resourceGetMock = vi.hoisted(() => vi.fn());
let previousWorkspaceAppsJson: string | undefined;
let previousAppUrl: string | undefined;

vi.mock("../resources/store.js", () => ({
  resourceGet: resourceGetMock,
  resourceList: resourceListMock,
  resourceListAccessible: resourceListAccessibleMock,
  SHARED_OWNER: "__shared__",
}));

vi.mock("./auth.js", () => ({
  DEV_MODE_USER_EMAIL: "dev@example.test",
}));

describe("agent discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourceListMock.mockResolvedValue([]);
    resourceListAccessibleMock.mockResolvedValue([]);
    resourceGetMock.mockResolvedValue(null);
    previousWorkspaceAppsJson = process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON;
    previousAppUrl = process.env.APP_URL;
    delete process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    restoreEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", previousWorkspaceAppsJson);
    restoreEnv("APP_URL", previousAppUrl);
  });

  it("derives built-in connected agents from visible production templates", () => {
    const expected = visibleTemplates()
      .filter((template) => template.prodUrl && template.name !== "dispatch")
      .map((template) => template.name);

    expect(getBuiltinAgents("dispatch").map((agent) => agent.id)).toEqual(
      expected,
    );
  });

  it("includes current public agents and excludes hidden production agents", () => {
    const ids = getBuiltinAgents("dispatch").map((agent) => agent.id);

    expect(ids).toContain("clips");
    expect(ids).toContain("design");
    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).not.toContain("calls");
    expect(ids).not.toContain("meeting-notes");
    expect(ids).not.toContain("scheduling");
    expect(ids).not.toContain("voice");
  });

  it("seeds built-in remote agents with production URLs only", () => {
    for (const agent of BUILTIN_AGENTS_FOR_SEEDING) {
      expect(agent.url).toMatch(/^https:\/\/.+\.agent-native\.com$/);
      expect(agent.url).not.toContain("localhost");
      expect(agent.url).not.toContain("127.0.0.1");
    }
  });

  it("ignores stale hidden first-party remote-agent resources", async () => {
    resourceListAccessibleMock.mockResolvedValue([
      { id: "issues-resource", path: "remote-agents/issues.json" },
      { id: "recruiting-resource", path: "remote-agents/recruiting.json" },
      { id: "custom-resource", path: "remote-agents/custom-qa.json" },
    ]);
    resourceGetMock.mockImplementation(async (id: string) => {
      const contentById: Record<string, string> = {
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

    expect(ids).not.toContain("issues");
    expect(ids).not.toContain("recruiting");
    expect(ids).toContain("custom-qa");
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
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
