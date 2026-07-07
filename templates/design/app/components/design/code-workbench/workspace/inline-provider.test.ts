import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

import { createInlineProvider } from "./inline-provider";
import { WorkspaceStaleVersionError } from "./types";

describe("createInlineProvider", () => {
  beforeEach(() => {
    mockCallAction.mockReset();
  });

  it("lists files via list-source-files as a GET call", async () => {
    mockCallAction.mockResolvedValueOnce({
      files: [
        { path: "index.html", displayName: "index.html", fileId: "file_1" },
      ],
    });
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    const files = await provider.listFiles();

    expect(mockCallAction).toHaveBeenCalledWith(
      "list-source-files",
      { designId: "design_1" },
      { method: "GET" },
    );
    expect(files).toEqual([
      {
        path: "index.html",
        displayName: "index.html",
        fileId: "file_1",
        readonly: undefined,
      },
    ]);
  });

  it("reads files via read-source-file as a GET call", async () => {
    mockCallAction.mockResolvedValueOnce({
      content: "<h1>hi</h1>",
      versionHash: "v1",
      fileId: "file_1",
    });
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    const result = await provider.readFile("index.html");

    expect(mockCallAction).toHaveBeenCalledWith(
      "read-source-file",
      { designId: "design_1", path: "index.html" },
      { method: "GET" },
    );
    expect(result.content).toBe("<h1>hi</h1>");
    expect(result.versionHash).toBe("v1");
  });

  it("chains preview-source-edit -> apply-source-edit on save, using the preview's currentVersionHash", async () => {
    mockCallAction
      .mockResolvedValueOnce({
        okToApply: true,
        currentVersionHash: "v2",
      })
      .mockResolvedValueOnce({ versionHash: "v3" });
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    const result = await provider.writeFile("index.html", "<p>new</p>", "v1");

    expect(mockCallAction).toHaveBeenNthCalledWith(1, "preview-source-edit", {
      designId: "design_1",
      path: "index.html",
      expectedVersionHash: "v1",
      edit: { kind: "full-replace", content: "<p>new</p>" },
    });
    expect(mockCallAction).toHaveBeenNthCalledWith(2, "apply-source-edit", {
      designId: "design_1",
      path: "index.html",
      expectedVersionHash: "v2",
      edit: { kind: "full-replace", content: "<p>new</p>" },
    });
    expect(result).toEqual({ versionHash: "v3" });
  });

  it("falls back to the original expectedVersionHash when the preview omits currentVersionHash", async () => {
    mockCallAction
      .mockResolvedValueOnce({ okToApply: true })
      .mockResolvedValueOnce({ versionHash: "v2" });
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    await provider.writeFile("index.html", "<p>new</p>", "v1");

    expect(mockCallAction).toHaveBeenNthCalledWith(
      2,
      "apply-source-edit",
      expect.objectContaining({ expectedVersionHash: "v1" }),
    );
  });

  it("throws WorkspaceStaleVersionError and never applies when okToApply is false", async () => {
    mockCallAction.mockResolvedValue({
      okToApply: false,
      message: "Source file changed since it was read.",
    });
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    await expect(
      provider.writeFile("index.html", "<p>new</p>", "v1"),
    ).rejects.toBeInstanceOf(WorkspaceStaleVersionError);
    await expect(
      provider.writeFile("index.html", "<p>new</p>", "v1"),
    ).rejects.toThrow("Source file changed since it was read.");

    // Only the preview call happened each time — apply was never reached.
    expect(mockCallAction).toHaveBeenCalledTimes(2);
    expect(mockCallAction).toHaveBeenCalledWith(
      "preview-source-edit",
      expect.objectContaining({ designId: "design_1", path: "index.html" }),
    );
  });

  it("uses a default message when a stale preview omits one", async () => {
    mockCallAction.mockResolvedValueOnce({ okToApply: false });
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    await expect(
      provider.writeFile("index.html", "<p>new</p>", "v1"),
    ).rejects.toThrow("Source file changed since it was read");
  });

  it("creates files via create-file and caches the returned fileId", async () => {
    mockCallAction
      .mockResolvedValueOnce({ id: "file_9" }) // create-file
      .mockResolvedValueOnce({ id: "ignored", updated: true }); // update-file (rename)
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    await provider.createFile?.("new.html", "");
    expect(mockCallAction).toHaveBeenNthCalledWith(1, "create-file", {
      designId: "design_1",
      filename: "new.html",
      content: "",
      fileType: "html",
    });

    await provider.renameFile?.("new.html", "renamed.html");
    expect(mockCallAction).toHaveBeenNthCalledWith(2, "update-file", {
      id: "file_9",
      filename: "renamed.html",
    });
  });

  it("resolves fileId via a listFiles refresh when renaming/deleting an uncached path", async () => {
    mockCallAction
      .mockResolvedValueOnce({
        files: [{ path: "styles.css", fileId: "file_5" }],
      }) // listFiles refresh inside resolveFileId
      .mockResolvedValueOnce({ id: "file_5", deleted: true }); // delete-file
    const provider = createInlineProvider({
      designId: "design_1",
      canEdit: true,
    });

    await provider.deleteFile?.("styles.css");

    expect(mockCallAction).toHaveBeenNthCalledWith(
      1,
      "list-source-files",
      { designId: "design_1" },
      { method: "GET" },
    );
    expect(mockCallAction).toHaveBeenNthCalledWith(2, "delete-file", {
      id: "file_5",
    });
  });

  it("sets write/create/rename/delete capabilities from canEdit", () => {
    const editable = createInlineProvider({ designId: "d1", canEdit: true });
    expect(editable.capabilities).toEqual({
      write: true,
      create: true,
      rename: true,
      delete: true,
    });

    const readonly = createInlineProvider({ designId: "d1", canEdit: false });
    expect(readonly.capabilities).toEqual({
      write: false,
      create: false,
      rename: false,
      delete: false,
    });
  });

  it("uses the inline:<designId> key and kind", () => {
    const provider = createInlineProvider({
      designId: "design_42",
      canEdit: true,
    });
    expect(provider.key).toBe("inline:design_42");
    expect(provider.kind).toBe("inline");
  });
});
