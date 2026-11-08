import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  buildDeepLink: vi.fn(),
  getUserSetting: vi.fn(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
  compareAndSetAppState: vi.fn(),
  deleteAppState: vi.fn(),
  deleteAppStateByPrefix: vi.fn(),
  listAppState: vi.fn(),
  saveGmailDraft: vi.fn(),
  deleteGmailDraft: vi.fn(),
  findGmailDraftAccount: vi.fn(),
  updateLocalSavedDraft: vi.fn(),
  isConnected: vi.fn(),
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
  appendSignatureToBody: vi.fn(),
  attachmentFromUpload: vi.fn(),
}));

vi.mock("../server/lib/media-upload.js", () => ({
  attachmentFromUpload: mocks.attachmentFromUpload,
}));

vi.mock("@agent-native/core", async () => {
  const { isOutsideAgentCall } =
    await import("../../../packages/core/src/action-caller.js");
  return { embedApp: vi.fn(() => ({})), isOutsideAgentCall };
});

vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/action")>();
  return {
    defineAction: (config: unknown) => config,
    fail: (message: string, options: Record<string, unknown>) => {
      const error = Object.assign(new Error(message), options);
      throw error;
    },
    ActionContractError: actual.ActionContractError,
    NoWriteError: actual.NoWriteError,
    isNoWriteError: actual.isNoWriteError,
  };
});

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
  compareAndSetAppState: mocks.compareAndSetAppState,
  deleteAppState: mocks.deleteAppState,
  deleteAppStateByPrefix: mocks.deleteAppStateByPrefix,
  listAppState: mocks.listAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
  buildDeepLink: mocks.buildDeepLink,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/gmail-drafts.js", () => ({
  saveGmailDraft: mocks.saveGmailDraft,
  deleteGmailDraft: mocks.deleteGmailDraft,
  findGmailDraftAccount: mocks.findGmailDraftAccount,
}));

vi.mock("../server/lib/local-email-drafts.js", () => ({
  updateLocalSavedDraft: mocks.updateLocalSavedDraft,
}));

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

vi.mock("../shared/signature.js", () => ({
  appendSignatureToBody: mocks.appendSignatureToBody,
}));

import { isNoWriteError } from "@agent-native/core/action";
import { saveRevisionOf } from "@agent-native/core/save-conflict";

import {
  GmailQuotaCooldownError,
  GmailQuotaRefusedError,
} from "../server/lib/gmail-quota.js";
import action from "./manage-draft";

let appState = new Map<string, unknown>();

beforeEach(() => {
  vi.clearAllMocks();
  appState = new Map();
  mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
  mocks.getUserSetting.mockResolvedValue({});
  mocks.appendSignatureToBody.mockImplementation((body: string) => body);
  mocks.buildDeepLink.mockReturnValue("/mail");
  mocks.saveGmailDraft.mockResolvedValue(null);
  mocks.findGmailDraftAccount.mockResolvedValue(null);
  mocks.updateLocalSavedDraft.mockResolvedValue(undefined);
  mocks.isConnected.mockResolvedValue(false);
  mocks.readLocalEmails.mockResolvedValue([]);
  mocks.withLocalEmailMutationLock.mockImplementation(
    (_ownerEmail: string, mutate: () => Promise<unknown>) => mutate(),
  );
  mocks.readAppState.mockImplementation((key: string) => appState.get(key));
  mocks.writeAppState.mockImplementation(
    (key: string, value: unknown) => void appState.set(key, value),
  );
  mocks.compareAndSetAppState.mockImplementation(
    (key: string, expected: unknown, next: unknown) => {
      if ((appState.get(key) ?? null) !== expected) return false;
      appState.set(key, next);
      return true;
    },
  );
});

/** The revision an agent would have read for the stored draft. */
function revisionOf(id: string): string {
  return saveRevisionOf(appState.get(`compose-${id}`));
}

function manageDraftSource(): string {
  return readFileSync(new URL("./manage-draft.ts", import.meta.url), "utf8");
}

