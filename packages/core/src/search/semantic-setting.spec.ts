import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const orgSettings = vi.hoisted(() => ({
  getOrgSetting: vi.fn(),
  mutateOrgSetting: vi.fn(),
}));
vi.mock("../settings/org-settings.js", () => orgSettings);

import {
  readSemanticSearchSetting,
  SEMANTIC_SEARCH_SETTING_KEY,
  writeSemanticSearchSetting,
} from "./semantic-setting.js";

beforeEach(() => {
  orgSettings.getOrgSetting.mockReset();
  orgSettings.mutateOrgSetting.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readSemanticSearchSetting", () => {
  it("is on when nothing is stored", async () => {
    orgSettings.getOrgSetting.mockResolvedValue(null);
    await expect(readSemanticSearchSetting("org-a")).resolves.toEqual({
      enabled: true,
      updatedAt: null,
      updatedBy: null,
    });
    expect(orgSettings.getOrgSetting).toHaveBeenCalledWith(
      "org-a",
      "semantic-search",
      undefined,
    );
    expect(SEMANTIC_SEARCH_SETTING_KEY).toBe("semantic-search");
  });

  it("is off only when stored as false", async () => {
    orgSettings.getOrgSetting.mockResolvedValue({
      enabled: false,
      updatedAt: "2026-11-11T00:00:00.000Z",
      updatedBy: "admin@a.com",
    });
    await expect(readSemanticSearchSetting("org-a")).resolves.toEqual({
      enabled: false,
      updatedAt: "2026-11-11T00:00:00.000Z",
      updatedBy: "admin@a.com",
    });
    for (const enabled of [true, 0, "false", null, undefined]) {
      orgSettings.getOrgSetting.mockResolvedValue({ enabled });
      expect((await readSemanticSearchSetting("org-a")).enabled).toBe(true);
    }
  });

  it("ignores who and when unless they are text", async () => {
    orgSettings.getOrgSetting.mockResolvedValue({
      enabled: false,
      updatedAt: 1_700_000_000,
      updatedBy: { email: "admin@a.com" },
    });
    await expect(readSemanticSearchSetting("org-a")).resolves.toEqual({
      enabled: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("skips the request's settings snapshot only when asked for a fresh read", async () => {
    orgSettings.getOrgSetting.mockResolvedValue(null);
    await readSemanticSearchSetting("org-b", { fresh: true });
    await readSemanticSearchSetting("org-b", { fresh: false });
    expect(orgSettings.getOrgSetting.mock.calls).toEqual([
      ["org-b", "semantic-search", { bypassCache: true }],
      ["org-b", "semantic-search", undefined],
    ]);
  });

  it("throws when the setting can't be read", async () => {
    orgSettings.getOrgSetting.mockRejectedValue(new Error("settings down"));
    await expect(readSemanticSearchSetting("org-a")).rejects.toThrow(
      "settings down",
    );
  });
});

describe("writeSemanticSearchSetting", () => {
  it("stores who turned it off and when, and returns the setting before and after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
    let written: Record<string, unknown> | undefined;
    orgSettings.mutateOrgSetting.mockImplementation(
      async (
        _orgId: string,
        _key: string,
        update: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown>,
      ) => {
        written = update({
          enabled: true,
          updatedAt: "2026-11-01T00:00:00.000Z",
          updatedBy: "owner@a.com",
        });
        return written;
      },
    );
    const result = await writeSemanticSearchSetting("org-a", {
      enabled: false,
      updatedBy: "admin@a.com",
    });
    expect(orgSettings.mutateOrgSetting).toHaveBeenCalledWith(
      "org-a",
      "semantic-search",
      expect.any(Function),
    );
    expect(written).toEqual({
      enabled: false,
      updatedAt: "2026-11-11T12:00:00.000Z",
      updatedBy: "admin@a.com",
    });
    expect(result).toEqual({
      before: {
        enabled: true,
        updatedAt: "2026-11-01T00:00:00.000Z",
        updatedBy: "owner@a.com",
      },
      after: {
        enabled: false,
        updatedAt: "2026-11-11T12:00:00.000Z",
        updatedBy: "admin@a.com",
      },
    });
  });

  it("reports the default as before when nothing was stored", async () => {
    orgSettings.mutateOrgSetting.mockImplementation(
      async (
        _orgId: string,
        _key: string,
        update: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown>,
      ) => update(null),
    );
    const result = await writeSemanticSearchSetting("org-a", {
      enabled: true,
      updatedBy: "admin@a.com",
    });
    expect(result.before).toEqual({
      enabled: true,
      updatedAt: null,
      updatedBy: null,
    });
    expect(result.after.enabled).toBe(true);
    expect(result.after.updatedBy).toBe("admin@a.com");
  });

  it("reports the stored result, not what it asked to store", async () => {
    orgSettings.mutateOrgSetting.mockResolvedValue({
      enabled: true,
      updatedAt: "later",
      updatedBy: "someone@a.com",
    });
    const result = await writeSemanticSearchSetting("org-a", {
      enabled: false,
      updatedBy: "admin@a.com",
    });
    expect(result).toEqual({
      before: { enabled: true, updatedAt: null, updatedBy: null },
      after: { enabled: true, updatedAt: "later", updatedBy: "someone@a.com" },
    });
  });
});
