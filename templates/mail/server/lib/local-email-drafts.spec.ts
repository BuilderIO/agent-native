import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
  bodyToHtml: vi.fn((body: string) => `<p>${body}</p>`),
}));

vi.mock("./local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

vi.mock("./outgoing-email.js", () => ({ bodyToHtml: mocks.bodyToHtml }));

import { updateLocalSavedDraft } from "./local-email-drafts.js";

describe("updateLocalSavedDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readLocalEmails.mockResolvedValue([]);
    mocks.withLocalEmailMutationLock.mockImplementation(
      (_owner: string, mutate: () => Promise<unknown>) => mutate(),
    );
  });

  it("updates the exact local mailbox draft and preserves its other metadata", async () => {
    const original = {
      id: "local-draft-1",
      threadId: "thread-1",
      from: { name: "Owner", email: "owner@example.com" },
      to: [],
      subject: "Old subject",
      snippet: "Old body",
      body: "Old body",
      date: "2026-01-01T00:00:00.000Z",
      isRead: true,
      isStarred: false,
      isDraft: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["drafts"],
      attachments: [
        { id: "file-1", filename: "file.txt", mimeType: "text/plain", size: 1 },
      ],
    };
    const sent = { ...original, id: "sent-1", isDraft: false };
    mocks.readLocalEmails.mockResolvedValue([original, sent]);

    await updateLocalSavedDraft({
      ownerEmail: "owner@example.com",
      draftId: "local-draft-1",
      to: "First <first@example.com>, second@example.com",
      cc: "",
      bcc: "blind@example.com",
      subject: "Updated subject",
      body: "Updated body",
      replyToId: "message-1",
      replyToThreadId: "thread-1",
    });

    expect(mocks.withLocalEmailMutationLock).toHaveBeenCalledOnce();
    const written = mocks.writeLocalEmails.mock.calls[0]?.[1];
    expect(written[0]).toMatchObject({
      id: "local-draft-1",
      threadId: "thread-1",
      from: original.from,
      to: [
        {
          name: "First <first@example.com>",
          email: "First <first@example.com>",
        },
        { name: "second@example.com", email: "second@example.com" },
      ],
      bcc: [{ name: "blind@example.com", email: "blind@example.com" }],
      subject: "Updated subject",
      body: "Updated body",
      bodyHtml: "<p>Updated body</p>",
      isDraft: true,
      replyToId: "message-1",
      replyToThreadId: "thread-1",
      attachments: original.attachments,
    });
    expect(written[0].cc).toBeUndefined();
    expect(written[1]).toEqual(sent);
  });

  it("fails rather than creating a replacement when the exact local draft is missing", async () => {
    await expect(
      updateLocalSavedDraft({
        ownerEmail: "owner@example.com",
        draftId: "missing-local-draft",
        to: "recipient@example.com",
        subject: "Subject",
        body: "Body",
      }),
    ).rejects.toThrow("it was not recreated");
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });
});
