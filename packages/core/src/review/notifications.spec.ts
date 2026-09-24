import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyActivity: vi.fn(),
  sendEmail: vi.fn(),
  queryReviewComments: vi.fn(),
  getReviewableResource: vi.fn(),
  resolveReviewableResourceAccess: vi.fn(),
  filterRecipientsByResourceAccess: vi.fn(),
  filterUnmutedReviewThreadRecipients: vi.fn(),
  reviewCommentNotificationCompleted: vi.fn(),
  markReviewCommentNotificationCompleted: vi.fn(),
  claimReviewNotificationDelivery: vi.fn(),
  finishReviewNotificationDelivery: vi.fn(),
  releaseReviewNotificationDelivery: vi.fn(),
}));

vi.mock("../server/activity-notifications.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server/activity-notifications.js")
  >("../server/activity-notifications.js");
  return {
    runActivityNotification: actual.runActivityNotification,
    notifyActivity: (...args: unknown[]) => mocks.notifyActivity(...args),
  };
});

vi.mock("../sharing/recipients.js", () => ({
  filterRecipientsByResourceAccess: (...args: unknown[]) =>
    mocks.filterRecipientsByResourceAccess(...args),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.test",
}));

vi.mock("../server/email-template.js", () => ({
  emailStrong: (value: string) => value,
  renderEmail: (args: { heading: string; paragraphs: string[] }) => ({
    html: `<h1>${args.heading}</h1>`,
    text: [args.heading, ...args.paragraphs].join("\n"),
  }),
}));

vi.mock("../server/email.js", () => ({
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
}));

vi.mock("./registry.js", () => ({
  getReviewableResource: (...args: unknown[]) =>
    mocks.getReviewableResource(...args),
  resolveReviewableResourceAccess: (...args: unknown[]) =>
    mocks.resolveReviewableResourceAccess(...args),
}));

vi.mock("./store.js", () => ({
  claimReviewNotificationDelivery: (...args: unknown[]) =>
    mocks.claimReviewNotificationDelivery(...args),
  finishReviewNotificationDelivery: (...args: unknown[]) =>
    mocks.finishReviewNotificationDelivery(...args),
  releaseReviewNotificationDelivery: (...args: unknown[]) =>
    mocks.releaseReviewNotificationDelivery(...args),
  reviewCommentNotificationCompleted: (...args: unknown[]) =>
    mocks.reviewCommentNotificationCompleted(...args),
  markReviewCommentNotificationCompleted: (...args: unknown[]) =>
    mocks.markReviewCommentNotificationCompleted(...args),
  filterUnmutedReviewThreadRecipients: (...args: unknown[]) =>
    mocks.filterUnmutedReviewThreadRecipients(...args),
  queryReviewComments: (...args: unknown[]) =>
    mocks.queryReviewComments(...args),
}));

import {
  notifyReviewComment,
  notifyReviewCommentWithReceipt,
  REVIEW_NOTIFICATION_PREFS_KEY,
} from "./notifications.js";
import type { ReviewComment } from "./types.js";

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "c1",
    resourceType: "design",
    resourceId: "design_1",
    threadId: "t1",
    parentCommentId: null,
    targetId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    body: "The spacing here is off",
    authorEmail: "reviewer@example.com",
    authorName: "Reviewer",
    createdBy: "human",
    resolutionTarget: "agent",
    mentions: [],
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    ...(overrides as Partial<ReviewComment>),
  } as ReviewComment;
}

function notifyArgs() {
  return mocks.notifyActivity.mock.calls[0]?.[0] as {
    candidates: (string | null | undefined)[];
    actorEmail?: string | null;
    preferenceKey: string;
    send: (to: string) => Promise<unknown>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notifyActivity.mockResolvedValue({
    status: "delivered",
    sent: [],
    failed: [],
  });
  mocks.reviewCommentNotificationCompleted.mockResolvedValue(false);
  mocks.claimReviewNotificationDelivery.mockResolvedValue({
    status: "claimed",
    token: "claim-1",
  });
  mocks.queryReviewComments.mockResolvedValue([]);
  mocks.filterUnmutedReviewThreadRecipients.mockImplementation(
    async (_threadId: string, recipients: string[]) => recipients,
  );
  mocks.getReviewableResource.mockReturnValue(undefined);
  // Default: everyone offered still has access. Access filtering has its own
  // tests; these assert who is *offered*.
  mocks.filterRecipientsByResourceAccess.mockImplementation(
    async ({ emails }: { emails: string[] }) =>
      [...emails].map((email) => email.trim().toLowerCase()),
  );
});

