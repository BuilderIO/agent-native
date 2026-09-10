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
    expect(body).toContain("composeDraftId: draft.id");
    expect(body).not.toContain("compose:");
    expect(body).not.toContain("encode");
  });
});
