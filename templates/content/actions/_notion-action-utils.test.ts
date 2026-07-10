import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  assertAccess: vi.fn(),
  flushOpenDocumentEditorToSql: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("./_document-flush.js", () => ({
  flushOpenDocumentEditorToSql: mocks.flushOpenDocumentEditorToSql,
}));

import {
  flushNotionDocumentEditor,
  getCurrentNotionOwner,
  getNotionDocumentOwner,
  resolveDocumentId,
} from "./_notion-action-utils";

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.assertAccess.mockReset();
  mocks.flushOpenDocumentEditorToSql.mockReset();
});

describe("getCurrentNotionOwner", () => {
  it("returns the requesting user's email", () => {
    mocks.getRequestUserEmail.mockReturnValue("requester@example.com");
    expect(getCurrentNotionOwner()).toBe("requester@example.com");
  });

  it("throws when there is no authenticated user", () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    expect(() => getCurrentNotionOwner()).toThrow("no authenticated user");
  });
});

describe("getNotionDocumentOwner", () => {
  it("resolves to the document owner, not the requesting editor", async () => {
    // Regression test for n3: a shared editor calling a Notion action must
    // scope by the document's actual owner (whose Notion OAuth connection and
    // sync-link rows are keyed by owner email), matching the route-layer
    // getDocumentOwnerEmail behavior — not by the requester's own email.
    mocks.getRequestUserEmail.mockReturnValue("editor-b@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: { id: "doc-1", ownerEmail: "owner-a@example.com" },
    });

    const owner = await getNotionDocumentOwner("doc-1");

    expect(owner).toBe("owner-a@example.com");
    expect(owner).not.toBe("editor-b@example.com");
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
      { userEmail: "editor-b@example.com", orgId: "org-1" },
    );
  });

  it("returns the requester's own email when they are the owner", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner-a@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: { id: "doc-1", ownerEmail: "owner-a@example.com" },
    });

    await expect(getNotionDocumentOwner("doc-1")).resolves.toBe(
      "owner-a@example.com",
    );
  });

  it("throws Document not found when the resolved resource has no owner email", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor-b@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: { id: "doc-1" },
    });

    await expect(getNotionDocumentOwner("doc-1")).rejects.toThrow(
      "Document not found",
    );
  });

  it("propagates access errors (e.g. no access) unchanged", async () => {
    mocks.getRequestUserEmail.mockReturnValue("stranger@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockRejectedValue(
      new Error("No access to document doc-1"),
    );

    await expect(getNotionDocumentOwner("doc-1")).rejects.toThrow(
      "No access to document doc-1",
    );
  });
});

describe("flushNotionDocumentEditor", () => {
  it("flushes the open editor under the document owner's session", async () => {
    mocks.flushOpenDocumentEditorToSql.mockResolvedValue(undefined);

    await flushNotionDocumentEditor("doc-1", "owner@example.com");

    expect(mocks.flushOpenDocumentEditorToSql).toHaveBeenCalledWith({
      documentId: "doc-1",
      ownerEmail: "owner@example.com",
    });
  });
});

describe("resolveDocumentId", () => {
  it("prefers documentId over id", () => {
    expect(resolveDocumentId({ documentId: "a", id: "b" })).toBe("a");
  });

  it("falls back to id", () => {
    expect(resolveDocumentId({ id: "b" })).toBe("b");
  });

  it("throws when neither is provided", () => {
    expect(() => resolveDocumentId({})).toThrow("documentId is required");
  });
});
