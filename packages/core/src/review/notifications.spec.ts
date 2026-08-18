import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyActivity: vi.fn(),
  sendEmail: vi.fn(),
  queryReviewComments: vi.fn(),
  getReviewableResource: vi.fn(),
  resolveReviewableResourceAccess: vi.fn(),
  filterRecipientsByResourceAccess: vi.fn(),
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
  queryReviewComments: (...args: unknown[]) =>
    mocks.queryReviewComments(...args),
}));

import {
  notifyReviewComment,
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
  mocks.queryReviewComments.mockResolvedValue([]);
  mocks.getReviewableResource.mockReturnValue(undefined);
  // Default: everyone offered still has access. Access filtering has its own
  // tests; these assert who is *offered*.
  mocks.filterRecipientsByResourceAccess.mockImplementation(
    async ({ emails }: { emails: string[] }) =>
      [...emails].map((email) => email.trim().toLowerCase()),
  );
});

describe("notifyReviewComment", () => {
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
