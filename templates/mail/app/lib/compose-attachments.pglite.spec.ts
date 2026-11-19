import { composeAttachmentLink } from "@shared/compose-attachments";
import type { Attachment, ComposeState, EmailMessage } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildForwardDraft } from "./message-draft-builders";
import { savedEmailDraftAttachments } from "./saved-draft";
import { uploadResultToAttachment } from "./upload";

const SESSION = "owner@acme.test";
const OWNERS = new Set([SESSION]);

const gmailAttachments: Attachment[] = [
  {
    id: "attachment-9",
    filename: "brief.pdf",
    mimeType: "application/pdf",
    size: 1234,
  },
];

const message: EmailMessage = {
  id: "message-42",
  threadId: "thread-17",
  from: { name: "Rae Sender", email: "rae@example.test" },
  to: [{ name: "Owner", email: SESSION }],
  subject: "Brief",
  snippet: "",
  body: "See attached",
  date: "2026-11-08T12:00:00.000Z",
  isRead: true,
  isStarred: false,
  isSent: false,
  isArchived: false,
  isTrashed: false,
  labelIds: ["inbox"],
  accountEmail: SESSION,
  attachments: gmailAttachments,
};

// The compose window saves every draft to app state, which refuses inline
// file bytes and unsafe links. These drafts used to fail there with
// "Failed to save draft.".
describe("compose drafts with files in app state (PGlite)", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function save(draft: ComposeState) {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const { appStateGet, appStatePut } =
      await import("@agent-native/core/application-state");
    await appStatePut(SESSION, `compose-${draft.id}`, draft);
    return appStateGet(SESSION, `compose-${draft.id}`);
  }

  it("saves a forward that keeps the message's Gmail attachments", async () => {
    const draft = {
      id: "forward-1",
      ...buildForwardDraft(message, OWNERS, { inline: true }),
    };

    expect(await save(draft)).toEqual(draft);
    expect(composeAttachmentLink(draft.attachments![0]!)).toBe(
      "/api/attachments?messageId=message-42&id=attachment-9&mimeType=application%2Fpdf",
    );
  });

  it("saves a reopened Gmail draft with its attachments", async () => {
    const draft: ComposeState = {
      id: "reopened-1",
      to: "rae@example.test",
      subject: "Brief",
      body: "Draft",
      mode: "compose",
      attachments:
        savedEmailDraftAttachments({
          id: "gmail-draft-1",
          accountEmail: SESSION,
          attachments: gmailAttachments,
        }) ?? [],
    };

    expect(await save(draft)).toEqual(draft);
  });

  it("saves a file uploaded to this server's disk", async () => {
    const draft: ComposeState = {
      id: "upload-1",
      to: "",
      subject: "",
      body: "",
      mode: "compose",
      attachments: [
        uploadResultToAttachment({
          url: "/api/media/abc123.pdf",
          filename: "abc123.pdf",
          originalName: "report.pdf",
          mimeType: "application/pdf",
          size: 2048,
        }),
      ],
    };

    expect(await save(draft)).toEqual(draft);
    expect(composeAttachmentLink(draft.attachments![0]!)).toBe(
      "/api/media/abc123.pdf",
    );
  });

  it("still refuses a file's bytes and a relative link", async () => {
    const draft = (url: string): ComposeState => ({
      id: "refused-1",
      to: "",
      subject: "",
      body: "",
      mode: "compose",
      attachments: [
        {
          id: "abc123.pdf",
          filename: "abc123.pdf",
          originalName: "report.pdf",
          mimeType: "application/pdf",
          size: 2048,
          url,
        },
      ],
    });

    await expect(
      save(draft("data:application/pdf;base64,JVBERi0xLjQK")),
    ).rejects.toThrow(/inline/);
    await expect(
      save(draft("/api/attachments?messageId=message-42&id=attachment-9")),
    ).rejects.toThrow(/unsafe attachment reference/);
  });
});
