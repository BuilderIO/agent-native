import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  buildDeepLink: vi.fn(),
  getUserSetting: vi.fn(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
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
}));

vi.mock("@agent-native/core", () => ({
  embedApp: vi.fn(() => ({})),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options: Record<string, unknown>) => {
    const error = Object.assign(new Error(message), options);
    throw error;
  },
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: mocks.writeAppState,
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
});

function manageDraftSource(): string {
  return readFileSync(new URL("./manage-draft.ts", import.meta.url), "utf8");
}

describe("manage-draft MCP App", () => {
  it("reuses the real Mail app embed instead of a bespoke compose form", () => {
    const source = manageDraftSource();

    expect(source).toContain("embedApp({");
    expect(source).toContain('openLabel: "Open in Mail"');
    expect(source).toContain('iframeTitle: "Agent-Native Mail"');
    expect(source).toContain("height: 900");
    expect(source).not.toContain("mailDraftMcpAppHtml");
    expect(source).not.toContain("_mcp-apps");
    expect(source).not.toContain("data-save");
    expect(source).not.toContain("Update draft");
    expect(existsSync(new URL("./_mcp-apps.ts", import.meta.url))).toBe(false);
  });

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
  it("deletes Gmail drafts with the exact selected account", async () => {
    mocks.isConnected.mockResolvedValue(true);

    await action.run({
      action: "delete-saved",
      savedDraftId: "gmail-draft-1",
      savedDraftBackend: "gmail",
      accountEmail: "secondary@example.com",
    });

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
      action.run({ action: "update", id: "unknown", body: "Changed" }),
    ).rejects.toThrow("Could not verify the backend");
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
    expect(mocks.updateLocalSavedDraft).not.toHaveBeenCalled();
  });
});

describe("manage-draft deep link", () => {
  // Security regression test: a previous implementation base64url-encoded the
  // full compose draft (subject + recipients + body) into a `compose=` query
  // param on the deep link. That URL is surfaced to external MCP host LLMs
  // (ChatGPT / Claude), which can see and remember it; shared / exported chat
  // transcripts would leak draft contents. The deep link now carries only the
  // opaque draft id, and the full draft is read from app-state on render.
  it("no longer encodes draft contents into the URL", () => {
    const source = manageDraftSource();

    // The compose-payload encoder helpers are removed entirely.
    expect(source).not.toContain("encodeComposeDraft");
    expect(source).not.toContain("encodeComposePayload");
    expect(source).not.toContain("MAX_COMPOSE_PAYLOAD_BYTES");
    // No `compose:` field passed to buildDeepLink.
    expect(source).not.toMatch(/\bcompose:\s*encode/);
    // The deep link still carries an id-only pointer.
    expect(source).toContain("composeDraftId");
  });

  it("composeDeepLink calls buildDeepLink with only id + view + to (no payload)", () => {
    const source = manageDraftSource();

    // The composeDeepLink helper body must contain ONLY the four expected
    // properties: app, view, to, params (with composeDraftId). It must not
    // contain a `compose:` field or any encoder call. Match the function
    // body precisely to catch a regression that re-adds the payload field.
    const match = source.match(
      /function composeDeepLink\([^)]*\)[^{]*{[\s\S]*?return buildDeepLink\(\{([\s\S]*?)\}\);[\s\S]*?}/,
    );
    expect(match).toBeTruthy();
    const body = match![1];
    expect(body).toContain('app: "mail"');
    expect(body).toContain('view: "inbox"');
    expect(body).toContain('to: "/inbox"');
    expect(body).not.toContain("composeFullscreen");
    expect(body).toContain("composeDraftId: draft.id");
    expect(body).not.toContain("compose:");
    expect(body).not.toContain("encode");
  });

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
});

describe("manage-draft call-shape guidance", () => {
  // Regression for a reported failure cluster: the agent repeatedly called
  // manage-draft with no action/id at all (schema validation failed 3x
  // identically, halting with repeated_identical_tool_error) because the
  // tool description didn't spell out that action is always required and
  // that update/delete need the id returned by a prior create.
  it("describes the required action field and the create-before-update contract", () => {
    expect(action.description).toContain("action");
    expect(action.description).toMatch(/create.*update.*delete/i);
    expect(action.description).toContain("id returned by a prior create");
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

  it("keeps deletes out of the draft-created chat widget", () => {
    expect(
      action.chatUI?.when?.(
        { action: "delete" },
        { message: "Deleted draft draft-1" },
      ),
    ).toBe(false);
    expect(
      action.chatUI?.when?.(
        { action: "create" },
        {
          draft: { id: "draft-1" },
          deepLink: "/_agent-native/open?app=mail&view=inbox",
        },
      ),
    ).toBe(true);
  });
});

describe("manage-draft create-then-reply flow", () => {
  // End-to-end regression for the reported user request: find an email and
  // save a draft reply, then keep editing that same draft. This exercises
  // the create-first-then-update-with-the-returned-id flow the tool
  // description now calls out explicitly.
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

    const updated = await action.run({
      action: "update",
      id: created.id,
      body: "Hi,\n\nQuick follow-up: could you confirm your check-in date?",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.draft.body).toContain("Quick follow-up");
  });
});
