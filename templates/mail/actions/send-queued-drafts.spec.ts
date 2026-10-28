import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimQueuedDraftForSending: vi.fn(),
  listQueuedDrafts: vi.fn(),
  markQueuedDraftSent: vi.fn(),
  releaseQueuedDraftClaim: vi.fn(),
  requiresEmailSendApproval: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../server/lib/automation-settings.js", () => ({
  requiresEmailSendApproval: mocks.requiresEmailSendApproval,
}));

vi.mock("../server/lib/queued-drafts.js", () => ({
  claimQueuedDraftForSending: mocks.claimQueuedDraftForSending,
  listQueuedDrafts: mocks.listQueuedDrafts,
  markQueuedDraftSent: mocks.markQueuedDraftSent,
  releaseQueuedDraftClaim: mocks.releaseQueuedDraftClaim,
}));

vi.mock("./send-email.js", () => ({
  default: { run: mocks.sendEmail },
}));

import action from "./send-queued-drafts";

function queuedDraft(id: string, to = `${id}@example.com`) {
  return {
    id,
    to,
    cc: null,
    bcc: null,
    subject: "A queued message",
    body: "Message body",
    accountEmail: null,
    status: "queued",
  };
}

function sendClaim(id: string, to = `${id}@example.com`) {
  return {
    claimed: true,
    ctx: { orgId: "org-1" },
    draft: queuedDraft(id, to),
    claimId: `claim-${id}`,
    priorStatus: "queued",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requiresEmailSendApproval.mockResolvedValue(false);
  mocks.listQueuedDrafts.mockResolvedValue([]);
  mocks.markQueuedDraftSent.mockResolvedValue(undefined);
  mocks.releaseQueuedDraftClaim.mockResolvedValue(undefined);
});

describe("send-queued-drafts action", () => {
  it("reports a failed send as an action error", async () => {
    mocks.claimQueuedDraftForSending.mockResolvedValueOnce(sendClaim("qd-1"));
    mocks.sendEmail.mockRejectedValueOnce(new Error("Gmail send failed"));

    await expect(
      action.run({ id: "qd-1" }, { caller: "tool" }),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "queued_draft_send_failed",
      message: "Failed to send queued draft: qd-1: Gmail send failed",
    });

    expect(mocks.releaseQueuedDraftClaim).toHaveBeenCalledWith(
      "qd-1",
      { orgId: "org-1" },
      "claim-qd-1",
      "queued",
    );
    expect(mocks.markQueuedDraftSent).not.toHaveBeenCalled();
  });

  it("keeps per-draft outcomes when an all-send partially succeeds", async () => {
    mocks.listQueuedDrafts.mockResolvedValue([
      queuedDraft("qd-sent", "sent@example.com"),
      queuedDraft("qd-failed", "failed@example.com"),
    ]);
    mocks.claimQueuedDraftForSending.mockImplementation(async (id: string) =>
      sendClaim(
        id,
        id === "qd-sent" ? "sent@example.com" : "failed@example.com",
      ),
    );
    mocks.sendEmail.mockImplementation(async ({ to }: { to: string }) => {
      if (to === "failed@example.com") throw new Error("Gmail send failed");
      return "Email sent successfully (id: gmail-message-1)";
    });
    mocks.markQueuedDraftSent.mockResolvedValue(queuedDraft("qd-sent"));

    const result = await action.run({ all: true }, { caller: "tool" });

    expect(result).toMatchObject({
      sent: [
        { outcome: "sent", id: "qd-sent", sentMessageId: "gmail-message-1" },
      ],
      failed: [{ id: "qd-failed", error: "Gmail send failed" }],
    });
  });
});
