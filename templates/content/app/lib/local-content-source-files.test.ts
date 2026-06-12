import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@shared/api";
import {
  localSourceAbsolutePath,
  revealLinkedLocalSourceFile,
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
    const writeFile = vi.fn().mockResolvedValue({
      ok: true,
      folder: { name: "repo", path: "/Users/steve/repo" },
      files: ["content/getting-started.mdx"],
    });
    const writeFiles = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn(),
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
      absolutePath: "/Users/steve/repo/content/getting-started.mdx",
      runtime: "desktop",
    });
    expect(writeFile).toHaveBeenCalledWith({
      path: "content/getting-started.mdx",
      content: expect.stringContaining("Hello from the editor."),
    });
    expect(writeFile.mock.calls[0]?.[0].content).toContain(
      'title: "Getting Started"',
    );
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it("resolves absolute paths from a linked desktop content folder", async () => {
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

    await expect(localSourceAbsolutePath(document.source)).resolves.toBe(
      "/Users/steve/repo/content/getting-started.mdx",
    );
  });

  it("reveals a linked desktop source file through the desktop bridge", async () => {
    const revealFile = vi.fn().mockResolvedValue({
      ok: true,
      folder: { name: "repo", path: "/Users/steve/repo" },
      files: ["content/getting-started.mdx"],
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        agentNativeDesktop: {
          contentFiles: {
            getFolder: vi.fn(),
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
      absolutePath: "/Users/steve/repo/content/getting-started.mdx",
      runtime: "desktop",
    });
    expect(revealFile).toHaveBeenCalledWith({
      path: "content/getting-started.mdx",
    });
  });
});