describe("manage-draft attachments", () => {
  const uploaded = {
    id: "abc123.pdf",
    filename: "abc123.pdf",
    originalName: "invoice.pdf",
    mimeType: "application/pdf",
    size: 2048,
    url: "https://cdn.builder.io/o/assets/abc123",
  };
  const handle = {
    filename: "abc123.pdf",
    originalName: "invoice.pdf",
    mimeType: "application/pdf",
  };

  it("puts an uploaded file on a new draft and its Gmail copy", async () => {
    mocks.attachmentFromUpload.mockResolvedValue(uploaded);

    const result = await action.run({
      action: "create",
      id: "with-file",
      to: "recipient@example.com",
      attachments: [handle],
    });

    expect(mocks.attachmentFromUpload).toHaveBeenCalledWith(
      "owner@example.com",
      handle,
    );
    expect(mocks.saveGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [uploaded] }),
    );
    expect((result as { draft: unknown }).draft).toMatchObject({
      attachments: [uploaded],
    });
  });

  it("saves nothing when a handle isn't one of this account's uploads", async () => {
    mocks.attachmentFromUpload.mockResolvedValue(null);

    await expect(
      action.run({
        action: "create",
        id: "missing-file",
        attachments: [{ filename: "someone-elses.pdf" }],
      }),
    ).rejects.toMatchObject({ errorCode: "draft_attachment_not_found" });
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(appState.has("compose-missing-file")).toBe(false);
  });

  it("keeps a forwarded Gmail file named in an update without re-reading it", async () => {
    const forwarded = {
      id: "gmail-part",
      filename: "forwarded.pdf",
      originalName: "forwarded.pdf",
      mimeType: "application/pdf",
      size: 10,
      url: "",
      source: "gmail",
      gmailMessageId: "message-1",
      gmailAttachmentId: "part-1",
    };
    appState.set("compose-forward", {
      id: "forward",
      to: "recipient@example.com",
      subject: "Fwd",
      body: "",
      mode: "forward",
      attachments: [forwarded],
    });
    mocks.attachmentFromUpload.mockResolvedValue(uploaded);

    const result = await action.run({
      action: "update",
      id: "forward",
      expectedRevision: revisionOf("forward"),
      attachments: [{ filename: "forwarded.pdf" }, handle],
    });

    expect(mocks.attachmentFromUpload).toHaveBeenCalledTimes(1);
    expect((result as { draft: unknown }).draft).toMatchObject({
      attachments: [forwarded, uploaded],
    });
  });

  it("keeps two forwarded Gmail files that share a name", async () => {
    const forwardedPart = (part: string) => ({
      id: part,
      filename: "image.png",
      originalName: "image.png",
      mimeType: "image/png",
      size: 10,
      url: "",
      source: "gmail",
      gmailMessageId: "message-1",
      gmailAttachmentId: part,
    });
    const first = forwardedPart("part-1");
    const second = forwardedPart("part-2");
    appState.set("compose-same-names", {
      id: "same-names",
      to: "recipient@example.com",
      subject: "Fwd",
      body: "",
      mode: "forward",
      attachments: [first, second],
    });
    mocks.attachmentFromUpload.mockResolvedValue(uploaded);

    const result = await action.run({
      action: "update",
      id: "same-names",
      expectedRevision: revisionOf("same-names"),
      attachments: [
        { filename: "image.png" },
        { filename: "image.png" },
        handle,
      ],
    });

    expect((result as { draft: unknown }).draft).toMatchObject({
      attachments: [first, second, uploaded],
    });
  });

  it("keeps the second of two same-named files when its id is passed", async () => {
    const forwardedPart = (part: string) => ({
      id: part,
      filename: "image.png",
      originalName: "image.png",
      mimeType: "image/png",
      size: 10,
      url: "",
      source: "gmail",
      gmailMessageId: "message-1",
      gmailAttachmentId: part,
    });
    const second = forwardedPart("part-2");
    appState.set("compose-pick-one", {
      id: "pick-one",
      to: "recipient@example.com",
      subject: "Fwd",
      body: "",
      mode: "forward",
      attachments: [forwardedPart("part-1"), second],
    });

    const result = await action.run({
      action: "update",
      id: "pick-one",
      expectedRevision: revisionOf("pick-one"),
      attachments: [{ filename: "image.png", id: "part-2" }],
    });

    expect(
      (result as { draft: { attachments: unknown } }).draft.attachments,
    ).toEqual([second]);
  });

  it("lets an id claim its file before a name-only entry does", async () => {
    const forwardedPart = (part: string) => ({
      id: part,
      filename: "image.png",
      originalName: "image.png",
      mimeType: "image/png",
      size: 10,
      url: "",
      source: "gmail",
      gmailMessageId: "message-1",
      gmailAttachmentId: part,
    });
    const first = forwardedPart("part-1");
    const second = forwardedPart("part-2");
    appState.set("compose-id-first", {
      id: "id-first",
      to: "recipient@example.com",
      subject: "Fwd",
      body: "",
      mode: "forward",
      attachments: [first, second],
    });

    const result = await action.run({
      action: "update",
      id: "id-first",
      expectedRevision: revisionOf("id-first"),
      attachments: [
        { filename: "image.png" },
        { filename: "image.png", id: "part-1" },
      ],
    });

    expect(
      (result as { draft: { attachments: unknown } }).draft.attachments,
    ).toEqual([second, first]);
  });

  it("removes every file when an update passes an empty list", async () => {
    appState.set("compose-clear", {
      id: "clear",
      to: "recipient@example.com",
      subject: "Hello",
      body: "",
      mode: "compose",
      attachments: [uploaded],
    });

    const result = await action.run({
      action: "update",
      id: "clear",
      expectedRevision: revisionOf("clear"),
      attachments: [],
    });

    expect((result as { draft: unknown }).draft).toMatchObject({
      attachments: [],
    });
  });

  it("applies a repeated attachment update once", async () => {
    appState.set("compose-repeat", {
      id: "repeat",
      to: "recipient@example.com",
      subject: "Hello",
      body: "",
      mode: "compose",
      attachments: [uploaded],
    });

    const result = await action.run({
      action: "update",
      id: "repeat",
      expectedRevision: "stale-revision",
      attachments: [handle],
    });

    expect((result as { message: string }).message).toContain(
      "already has this update",
    );
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
  });
});

