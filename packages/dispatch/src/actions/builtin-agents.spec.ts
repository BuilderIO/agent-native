import { runWithRequestContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  role: "admin" as string | null,
  recordAudit: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (orgId: string, key: string) =>
    mocks.settings.get(`org:${orgId}:${key}`) ?? null,
  putOrgSetting: async (
    orgId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    mocks.settings.set(`org:${orgId}:${key}`, value);
  },
  getUserSetting: async (email: string, key: string) =>
    mocks.settings.get(`user:${email}:${key}`) ?? null,
  putUserSetting: async (
    email: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    mocks.settings.set(`user:${email}:${key}`, value);
  },
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async () => ({ rows: mocks.role ? [{ role: mocks.role }] : [] }),
  }),
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  recordAudit: mocks.recordAudit,
}));

import listBuiltinAgents from "./list-builtin-agents.js";
import setBuiltinAgentsEnabled from "./set-builtin-agents-enabled.js";

function asAdmin<T>(orgId: string, run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: "admin@example.test", orgId }, run);
}

function builderConfig(value: unknown): void {
  vi.stubEnv("AGENT_NATIVE_BUILTIN_AGENTS_JSON", JSON.stringify(value));
}

beforeEach(() => {
  mocks.settings.clear();
  mocks.role = "admin";
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("list-builtin-agents", () => {
  it("lists only offered built-ins with their default state", async () => {
    builderConfig({
      mode: "selected",
      include: ["mail", "calendar"],
      defaultEnabled: ["mail"],
    });

    const result = await asAdmin("org-1", () => listBuiltinAgents.run({}));

    expect(result.mode).toBe("selected");
    expect(result.canManage).toBe(true);
    expect(
      result.apps.map((app) => [app.id, app.enabled, app.isDefault]),
    ).toEqual([
      ["calendar", false, false],
      ["mail", true, true],
    ]);
    expect(result.apps[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        description: expect.any(String),
        color: expect.any(String),
      }),
    );
  });

  it('lists nothing in mode "none"', async () => {
    builderConfig({ mode: "none" });
    const result = await asAdmin("org-1", () => listBuiltinAgents.run({}));
    expect(result).toMatchObject({ mode: "none", apps: [] });
  });

  it("reports that members cannot manage the setting", async () => {
    builderConfig({ mode: "selected", include: ["mail"] });
    mocks.role = "member";
    const result = await asAdmin("org-1", () => listBuiltinAgents.run({}));
    expect(result.canManage).toBe(false);
  });
});

describe("set-builtin-agents-enabled", () => {
  it("enables offered built-ins for the current org only and audits it", async () => {
    builderConfig({
      mode: "selected",
      include: ["mail", "calendar"],
      defaultEnabled: ["mail"],
    });

    const result = await asAdmin("org-1", () =>
      setBuiltinAgentsEnabled.run({ enabledIds: ["calendar"] }),
    );
    const otherOrg = await asAdmin("org-2", () => listBuiltinAgents.run({}));

    expect(
      result.apps.filter((app) => app.enabled).map((app) => app.id),
    ).toEqual(["calendar"]);
    expect(
      otherOrg.apps.filter((app) => app.enabled).map((app) => app.id),
    ).toEqual(["mail"]);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "builtin-agents.updated",
        metadata: { enabledIds: ["calendar"] },
      }),
    );
  });

  it("rejects ids outside the builder's include", async () => {
    builderConfig({ mode: "selected", include: ["mail"] });

    await expect(
      asAdmin("org-1", () =>
        setBuiltinAgentsEnabled.run({ enabledIds: ["mail", "calendar"] }),
      ),
    ).rejects.toThrow(/not offered by this workspace: calendar/);
    expect(mocks.settings.size).toBe(0);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("rejects org members who are not owners or admins", async () => {
    builderConfig({ mode: "selected", include: ["mail"] });
    mocks.role = "member";

    await expect(
      asAdmin("org-1", () => setBuiltinAgentsEnabled.run({ enabledIds: [] })),
    ).rejects.toThrow(/owners and admins/);
    expect(mocks.settings.size).toBe(0);
  });

  it("keeps Dispatch's own built-in state when disabling everything listed", async () => {
    builderConfig({ mode: "selected", include: ["dispatch", "mail"] });

    await asAdmin("org-1", () =>
      setBuiltinAgentsEnabled.run({ enabledIds: [] }),
    );

    expect(
      mocks.settings.get("org:org-1:builtin-agents-enabled"),
    ).toMatchObject({ enabledIds: ["dispatch"] });
  });
});
