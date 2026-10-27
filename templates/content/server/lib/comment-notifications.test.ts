import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getAppProductionUrl: () => "https://content.example/",
    sendEmail: mocks.sendEmail,
    runActivityNotification: (_label: string, run: () => Promise<unknown>) =>
      run(),
    notifyActivity: async ({
      candidates,
      send,
    }: {
      candidates: string[];
      send: (to: string) => Promise<void>;
    }) => {
      for (const to of candidates) await send(to);
      return { status: "sent" };
    },
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  filterRecipientsByResourceAccess: async ({ emails }: { emails: string[] }) =>
    emails,
}));

vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

import { notifyDocumentComment } from "./comment-notifications.js";

describe("notifyDocumentComment", () => {
  beforeEach(() => mocks.sendEmail.mockClear());

  it("links the email to the comment thread, not just the page", async () => {
    await notifyDocumentComment({
      documentId: "page 1",
      documentTitle: "Launch plan",
      threadId: "thread/1",
      ownerEmail: "owner@example.test",
      authorEmail: "author@example.test",
      authorName: "Author",
      content: "Whole-page note",
      mentions: [{ email: "reader@example.test", name: "Reader" }],
      isReply: false,
    });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    for (const [message] of mocks.sendEmail.mock.calls as unknown as [
      { html: string; text: string },
    ][]) {
      expect(message.text).toContain(
        "https://content.example/page/page%201?comment=thread%2F1",
      );
    }
  });
});
