import type { Document } from "@shared/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localSourceAbsolutePath,
  readDocumentFromLinkedLocalSource,
  rememberLinkedLocalSourceDirectory,
  revealLinkedLocalSourceFile,
  sourceFileContent,
  watchLinkedLocalSource,
  writeDocumentToLinkedLocalSource,
} from "./local-content-source-files";

const document: Document = {
  id: "doc_1234",
  parentId: null,
  title: "Getting Started",
  content: "Hello from the editor.",
  icon: null,
  position: 0,
  isFavorite: false,
  hideFromSearch: false,
  visibility: "private",
  accessRole: "owner",
  canEdit: true,
  canManage: true,
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T01:00:00.000Z",
  source: {
    mode: "local-files",
    kind: "file",
    path: "content/getting-started.mdx",
  },
};

describe("local content source files", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("preserves source-owned frontmatter while replacing Content-managed fields", () => {
    const existingSource = `---
title: "Old title"
tags: ["acceptance", "local"]
unchanged_key: preserve-me
# source-owned comment
---

Old body`;

    const serialized = sourceFileContent(document, existingSource);

    expect(serialized).toContain('title: "Getting Started"');
    expect(serialized).not.toContain('title: "Old title"');
    expect(serialized).toContain('tags: ["acceptance", "local"]');
    expect(serialized).toContain("unchanged_key: preserve-me");
    expect(serialized).toContain("# source-owned comment");
    expect(serialized).toContain("Hello from the editor.");
  });

  it("writes an edited document through the desktop single-file bridge", async () => {
    const folder = {
      id: "folder-repo",
      name: "repo",
      path: "/Users/steve/repo",
    };
    const writeFile = vi.fn().mockResolvedValue({
      ok: true,
      folder,
      files: ["content/getting-started.mdx"],
    });
    const writeFiles = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({ ok: true, folder }),
            chooseFolder: vi.fn(),
            writeFiles,
            writeFile,
            readFiles: vi.fn().mockResolvedValue({
              ok: true,
              folder,
              sources: {
                "content/getting-started.mdx":
                  '---\ntags: "keep-me"\n---\n\nOriginal',
              },
              revisions: { "content/getting-started.mdx": "a".repeat(64) },
            }),
            revealFile: vi.fn(),
            clearFolder: vi.fn(),
          },
        },
      },
    });

    const result = await writeDocumentToLinkedLocalSource(document);

    expect(result).toMatchObject({
      ok: true,
      path: "content/getting-started.mdx",
      runtime: "desktop",
    });
    expect(writeFile).toHaveBeenCalledWith({
      folderId: "folder-repo",
      path: "content/getting-started.mdx",
      content: expect.stringContaining("Hello from the editor."),
      expectedRevision: "a".repeat(64),
    });
    expect(writeFile.mock.calls[0]?.[0].content).toContain(
      'title: "Getting Started"',
    );
    expect(writeFile.mock.calls[0]?.[0].content).toContain('tags: "keep-me"');
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it("uses source identity to choose the matching Desktop folder", async () => {
    const selectedFolder = {
      id: "folder-selected",
      name: "selected-source",
      sourcePrefix: "display-prefix",
    };
    const writeFile = vi.fn().mockResolvedValue({
      ok: true,
      folder: selectedFolder,
      files: ["notes/roundtrip.md"],
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({
              ok: true,
              folder: { id: "folder-other", name: "other-source" },
              folders: [
                { id: "folder-other", name: "other-source" },
                selectedFolder,
              ],
            }),
            chooseFolder: vi.fn(),
            writeFiles: vi.fn(),
            writeFile,
            readFiles: vi.fn().mockResolvedValue({
              ok: true,
              folder: selectedFolder,
              sources: { "notes/roundtrip.md": "Original" },
              revisions: { "notes/roundtrip.md": "b".repeat(64) },
            }),
            revealFile: vi.fn(),
            clearFolder: vi.fn(),
          },
        },
      },
    });
    const selectedDocument: Document = {
      ...document,
      source: {
        mode: "local-files",
        kind: "file",
        path: "notes/roundtrip.md",
        rootPath: "folder-selected",
      },
    };

    await expect(
      writeDocumentToLinkedLocalSource(selectedDocument),
    ).resolves.toMatchObject({ ok: true, runtime: "desktop" });
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: "folder-selected",
        path: "notes/roundtrip.md",
      }),
    );
  });

  it("passes the observed revision to Desktop and returns a typed stale-write conflict", async () => {
    const folder = { id: "folder-repo", name: "repo" };
    const writeFile = vi.fn().mockResolvedValue({
      ok: false,
      error: "The local file changed.",
      code: "conflict",
      conflict: {
        path: "content/getting-started.mdx",
        expectedRevision: "sha256:old",
        actualRevision: { hash: "sha256:new" },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({ ok: true, folder }),
            chooseFolder: vi.fn(),
            writeFiles: vi.fn(),
            writeFile,
            readFiles: vi.fn().mockResolvedValue({
              ok: true,
              folder,
              sources: {
                "content/getting-started.mdx": "Original",
              },
            }),
            revealFile: vi.fn(),
            clearFolder: vi.fn(),
          },
        },
      },
    });

    await expect(
      writeDocumentToLinkedLocalSource(document, undefined, {
        expectedRevision: "sha256:old",
      }),
    ).resolves.toMatchObject({
      ok: false,
      conflict: {
        path: "content/getting-started.mdx",
        expectedRevision: "sha256:old",
        actualRevision: { hash: "sha256:new" },
      },
    });
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: "sha256:old",
      }),
    );
  });

  it("rejects a stale browser write without replacing the physical file", async () => {
    let physicalContent = [
      "---",
      'title: "Getting Started"',
      "---",
      "",
      "Original browser body.",
    ].join("\n");
    const write = vi.fn(async (next: string) => {
      physicalContent = next;
    });
    const truncate = vi.fn(async (size: number) => {
      physicalContent = physicalContent.slice(0, size);
    });
    const close = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const fileHandle = {
      kind: "file" as const,
      name: "getting-started.mdx",
      getFile: vi.fn(
        async () =>
          ({
            text: async () => physicalContent,
            lastModified: Date.parse("2026-06-12T02:00:00.000Z"),
          }) as File,
      ),
      createWritable: vi.fn(async () => ({ write, truncate, close, abort })),
    };
    const root = {
      kind: "directory" as const,
      name: "content",
      values: vi.fn(),
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn(async () => fileHandle),
      queryPermission: vi.fn(async () => "granted" as const),
      requestPermission: vi.fn(async () => "granted" as const),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    rememberLinkedLocalSourceDirectory(root);
    const baseline = await readDocumentFromLinkedLocalSource(document);
    expect(baseline).toMatchObject({ ok: true, runtime: "browser" });
    if (!baseline.ok) throw new Error(baseline.error);

    physicalContent = physicalContent.replace(
      "Original browser body.",
      "Changed outside Content.",
    );
    const editedDocument = {
      ...document,
      content: "Agent replacement.",
    };
    const result = await writeDocumentToLinkedLocalSource(
      editedDocument,
      undefined,
      { expectedRevision: baseline.revision },
    );

    expect(result).toMatchObject({
      ok: false,
      conflict: {
        path: "content/getting-started.mdx",
        expectedRevision: baseline.revision,
      },
    });
    expect(write).not.toHaveBeenCalled();
    expect(truncate).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(physicalContent).toContain("Changed outside Content.");
    expect(fileHandle.createWritable).toHaveBeenCalledWith({
      keepExistingData: true,
      mode: "exclusive",
    });
  });

  it("truncates a browser file before committing shorter content", async () => {
    let physicalContent = [
      "---",
      'title: "Getting Started"',
      "---",
      "",
      "A deliberately long original browser body.",
    ].join("\n");
    const write = vi.fn(async (next: string) => {
      physicalContent = next + physicalContent.slice(next.length);
    });
    const truncate = vi.fn(async (size: number) => {
      physicalContent = physicalContent.slice(0, size);
    });
    const close = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const fileHandle = {
      kind: "file" as const,
      name: "getting-started.mdx",
      getFile: vi.fn(
        async () =>
          ({
            text: async () => physicalContent,
            lastModified: Date.parse("2026-06-12T02:00:00.000Z"),
          }) as File,
      ),
      createWritable: vi.fn(async () => ({ write, truncate, close, abort })),
    };
    const root = {
      kind: "directory" as const,
      name: "content",
      values: vi.fn(),
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn(async () => fileHandle),
      queryPermission: vi.fn(async () => "granted" as const),
      requestPermission: vi.fn(async () => "granted" as const),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    rememberLinkedLocalSourceDirectory(root);
    const baseline = await readDocumentFromLinkedLocalSource(document);
    if (!baseline.ok) throw new Error(baseline.error);

    const result = await writeDocumentToLinkedLocalSource(
      { ...document, content: "Short." },
      undefined,
      { expectedRevision: baseline.revision },
    );

    expect(result).toMatchObject({ ok: true });
    expect(truncate).toHaveBeenCalledWith(0);
    expect(physicalContent).not.toContain("deliberately long original");
    expect(close).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts the exclusive browser writer after a write failure", async () => {
    const physicalContent = [
      "---",
      'title: "Getting Started"',
      "---",
      "",
      "Original.",
    ].join("\n");
    const write = vi.fn(async () => {
      throw new Error("synthetic write failure");
    });
    const truncate = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const fileHandle = {
      kind: "file" as const,
      name: "getting-started.mdx",
      getFile: vi.fn(
        async () =>
          ({
            text: async () => physicalContent,
            lastModified: Date.parse("2026-06-12T02:00:00.000Z"),
          }) as File,
      ),
      createWritable: vi.fn(async () => ({ write, truncate, close, abort })),
    };
    const root = {
      kind: "directory" as const,
      name: "content",
      values: vi.fn(),
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn(async () => fileHandle),
      queryPermission: vi.fn(async () => "granted" as const),
      requestPermission: vi.fn(async () => "granted" as const),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    rememberLinkedLocalSourceDirectory(root);
    const baseline = await readDocumentFromLinkedLocalSource(document);
    if (!baseline.ok) throw new Error(baseline.error);

    await expect(
      writeDocumentToLinkedLocalSource(
        { ...document, content: "Replacement." },
        undefined,
        { expectedRevision: baseline.revision },
      ),
    ).rejects.toThrow("synthetic write failure");
    expect(abort).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("returns a no-write conflict when another browser writer holds the file", async () => {
    const physicalContent = [
      "---",
      'title: "Getting Started"',
      "---",
      "",
      "Original browser body.",
    ].join("\n");
    const fileHandle = {
      kind: "file" as const,
      name: "getting-started.mdx",
      getFile: vi.fn(
        async () =>
          ({
            text: async () => physicalContent,
            lastModified: Date.parse("2026-06-12T02:00:00.000Z"),
          }) as File,
      ),
      createWritable: vi.fn(async () => {
        throw new DOMException(
          "A writer already holds this file.",
          "NoModificationAllowedError",
        );
      }),
    };
    const root = {
      kind: "directory" as const,
      name: "content",
      values: vi.fn(),
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn(async () => fileHandle),
      queryPermission: vi.fn(async () => "granted" as const),
      requestPermission: vi.fn(async () => "granted" as const),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    rememberLinkedLocalSourceDirectory(root);
    const baseline = await readDocumentFromLinkedLocalSource(document);
    if (!baseline.ok) throw new Error(baseline.error);

    const result = await writeDocumentToLinkedLocalSource(
      { ...document, content: "Agent replacement." },
      undefined,
      { expectedRevision: baseline.revision },
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("already open for writing"),
      conflict: {
        path: "content/getting-started.mdx",
        expectedRevision: baseline.revision,
      },
    });
    expect(fileHandle.createWritable).toHaveBeenCalledWith({
      keepExistingData: true,
      mode: "exclusive",
    });
    expect(physicalContent).toContain("Original browser body.");
  });

  it("filters Desktop watch events to the linked source file", async () => {
    const folder = { id: "folder-repo", name: "repo" };
    let listener:
      | ((change: { type: "modified"; path: string }) => void)
      | undefined;
    const unsubscribe = vi.fn();
    const watchFiles = vi
      .fn()
      .mockImplementation(async (_request, callback) => {
        listener = callback;
        return { ok: true, unsubscribe };
      });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({ ok: true, folder }),
            chooseFolder: vi.fn(),
            writeFiles: vi.fn(),
            writeFile: vi.fn(),
            readFiles: vi.fn(),
            revealFile: vi.fn(),
            clearFolder: vi.fn(),
            watchFiles,
          },
        },
      },
    });
    const onChange = vi.fn();
    const result = await watchLinkedLocalSource(document.source, onChange);
    listener?.({ type: "modified", path: "content/other.mdx" });
    listener?.({ type: "modified", path: "content/getting-started.mdx" });

    expect(result).toMatchObject({ ok: true });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: "content/getting-started.mdx",
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not expose a linked desktop folder path to the web client", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({
              ok: true,
              folder: { name: "content", path: "/Users/steve/repo/content" },
            }),
            chooseFolder: vi.fn(),
            writeFiles: vi.fn(),
            writeFile: vi.fn(),
            readFiles: vi.fn(),
            revealFile: vi.fn(),
            clearFolder: vi.fn(),
          },
        },
      },
    });

    await expect(localSourceAbsolutePath(document.source)).resolves.toBeNull();
  });

  it("reads linked desktop source files as the document authority", async () => {
    const folder = {
      id: "folder-repo",
      name: "repo",
      path: "/Users/steve/repo",
      updatedAt: "2026-06-12T02:00:00.000Z",
    };
    const readFiles = vi.fn().mockResolvedValue({
      ok: true,
      folder,
      sources: {
        "content/getting-started.mdx": [
          "---",
          'id: "doc_1234"',
          'title: "File Title"',
          "isFavorite: true",
          "---",
          "",
          "File body from disk.",
        ].join("\n"),
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({ ok: true, folder }),
            chooseFolder: vi.fn(),
            writeFiles: vi.fn(),
            writeFile: vi.fn(),
            readFiles,
            revealFile: vi.fn(),
            clearFolder: vi.fn(),
          },
        },
      },
    });

    const result = await readDocumentFromLinkedLocalSource(document);

    expect(result).toMatchObject({
      ok: true,
      path: "content/getting-started.mdx",
      updatedAt: "2026-06-12T02:00:00.000Z",
      runtime: "desktop",
      document: {
        id: "doc_1234",
        title: "File Title",
        content: "File body from disk.",
        isFavorite: true,
      },
    });
    expect(readFiles).toHaveBeenCalledTimes(1);
    expect(readFiles).toHaveBeenCalledWith({ folderId: "folder-repo" });
  });

  it("reveals a linked desktop source file through the desktop bridge", async () => {
    const folder = {
      id: "folder-repo",
      name: "repo",
      path: "/Users/steve/repo",
    };
    const revealFile = vi.fn().mockResolvedValue({
      ok: true,
      folder,
      files: ["content/getting-started.mdx"],
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn().mockResolvedValue({ ok: true, folder }),
            chooseFolder: vi.fn(),
            writeFiles: vi.fn(),
            writeFile: vi.fn(),
            readFiles: vi.fn(),
            revealFile,
            clearFolder: vi.fn(),
          },
        },
      },
    });

    const result = await revealLinkedLocalSourceFile(document.source);

    expect(result).toMatchObject({
      ok: true,
      path: "content/getting-started.mdx",
      runtime: "desktop",
    });
    expect(revealFile).toHaveBeenCalledWith({
      folderId: "folder-repo",
      path: "content/getting-started.mdx",
    });
  });
});
