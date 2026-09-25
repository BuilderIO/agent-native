import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSettingsRoute } from "../../../navigation/index.js";
import { CORE_SETTINGS_PAGES } from "./core-pages.js";
import { defineSettingsPage, type SettingsPageDefinition } from "./registry.js";
import {
  resolveSettingsRoute,
  resolveSettingsTabValue,
  settingsPagePath,
  settingsPathSegments,
  type SettingsLocation,
} from "./routing.js";

const Stub = () => null;

/** A template's own tabs, as the bridge turns them into app pages (Mail). */
const appPage = (id: string, tabId = id): SettingsPageDefinition =>
  defineSettingsPage({
    id,
    group: "app",
    order: 11,
    label: id,
    icon: Stub,
    component: Stub,
    legacyTabIds: [tabId],
  });

const MAIL_PAGES = [
  ...CORE_SETTINGS_PAGES,
  appPage("drafting"),
  appPage("app-automations", "automations"),
];
const FORMS_PAGES = [...CORE_SETTINGS_PAGES, appPage("extensions")];

function resolve(
  pathname: string,
  hash = "",
  rest: Partial<SettingsLocation> = {},
  pages: readonly SettingsPageDefinition[] = CORE_SETTINGS_PAGES,
) {
  return resolveSettingsRoute({ pathname, hash, ...rest }, pages);
}

describe("settings shell routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves new page ids and their sub-pages without rewriting them", () => {
    expect(resolve("/settings/profile")).toEqual({
      page: "profile",
      sub: null,
      anchor: null,
      legacy: false,
    });
    expect(resolve("/settings/integrations/builder")).toMatchObject({
      page: "integrations",
      sub: "builder",
      legacy: false,
    });
    expect(resolve("/settings/app/recordings")).toMatchObject({
      page: "app",
      sub: "recordings",
      legacy: false,
    });
    // New ids win over a section of the same name.
    expect(resolve("/settings/auth")).toMatchObject({
      page: "auth",
      legacy: false,
    });
    expect(resolve("/settings/model", "#limits")).toMatchObject({
      page: "model",
      anchor: "limits",
      legacy: false,
    });
  });

  it("leaves bare /settings unresolved so the shell opens its default", () => {
    expect(resolve("/settings")).toMatchObject({ page: null, sub: null });
  });

  it("reports an unknown id as named so the shell can redirect it", () => {
    expect(resolve("/settings/not-a-page")).toEqual({
      page: "not-a-page",
      sub: null,
      anchor: null,
      legacy: false,
    });
  });

  it("strips a workspace mount prefix", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([{ id: "dispatch", path: "/dispatch" }]),
    );
    vi.stubGlobal("window", {
      location: { pathname: "/dispatch/settings/model" },
    });
    expect(settingsPathSegments("/dispatch/settings/model")).toEqual(["model"]);
    expect(resolve("/dispatch/settings/agent").page).toBe("model");
  });

  it("builds page paths", () => {
    expect(settingsPagePath("api-keys")).toBe("/settings/api-keys");
    expect(settingsPagePath("channels", "slack")).toBe(
      "/settings/channels/slack",
    );
    expect(settingsPagePath("app", null)).toBe("/settings/app");
  });
});

