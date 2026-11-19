import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserSetting } = vi.hoisted(() => ({ getUserSetting: vi.fn() }));
vi.mock("../settings/user-settings.js", () => ({ getUserSetting }));

import { z } from "zod";

import {
  actionCallIntent,
  defineAction,
  preparedCallNeedsApproval,
} from "../action.js";

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
  const prevEnv = process.env.AGENT_NATIVE_NO_APPROVALS_EMAILS;

  beforeEach(() => {
    getUserSetting.mockReset();
    delete process.env.AGENT_NATIVE_NO_APPROVALS_EMAILS;
  });

  afterEach(() => {
    if (prevEnv === undefined) {
      delete process.env.AGENT_NATIVE_NO_APPROVALS_EMAILS;
    } else {
      process.env.AGENT_NATIVE_NO_APPROVALS_EMAILS = prevEnv;
    }
  });

  it("pauses an approval-gated action when the setting is off", async () => {
    getUserSetting.mockResolvedValue({ enabled: false });
    expect(await needsApproval("person@example.test")).toBe(true);
  });

  it("pauses when the user never chose and is not in default-on emails", async () => {
    getUserSetting.mockResolvedValue(null);
    expect(await needsApproval("person@example.test")).toBe(true);
  });

  it("runs without a card when the setting is on", async () => {
    getUserSetting.mockResolvedValue({ enabled: true });
    expect(await needsApproval("person@example.test")).toBe(false);
  });

  it("defaults on for configured emails, and a stored off wins", async () => {
    process.env.AGENT_NATIVE_NO_APPROVALS_EMAILS = "demo@example.test";
    getUserSetting.mockResolvedValue(null);
    expect(await needsApproval("Demo@Example.Test")).toBe(false);
    getUserSetting.mockResolvedValue({ enabled: false });
    expect(await needsApproval("demo@example.test")).toBe(true);
  });

  it("asks when the setting cannot be read", async () => {
    getUserSetting.mockImplementation(async (_email: string, key: string) => {
      if (key === "no-approvals") throw new Error("db down");
      return null;
    });
    expect(await needsApproval("person@example.test")).toBe(true);
  });
});
