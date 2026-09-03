import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  createScheduledJobRecord: vi.fn(),
  requiresEmailSendApproval: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/automation-settings.js", () => ({
  requiresEmailSendApproval: mocks.requiresEmailSendApproval,
}));

vi.mock("../server/lib/jobs.js", () => ({
  createScheduledJobRecord: mocks.createScheduledJobRecord,
}));

import snoozeAction from "./create-scheduled-job.js";
import action from "./create-scheduled-send.js";

describe("scheduled mail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.requiresEmailSendApproval.mockResolvedValue(true);
    mocks.createScheduledJobRecord.mockResolvedValue({ id: "job-1" });
  });

  it("keeps snooze page-local and exposes scheduled sends behind approval", async () => {
    expect(snoozeAction.needsApproval).toBeUndefined();
    expect(
      snoozeAction.schema.safeParse({
        type: "send_later",
        runAt: Date.now() + 60_000,
      }).success,
    ).toBe(false);
    expect(typeof action.needsApproval).toBe("function");
    if (typeof action.needsApproval !== "function") return;
    await expect(
      action.needsApproval({ runAt: Date.now() + 60_000 }, { caller: "mcp" }),
    ).resolves.toBe(true);
  });

  it("does not persist an unapproved automation schedule", async () => {
    await expect(
      action.run(
        { runAt: Date.now() + 60_000 },
        { caller: "automation", userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("Automation email sending is disabled");
    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });
});
