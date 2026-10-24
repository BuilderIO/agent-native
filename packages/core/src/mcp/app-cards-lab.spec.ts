import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Saved "labs" user settings by email; an Error stands for a failed read.
const savedLabs = vi.hoisted(
  () => new Map<string, Record<string, unknown> | Error>(),
);

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: vi.fn(async (email: string, key: string) => {
    if (key !== "labs") return null;
    const saved = savedLabs.get(email);
    if (saved instanceof Error) throw saved;
    return saved ?? null;
  }),
  mutateUserSetting: vi.fn(),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: vi.fn(async () => null),
}));
vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: vi.fn(async () => null),
}));

import { MCP_APP_CARDS_LAB } from "../labs/core-labs.js";
import { _resetLabRegistryForTests, listLabs } from "../labs/registry.js";
import { registerHostLabOverrides } from "../labs/store.js";
import {
  _resetRetiredInlineEnvWarningForTests,
  isMcpAppsInlineEnabled,
  registerMcpAppCardsLab,
} from "./app-cards-lab.js";

const RETIRED_ENV_VARS = [
  "AGENT_NATIVE_MCP_APPS_INLINE",
  "AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS",
];

function caller(userEmail: string | undefined, orgId?: string) {
  return { userEmail, orgDomain: undefined, ...(orgId ? { orgId } : {}) };
}

describe("App cards in chat apps lab", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetLabRegistryForTests();
    _resetRetiredInlineEnvWarningForTests();
    savedLabs.clear();
    for (const name of RETIRED_ENV_VARS) delete process.env[name];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    registerHostLabOverrides(null);
    for (const name of RETIRED_ENV_VARS) delete process.env[name];
    warn.mockRestore();
  });

  it("registers one lab that is off by default", async () => {
    registerMcpAppCardsLab();
    registerMcpAppCardsLab();

    expect(listLabs()).toEqual([MCP_APP_CARDS_LAB]);
    expect(MCP_APP_CARDS_LAB.defaultEnabled).toBeUndefined();
    expect(await isMcpAppsInlineEnabled(caller("alice@example.com"))).toBe(
      false,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("gives cards only to the person who turned the lab on", async () => {
    registerMcpAppCardsLab();
    savedLabs.set("alice@example.com", { [MCP_APP_CARDS_LAB.key]: true });
    savedLabs.set("carol@example.com", { [MCP_APP_CARDS_LAB.key]: false });

    expect(await isMcpAppsInlineEnabled(caller("alice@example.com"))).toBe(
      true,
    );
    expect(await isMcpAppsInlineEnabled(caller("bob@example.com"))).toBe(false);
    expect(await isMcpAppsInlineEnabled(caller("carol@example.com"))).toBe(
      false,
    );
  });

  it("reads the lab in the caller's organization", async () => {
    registerMcpAppCardsLab();
    const seen: unknown[] = [];
    registerHostLabOverrides((key, scope) => {
      seen.push({ key, orgId: scope.orgId, userEmail: scope.userEmail });
      return scope.orgId === "org_cards" ? true : undefined;
    });

    expect(
      await isMcpAppsInlineEnabled(caller("dana@example.com", "org_cards")),
    ).toBe(true);
    expect(
      await isMcpAppsInlineEnabled(caller("dana@example.com", "org_plain")),
    ).toBe(false);
    expect(seen).toEqual([
      {
        key: MCP_APP_CARDS_LAB.key,
        orgId: "org_cards",
        userEmail: "dana@example.com",
      },
      {
        key: MCP_APP_CARDS_LAB.key,
        orgId: "org_plain",
        userEmail: "dana@example.com",
      },
    ]);
  });

  it("gives no cards without an email, a registered lab, or a readable choice", async () => {
    savedLabs.set("alice@example.com", { [MCP_APP_CARDS_LAB.key]: true });
    expect(await isMcpAppsInlineEnabled(caller("alice@example.com"))).toBe(
      false,
    );

    registerMcpAppCardsLab();
    expect(await isMcpAppsInlineEnabled(undefined)).toBe(false);
    expect(await isMcpAppsInlineEnabled(caller(undefined))).toBe(false);
    expect(await isMcpAppsInlineEnabled(caller("  "))).toBe(false);

    savedLabs.set("erin@example.com", { [MCP_APP_CARDS_LAB.key]: "yes" });
    expect(await isMcpAppsInlineEnabled(caller("erin@example.com"))).toBe(
      false,
    );

    savedLabs.set("alice@example.com", new Error("settings store offline"));
    expect(await isMcpAppsInlineEnabled(caller("alice@example.com"))).toBe(
      false,
    );
  });

  it("ignores the retired env vars and warns once naming the lab", async () => {
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "1";
    process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS = "bob@example.com";

    registerMcpAppCardsLab();
    expect(await isMcpAppsInlineEnabled(caller("bob@example.com"))).toBe(false);
    expect(await isMcpAppsInlineEnabled(caller("frank@example.com"))).toBe(
      false,
    );
    registerMcpAppCardsLab();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("AGENT_NATIVE_MCP_APPS_INLINE and ");
    expect(message).toContain("AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS");
    expect(message).toContain("ignored");
    expect(message).toContain('"App cards in chat apps"');
    expect(message).toContain(MCP_APP_CARDS_LAB.key);
  });

  it("warns about a single retired env var too", async () => {
    process.env.AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS = "bob@example.com";

    expect(await isMcpAppsInlineEnabled(caller("bob@example.com"))).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /^\[mcp\] AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS is ignored\./,
    );
  });
});
