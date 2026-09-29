import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn((): string | null => null),
  confirmUncertainScheduledJobSentForOwner: vi.fn(),
  retryUncertainScheduledJobForOwner: vi.fn(),
  sendScheduledJobNowForOwner: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/jobs.js", () => ({
  confirmUncertainScheduledJobSentForOwner:
    mocks.confirmUncertainScheduledJobSentForOwner,
  retryUncertainScheduledJobForOwner: mocks.retryUncertainScheduledJobForOwner,
  sendScheduledJobNowForOwner: mocks.sendScheduledJobNowForOwner,
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

  it("uses provider-neutral instructions for Sent confirmation", async () => {
    expect(confirmUncertainScheduledEmail.tool.description).toContain(
      "Mail's Sent view",
    );
    expect(confirmUncertainScheduledEmail.tool.description).not.toMatch(
      /gmail/i,
    );
    expect(
      confirmUncertainScheduledEmail.schema.shape.verifiedInSent.description,
    ).toContain("Mail's Sent view");

    mocks.getRequestUserEmail.mockReturnValue("alice@example.com");
    mocks.confirmUncertainScheduledJobSentForOwner.mockResolvedValue({
      id: "scheduled-send",
    });

    await expect(
      confirmUncertainScheduledEmail.run(
        { id: "scheduled-send", verifiedInSent: true },
        { caller: "frontend" },
      ),
    ).resolves.toContain("Mail's Sent view");
  });
});
