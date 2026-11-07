import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@agent-native/core/client/hooks", () => ({ callAction: vi.fn() }));

import type { ImportResult } from "@/lib/design-import";
import type { PreparedFigImport } from "@/lib/fig-client-import";
import { FIG_IMPORT_TOAST_ID } from "@/lib/pending-import";

import { BROWSER_FIG_LIMITS } from "../../../../server/lib/fig-file-limits.js";
import {
  runImportDesignFile,
  type ImportDesignFileArgs,
  type ImportDesignFileDeps,
} from "./import-design-file";

const t = (key: string) => key;

/** A bare fig-kiwi file whose document chunk declares `documentBytes`. */
function kiwiFile(documentBytes: number): File {
  const document = new Uint8Array(17);
  document.set([0x28, 0xb5, 0x2f, 0xfd, 0xe0], 0);
  new DataView(document.buffer).setBigUint64(5, BigInt(documentBytes), true);
  const schema = new Uint8Array([1, 2, 3, 4]);
  const bytes = new Uint8Array(12 + 4 + schema.length + 4 + document.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("fig-kiwi"), 0);
  view.setUint32(8, 48, true);
  view.setUint32(12, schema.length, true);
  bytes.set(schema, 16);
  view.setUint32(16 + schema.length, document.length, true);
  bytes.set(document, 20 + schema.length);
  return new File([bytes], "Brand.fig");
}

function prepared(frameCount: number): PreparedFigImport {
  return {
    file: kiwiFile(1024),
    summary: {
      pageCount: 3,
      frameCount,
      nodeCount: 10,
      imageCount: 0,
      pages: [],
    },
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

const imported: ImportResult = {
  designId: "design-1",
  files: [
    { id: "f1", filename: "a.html" },
    { id: "f2", filename: "b.html" },
  ],
};

function setup(overrides: Partial<ImportDesignFileDeps> = {}) {
  const deps = {
    prepareFigImport: vi.fn(async () => prepared(24)),
    importFigInBrowser: vi.fn(async () => imported),
    uploadDesignFile: vi.fn(async () => imported),
    importHtml: vi.fn(async () => imported),
    isUploadStorageConfigured: vi.fn(async () => true),
    ...overrides,
  };
  const onImported = vi.fn(async () => {});
  const onRetry = vi.fn();
  const args = (file: File): ImportDesignFileArgs => ({
    designId: "design-1",
    file,
    t,
    formatNumber: String,
    formatList: (items) => items.join(", "),
    onImported,
    onRetry,
    deps,
  });
  return { deps, onImported, onRetry, args };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runImportDesignFile", () => {
  it("imports every page of a .fig with no selection step", async () => {
    const { deps, onImported, args } = setup();
    const file = kiwiFile(40 * 1024 * 1024);

    const running = runImportDesignFile(args(file));
    expect(toastMock.loading).toHaveBeenCalledWith(
      "designEditor.import.figImportAnalyzing",
      { id: FIG_IMPORT_TOAST_ID, description: "Brand.fig" },
    );
    await expect(running).resolves.toEqual({
      status: "imported",
      result: imported,
    });

    expect(deps.prepareFigImport).toHaveBeenCalledWith(file);
    const options = vi.mocked(deps.importFigInBrowser).mock.calls[0]![0];
    expect(options).toMatchObject({ designId: "design-1", file });
    expect(options).not.toHaveProperty("selection");
    expect(onImported).toHaveBeenCalledWith(imported);
    expect(toastMock.success).toHaveBeenCalledWith("Imported 2 screens.", {
      id: FIG_IMPORT_TOAST_ID,
      description: undefined,
    });
  });

  it("refuses an oversized .fig before decoding it and suggests a link", async () => {
    const { deps, onImported, args } = setup();

    await expect(
      runImportDesignFile(args(kiwiFile(600 * 1024 * 1024))),
    ).resolves.toEqual({ status: "refused", reason: "too-large" });

    expect(deps.prepareFigImport).not.toHaveBeenCalled();
    expect(deps.uploadDesignFile).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "designEditor.import.errors.importFailed",
      {
        id: FIG_IMPORT_TOAST_ID,
        description: "designEditor.import.errors.figFileTooLarge",
        action: undefined,
      },
    );
  });

  it("refuses a whole file with more frames than the limit instead of importing part of it", async () => {
    const tooMany = prepared(BROWSER_FIG_LIMITS.frames + 1);
    const { deps, args } = setup({
      prepareFigImport: vi.fn(async () => tooMany),
    });

    await expect(runImportDesignFile(args(kiwiFile(1024)))).resolves.toEqual({
      status: "refused",
      reason: "too-large",
    });

    expect(tooMany.dispose).toHaveBeenCalledOnce();
    expect(deps.importFigInBrowser).not.toHaveBeenCalled();
    expect(deps.uploadDesignFile).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "designEditor.import.errors.importFailed",
      expect.objectContaining({
        description: "designEditor.import.errors.figFileTooLarge",
      }),
    );
  });

  it("falls back to the upload route when a small file fails to decode in the browser", async () => {
    const { deps, args } = setup({
      prepareFigImport: vi.fn(async () => {
        throw new Error("schema changed");
      }),
    });

    await expect(
      runImportDesignFile(args(kiwiFile(1024))),
    ).resolves.toMatchObject({ status: "imported" });
    expect(deps.uploadDesignFile).toHaveBeenCalledOnce();
  });

  it("reports a decode failure with a retry when no upload fallback is available", async () => {
    const { deps, onRetry, args } = setup({
      prepareFigImport: vi.fn(async () => {
        throw new Error("schema changed");
      }),
      isUploadStorageConfigured: vi.fn(async () => false),
    });

    await expect(
      runImportDesignFile(args(kiwiFile(1024))),
    ).resolves.toMatchObject({ status: "failed" });
    expect(deps.uploadDesignFile).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "designEditor.import.errors.importFailed",
      {
        id: FIG_IMPORT_TOAST_ID,
        description: "schema changed",
        action: { label: "homeContext.retry", onClick: onRetry },
      },
    );
  });

  it("imports a standalone HTML file", async () => {
    const { deps, onImported, args } = setup();
    const file = new File(["<main>Hello</main>"], "page.html");

    await expect(runImportDesignFile(args(file))).resolves.toMatchObject({
      status: "imported",
    });
    expect(deps.importHtml).toHaveBeenCalledWith({
      designId: "design-1",
      content: "<main>Hello</main>",
      originalName: "page.html",
    });
    expect(onImported).toHaveBeenCalledWith(imported);
    expect(deps.prepareFigImport).not.toHaveBeenCalled();
  });

  it("refuses other file types without starting an import", async () => {
    const { deps, args } = setup();

    await expect(
      runImportDesignFile(args(new File(["x"], "notes.txt"))),
    ).resolves.toEqual({ status: "refused", reason: "unsupported" });
    expect(toastMock.loading).not.toHaveBeenCalled();
    expect(deps.importHtml).not.toHaveBeenCalled();
  });
});
