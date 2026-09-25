import { describe, expect, it } from "vitest";

import {
  buildLegacyAgentSettingsRoute,
  buildSettingsEntryRoute,
  buildSettingsRedirectRoute,
  buildSettingsRoute,
} from "./index.js";
import {
  CORE_SETTINGS_PAGE_ID_LIST,
  describeSettingsViewForAgent,
  isSettingsSectionId,
  legacySettingsTabIdsForPage,
  resolveLegacySettingsId,
  resolveSettingsIdPattern,
  resolveSettingsSectionRedirect,
} from "./settings-redirects.js";

describe("buildSettingsRoute", () => {
  it("builds page and sub-page routes", () => {
    expect(buildSettingsRoute("model")).toBe("/settings/model");
    expect(buildSettingsRoute("integrations", "builder")).toBe(
      "/settings/integrations/builder",
    );
    expect(buildSettingsRoute("channels", "slack")).toBe(
      "/settings/channels/slack",
    );
    expect(buildSettingsRoute("app", "recordings")).toBe(
      "/settings/app/recordings",
    );
    expect(buildSettingsRoute("org")).toBe("/settings/org");
  });

  it("keeps today's a:b:c ids and the base-path argument working", () => {
    expect(buildSettingsRoute("agent:resources:files")).toBe(
      "/settings/agent/resources/files",
    );
    expect(buildSettingsRoute("agent:agents", "/settings")).toBe(
      "/settings/agent/agents",
    );
    expect(buildSettingsRoute("team")).toBe("/settings/organization");
    expect(buildSettingsRoute("model", null, { basePath: "/admin" })).toBe(
      "/admin/model",
    );
  });

  it("appends an anchor", () => {
    expect(buildSettingsRoute("model", null, { anchor: "limits" })).toBe(
      "/settings/model#limits",
    );
    expect(
      buildSettingsRedirectRoute({
        page: "api-keys",
        anchor: "secrets:OPENAI_API_KEY",
      }),
    ).toBe("/settings/api-keys#secrets:OPENAI_API_KEY");
  });

  it("keeps a secret key's case so the route opens that key", () => {
    const route = buildSettingsRoute("integrations:secrets:OPENAI_API_KEY");
    expect(route).toBe("/settings/integrations/secrets/OPENAI_API_KEY");
    expect(buildSettingsRoute("secrets:GOOGLE_APPLICATION_CREDENTIALS")).toBe(
      "/settings/secrets/GOOGLE_APPLICATION_CREDENTIALS",
    );
    expect(buildSettingsRoute("Integrations:Secrets:OPENAI_API_KEY")).toBe(
      "/settings/integrations/secrets/OPENAI_API_KEY",
    );
    const segments = route.replace(/^\/settings\//, "").split("/");
    expect(resolveSettingsIdPattern(segments.join(":"))).toEqual({
      page: "api-keys",
      anchor: "secrets:OPENAI_API_KEY",
    });
  });

  it("builds today's search-entry routes", () => {
    expect(buildSettingsEntryRoute("agent", "limits")).toBe(
      "/settings/agent/limits",
    );
    expect(
      buildSettingsEntryRoute("agent:resources", "agent:resources:memory"),
    ).toBe("/settings/agent/resources/memory");
    expect(buildSettingsEntryRoute("general", "general")).toBe(
      "/settings/general",
    );
  });
});

describe("legacy settings redirect table", () => {
  it.each([
    // Tab ids (STANDARD_SETTINGS_TABS, useAgentSettingsTabs, built-ins).
    ["general", "app"],
    ["account", "profile"],
    ["language", "preferences"],
    ["agent", "model"],
    ["agent:overview", "model"],
    ["providers", "model"],
    ["connections", "integrations"],
    ["integrations", "integrations"],
    ["keys", "api-keys"],
    ["secrets", "api-keys"],
    ["organization", "org"],
    ["team", "members"],
    ["workspace", "infra"],
    ["library", "creative-context"],
    ["experiments", "labs"],
    ["changelog", "whats-new"],
    ["updates", "whats-new"],
    ["what-s-new", "whats-new"],
    ["agent:resources", "files"],
    ["agent:resources:files", "files"],
    ["agent:resources:instructions", "instructions"],
    ["agent:resources:memory", "memory"],
    ["agent:resources:skills", "skills"],
    ["agent:resources:agents", "sub-agents"],
    ["agent:resources:remote-agents", "sub-agents"],
    ["agent:agents", "sub-agents"],
    ["agent:directory", "sub-agents"],
    ["agent:automations", "automations"],
    ["agent:resources:unknown-view", "files"],
    ["agent:unknown", "model"],
  ])("tab %s opens %s", (id, page) => {
    expect(resolveLegacySettingsId(id, "tab")?.page).toBe(page);
  });

  it.each([
    ["agent:llm", { page: "model", anchor: "llm" }],
    ["agent:limits", { page: "model", anchor: "limits" }],
    ["agent:voice", { page: "preferences", anchor: "voice" }],
    ["agent:app-models", { page: "app", anchor: "app-models" }],
    ["agent:background", { page: "infra", anchor: "background" }],
    ["agent:resources:learnings", { page: "memory", anchor: "learnings" }],
    ["labs:lab-meetings", { page: "labs", anchor: "lab-meetings" }],
    [
      "experiments:experiment-meetings",
      { page: "labs", anchor: "lab-meetings" },
    ],
    ["experiment-meetings", { page: "labs", anchor: "lab-meetings" }],
    ["browser", { page: "integrations", sub: "builder" }],
  ])("nested id %s keeps its target", (id, target) => {
    expect(resolveLegacySettingsId(id, "tab")).toMatchObject(target);
  });

  it("focuses a key named in any of today's secrets forms, keeping its case", () => {
    for (const id of [
      "secrets:OPENAI_API_KEY",
      "#secrets:OPENAI_API_KEY",
      "keys:OPENAI_API_KEY",
      "integrations:secrets:OPENAI_API_KEY",
    ]) {
      expect(resolveLegacySettingsId(id)).toEqual({
        page: "api-keys",
        anchor: "secrets:OPENAI_API_KEY",
      });
    }
    expect(resolveLegacySettingsId("integrations:secrets")).toEqual({
      page: "api-keys",
    });
  });

  it("sends /extensions to the app's Extensions page, else its General page", () => {
    expect(resolveLegacySettingsId("extensions")).toEqual({
      page: "extensions",
      fallbackPage: "app",
    });
  });

  it("reads a colliding id as a section for hashes and a tab for paths", () => {
    expect(resolveLegacySettingsId("workspace-settings", "section")?.page).toBe(
      "org",
    );
    expect(resolveLegacySettingsId("auth", "section")).toEqual({
      page: "infra",
      anchor: "auth",
    });
  });

  it("names nothing for an unknown id", () => {
    expect(resolveLegacySettingsId("not-a-tab")).toBeNull();
    expect(resolveLegacySettingsId("")).toBeNull();
  });

  it("maps every /agent# hash buildLegacyAgentSettingsRoute emits", () => {
    const cases: Array<[string, string]> = [
      ["", "model"],
      ["#files", "files"],
      ["#instructions", "instructions"],
      ["#agents", "sub-agents"],
      ["#memory", "memory"],
      ["#skills", "skills"],
      ["#learnings", "memory"],
      ["#remote-agents", "sub-agents"],
      ["#connections", "integrations"],
      ["#jobs", "automations"],
      ["#library", "creative-context"],
      ["#access", "mcp"],
      ["#llm", "model"],
      ["#app-models", "app"],
      ["#limits", "model"],
      ["#voice", "preferences"],
      ["#background", "infra"],
    ];
    for (const [hash, page] of cases) {
      const route = buildLegacyAgentSettingsRoute(hash).replace(
        /^\/settings\//,
        "",
      );
      const id = route.split("/").join(":");
      expect(
        resolveLegacySettingsId(id)?.page ?? id,
        `${hash} → ${route}`,
      ).toBe(page);
    }
  });
});

describe("agent-panel:open-settings sections", () => {
  it.each([
    ["llm", { page: "model", anchor: "llm" }],
    ["app-models", { page: "app", anchor: "app-models" }],
    ["limits", { page: "model", anchor: "limits" }],
    ["voice", { page: "preferences", anchor: "voice" }],
    ["demo-mode", { page: "app", anchor: "demo-mode" }],
    ["automations", { page: "automations" }],
    ["secrets", { page: "api-keys" }],
    ["hosting", { page: "infra", anchor: "hosting" }],
    ["database", { page: "infra", anchor: "database" }],
    ["uploads", { page: "infra", anchor: "uploads" }],
    ["auth", { page: "infra", anchor: "auth" }],
    ["email", { page: "channels", anchor: "email" }],
    ["browser", { page: "integrations", sub: "builder" }],
    ["background", { page: "infra", anchor: "background" }],
    ["integrations", { page: "integrations" }],
    ["usage", { page: "usage" }],
    ["a2a", { page: "sub-agents" }],
    ["workspace-settings", { page: "org" }],
    ["account", { page: "profile" }],
    ["organization", { page: "org" }],
    ["agent-engine", { page: "model", anchor: "llm" }],
    ["agent-limits", { page: "model", anchor: "limits" }],
    ["loop-settings", { page: "model", anchor: "limits" }],
    ["models", { page: "app", anchor: "app-models" }],
    [
      "secrets:FIGMA_ACCESS_TOKEN",
      {
        page: "api-keys",
        anchor: "secrets:FIGMA_ACCESS_TOKEN",
      },
    ],
    ["mcp", { page: "mcp" }],
  ])("section %s opens %o", (section, target) => {
    expect(resolveSettingsSectionRedirect(section)).toEqual(target);
  });

  it("uses the hash a caller set before dispatching without a section", () => {
    // run-recovery.tsx and TiptapComposer.tsx set the hash, then dispatch.
    expect(resolveSettingsSectionRedirect(undefined, "#agent-limits")).toEqual({
      page: "model",
      anchor: "limits",
    });
    expect(resolveSettingsSectionRedirect(null, "#llm")).toEqual({
      page: "model",
      anchor: "llm",
    });
  });

  it("keeps the key a caller put in the hash for a plain secrets request", () => {
    expect(
      resolveSettingsSectionRedirect("secrets", "#secrets:OPENAI_API_KEY"),
    ).toEqual({ page: "api-keys", anchor: "secrets:OPENAI_API_KEY" });
  });

  it("opens Model for an unknown or missing section, as #agent did", () => {
    expect(resolveSettingsSectionRedirect("nope")).toEqual({ page: "model" });
    expect(resolveSettingsSectionRedirect(undefined, "#comments")).toEqual({
      page: "model",
    });
  });

  it("recognizes section ids and their old spellings", () => {
    expect(isSettingsSectionId("agent-limits")).toBe(true);
    expect(isSettingsSectionId("llm")).toBe(true);
    expect(isSettingsSectionId("comments")).toBe(false);
  });
});

describe("the agent's view of Settings", () => {
  it("names the open page and sub-page for <current-url>", () => {
    expect(
      describeSettingsViewForAgent({
        page: "integrations",
        sub: "builder",
        label: "Connections › Integrations",
      }),
    ).toBe("settingsPage: integrations/builder (Connections › Integrations)");
    expect(
      describeSettingsViewForAgent({ page: "model", sub: null, label: null }),
    ).toBe("settingsPage: model");
  });

  it("ignores a value that isn't a Settings view", () => {
    expect(describeSettingsViewForAgent(null)).toBeNull();
    expect(describeSettingsViewForAgent({ page: "" })).toBeNull();
    expect(describeSettingsViewForAgent("model")).toBeNull();
  });
});

describe("new page ids in today's tabbed Settings", () => {
  it("names a tab for every core page", () => {
    for (const page of CORE_SETTINGS_PAGE_ID_LIST) {
      expect(legacySettingsTabIdsForPage(page).length, page).toBeGreaterThan(0);
    }
  });

  it("prefers an app area tab for app sub-pages", () => {
    expect(legacySettingsTabIdsForPage("app", "recordings")).toEqual([
      "recordings",
      "general",
    ]);
    expect(legacySettingsTabIdsForPage("model")).toEqual(["agent"]);
    expect(legacySettingsTabIdsForPage("api-keys")).toEqual([
      "keys",
      "secrets",
    ]);
  });
});
