import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  assertAccess: vi.fn(),
  flushOpenDocumentEditorToSql: vi.fn(),
  createAndLinkNotionPage: vi.fn(),
  linkDocumentToNotionPage: vi.fn(),
  pullDocumentFromNotion: vi.fn(),
  pushDocumentToNotion: vi.fn(),
  resolveDocumentSyncConflict: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));

vi.mock("./_document-flush.js", () => ({
  flushOpenDocumentEditorToSql: mocks.flushOpenDocumentEditorToSql,
}));

vi.mock("./_document-agent-lock.js", () => ({
  assertAgentsMayEditPagesText: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));

vi.mock("../server/lib/notion-sync.js", () => ({
  createAndLinkNotionPage: mocks.createAndLinkNotionPage,
  linkDocumentToNotionPage: mocks.linkDocumentToNotionPage,
  pullDocumentFromNotion: mocks.pullDocumentFromNotion,
  pushDocumentToNotion: mocks.pushDocumentToNotion,
  resolveDocumentSyncConflict: mocks.resolveDocumentSyncConflict,
}));

import createAndLinkAction from "./create-and-link-notion-page";
import linkAction from "./link-notion-page";
import pullAction from "./pull-notion-page";
import pushAction from "./push-notion-page";
import resolveAction from "./resolve-notion-sync-conflict";

function callerIs(email: string) {
  mocks.getRequestUserEmail.mockReturnValue(email);
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.assertAccess.mockResolvedValue({
    role: email === "owner@example.com" ? "owner" : "editor",
    resource: { id: "doc-1", ownerEmail: "owner@example.com" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Notion actions that choose or overwrite the Notion page", () => {
  it("refuse a shared editor without calling Notion", async () => {
    callerIs("member@example.com");

    await expect(
      linkAction.run({ documentId: "doc-1", pageId: "page-1" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      createAndLinkAction.run({ documentId: "doc-1" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      pushAction.run({ documentId: "doc-1", flushOpenEditor: true }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      resolveAction.run({ documentId: "doc-1", direction: "push" }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mocks.linkDocumentToNotionPage).not.toHaveBeenCalled();
    expect(mocks.createAndLinkNotionPage).not.toHaveBeenCalled();
    expect(mocks.pushDocumentToNotion).not.toHaveBeenCalled();
    expect(mocks.resolveDocumentSyncConflict).not.toHaveBeenCalled();
    expect(mocks.flushOpenDocumentEditorToSql).not.toHaveBeenCalled();
  });

  it("still let a shared editor pull the page the owner linked", async () => {
    callerIs("member@example.com");

    await pullAction.run({ documentId: "doc-1" });

    expect(mocks.pullDocumentFromNotion).toHaveBeenCalledWith(
      "owner@example.com",
      "doc-1",
      expect.anything(),
      expect.anything(),
    );
  });

  it("let the owner link and push", async () => {
    callerIs("owner@example.com");

    await linkAction.run({ documentId: "doc-1", pageId: "page-1" });
    await pushAction.run({ documentId: "doc-1", flushOpenEditor: true });

    expect(mocks.linkDocumentToNotionPage).toHaveBeenCalledWith(
      "owner@example.com",
      "doc-1",
      "page-1",
      undefined,
    );
    expect(mocks.pushDocumentToNotion).toHaveBeenCalled();
  });
});
