import { describe, expect, it } from "vitest";

import { dispatchActions } from "./index.js";

describe("dispatch action registry", () => {
  it("keeps workspace resources runtime-inherited instead of exposing sync actions", () => {
    expect(dispatchActions).toHaveProperty("list-workspace-resources-for-app");
    expect(dispatchActions).toHaveProperty("connect-external-agent");
    expect(dispatchActions).toHaveProperty("import-agent");
    expect(dispatchActions).toHaveProperty("list-mcp-app-access");
    expect(dispatchActions).toHaveProperty("set-mcp-app-access");
    expect(dispatchActions).toHaveProperty("list_apps");
    expect(dispatchActions).toHaveProperty("ask_app");
    expect(dispatchActions).toHaveProperty("ask_app_status");
    expect(dispatchActions).toHaveProperty("open_app");
    expect(dispatchActions).toHaveProperty("create_embed_session");
    expect(dispatchActions).toHaveProperty(
      "create-workspace-app-embed-session",
    );
    expect(dispatchActions).toHaveProperty("read-slack-thread-context");
    expect(dispatchActions).toHaveProperty("list-dispatch-usage-metrics");
    expect(dispatchActions).toHaveProperty(
      "get-workspace-resource-effective-context",
    );
    expect(dispatchActions).toHaveProperty("grant-workspace-resources-to-app");
    expect(dispatchActions).toHaveProperty("sync-vault-to-app");

    expect(dispatchActions).not.toHaveProperty(
      "sync-workspace-resources-to-app",
    );
    expect(dispatchActions).not.toHaveProperty(
      "sync-workspace-resources-to-all",
    );
    expect(
      Object.keys(dispatchActions).filter((name) =>
        name.startsWith("sync-workspace-resources"),
      ),
    ).toEqual([]);
  });

  it("exposes folder-backed agent pack actions", () => {
    expect(dispatchActions).toHaveProperty("import-agent-pack");
    expect(dispatchActions).toHaveProperty("list-agent-pack");
    expect(dispatchActions["import-agent-pack"].tool.description).toContain(
      "folder-backed agent pack",
    );
  });

  it("distinguishes mounted workspace apps from connected A2A agents", () => {
    expect(dispatchActions["list-workspace-apps"].tool.description).toContain(
      "not the hosted/connected A2A agent registry",
    );
    expect(dispatchActions["list-workspace-apps"].tool.description).toContain(
      "list-connected-agents",
    );
    expect(dispatchActions["list-connected-agents"].tool.description).toContain(
      "A2A delegation",
    );
  });

  it("exposes shared usage metrics as an authenticated read", () => {
    const action = dispatchActions["list-dispatch-usage-metrics"];

    expect(action.readOnly).toBe(true);
    expect(action.parallelSafe).toBe(true);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
      isConsequential: false,
    });
    expect(action.tool.description).toContain(
      "workspaceAppCreationsByUserMonth",
    );
    expect(action.tool.description).toContain("app adoption metrics");
  });
});
