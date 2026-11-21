import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserSetting, getAppConfig } = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  getAppConfig: vi.fn(() => ({ agent: { noApprovalsEmails: [] as string[] } })),
}));
vi.mock("../settings/user-settings.js", () => ({ getUserSetting }));
vi.mock("../app-config/index.js", () => ({ getAppConfig }));

import { z } from "zod";

import {
  actionCallIntent,
  defineAction,
  preparedCallClearsReview,
  preparedCallNeedsApproval,
} from "../action.js";
import {
  NO_APPROVALS_SETTING_KEY,
  isNoApprovalsMode,
} from "./no-approvals-mode.js";

const deleteDraft = defineAction({
  description: "Delete a draft.",
  schema: z.object({ id: z.string() }),
  needsApproval: true,
  run: async ({ id }) => ({ deleted: id }),
});

async function needsApproval(userEmail: string | undefined) {
  const prepared = await actionCallIntent(deleteDraft, { id: "d1" });
  if (!prepared.valid) throw new Error("invalid fixture call");
  return preparedCallNeedsApproval(deleteDraft, prepared, {
    caller: "tool",
    userEmail,
  });
}

describe("no approvals mode", () => {
  beforeEach(() => {
    getUserSetting.mockReset();
    getAppConfig.mockReset();
    getAppConfig.mockReturnValue({ agent: { noApprovalsEmails: [] } });
  });

  it("pauses an approval-gated action when the setting is off or email is absent", async () => {
    expect(await isNoApprovalsMode(undefined)).toBe(false);
    expect(await isNoApprovalsMode("")).toBe(false);
    expect(getUserSetting).not.toHaveBeenCalled();

    getUserSetting.mockResolvedValue({ enabled: false });
    expect(await needsApproval("person@example.test")).toBe(true);
    expect(getUserSetting).toHaveBeenCalledWith(
      "person@example.test",
      NO_APPROVALS_SETTING_KEY,
    );
    expect(NO_APPROVALS_SETTING_KEY).toBe("no-approvals");
  });

  it("pauses when the user never chose or stored value is non-boolean", async () => {
    getUserSetting.mockResolvedValue(null);
    expect(await needsApproval("person@example.test")).toBe(true);

    getUserSetting.mockResolvedValue({ enabled: "yes" });
    expect(await isNoApprovalsMode("person@example.test")).toBe(false);
  });

  it("runs without a card when the setting is on", async () => {
    getUserSetting.mockResolvedValue({ enabled: true });
    expect(await needsApproval("person@example.test")).toBe(false);
  });

  it("defaults on for configured emails with case/whitespace normalization, and a stored off wins", async () => {
    getAppConfig.mockReturnValue({
      agent: { noApprovalsEmails: ["  demo@example.test  "] },
    });
    getUserSetting.mockResolvedValue(null);
    expect(await needsApproval("  Demo@Example.Test  ")).toBe(false);
    expect(await isNoApprovalsMode("other@example.test")).toBe(false);

    getUserSetting.mockResolvedValue({ enabled: false });
    expect(await needsApproval("demo@example.test")).toBe(true);
  });

  it("asks when the setting cannot be read", async () => {
    getUserSetting.mockImplementation(async (_email: string, key: string) => {
      if (key === "no-approvals") throw new Error("db down");
      return null;
    });
    expect(await isNoApprovalsMode("person@example.test")).toBe(false);
    expect(await needsApproval("person@example.test")).toBe(true);
  });

  it("clears direct-write review when on, and keeps review when off or unreadable", async () => {
    const directAction = defineAction({
      description: "Add item.",
      schema: z.object({ id: z.string() }),
      userTurn: "direct",
      needsApproval: () => true,
      run: async ({ id }) => ({ id }),
    });
    const prepared = await actionCallIntent(directAction, { id: "d1" });
    if (!prepared.valid) throw new Error("invalid fixture call");

    getUserSetting.mockResolvedValue({ enabled: true });
    expect(
      await preparedCallClearsReview(directAction, prepared, {
        caller: "mcp",
        userEmail: "person@example.test",
      }),
    ).toBe(true);

    getUserSetting.mockResolvedValue({ enabled: false });
    expect(
      await preparedCallClearsReview(directAction, prepared, {
        caller: "mcp",
        userEmail: "person@example.test",
      }),
    ).toBe(false);

    getUserSetting.mockRejectedValue(new Error("db down"));
    expect(
      await preparedCallClearsReview(directAction, prepared, {
        caller: "mcp",
        userEmail: "person@example.test",
      }),
    ).toBe(false);
  });
});