describe("notifyReviewCommentWithReceipt", () => {
  it("does not resend successful recipients when another recipient fails", async () => {
    const delivered = new Set<string>();
    mocks.notifyActivity.mockImplementation(
      async ({ send }: { send: (to: string) => Promise<void> }) => {
        const sent: string[] = [];
        const failed: { email: string; error: string }[] = [];
        for (const email of ["first@example.com", "second@example.com"]) {
          try {
            await send(email);
            sent.push(email);
          } catch (error) {
            failed.push({ email, error: String(error) });
          }
        }
        return {
          status: failed.length ? "delivered" : "delivered",
          sent,
          failed,
        };
      },
    );
    mocks.claimReviewNotificationDelivery.mockImplementation(
      async (_id: string, email: string) =>
        delivered.has(email)
          ? { status: "sent" }
          : { status: "claimed", token: email },
    );
    mocks.finishReviewNotificationDelivery.mockImplementation(
      async (_id: string, email: string) => {
        delivered.add(email);
      },
    );
    mocks.sendEmail
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error("offline");
      })
      .mockImplementationOnce(async () => {});

    expect(
      (await notifyReviewCommentWithReceipt(comment()))?.failed,
    ).toHaveLength(1);
    expect(
      (await notifyReviewCommentWithReceipt(comment()))?.failed,
    ).toHaveLength(0);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    expect(mocks.sendEmail.mock.calls.map(([input]) => input.to)).toEqual([
      "first@example.com",
      "second@example.com",
      "second@example.com",
    ]);
  });

  it("reports a receipt read failure without rejecting an already saved comment", async () => {
    mocks.reviewCommentNotificationCompleted.mockRejectedValue(
      new Error("database unavailable"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await notifyReviewCommentWithReceipt(comment()))?.status).toBe(
      "notification-error",
    );
    expect(mocks.notifyActivity).not.toHaveBeenCalled();
  });

  it("retries after a failed delivery, then suppresses a completed replay", async () => {
    mocks.notifyActivity.mockResolvedValueOnce({
      status: "delivery-failed",
      sent: [],
      failed: [{ email: "owner@example.com", error: "offline" }],
    });
    expect((await notifyReviewCommentWithReceipt(comment()))?.status).toBe(
      "delivery-failed",
    );
    expect(mocks.markReviewCommentNotificationCompleted).not.toHaveBeenCalled();

    expect((await notifyReviewCommentWithReceipt(comment()))?.status).toBe(
      "delivered",
    );
    expect(mocks.markReviewCommentNotificationCompleted).toHaveBeenCalledWith(
      "c1",
    );

    mocks.reviewCommentNotificationCompleted.mockResolvedValue(true);
    expect(await notifyReviewCommentWithReceipt(comment())).toBeNull();
    expect(mocks.notifyActivity).toHaveBeenCalledTimes(2);
  });
});

describe("notifyReviewComment", () => {
  it("honors thread mute for reply emails, including explicit mentions", async () => {
    mocks.filterUnmutedReviewThreadRecipients.mockResolvedValue([
      "participant@example.com",
    ]);
    mocks.queryReviewComments.mockResolvedValue([
      { threadId: "t1", authorEmail: "participant@example.com" },
    ]);
    await notifyReviewComment(
      comment({
        parentCommentId: "root",
        mentions: [{ label: "Owner", email: "owner@example.com" }],
      }),
    );
    expect(mocks.filterUnmutedReviewThreadRecipients).toHaveBeenCalledWith(
      "t1",
      expect.arrayContaining(["owner@example.com", "participant@example.com"]),
    );
    expect(notifyArgs().candidates).toEqual(["participant@example.com"]);
  });

  it("reports unreadable mute preferences without sending reply emails", async () => {
    mocks.filterUnmutedReviewThreadRecipients.mockRejectedValue(
      new Error("preference store unavailable"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await notifyReviewComment(
      comment({ parentCommentId: "root" }),
    );
    expect(result.status).toBe("notification-error");
    expect(mocks.notifyActivity).not.toHaveBeenCalled();
  });

  it("notifies the owner and mentions against the shared preference key", async () => {
    await notifyReviewComment(
      comment({
        mentions: [{ label: "Dana", email: "Dana@Example.com" }],
      }),
    );

    const args = notifyArgs();
    expect(args.candidates).toEqual(["owner@example.com", "dana@example.com"]);
    expect(args.actorEmail).toBe("reviewer@example.com");
    expect(args.preferenceKey).toBe(REVIEW_NOTIFICATION_PREFS_KEY);
    expect(mocks.queryReviewComments).not.toHaveBeenCalled();
  });

  it("adds thread participants on a reply", async () => {
    mocks.queryReviewComments.mockResolvedValue([
      { threadId: "t1", authorEmail: "first@example.com" },
      { threadId: "other", authorEmail: "unrelated@example.com" },
    ]);

    await notifyReviewComment(comment({ parentCommentId: "c0" }));

    expect(notifyArgs().candidates).toEqual([
      "owner@example.com",
      "first@example.com",
    ]);
  });

  it("uses the registered deep link when the resource provides one", async () => {
    mocks.getReviewableResource.mockReturnValue({
      type: "design",
      displayName: "design",
      resolveUrl: (id: string) => `https://app.test/design/${id}`,
    });

    await notifyReviewComment(comment());
    await notifyArgs().send("owner@example.com");

    const email = mocks.sendEmail.mock.calls[0][0] as { text: string };
    expect(email.text).toContain("The spacing here is off");
    expect(mocks.getReviewableResource).toHaveBeenCalledWith("design");
  });

  it("drops recipients who can no longer open the resource", async () => {
    mocks.filterRecipientsByResourceAccess.mockResolvedValue([
      "owner@example.com",
    ]);

    await notifyReviewComment(
      comment({
        mentions: [{ label: "Outsider", email: "outsider@evil.test" }],
      }),
    );

    expect(notifyArgs().candidates).toEqual(["owner@example.com"]);
    const filterArgs = mocks.filterRecipientsByResourceAccess.mock
      .calls[0][0] as { emails: string[]; resourceId: string };
    expect(filterArgs.emails).toContain("outsider@evil.test");
    expect(filterArgs.resourceId).toBe("design_1");
  });

  it("reports a resolution failure instead of failing the comment write", async () => {
    mocks.notifyActivity.mockRejectedValue(new Error("settings store down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyReviewComment(comment());

    expect(result.status).toBe("notification-error");
  });
});
