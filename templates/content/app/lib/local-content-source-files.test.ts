import type { Document } from "@shared/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  localSourceAbsolutePath,
  readDocumentFromLinkedLocalSource,
  revealLinkedLocalSourceFile,
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
            readFiles: vi.fn(),
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
    });
    expect(writeFile.mock.calls[0]?.[0].content).toContain(
      'title: "Getting Started"',
    );
    expect(writeFiles).not.toHaveBeenCalled();
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
            readFiles: vi.fn(),
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