describe("manage-draft MCP App", () => {
  it("requires an action and IDs for draft operations that target a draft", () => {
    const source = manageDraftSource();

    expect(source).toContain('z.discriminatedUnion("action"');
    expect(source).toContain('action: z.literal("update")');
    expect(source).toContain('action: z.literal("delete")');
    expect(source).toContain('.literal("delete-saved")');
    expect(source).toContain('errorCode: "draft_not_found"');
    expect(source).toContain("deleteGmailDraft");
    expect(source).toContain('listAppState("compose-")');
    expect(source).toContain("replyToId: args.replyToId");
    expect(source).toContain(
      "draft.accountEmail = savedGmailDraft.accountEmail",
    );
    expect(source).toContain(
      "savedGmailDraft?.accountEmail ?? args.accountEmail",
    );
    expect(source).toContain(
      "draft.savedDraftId ? draft.accountEmail : undefined",
    );
    expect(source).toContain("delete draft.accountEmail");
  });
});

describe("manage-draft saved mailbox deletion", () => {
  it("executes an approved MCP deletion with the exact selected Gmail account", async () => {
    mocks.isConnected.mockResolvedValue(true);

    await action.run(
      {
        action: "delete-saved",
        savedDraftId: "gmail-draft-1",
        savedDraftBackend: "gmail",
        accountEmail: "secondary@example.com",
      },
      { caller: "mcp" },
    );

    expect(mocks.deleteGmailDraft).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      accountEmail: "secondary@example.com",
      draftId: "gmail-draft-1",
    });
    expect(mocks.readLocalEmails).not.toHaveBeenCalled();
  });

  it("removes local fallback drafts under the local mailbox lock", async () => {
    const otherEmail = { id: "sent-1", isDraft: false };
    mocks.readLocalEmails.mockResolvedValue([
      { id: "local-draft-1", isDraft: true },
      otherEmail,
    ]);

    await action.run({
      action: "delete-saved",
      savedDraftId: "local-draft-1",
      savedDraftBackend: "local",
    });

    expect(mocks.withLocalEmailMutationLock).toHaveBeenCalledOnce();
    expect(mocks.writeLocalEmails).toHaveBeenCalledWith("owner@example.com", [
      otherEmail,
    ]);
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
  });

  it("uses saved mailbox metadata when deleting a compose draft", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.deleteAppState.mockResolvedValue(true);
    appState.set("compose-1", {
      id: "1",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "secondary@example.com",
      accountEmail: "default@example.com",
    });

    await action.run({ action: "delete", id: "1" });

    expect(mocks.deleteGmailDraft).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      accountEmail: "secondary@example.com",
      draftId: "gmail-draft-1",
    });
  });

  it("deletes a legacy local saved draft even after Gmail is connected", async () => {
    const otherEmail = { id: "sent-1", isDraft: false };
    mocks.readLocalEmails.mockResolvedValue([
      { id: "legacy-local-1", isDraft: true },
      otherEmail,
    ]);

    await action.run({
      action: "delete-saved",
      savedDraftId: "legacy-local-1",
      accountEmail: "owner@example.com",
    });

    expect(mocks.writeLocalEmails).toHaveBeenCalledWith("owner@example.com", [
      otherEmail,
    ]);
    expect(mocks.findGmailDraftAccount).not.toHaveBeenCalled();
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
  });

  it("deletes a legacy Gmail draft only from the account that contains that ID", async () => {
    mocks.findGmailDraftAccount.mockResolvedValue("secondary@example.com");

    await action.run({
      action: "delete-saved",
      savedDraftId: "legacy-gmail-1",
    });

    expect(mocks.deleteGmailDraft).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      accountEmail: "secondary@example.com",
      draftId: "legacy-gmail-1",
    });
  });

  it("fails closed when a legacy saved draft has no verifiable owner", async () => {
    await expect(
      action.run({
        action: "delete-saved",
        savedDraftId: "unknown-draft",
        accountEmail: "owner@example.com",
      }),
    ).rejects.toThrow("Could not verify the backend");
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("uses saved mailbox metadata when deleting all compose drafts", async () => {
    mocks.isConnected.mockResolvedValue(true);
    mocks.listAppState.mockResolvedValue([
      {
        value: {
          savedDraftId: "gmail-draft-1",
          savedDraftBackend: "gmail",
          savedDraftAccountEmail: "secondary@example.com",
          accountEmail: "default@example.com",
        },
      },
    ]);

    await action.run({ action: "delete-all" });

    expect(mocks.deleteGmailDraft).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      accountEmail: "secondary@example.com",
      draftId: "gmail-draft-1",
    });
  });
});

