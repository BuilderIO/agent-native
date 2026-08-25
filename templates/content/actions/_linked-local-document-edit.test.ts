import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callBrowserSession: vi.fn(),
  listBrowserSessions: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => mocks);

import {
  editLinkedLocalDocumentThroughBrowser,
  linkedLocalDocumentEditActionName,
} from "./_linked-local-document-edit.js";

const args = {
  ownerEmail: "alice@example.com",
  documentId: "doc-1",
  expectedContent: "# Original",
  edits: [{ find: "Original", replace: "Updated" }],
};

describe("editLinkedLocalDocumentThroughBrowser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls only the session advertising the exact document action", async () => {
    const exactName = linkedLocalDocumentEditActionName("doc-1");
    mocks.listBrowserSessions.mockResolvedValue([
      {
        sessionId: "other",
        actions: [{ name: "content-edit-linked-document:doc-2" }],
      },
      { sessionId: "exact", actions: [{ name: exactName }] },
    ]);
    mocks.callBrowserSession.mockResolvedValue({
      status: "persisted",
      content: "# Updated",
      title: "Updated",
      path: "fixture.mdx",
      runtime: "browser",
    });

    await expect(
      editLinkedLocalDocumentThroughBrowser(args),
    ).resolves.toMatchObject({
      status: "persisted",
      content: "# Updated",
    });
    expect(mocks.callBrowserSession).toHaveBeenCalledWith(
      "alice@example.com",
      "exact",
      expect.objectContaining({ type: "run-action", name: exactName }),
      { timeoutMs: 30_000 },
    );
  });

  it("reports unavailable instead of falling back to an unrelated tab", async () => {
    mocks.listBrowserSessions.mockResolvedValue([
      {
        sessionId: "other",
        actions: [{ name: "content-edit-linked-document:doc-2" }],
      },
    ]);

    await expect(
      editLinkedLocalDocumentThroughBrowser(args),
    ).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(mocks.callBrowserSession).not.toHaveBeenCalled();
  });

  it("fails closed when more than one tab advertises the exact document", async () => {
    const name = linkedLocalDocumentEditActionName("doc-1");
    mocks.listBrowserSessions.mockResolvedValue([
      { sessionId: "one", actions: [{ name }] },
      { sessionId: "two", actions: [{ name }] },
    ]);

    await expect(
      editLinkedLocalDocumentThroughBrowser(args),
    ).resolves.toMatchObject({
      status: "conflict",
    });
    expect(mocks.callBrowserSession).not.toHaveBeenCalled();
  });
});
