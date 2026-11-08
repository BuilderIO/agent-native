import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
  bodyToHtml: vi.fn((body: string) => `<p>${body}</p>`),
  readSettings: vi.fn(),
}));

vi.mock("./local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

vi.mock("./mail-settings.js", () => ({ readSettings: mocks.readSettings }));

// No attachment reader here: a local copy never reads an attachment's bytes.
vi.mock("./outgoing-email.js", () => ({ bodyToHtml: mocks.bodyToHtml }));

import {
  createLocalSavedDraft,
  updateLocalSavedDraft,
} from "./local-email-drafts.js";

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

  it("says so, and writes nothing, when the exact local draft is missing", async () => {
    await expect(
      updateLocalSavedDraft({
        ownerEmail: "owner@example.com",
        draftId: "missing-local-draft",
        to: "recipient@example.com",
        subject: "Subject",
        body: "Body",
      }),
    ).resolves.toBe(false);
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  describe("given the draft's attachments", () => {
    const draft = {
      id: "local-draft-1",
      threadId: "thread-1",
      from: { name: "Owner", email: "owner@example.com" },
      to: [],
      subject: "Subject",
      snippet: "Body",
      body: "Body",
      date: "2026-01-01T00:00:00.000Z",
      isRead: true,
      isStarred: false,
      isDraft: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["drafts"],
      attachments: [
        { id: "a.txt", filename: "a.txt", mimeType: "text/plain", size: 1 },
      ],
    };
    const update = {
      ownerEmail: "owner@example.com",
      draftId: "local-draft-1",
      to: "recipient@example.com",
      subject: "Subject",
      body: "Body",
    };

    it("replaces the ones it had", async () => {
      mocks.readLocalEmails.mockResolvedValue([draft]);
      const attachments = [
        {
          id: "b",
          filename: "b.txt",
          originalName: "b.txt",
          mimeType: "text/plain",
          size: 2,
          url: "/uploads/b.txt",
        },
      ];

      await expect(
        updateLocalSavedDraft({ ...update, attachments }),
      ).resolves.toBe(true);

      const [written] = mocks.writeLocalEmails.mock.calls[0]?.[1];
      expect(written.attachments).toEqual([
        {
          id: "b.txt",
          filename: "b.txt",
          mimeType: "text/plain",
          size: 2,
          url: "/uploads/b.txt",
        },
      ]);
    });

    it("removes them all when there are none", async () => {
      mocks.readLocalEmails.mockResolvedValue([draft]);

      await updateLocalSavedDraft({ ...update, attachments: [] });

      const [written] = mocks.writeLocalEmails.mock.calls[0]?.[1];
      expect(written).not.toHaveProperty("attachments");
    });

    it("lists one forwarded from Gmail without reading it", async () => {
      mocks.readLocalEmails.mockResolvedValue([draft]);

      await updateLocalSavedDraft({
        ...update,
        attachments: [
          {
            id: "gmail-att",
            filename: "brief.pdf",
            originalName: "brief.pdf",
            mimeType: "application/pdf",
            size: 3,
            url: "/api/attachments?messageId=m1&id=gmail-att",
            source: "gmail",
            gmailMessageId: "m1",
            gmailAttachmentId: "gmail-att",
          },
        ],
      });

      const [written] = mocks.writeLocalEmails.mock.calls[0]?.[1];
      expect(written.attachments).toEqual([
        {
          id: "brief.pdf",
          filename: "brief.pdf",
          mimeType: "application/pdf",
          size: 3,
          url: "/api/attachments?messageId=m1&id=gmail-att",
        },
      ]);
    });
  });
});

describe("createLocalSavedDraft", () => {
  const owner = { name: "Owner", email: "owner@example.com" };
  const fields = {
    ownerEmail: "owner@example.com",
    to: "recipient@example.com",
    subject: "Subject",
    body: "Body",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockResolvedValue(owner);
    mocks.readLocalEmails.mockResolvedValue([
      { id: "message-1", threadId: "thread-of-message" },
    ]);
    mocks.withLocalEmailMutationLock.mockImplementation(
      (_owner: string, mutate: () => Promise<unknown>) => mutate(),
    );
  });

  const written = () => mocks.writeLocalEmails.mock.calls[0]?.[1].slice(-1)[0];

  it("joins the thread of the message it answers", async () => {
    await createLocalSavedDraft({
      ...fields,
      replyToId: "message-1",
      replyToThreadId: "thread-given",
    });

    expect(written().threadId).toBe("thread-of-message");
  });

  it("falls back to the thread it was given when that message isn't here", async () => {
    await createLocalSavedDraft({
      ...fields,
      replyToId: "message-elsewhere",
      replyToThreadId: "thread-given",
    });

    expect(written().threadId).toBe("thread-given");
  });

  it("lists attachments without reading them", async () => {
    await createLocalSavedDraft({
      ...fields,
      attachments: [
        {
          id: "b",
          filename: "b.txt",
          originalName: "Big file.txt",
          mimeType: "text/plain",
          size: 99_000_000,
          url: "/uploads/b.txt",
        },
      ],
    });

    expect(written().attachments).toEqual([
      {
        id: "b.txt",
        filename: "Big file.txt",
        mimeType: "text/plain",
        size: 99_000_000,
        url: "/uploads/b.txt",
      },
    ]);
  });
});
