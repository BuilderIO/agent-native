import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => null,
}));
vi.mock("../server/lib/jobs.js", () => ({
  confirmUncertainScheduledJobSentForOwner: vi.fn(),
  retryUncertainScheduledJobForOwner: vi.fn(),
  sendScheduledJobNowForOwner: vi.fn(),
}));

import confirmUncertainScheduledEmail from "./confirm-uncertain-scheduled-email.js";
import retryUncertainScheduledEmail from "./retry-uncertain-scheduled-email.js";

describe("uncertain scheduled email actions", () => {
  it("requires the signed-in app UI for duplicate-risk recovery", async () => {
    expect(retryUncertainScheduledEmail.uiOnly).toBe(true);
    await expect(
      retryUncertainScheduledEmail.run(
        { id: "scheduled-send", duplicateRiskAcknowledged: true },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({ errorCode: "ui_only_action", statusCode: 403 });
  });

  it("requires the signed-in app UI to confirm a message in Sent", async () => {
    expect(confirmUncertainScheduledEmail.uiOnly).toBe(true);
    await expect(
      confirmUncertainScheduledEmail.run(
        { id: "scheduled-send", verifiedInSent: true },
        { caller: "tool" },
      ),
    ).rejects.toMatchObject({ errorCode: "ui_only_action", statusCode: 403 });
  });
});