describe("manage-draft local fallback", () => {
  it("updates a compose draft already in app state without a create call", async () => {
    const attachments = [
      {
        id: "attachment-1",
        filename: "brief.pdf",
        originalName: "brief.pdf",
        mimeType: "application/pdf",
        size: 128,
        url: "/uploads/brief.pdf",
      },
    ];
    appState.set("compose-ui-draft", {
      id: "ui-draft",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Original draft",
      mode: "compose",
      attachments,
      inline: true,
    });

    const updated = await action.run({
      action: "update",
      id: "ui-draft",
      expectedRevision: revisionOf("ui-draft"),
      body: "Updated draft",
    });

    expect(mocks.readAppState).toHaveBeenCalledWith("compose-ui-draft");
    expect(updated.draft.body).toBe("Updated draft");
    expect(updated.draft.attachments).toEqual(attachments);
    expect(updated.draft.inline).toBe(true);
    expect(mocks.saveGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ attachments }),
    );
    expect(mocks.compareAndSetAppState).toHaveBeenCalledWith(
      "compose-ui-draft",
      expect.anything(),
      expect.objectContaining({
        body: "Updated draft",
        attachments,
        inline: true,
      }),
    );
  });

  it("rejects malformed attachment state instead of replacing a draft without it", async () => {
    appState.set("compose-ui-draft", {
      id: "ui-draft",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Original draft",
      mode: "compose",
      attachments: { filename: "brief.pdf" },
    });

    await expect(
      action.run({
        action: "update",
        id: "ui-draft",
        expectedRevision: revisionOf("ui-draft"),
        body: "Updated draft",
      }),
    ).rejects.toThrow('Draft "ui-draft" has invalid attachments');
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("can create and update a local draft without an account marker", async () => {
    const created = await action.run({
      action: "create",
      id: "local-draft",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(created.draft).not.toHaveProperty("accountEmail");

    const updated = await action.run({
      action: "update",
      id: "local-draft",
      expectedRevision: revisionOf("local-draft"),
      body: "Updated draft",
    });

    expect(updated.draft).not.toHaveProperty("accountEmail");
    expect(mocks.saveGmailDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        accountEmail: undefined,
        draftId: undefined,
      }),
    );
  });

  it("rejects switching the mailbox for an existing Gmail draft", async () => {
    appState.set("compose-gmail-draft", {
      id: "gmail-draft",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "old@example.com",
      accountEmail: "old@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
      mode: "compose",
    });

    await expect(
      action.run({
        action: "update",
        id: "gmail-draft",
        expectedRevision: revisionOf("gmail-draft"),
        accountEmail: "new@example.com",
      }),
    ).rejects.toMatchObject({ errorCode: "draft_account_change" });
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
  });

  it("updates a saved local draft locally after Gmail connects", async () => {
    appState.set("compose-local-draft", {
      id: "local-draft",
      savedDraftId: "local-draft-1",
      savedDraftBackend: "local",
      to: "old@example.com",
      subject: "Old",
      body: "Old body",
      mode: "compose",
    });

    const result = await action.run({
      action: "update",
      id: "local-draft",
      expectedRevision: revisionOf("local-draft"),
      body: "Updated body",
    });

    expect(mocks.updateLocalSavedDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        draftId: "local-draft-1",
        body: "Updated body",
      }),
    );
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(result.draft).toMatchObject({
      savedDraftId: "local-draft-1",
      savedDraftBackend: "local",
    });
  });

  it("saves changed attachments to a saved local draft", async () => {
    const uploaded = {
      id: "abc123.pdf",
      filename: "abc123.pdf",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 2048,
      url: "https://cdn.builder.io/o/assets/abc123",
    };
    appState.set("compose-local-file", {
      id: "local-file",
      savedDraftId: "local-draft-2",
      savedDraftBackend: "local",
      to: "old@example.com",
      subject: "Old",
      body: "Old body",
      mode: "compose",
    });
    mocks.attachmentFromUpload.mockResolvedValue(uploaded);

    await action.run({
      action: "update",
      id: "local-file",
      expectedRevision: revisionOf("local-file"),
      attachments: [{ filename: "abc123.pdf" }],
    });

    expect(mocks.updateLocalSavedDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "local-draft-2",
        attachments: [uploaded],
      }),
    );
  });

  it("resolves a legacy local draft by mailbox row before updating it", async () => {
    mocks.readLocalEmails.mockResolvedValue([
      { id: "legacy-local-1", isDraft: true },
    ]);
    appState.set("compose-legacy-local", {
      id: "legacy-local",
      savedDraftId: "legacy-local-1",
      to: "old@example.com",
      subject: "Old",
      body: "Old body",
      mode: "compose",
    });

    const result = await action.run({
      action: "update",
      id: "legacy-local",
      expectedRevision: revisionOf("legacy-local"),
      body: "Updated body",
    });

    expect(mocks.updateLocalSavedDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "legacy-local-1",
        body: "Updated body",
      }),
    );
    expect(mocks.findGmailDraftAccount).not.toHaveBeenCalled();
    expect(result.draft.savedDraftBackend).toBe("local");
  });

  it("honors the mailbox containing a legacy Gmail draft during agent updates", async () => {
    mocks.findGmailDraftAccount.mockResolvedValue("secondary@example.com");
    mocks.saveGmailDraft.mockResolvedValue({
      draftId: "legacy-gmail-1",
      accountEmail: "secondary@example.com",
      created: false,
      updated: true,
    });
    appState.set("compose-legacy-gmail", {
      id: "legacy-gmail",
      savedDraftId: "legacy-gmail-1",
      to: "old@example.com",
      subject: "Old",
      body: "Old body",
      mode: "compose",
    });

    await action.run({
      action: "update",
      id: "legacy-gmail",
      expectedRevision: revisionOf("legacy-gmail"),
      body: "Updated body",
    });

    expect(mocks.saveGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        accountEmail: "secondary@example.com",
        draftId: "legacy-gmail-1",
        body: "Updated body",
      }),
    );
  });

  it("does not create a replacement for an unverified legacy saved draft", async () => {
    appState.set("compose-unknown", {
      id: "unknown",
      savedDraftId: "unknown-draft",
      to: "recipient@example.com",
      subject: "Subject",
      body: "Body",
      mode: "compose",
    });

    await expect(
      action.run({
        action: "update",
        id: "unknown",
        expectedRevision: revisionOf("unknown"),
        body: "Changed",
      }),
    ).rejects.toThrow("Could not verify the backend");
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(mocks.updateLocalSavedDraft).not.toHaveBeenCalled();
  });
});