// Every link that works today, and where it lands now. `legacy: true` means
// the shell rewrites the URL to the page's own path.
describe("legacy settings links", () => {
  it.each([
    // Today's tab links, including the e2e paths.
    ["/settings/general", "", "app", null, null],
    ["/settings/account", "", "profile", null, null],
    ["/settings/language", "", "preferences", null, null],
    ["/settings/agent", "", "model", null, null],
    ["/settings/providers", "", "model", null, null],
    ["/settings/agent/resources", "", "files", null, null],
    ["/settings/agent/resources/files", "", "files", null, null],
    ["/settings/agent/resources/instructions", "", "instructions", null, null],
    ["/settings/agent/resources/memory", "", "memory", null, null],
    ["/settings/agent/resources/learnings", "", "memory", null, "learnings"],
    ["/settings/agent/resources/skills", "", "skills", null, null],
    ["/settings/agent/resources/agents", "", "sub-agents", null, null],
    ["/settings/agent/automations", "", "automations", null, null],
    ["/settings/agent/agents", "", "sub-agents", null, null],
    ["/settings/agent/directory", "", "sub-agents", null, null],
    ["/settings/agent/llm", "", "model", null, "llm"],
    ["/settings/agent/limits", "", "model", null, "limits"],
    ["/settings/agent/voice", "", "preferences", null, "voice"],
    ["/settings/organization", "", "org", null, null],
    ["/settings/team", "", "members", null, null],
    ["/settings/keys", "", "api-keys", null, null],
    ["/settings/secrets", "", "api-keys", null, null],
    ["/settings/connections", "", "integrations", null, null],
    ["/settings/workspace", "", "infra", null, null],
    ["/settings/library", "", "creative-context", null, null],
    ["/settings/changelog", "", "whats-new", null, null],
    ["/settings/experiments", "", "labs", null, null],
    ["/settings/labs/lab-meetings", "", "labs", null, "lab-meetings"],
    // Broken today: a key under Integrations lands on Integrations.
    [
      "/settings/integrations/secrets/OPENAI_API_KEY",
      "",
      "api-keys",
      null,
      "secrets:OPENAI_API_KEY",
    ],
    // A row hash on a legacy path survives the rewrite (Clips).
    ["/settings/general", "#ai-providers", "app", null, "ai-providers"],
    ["/settings/agent", "#llm", "model", null, "llm"],
    // Hashes on bare /settings.
    ["/settings", "#organization", "org", null, null],
    ["/settings", "#team", "members", null, null],
    ["/settings", "#agent", "model", null, null],
    ["/settings", "#agent:resources", "files", null, null],
    ["/settings", "#llm", "model", null, "llm"],
    ["/settings", "#agent-limits", "model", null, "limits"],
    ["/settings", "#voice", "preferences", null, "voice"],
    ["/settings", "#integrations", "integrations", null, null],
    ["/settings", "#workspace", "infra", null, null],
    ["/settings", "#browser", "integrations", "builder", null],
    ["/settings", "#usage", "usage", null, null],
    [
      "/settings",
      "#secrets:FIGMA_ACCESS_TOKEN",
      "api-keys",
      null,
      "secrets:FIGMA_ACCESS_TOKEN",
    ],
    ["/settings", "#labs:lab-meetings", "labs", null, "lab-meetings"],
  ])("%s%s opens %s", (pathname, hash, page, sub, anchor) => {
    expect(resolve(pathname, hash)).toEqual({
      page,
      sub,
      anchor,
      legacy: true,
    });
  });

  it("opens the key a built secret route names", () => {
    const route = buildSettingsRoute(
      "integrations:secrets:GOOGLE_APPLICATION_CREDENTIALS",
    );
    expect(resolve(route)).toEqual({
      page: "api-keys",
      sub: null,
      anchor: "secrets:GOOGLE_APPLICATION_CREDENTIALS",
      legacy: true,
    });
  });

  it("keeps OAuth callbacks and emailed links on their page", () => {
    expect(
      resolve("/settings/integrations", "", { search: "?connected=slack" }),
    ).toMatchObject({ page: "integrations", legacy: false });
    expect(resolve("/settings/notifications")).toMatchObject({
      page: "notifications",
      legacy: false,
    });
  });

  it("sends /extensions to the app's Extensions page, else its General page", () => {
    expect(resolve("/settings/extensions", "", {}, FORMS_PAGES)).toMatchObject({
      page: "extensions",
      legacy: false,
    });
    expect(resolve("/settings/extensions")).toMatchObject({
      page: "app",
      legacy: true,
    });
  });

  it("reads ?section= as the template's own tab id", () => {
    const section = (value: string) =>
      resolve("/settings", "", { search: `?section=${value}` }, MAIL_PAGES);
    expect(section("drafting")).toMatchObject({
      page: "drafting",
      legacy: true,
    });
    // Mail's inbox rules, not the core Automations page.
    expect(section("automations")).toMatchObject({ page: "app-automations" });
    // Broken today: Mail's /team sends ?section=team, which has no tab.
    expect(section("team")).toMatchObject({ page: "members" });
    expect(section("general")).toMatchObject({ page: "app" });
    expect(section("agent")).toMatchObject({ page: "model" });
  });

  it("routes app areas under the app's General page", () => {
    expect(
      resolveSettingsTabValue("recordings", CORE_SETTINGS_PAGES, [
        "recordings",
      ]),
    ).toMatchObject({ page: "app", sub: "recordings" });
  });

  it("prefers the agent panel's section over the hash it navigated to", () => {
    // The panel sends `secrets` to #integrations for today's Settings.
    expect(
      resolve("/settings", "#integrations", { section: "secrets" }),
    ).toMatchObject({ page: "api-keys", legacy: true });
    expect(
      resolve("/settings", "#workspace", { section: "workspace-settings" }),
    ).toMatchObject({ page: "org" });
    expect(
      resolve("/settings", "#secrets:OPENAI_API_KEY", { section: "secrets" }),
    ).toMatchObject({ page: "api-keys", anchor: "secrets:OPENAI_API_KEY" });
  });

  it("opens the template's chosen tab on a bare /settings", () => {
    expect(
      resolveSettingsRoute({ pathname: "/settings", hash: "" }, MAIL_PAGES, {
        tabValue: "drafting",
      }),
    ).toMatchObject({ page: "drafting", legacy: true });
  });
});
