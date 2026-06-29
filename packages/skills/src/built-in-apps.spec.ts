import { describe, expect, it } from "vitest";

import {
  appHasMcp,
  BUILT_IN_APP_MCP,
  resolveAppForSkill,
} from "./built-in-apps.js";

describe("resolveAppForSkill", () => {
  it("maps visual-plan to the plan app", () => {
    const app = resolveAppForSkill("visual-plan");
    expect(app).toBeDefined();
    expect(app?.appId).toBe("visual-plans");
    expect(app?.serverName).toBe("plan");
    expect(app?.mcpUrl).toBe("https://plan.agent-native.com/_agent-native/mcp");
    expect(
      app?.mcpUrl.endsWith("plan.agent-native.com/_agent-native/mcp"),
    ).toBe(true);
    expect(app?.aliases).toContain("agent-native-plans");
  });

  it("maps visual-recap to the same plan app", () => {
    const planSkill = resolveAppForSkill("visual-plan");
    const recapSkill = resolveAppForSkill("visual-recap");
    expect(recapSkill).toBeDefined();
    expect(recapSkill?.serverName).toBe("plan");
    expect(
      recapSkill?.mcpUrl.endsWith("plan.agent-native.com/_agent-native/mcp"),
    ).toBe(true);
    expect(recapSkill?.aliases).toContain("agent-native-plans");
    // Both skills resolve to the very same registry entry.
    expect(recapSkill).toBe(planSkill);
  });

  it("maps assets to the agent-native-assets server", () => {
    const app = resolveAppForSkill("assets");
    expect(app?.appId).toBe("assets");
    expect(app?.serverName).toBe("agent-native-assets");
    expect(app?.authMode).toBe("oauth");
  });

  it("maps content to the agent-native-content server", () => {
    const app = resolveAppForSkill("content");
    expect(app?.appId).toBe("content");
    expect(app?.serverName).toBe("agent-native-content");
    expect(app?.mcpUrl).toBe(
      "https://content.agent-native.com/_agent-native/mcp",
    );
  });

  it("maps design-exploration to the agent-native-design server", () => {
    const app = resolveAppForSkill("design-exploration");
    expect(app?.appId).toBe("design");
    expect(app?.serverName).toBe("agent-native-design");
  });

  it("maps visual-edit to the agent-native-design server", () => {
    const app = resolveAppForSkill("visual-edit");
    expect(app?.appId).toBe("design");
    expect(app?.serverName).toBe("agent-native-design");
  });

  it("maps context-xray to a none-auth, local-only app", () => {
    const app = resolveAppForSkill("context-xray");
    expect(app?.appId).toBe("context-xray");
    expect(app?.serverName).toBe("agent-native-context-xray");
    expect(app?.authMode).toBe("none");
    expect(app?.localOnly).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(resolveAppForSkill("Visual-Plan")?.serverName).toBe("plan");
    expect(resolveAppForSkill("ASSETS")?.serverName).toBe(
      "agent-native-assets",
    );
  });

  it("returns undefined for an unknown skill", () => {
    expect(resolveAppForSkill("not-a-real-skill")).toBeUndefined();
    expect(resolveAppForSkill("")).toBeUndefined();
  });
});

describe("appHasMcp", () => {
  it("is true for known skills and false otherwise", () => {
    expect(appHasMcp("visual-plan")).toBe(true);
    expect(appHasMcp("visual-recap")).toBe(true);
    expect(appHasMcp("assets")).toBe(true);
    expect(appHasMcp("content")).toBe(true);
    expect(appHasMcp("design-exploration")).toBe(true);
    expect(appHasMcp("visual-edit")).toBe(true);
    expect(appHasMcp("context-xray")).toBe(true);
    expect(appHasMcp("nope")).toBe(false);
  });
});

describe("BUILT_IN_APP_MCP registry shape", () => {
  it("only the plan app advertises the GitHub Action", () => {
    const withAction = BUILT_IN_APP_MCP.filter((app) => app.hasGithubAction);
    expect(withAction.map((app) => app.appId)).toEqual(["visual-plans"]);
  });

  it("every hosted MCP url is under its hosted base url", () => {
    for (const app of BUILT_IN_APP_MCP) {
      expect(app.mcpUrl.startsWith(app.hostedUrl)).toBe(true);
      expect(app.mcpUrl).toBe(`${app.hostedUrl}/_agent-native/mcp`);
    }
  });
});