describe("manage-draft Gmail budget refusals", () => {
  it("reports a create refused by Mail's Gmail budget as not saved", async () => {
    mocks.saveGmailDraft.mockRejectedValue(new GmailQuotaRefusedError(23_000));

    const error = await action
      .run({
        action: "create",
        id: "refused-draft",
        to: "recipient@example.com",
        subject: "Refund",
        body: "Draft",
      })
      .catch((thrown: unknown) => thrown);

    expect(isNoWriteError(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: "gmail_quota_cooldown",
      statusCode: 429,
      details: { retryAfterSeconds: 23 },
      message: expect.stringMatching(/^The draft was not saved\. .*about 23s/),
    });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("reports a refused update of a Gmail draft as not saved", async () => {
    const stored = {
      id: "gmail-draft",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Refund",
      body: "Draft",
      mode: "compose",
    };
    appState.set("compose-gmail-draft", stored);
    mocks.saveGmailDraft.mockRejectedValue(new GmailQuotaRefusedError(5_000));

    const error = await action
      .run({
        action: "update",
        id: "gmail-draft",
        expectedRevision: revisionOf("gmail-draft"),
        body: "Changed",
      })
      .catch((thrown: unknown) => thrown);

    expect(isNoWriteError(error)).toBe(true);
    expect(mocks.writeAppState).not.toHaveBeenCalled();
    expect(appState.get("compose-gmail-draft")).toBe(stored);
  });

  it("leaves Gmail's own 429 as it was, since that request was sent", async () => {
    const gmail429 = new GmailQuotaCooldownError(60_000);
    mocks.saveGmailDraft.mockRejectedValue(gmail429);

    await expect(
      action.run({ action: "create", id: "sent-draft", body: "Draft" }),
    ).rejects.toBe(gmail429);
  });
});

describe("manage-draft deep link", () => {
  it("creates an ordinary draft deep link without fullscreen mode", async () => {
    await action.run({
      action: "create",
      id: "compact-draft",
      to: "recipient@example.com",
      subject: "Subject",
      body: "Body",
    });

    expect(mocks.buildDeepLink).toHaveBeenCalledWith({
      app: "mail",
      view: "inbox",
      to: "/inbox",
      params: { composeDraftId: "compact-draft" },
    });
  });

  it("embeds the draft card and keeps the inbox deep link to open Mail", async () => {
    mocks.buildDeepLink.mockReturnValue(
      "/_agent-native/open?view=inbox&composeDraftId=card-draft",
    );

    const created = await action.run({
      action: "create",
      id: "card-draft",
      to: "recipient@example.com",
      subject: "Subject",
      body: "Body",
    });
    const updated = await action.run({
      action: "update",
      id: "card-draft",
      expectedRevision: revisionOf("card-draft"),
      body: "Revised body",
    });

    for (const result of [created, updated]) {
      expect(result).toMatchObject({
        embed: true,
        path: "/draft?id=card-draft",
        deepLink: "/_agent-native/open?view=inbox&composeDraftId=card-draft",
        deepLinkUrl: "/_agent-native/open?view=inbox&composeDraftId=card-draft",
      });
    }
  });
});

describe("manage-draft call-shape guidance", () => {
  it("explains how to target existing drafts and when to create", () => {
    expect(action.description).toContain(
      "use `create` for a new draft even if another compose draft is open",
    );
    expect(action.description).toContain(
      "`update` to revise a specific existing draft with its raw compose ID",
    );
    expect(action.description).toContain("pass only `{id}`");
    expect(action.description).toContain(
      "`delete` with only the raw compose ID (not the `compose-{id}` app-state key)",
    );
    expect(action.description).toContain(
      "`delete-saved` with `savedDraftId` for a saved mailbox draft",
    );
    expect(action.description).toMatch(/create.*update.*delete/i);
    expect(action.description).not.toContain(
      "Never call update or delete before a matching create",
    );
  });

  it("rejects a call with no action at all", () => {
    expect(action.schema.safeParse({}).success).toBe(false);
  });

  it("rejects update/delete without an id", () => {
    expect(action.schema.safeParse({ action: "update" }).success).toBe(false);
    expect(action.schema.safeParse({ action: "delete" }).success).toBe(false);
  });

  it("accepts a create call with only action set", () => {
    expect(action.schema.safeParse({ action: "create" }).success).toBe(true);
  });

  it("does not register a Mail-specific chat renderer", () => {
    expect(action.chatUI).toBeUndefined();
  });
});

describe("manage-draft create-then-reply flow", () => {
  it("creates a reply draft, then updates it using the id create returned", async () => {
    const created = await action.run({
      action: "create",
      to: "attendee@example.com",
      subject: "Re: Event Registration",
      body: "Hi,\n\nCould you confirm your check-in date?",
      mode: "reply",
      replyToId: "msg-123",
    });

    expect(created.id).toBeTruthy();
    expect(created.draft).toMatchObject({
      mode: "reply",
      replyToId: "msg-123",
    });
    expect(created.change).toEqual({
      verb: "created",
      kind: "email-draft",
      title: "Re: Event Registration",
      detail: "attendee@example.com",
      url: "/mail",
    });

    const updated = await action.run({
      action: "update",
      id: created.id,
      expectedRevision: created.revision,
      body: "Hi,\n\nQuick follow-up: could you confirm your check-in date?",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.draft.body).toContain("Quick follow-up");
    expect(updated.change).toEqual({
      verb: "updated",
      kind: "email-draft",
      title: "Re: Event Registration",
      detail: "attendee@example.com",
      url: "/mail",
    });
    expect(JSON.stringify(updated.change)).not.toContain("Quick follow-up");
  });
});

describe("manage-draft saves against the revision it read", () => {
  const stored = {
    id: "shared-draft",
    to: "recipient@example.com",
    subject: "Hello",
    body: "Original",
    mode: "compose",
  };

  beforeEach(() => {
    appState.set("compose-shared-draft", stored);
  });

  it("returns the current draft when the person changed it after the read", async () => {
    const readRevision = revisionOf("shared-draft");
    const typed = { ...stored, body: "Typed in the compose window" };
    appState.set("compose-shared-draft", typed);

    await expect(
      action.run({
        action: "update",
        id: "shared-draft",
        expectedRevision: readRevision,
        subject: "Agent subject",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "save_conflict",
      details: { current: typed, currentRevision: saveRevisionOf(typed) },
    });
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(appState.get("compose-shared-draft")).toBe(typed);
  });

  it("sends the same conflict when no revision was read at all", async () => {
    await expect(
      action.run({ action: "update", id: "shared-draft", body: "Blind" }),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { current: stored, currentRevision: revisionOf("shared-draft") },
    });
    expect(appState.get("compose-shared-draft")).toBe(stored);
  });

  it("lets the agent redo its edit with the revision from the conflict", async () => {
    const conflict = await action
      .run({ action: "update", id: "shared-draft", body: "Agent body" })
      .catch((error: { details: { currentRevision: string } }) => error);

    const redone = await action.run({
      action: "update",
      id: "shared-draft",
      expectedRevision: (conflict as { details: { currentRevision: string } })
        .details.currentRevision,
      body: "Agent body",
    });

    expect(redone.draft.body).toBe("Agent body");
    expect(redone.revision).toBe(revisionOf("shared-draft"));
  });

  it("applies a repeated update once", async () => {
    const readRevision = revisionOf("shared-draft");
    const first = await action.run({
      action: "update",
      id: "shared-draft",
      expectedRevision: readRevision,
      body: "Agent body",
    });
    mocks.saveGmailDraft.mockClear();

    const repeat = await action.run({
      action: "update",
      id: "shared-draft",
      expectedRevision: readRevision,
      body: "Agent body",
    });

    expect(repeat.draft.body).toBe("Agent body");
    expect(repeat.revision).toBe(first.revision);
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
  });

  it("catches a save that lands between the check and the write", async () => {
    const typed = { ...stored, body: "Typed during the Gmail save" };
    mocks.saveGmailDraft.mockImplementation(async () => {
      appState.set("compose-shared-draft", typed);
      return null;
    });

    await expect(
      action.run({
        action: "update",
        id: "shared-draft",
        expectedRevision: revisionOf("shared-draft"),
        subject: "Agent subject",
      }),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: { current: typed },
    });
    expect(appState.get("compose-shared-draft")).toBe(typed);
  });

  it("removes the Gmail draft it made when it loses that race", async () => {
    const typed = { ...stored, body: "Typed during the Gmail save" };
    mocks.saveGmailDraft.mockImplementation(async () => {
      appState.set("compose-shared-draft", typed);
      return {
        draftId: "new-gmail-draft",
        accountEmail: "user@example.com",
        created: true,
      };
    });

    await expect(
      action.run({
        action: "update",
        id: "shared-draft",
        expectedRevision: revisionOf("shared-draft"),
        subject: "Agent subject",
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    expect(mocks.deleteGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        accountEmail: "user@example.com",
        draftId: "new-gmail-draft",
      }),
    );
  });

  it("names the Gmail draft it couldn't remove after losing that race", async () => {
    const typed = { ...stored, body: "Typed during the Gmail save" };
    mocks.saveGmailDraft.mockImplementation(async () => {
      appState.set("compose-shared-draft", typed);
      return {
        draftId: "stuck-gmail-draft",
        accountEmail: "user@example.com",
        created: true,
      };
    });
    mocks.deleteGmailDraft.mockRejectedValueOnce(new Error("Gmail is down"));

    await expect(
      action.run({
        action: "update",
        id: "shared-draft",
        expectedRevision: revisionOf("shared-draft"),
        subject: "Agent subject",
      }),
    ).rejects.toMatchObject({
      errorCode: "save_conflict",
      details: {
        current: typed,
        leftoverGmailDraftId: "stuck-gmail-draft",
      },
    });
  });

  it("keeps a Gmail draft it only updated when it loses that race", async () => {
    const saved = {
      ...stored,
      savedDraftId: "existing-gmail-draft",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "user@example.com",
    };
    appState.set("compose-shared-draft", saved);
    mocks.saveGmailDraft.mockImplementation(async () => {
      appState.set("compose-shared-draft", {
        ...saved,
        body: "Typed during the Gmail save",
      });
      return {
        draftId: "existing-gmail-draft",
        accountEmail: "user@example.com",
        created: false,
      };
    });

    await expect(
      action.run({
        action: "update",
        id: "shared-draft",
        expectedRevision: revisionOf("shared-draft"),
        subject: "Agent subject",
      }),
    ).rejects.toMatchObject({ errorCode: "save_conflict" });
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
  });

  describe("when the write throws", () => {
    const writeError = new Error("connection reset");
    const newGmailDraft = {
      draftId: "new-gmail-draft",
      accountEmail: "user@example.com",
      created: true,
    };
    const update = () =>
      action.run({
        action: "update",
        id: "shared-draft",
        expectedRevision: revisionOf("shared-draft"),
        subject: "Agent subject",
      });

    it("removes the Gmail draft it made if the write didn't land", async () => {
      mocks.saveGmailDraft.mockResolvedValue(newGmailDraft);
      mocks.compareAndSetAppState.mockRejectedValueOnce(writeError);

      await expect(update()).rejects.toBe(writeError);
      expect(mocks.deleteGmailDraft).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: "new-gmail-draft" }),
      );
    });

    it("counts a write that landed before it threw as stored", async () => {
      mocks.saveGmailDraft.mockResolvedValue(newGmailDraft);
      mocks.compareAndSetAppState.mockImplementationOnce(
        async (key: string, _expected: unknown, next: unknown) => {
          appState.set(key, next);
          throw writeError;
        },
      );

      await expect(update()).resolves.toMatchObject({
        draft: { savedDraftId: "new-gmail-draft", subject: "Agent subject" },
      });
      expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
    });

    it("keeps the Gmail draft and says so if the reread fails too", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mocks.saveGmailDraft.mockResolvedValue(newGmailDraft);
      mocks.compareAndSetAppState.mockImplementationOnce(async () => {
        mocks.readAppState.mockRejectedValueOnce(new Error("database down"));
        throw writeError;
      });

      await expect(update()).rejects.toMatchObject({
        errorCode: "draft_store_unconfirmed",
        details: { gmailDraftId: "new-gmail-draft" },
      });
      expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("doesn't take an existing Gmail draft's ID as proof the write landed", async () => {
      const saved = {
        ...stored,
        savedDraftId: "existing-gmail-draft",
        savedDraftBackend: "gmail",
        savedDraftAccountEmail: "user@example.com",
      };
      appState.set("compose-shared-draft", saved);
      mocks.saveGmailDraft.mockResolvedValue({
        draftId: "existing-gmail-draft",
        accountEmail: "user@example.com",
        created: false,
      });
      mocks.compareAndSetAppState.mockRejectedValueOnce(writeError);

      await expect(update()).rejects.toBe(writeError);
      expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
    });
  });
});

describe("manage-draft approval", () => {
  it("requires a fresh approval for every external destructive draft call", () => {
    expect(action.allowPersistentApproval).toBe(false);
  });

  it.each([
    "create",
    "update",
    "delete",
    "delete-saved",
    "delete-all",
  ] as const)(
    "requires approval only for outside agents using destructive draft mode %s",
    async (operation) => {
      const needsApproval = action.needsApproval;
      expect(typeof needsApproval).toBe("function");
      if (typeof needsApproval !== "function")
        throw new Error("Missing approval gate");
      const args = action.schema.parse({
        action: operation,
        id: "draft-1",
        savedDraftId: "saved-1",
      });
      expect(await needsApproval(args, { caller: "mcp" })).toBe(
        operation !== "create" && operation !== "update",
      );
      expect(await needsApproval(args, { caller: "a2a" })).toBe(
        operation !== "create" && operation !== "update",
      );
      expect(await needsApproval(args, { caller: "tool" })).toBe(false);
      for (const networkProtocol of ["a2a", "mcp"] as const) {
        expect(
          await needsApproval(args, { caller: "tool", networkProtocol }),
        ).toBe(operation !== "create" && operation !== "update");
      }
      expect(await needsApproval(args, { caller: "webmcp" })).toBe(
        operation !== "create" && operation !== "update",
      );
      expect(await needsApproval(args, { caller: "frontend" })).toBe(false);
      expect(await needsApproval(args)).toBe(
        operation !== "create" && operation !== "update",
      );
    },
  );
});

describe("manage-draft create collisions", () => {
  it("refuses an existing ID without changing the draft or saving another Gmail draft", async () => {
    const existing = {
      id: "existing",
      to: "recipient@example.com",
      subject: "Keep this draft",
      body: "Original body",
      savedDraftId: "gmail-original",
      savedDraftBackend: "gmail",
      savedDraftAccountEmail: "owner@example.com",
    };
    appState.set("compose-existing", existing);

    await expect(
      action.run({ action: "create", id: "existing", body: "Replacement" }),
    ).rejects.toMatchObject({
      errorCode: "draft_already_exists",
      statusCode: 409,
    });

    expect(appState.get("compose-existing")).toEqual(existing);
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("preserves a concurrently created draft and removes only its own new Gmail draft", async () => {
    const competingDraft = {
      id: "same-id",
      body: "Concurrent draft",
      savedDraftId: "gmail-competing",
    };
    mocks.saveGmailDraft.mockImplementationOnce(async () => {
      appState.set("compose-same-id", competingDraft);
      return {
        draftId: "gmail-new",
        accountEmail: "owner@example.com",
        created: true,
      };
    });

    await expect(
      action.run({ action: "create", id: "same-id", body: "New draft" }),
    ).rejects.toMatchObject({
      errorCode: "draft_already_exists",
      statusCode: 409,
    });

    expect(appState.get("compose-same-id")).toEqual(competingDraft);
    expect(mocks.deleteGmailDraft).toHaveBeenCalledExactlyOnceWith({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId: "gmail-new",
    });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("still reports the collision when removing its own Gmail draft fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.saveGmailDraft.mockImplementationOnce(async () => {
      appState.set("compose-same-id", { id: "same-id", body: "Concurrent" });
      return {
        draftId: "gmail-new",
        accountEmail: "owner@example.com",
        created: true,
      };
    });
    mocks.deleteGmailDraft.mockRejectedValueOnce(new Error("Gmail 503"));

    await expect(
      action.run({ action: "create", id: "same-id", body: "New draft" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "The Gmail draft this call saved (gmail-new) couldn't be removed",
      ),
      errorCode: "draft_already_exists",
      statusCode: 409,
      details: { draftId: "same-id", leftoverGmailDraftId: "gmail-new" },
    });
    expect(mocks.deleteGmailDraft).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});

describe("manage-draft create when the draft write throws", () => {
  const writeError = new Error("connection reset");

  beforeEach(() => {
    mocks.saveGmailDraft.mockResolvedValueOnce({
      draftId: "gmail-new",
      accountEmail: "owner@example.com",
      created: true,
    });
  });

  it("removes its new Gmail draft and rethrows when the write didn't commit", async () => {
    mocks.compareAndSetAppState.mockRejectedValueOnce(writeError);

    await expect(
      action.run({ action: "create", id: "fresh", body: "New draft" }),
    ).rejects.toBe(writeError);

    expect(appState.has("compose-fresh")).toBe(false);
    expect(mocks.deleteGmailDraft).toHaveBeenCalledExactlyOnceWith({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId: "gmail-new",
    });
  });

  it("returns the draft when the write committed before throwing", async () => {
    mocks.compareAndSetAppState.mockImplementationOnce(
      async (key: string, _expected: unknown, next: unknown) => {
        appState.set(key, next);
        throw writeError;
      },
    );

    const result = await action.run({
      action: "create",
      id: "fresh",
      body: "New draft",
    });

    expect(result).toMatchObject({
      id: "fresh",
      draft: { savedDraftId: "gmail-new" },
    });
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
  });

  it("keeps the Gmail draft and says so when the outcome can't be read", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.compareAndSetAppState.mockImplementationOnce(async () => {
      mocks.readAppState.mockRejectedValue(new Error("database unavailable"));
      throw writeError;
    });

    const error = await action
      .run({ action: "create", id: "fresh", body: "New draft" })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      message: expect.stringContaining(
        "kept the Gmail draft it saved (gmail-new)",
      ),
      errorCode: "draft_store_unconfirmed",
      statusCode: 503,
      details: { draftId: "fresh", gmailDraftId: "gmail-new" },
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("write and reread both failed"),
      writeError,
    );
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("names the Gmail draft it left behind when Gmail cleanup also fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.compareAndSetAppState.mockRejectedValueOnce(writeError);
    mocks.deleteGmailDraft.mockRejectedValueOnce(new Error("Gmail 503"));

    await expect(
      action.run({ action: "create", id: "fresh", body: "New draft" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "remove the Gmail draft it saved (gmail-new)",
      ),
      errorCode: "draft_store_failed",
      statusCode: 503,
      details: { draftId: "fresh", leftoverGmailDraftId: "gmail-new" },
    });

    expect(appState.has("compose-fresh")).toBe(false);
    expect(mocks.deleteGmailDraft).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("draft fresh write failed"),
      writeError,
    );
    consoleError.mockRestore();
  });
});

describe("manage-draft local create when the draft write throws", () => {
  const writeError = new Error("connection reset");

  it("returns the draft when the write committed before throwing", async () => {
    mocks.compareAndSetAppState.mockImplementationOnce(
      async (key: string, _expected: unknown, next: unknown) => {
        appState.set(key, next);
        throw writeError;
      },
    );

    const result = await action.run({ action: "create", body: "Local draft" });

    expect(result).toMatchObject({ draft: { body: "Local draft" } });
    expect(appState.size).toBe(1);
  });

  it("rethrows when the write didn't commit", async () => {
    mocks.compareAndSetAppState.mockRejectedValueOnce(writeError);

    await expect(
      action.run({ action: "create", id: "fresh", body: "Local draft" }),
    ).rejects.toBe(writeError);
    expect(appState.has("compose-fresh")).toBe(false);
  });

  it("rethrows when another draft holds the key after the write throws", async () => {
    mocks.compareAndSetAppState.mockImplementationOnce(async (key: string) => {
      appState.set(key, { id: "fresh", body: "Someone else's draft" });
      throw writeError;
    });

    await expect(
      action.run({ action: "create", id: "fresh", body: "Local draft" }),
    ).rejects.toBe(writeError);
  });

  it("says to check before creating again when the outcome can't be read", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.compareAndSetAppState.mockImplementationOnce(async () => {
      mocks.readAppState.mockRejectedValue(new Error("database unavailable"));
      throw writeError;
    });

    const error = await action
      .run({ action: "create", id: "fresh", body: "Local draft" })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      message:
        'Mail couldn\'t confirm whether draft "fresh" was stored. Check for draft "fresh" before creating it again.',
      errorCode: "draft_store_unconfirmed",
      statusCode: 503,
      details: { draftId: "fresh" },
    });
    consoleError.mockRestore();
  });
});
