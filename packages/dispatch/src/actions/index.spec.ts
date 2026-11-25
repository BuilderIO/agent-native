import {
  defineAppConfig,
  resetAppConfigForTests,
} from "@agent-native/core/app-config";
import { afterEach, describe, expect, it } from "vitest";

import {
  dispatchActions,
  dispatchDirectAppActions,
  resolveDispatchActions,
} from "./index.js";

const DIRECT_APP_ACTION_NAMES = [
  "call_app_action",
  "list_app_actions",
  "read_view",
];

describe("dispatch direct app actions", () => {
  afterEach(() => resetAppConfigForTests());

  it("serves exactly the default registry while the capability is off", () => {
    const actions = resolveDispatchActions();

    expect(actions).toBe(dispatchActions);
    for (const name of DIRECT_APP_ACTION_NAMES) {
      expect(actions).not.toHaveProperty(name);
    }
    expect(actions.ask_app.tool.description).not.toContain("call_app_action");
  });

  it("adds the direct tools and points ask_app at them when enabled", () => {
    defineAppConfig({ dispatch: { directAppActions: true } });

    const actions = resolveDispatchActions();

    expect(Object.keys(dispatchDirectAppActions).sort()).toEqual(
      DIRECT_APP_ACTION_NAMES,
    );
    for (const name of DIRECT_APP_ACTION_NAMES) {
      expect(actions[name]).toBe(dispatchDirectAppActions[name]);
    }
    expect(actions.ask_app.run).toBe(dispatchActions.ask_app.run);
    expect(actions.ask_app.tool.description).toContain(
      "list_app_actions and call_app_action",
    );
    expect(dispatchActions.ask_app.tool.description).not.toContain(
      "call_app_action",
    );
  });
});

describe("dispatch action registry", () => {
  it("keeps workspace resources runtime-inherited instead of exposing sync actions", () => {
    expect(dispatchActions).toHaveProperty("list-workspace-resources-for-app");
    expect(dispatchActions).toHaveProperty("list-connect-marketplace-apps");
    expect(dispatchActions).toHaveProperty("inspect-connect-agent-card");
    expect(dispatchActions).toHaveProperty("connect-external-agent");
    expect(dispatchActions).toHaveProperty("import-agent");
    expect(dispatchActions).toHaveProperty("list-mcp-app-access");
    expect(dispatchActions).toHaveProperty("set-mcp-app-access");
    expect(dispatchActions).toHaveProperty("list_apps");
    expect(dispatchActions).toHaveProperty("ask_app");
    expect(dispatchActions).toHaveProperty("ask_app_status");
    expect(dispatchActions).toHaveProperty("claim-workspace-app-organization");
    expect(dispatchActions).toHaveProperty("verify-curated-community-app");
    expect(dispatchActions["verify-curated-community-app"].readOnly).toBe(true);
    expect(dispatchActions).toHaveProperty("inspect-community-builder-backup");
    expect(dispatchActions["inspect-community-builder-backup"].readOnly).toBe(
      true,
    );
    expect(dispatchActions).toHaveProperty("open_app");
    expect(dispatchActions).toHaveProperty("create_embed_session");
    expect(dispatchActions.create_embed_session.mcpApp?.visibility).toEqual([
      "app",
    ]);
    expect(dispatchActions).toHaveProperty(
      "create-workspace-app-embed-session",
    );
    expect(dispatchActions).toHaveProperty("list-workspace-connections");
    expect(dispatchActions).toHaveProperty("read-slack-thread-context");
    expect(dispatchActions).toHaveProperty("list-dispatch-usage-metrics");
    expect(dispatchActions).toHaveProperty(
      "get-workspace-resource-effective-context",
    );
    expect(dispatchActions).toHaveProperty("grant-workspace-resources-to-app");
    // oracle-change: sync-vault-to-app is removed; vault keys are no longer pushed to apps.

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

  it("keeps Connect URL inspection UI-only", () => {
    expect(dispatchActions["list-connect-marketplace-apps"].agentTool).toBe(
      false,
    );
    expect(dispatchActions["list-connect-marketplace-apps"].mcpTool).toBe(
      false,
    );
    expect(dispatchActions["inspect-connect-agent-card"].agentTool).toBe(false);
    expect(dispatchActions["inspect-connect-agent-card"].mcpTool).toBe(false);
  });

  it("describes ask_app factually without prescriptive tool-selection instructions", () => {
    expect(dispatchActions.ask_app.tool.description).toContain(
      "this Dispatch connection",
    );
    expect(dispatchActions.ask_app.tool.description).not.toMatch(
      /do not require|call list_apps first|prefer /i,
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
    const firstSentence = action.tool.description.split(". ")[0];
    expect(firstSentence).toContain("members of this organization");
    expect(firstSentence).toContain("does NOT cover");
    expect(firstSentence).toContain("external customers");
    expect(firstSentence).toContain("describe-workspace-apps");
    expect(JSON.stringify(action.tool.parameters)).toContain(
      "Not for customers or other external accounts",
    );
  });
});
