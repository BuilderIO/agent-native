import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  flush: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: mocks.access }));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "https://example.test/page/doc",
}));
vi.mock("./_database-utils.js", () => ({
  isSoftDeletedDatabaseDocument: mocks.deleted,
}));
vi.mock("./_document-flush.js", () => ({
  flushOpenDocumentEditorToSql: mocks.flush,
}));
import pullDocument from "./pull-document";

const resource = {
  id: "doc",
  title: "Later title",
  content: "Later unrelated body",
  trashedAt: null,
  ownerEmail: "writer@example.test",
};
const snapshot = {
  bodyRevision: 4,
  title: "Captured title",
  content: "Captured body",
  contentHash: "hash",
  updatedAt: "2026-10-19T12:00:00Z",
};
const editors = [
  {
    clientId: 123,
    editorSessionId: "editor",
    flush: "answered",
    prepareToken: "before-S",
    verifyToken: "after-S",
  },
];
describe("pull-document captured freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ resource });
    mocks.deleted.mockResolvedValue(false);
    mocks.flush.mockResolvedValue({ status: "flushed", snapshot, editors });
  });
  it("returns S and its typed receipts after rechecking access, without substituting a later body or title", async () => {
    expect(
      await pullDocument.run({ id: "doc", format: "markdown" }),
    ).toMatchObject({
      title: "Captured title",
      content: "Captured body",
      editorFlush: { status: "flushed", editors },
    });
    expect(mocks.access).toHaveBeenCalledTimes(2);
    const result = await pullDocument.run({ id: "doc", format: "markdown" });
    expect(result.editorFlush).not.toHaveProperty("snapshot");
  });
  it("refuses the captured body if document access is revoked during confirmation", async () => {
    mocks.access
      .mockResolvedValueOnce({ resource })
      .mockResolvedValueOnce(null);
    await expect(
      pullDocument.run({ id: "doc", format: "markdown" }),
    ).rejects.toThrow("not found");
  });
  it("refuses the captured body if it is trashed during confirmation", async () => {
    mocks.deleted.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(
      pullDocument.run({ id: "doc", format: "markdown" }),
    ).rejects.toThrow("not found");
  });
  it("reads SQL normally when no editor is registered", async () => {
    mocks.flush.mockResolvedValue({ status: "no_open_editor" });
    expect(
      await pullDocument.run({ id: "doc", format: "markdown" }),
    ).toMatchObject({
      title: resource.title,
      content: resource.content,
      editorFlush: { status: "no_open_editor" },
    });
  });
});
