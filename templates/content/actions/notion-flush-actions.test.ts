import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAndLinkNotionPage: vi.fn(),
  flushNotionDocumentEditor: vi.fn(),
  getNotionDocumentOwner: vi.fn(),
  linkDocumentToNotionPage: vi.fn(),
  pullDocumentFromNotion: vi.fn(),
  pushDocumentToNotion: vi.fn(),
  resolveDocumentSyncConflict: vi.fn(),
}));

vi.mock("../server/lib/notion-sync.js", () => ({
  createAndLinkNotionPage: mocks.createAndLinkNotionPage,
  linkDocumentToNotionPage: mocks.linkDocumentToNotionPage,
  pullDocumentFromNotion: mocks.pullDocumentFromNotion,
  pushDocumentToNotion: mocks.pushDocumentToNotion,
  resolveDocumentSyncConflict: mocks.resolveDocumentSyncConflict,
}));

vi.mock("./_notion-action-utils.js", () => ({
  flushNotionDocumentEditor: mocks.flushNotionDocumentEditor,
  getNotionDocumentOwner: mocks.getNotionDocumentOwner,
  resolveDocumentId: (args: { documentId?: string; id?: string }) =>
    args.documentId ?? args.id ?? "",
}));

import createAndLinkAction from "./create-and-link-notion-page";
import linkAction from "./link-notion-page";
import pullAction from "./pull-notion-page";
import pushAction from "./push-notion-page";
import resolveAction from "./resolve-notion-sync-conflict";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getNotionDocumentOwner.mockResolvedValue("owner@example.com");
  mocks.flushNotionDocumentEditor.mockResolvedValue(undefined);
});

describe("user-triggered Notion action flushes", () => {
  it("flushes the live editor before pulling", async () => {
    await pullAction.run({ documentId: "doc-1" });

    expect(mocks.flushNotionDocumentEditor).toHaveBeenCalledWith(
      "doc-1",
      "owner@example.com",
    );
    expect(
      mocks.flushNotionDocumentEditor.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.pullDocumentFromNotion.mock.invocationCallOrder[0]);
  });

  it("flushes the live editor before resolving either conflict direction", async () => {
    await resolveAction.run({ documentId: "doc-1", direction: "pull" });

    expect(mocks.flushNotionDocumentEditor).toHaveBeenCalledWith(
      "doc-1",
      "owner@example.com",
    );
    expect(
      mocks.flushNotionDocumentEditor.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.resolveDocumentSyncConflict.mock.invocationCallOrder[0],
    );
  });

  it("flushes manual pushes but skips the redundant post-save auto-push flush", async () => {
    await pushAction.run({
      documentId: "doc-1",
      flushOpenEditor: true,
    });
    expect(mocks.flushNotionDocumentEditor).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.getNotionDocumentOwner.mockResolvedValue("owner@example.com");
    await pushAction.run({
      documentId: "doc-1",
      flushOpenEditor: false,
    });

    expect(mocks.flushNotionDocumentEditor).not.toHaveBeenCalled();
    expect(mocks.pushDocumentToNotion).toHaveBeenCalledWith(
      "owner@example.com",
      "doc-1",
    );
  });

  it("flushes before linking to an existing Notion page", async () => {
    await linkAction.run({
      documentId: "doc-1",
      pageId: "example-page-id",
    });

    expect(mocks.flushNotionDocumentEditor).toHaveBeenCalledWith(
      "doc-1",
      "owner@example.com",
    );
    expect(
      mocks.flushNotionDocumentEditor.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.linkDocumentToNotionPage.mock.invocationCallOrder[0]);
  });

  it("flushes before creating a linked Notion page", async () => {
    await createAndLinkAction.run({ documentId: "doc-1" });

    expect(mocks.flushNotionDocumentEditor).toHaveBeenCalledWith(
      "doc-1",
      "owner@example.com",
    );
    expect(
      mocks.flushNotionDocumentEditor.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.createAndLinkNotionPage.mock.invocationCallOrder[0]);
  });
});
