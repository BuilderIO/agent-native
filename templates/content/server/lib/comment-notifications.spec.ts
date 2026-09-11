import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyActivity: vi.fn(),
  sendEmail: vi.fn(),
  select: vi.fn(),
  filterRecipients: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
}));

vi.mock("@agent-native/core/server", async () => {
  const { emailStrong, renderEmail } =
    await import("../../../../packages/core/src/server/email-template.js");
  return {
    emailStrong,
    getAppProductionUrl: () => "https://docs.test",
    notifyActivity: (...args: unknown[]) => mocks.notifyActivity(...args),
    renderEmail,
    sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
    runActivityNotification: async (
      _logLabel: string,
      resolve: () => Promise<unknown>,
    ) => {
      try {
        return await resolve();
      } catch (error) {
        return {
          status: "notification-error",
          error: error instanceof Error ? error.message : String(error),
          sent: [],
          failed: [],
        };
      }
    },
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  filterRecipientsByResourceAccess: (...args: unknown[]) =>
    mocks.filterRecipients(...args),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: (...args: unknown[]) => mocks.select(...args) }),
  schema: {
    documentComments: {
      documentId: "document_id",
      threadId: "thread_id",
      authorEmail: "author_email",
    },
  },
}));

import { CONTENT_USER_PREFS_KEY } from "../../shared/content-user-prefs.js";
import { notifyDocumentComment } from "./comment-notifications.js";

function stubDb(participants: string[] = []) {
  mocks.select.mockReturnValue({
    from: () => ({
      where: () =>
        Promise.resolve(participants.map((authorEmail) => ({ authorEmail }))),
    }),
  });
}

function notifyArgs() {
  return mocks.notifyActivity.mock.calls[0]?.[0] as {
    candidates: string[];
    actorEmail?: string | null;
    preferenceKey: string;
    send: (to: string) => Promise<unknown>;
  };
}

const BASE = {
  documentId: "doc_1",
  documentTitle: "Launch plan",
  threadId: "thread_1",
  ownerEmail: "owner@example.com",
  authorEmail: "writer@example.com",
  authorName: "Writer",
  content: "This section needs a source",
  mentions: [] as { email: string; name: string }[],
  isReply: false,
};

describe("content comment notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyActivity.mockResolvedValue({
      status: "delivered",
      sent: [],
      failed: [],
    });
    stubDb();
    // Access filtering has its own tests; these assert who is offered.
    mocks.filterRecipients.mockImplementation(
      async ({ emails }: { emails: string[] }) => [...emails],
    );
  });

  it("notifies the owner and mentioned people against the Documents key", async () => {
    await notifyDocumentComment({
      ...BASE,
      mentions: [{ email: "Reviewer@Example.com", name: "Reviewer" }],
    });

    const args = notifyArgs();
    expect(args.candidates).toEqual([
      "owner@example.com",
      "reviewer@example.com",
    ]);
    expect(args.actorEmail).toBe("writer@example.com");
    expect(args.preferenceKey).toBe(CONTENT_USER_PREFS_KEY);
  });

  it("adds thread participants on a reply", async () => {
    stubDb(["first@example.com", "writer@example.com"]);

    await notifyDocumentComment({ ...BASE, isReply: true });

    expect(notifyArgs().candidates).toEqual([
      "owner@example.com",
      "first@example.com",
      "writer@example.com",
    ]);
  });

  it("tells a mentioned recipient they were mentioned", async () => {
    await notifyDocumentComment({
      ...BASE,
      mentions: [{ email: "reviewer@example.com", name: "Reviewer" }],
    });

    const send = notifyArgs().send;
    await send("reviewer@example.com");
    await send("owner@example.com");

    const [mention, owner] = mocks.sendEmail.mock.calls.map(
      (call) => call[0] as { subject: string; text: string },
    );
    expect(mention.subject).toBe('Writer mentioned you on "Launch plan"');
    expect(mention.text).toContain("You were mentioned");
    expect(owner.subject).toBe('Writer commented on "Launch plan"');
  });

  it.each(["mcp", "agent"])(
    "identifies %s comments without changing the account",
    async (submissionSource) => {
      await notifyDocumentComment({ ...BASE, submissionSource });
      const args = notifyArgs();
      expect(args.actorEmail).toBe("writer@example.com");
      await args.send("owner@example.com");
      const email = mocks.sendEmail.mock.calls[0][0];
      expect(email.subject).toBe('Writer commented on "Launch plan" · AI');
      expect(email.text).toContain("Posted via AI on behalf of Writer");
    },
  );

  it.each([undefined, null, "frontend", "cli", "automation"])(
    "does not label %s submissions as AI",
    async (submissionSource) => {
      await notifyDocumentComment({ ...BASE, submissionSource });
      await notifyArgs().send("owner@example.com");
      expect(mocks.sendEmail.mock.calls[0][0].subject).toBe(
        'Writer commented on "Launch plan"',
      );
    },
  );

  it.each(["mcp", "agent", undefined])(
    "escapes user markup in %s notification HTML",
    async (submissionSource) => {
      await notifyDocumentComment({
        ...BASE,
        submissionSource,
        authorName: '<img src=x onerror="alert(1)"> & Writer',
        content: "<script>alert(2)</script> & comment",
      });
      await notifyArgs().send("owner@example.com");
      const email = mocks.sendEmail.mock.calls[0][0];
      expect(email.html).not.toContain("<img src=x");
      expect(email.html).not.toContain("<script>alert(2)</script>");
      expect(email.html).toContain("&lt;img src=x");
      expect(email.html).toContain(
        "&lt;script&gt;alert(2)&lt;/script&gt; &amp; comment",
      );
      if (submissionSource)
        expect(email.html).toContain("Posted via AI on behalf of &lt;img");
    },
  );

  it("drops a mentioned address with no access to the document", async () => {
    mocks.filterRecipients.mockResolvedValue(["owner@example.com"]);

    await notifyDocumentComment({
      ...BASE,
      mentions: [{ email: "outsider@evil.test", name: "Outsider" }],
    });

    expect(notifyArgs().candidates).toEqual(["owner@example.com"]);
    expect(
      (mocks.filterRecipients.mock.calls[0][0] as { emails: string[] }).emails,
    ).toContain("outsider@evil.test");
  });

  it("returns notification-error instead of throwing when a lookup fails", async () => {
    mocks.filterRecipients.mockRejectedValue(new Error("acl store down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyDocumentComment({ ...BASE, isReply: true });

    expect(result.status).toBe("notification-error");
  });
});
