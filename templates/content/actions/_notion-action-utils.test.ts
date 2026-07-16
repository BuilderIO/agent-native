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
  getCurrentNotionCaller,
  getNotionDocumentAuthority,
  resolveDocumentId,
} from "./_notion-action-utils";

beforeEach(() => {
  mocks.getRequestOrgId.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.assertAccess.mockReset();
  mocks.flushOpenDocumentEditorToSql.mockReset();
});

describe("getCurrentNotionCaller", () => {
  it("returns the requesting user's email", () => {
    mocks.getRequestUserEmail.mockReturnValue("requester@example.com");
    expect(getCurrentNotionCaller()).toBe("requester@example.com");
  });

  it("throws when there is no authenticated user", () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    expect(() => getCurrentNotionCaller()).toThrow("no authenticated user");
  });
});

describe("getNotionDocumentAuthority", () => {
  it("keeps the shared editor's OAuth caller distinct from document ownership", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor-b@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: { id: "doc-1", ownerEmail: "owner-a@example.com" },
    });

    const authority = await getNotionDocumentAuthority("doc-1");

    expect(authority).toEqual({
      callerEmail: "editor-b@example.com",
      documentOwnerEmail: "owner-a@example.com",
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
      { userEmail: "editor-b@example.com", orgId: "org-1" },
    );
  });

  it("uses the owner as caller only when the owner initiated the operation", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner-a@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockResolvedValue({
      role: "owner",
      resource: { id: "doc-1", ownerEmail: "owner-a@example.com" },
    });

    await expect(getNotionDocumentAuthority("doc-1")).resolves.toEqual({
      callerEmail: "owner-a@example.com",
      documentOwnerEmail: "owner-a@example.com",
    });
  });

  it("keeps an organization editor's caller identity distinct from the owner", async () => {
    mocks.getRequestUserEmail.mockReturnValue("org-editor@example.com");
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: { id: "doc-1", ownerEmail: "owner-a@example.com" },
    });

    await expect(getNotionDocumentAuthority("doc-1")).resolves.toEqual({
      callerEmail: "org-editor@example.com",
      documentOwnerEmail: "owner-a@example.com",
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "document",
      "doc-1",
      "editor",
      { userEmail: "org-editor@example.com", orgId: "org-1" },
    );
  });

  it("rejects an unauthenticated document operation before access lookup", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(getNotionDocumentAuthority("doc-1")).rejects.toThrow(
      "no authenticated user",
    );
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("throws Document not found when the resolved resource has no owner email", async () => {
    mocks.getRequestUserEmail.mockReturnValue("editor-b@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: { id: "doc-1" },
    });

    await expect(getNotionDocumentAuthority("doc-1")).rejects.toThrow(
      "Document not found",
    );
  });

  it("propagates access errors (e.g. no access) unchanged", async () => {
    mocks.getRequestUserEmail.mockReturnValue("stranger@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockRejectedValue(
      new Error("No access to document doc-1"),
    );

    await expect(getNotionDocumentAuthority("doc-1")).rejects.toThrow(
      "No access to document doc-1",
    );
  });

  it("rejects viewers because Notion workflows require editor access", async () => {
    mocks.getRequestUserEmail.mockReturnValue("viewer@example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    mocks.assertAccess.mockRejectedValue(new Error("Requires editor access"));

    await expect(getNotionDocumentAuthority("doc-1")).rejects.toThrow(
      "Requires editor access",
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
