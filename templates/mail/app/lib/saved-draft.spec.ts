import { describe, expect, it } from "vitest";

import {
  savedEmailDraftAttachments,
  savedEmailDraftMetadata,
} from "./saved-draft";

describe("savedEmailDraftAttachments", () => {
  const attachment = {
    id: "abc123.pdf",
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    size: 2048,
    url: "https://cdn.builder.io/o/assets/abc123",
  };

  it("reads a Gmail draft's files as parts of that draft", () => {
    expect(
      savedEmailDraftAttachments({
        id: "gmail-draft-1",
        accountEmail: "owner@example.com",
        attachments: [attachment],
      }),
    ).toEqual([
      {
        id: "abc123.pdf",
        filename: "invoice.pdf",
        originalName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 2048,
        source: "gmail",
        gmailMessageId: "gmail-draft-1",
        gmailAttachmentId: "abc123.pdf",
        accountEmail: "owner@example.com",
      },
    ]);
  });

  it("reads a local draft's files as uploads, which is how they send", () => {
    expect(
      savedEmailDraftAttachments({
        id: "local-draft-1",
        attachments: [attachment],
      }),
    ).toEqual([
      {
        id: "abc123.pdf",
        filename: "abc123.pdf",
        originalName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 2048,
        url: "https://cdn.builder.io/o/assets/abc123",
      },
    ]);
  });

  it("drops a local draft file's path on this server, which app state refuses", () => {
    expect(
      savedEmailDraftAttachments({
        id: "local-draft-1",
        attachments: [{ ...attachment, url: "/api/media/abc123.pdf" }],
      }),
    ).toEqual([
      {
        id: "abc123.pdf",
        filename: "abc123.pdf",
        originalName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
    ]);
  });
});

describe("savedEmailDraftMetadata", () => {
  it("preserves the Gmail account as both sender and saved-draft owner", () => {
    expect(
      savedEmailDraftMetadata({
        id: "gmail-draft-1",
        accountEmail: "secondary@example.com",
      }),
    ).toEqual({
      accountEmail: "secondary@example.com",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
    });
  });

  it("marks a local saved draft without a Gmail account as local", () => {
    expect(savedEmailDraftMetadata({ id: "local-draft-1" })).toMatchObject({
      savedDraftId: "local-draft-1",
      savedDraftBackend: "local",
    });
  });
});
