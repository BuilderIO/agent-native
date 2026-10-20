// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESIGN_IMPORT_FORMATS,
  FIGMA_IMPORT_FORMAT,
  importFilePickerTypes,
  importFormatsAccept,
  pickImportFile,
  requestImportFile,
  supportsNativeImportPicker,
} from "./design-import-file-picker";

const ALL_SUPPORTED = "All supported files";

function installPicker(picker: unknown) {
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true,
    value: picker,
  });
}

function pickerReturning(file: File) {
  return vi.fn().mockResolvedValue([{ getFile: async () => file }]);
}

afterEach(() => {
  Reflect.deleteProperty(window, "showOpenFilePicker");
});

describe("import format map", () => {
  it("names each format and lists its extensions", () => {
    expect(importFilePickerTypes(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED)).toEqual(
      [
        {
          description: ALL_SUPPORTED,
          accept: {
            "application/x-figma": [".fig"],
            "text/html": [".html", ".htm"],
          },
        },
        {
          description: "Figma (.fig)",
          accept: { "application/x-figma": [".fig"] },
        },
        {
          description: "HTML (.html, .htm)",
          accept: { "text/html": [".html", ".htm"] },
        },
      ],
    );
  });

  it("skips the combined entry when only one format is offered", () => {
    expect(importFilePickerTypes([FIGMA_IMPORT_FORMAT], ALL_SUPPORTED)).toEqual(
      [
        {
          description: "Figma (.fig)",
          accept: { "application/x-figma": [".fig"] },
        },
      ],
    );
  });

  it("derives the <input accept> fallback from the same extensions", () => {
    expect(importFormatsAccept(DESIGN_IMPORT_FORMATS)).toBe(".fig,.html,.htm");
    expect(importFormatsAccept([FIGMA_IMPORT_FORMAT])).toBe(".fig");
  });
});

describe("pickImportFile", () => {
  it("passes the named types and excludes the unfiltered option", async () => {
    const file = new File(["fig"], "Design.fig");
    const picker = pickerReturning(file);
    installPicker(picker);

    await expect(
      pickImportFile(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED),
    ).resolves.toEqual({ status: "picked", file });
    expect(picker).toHaveBeenCalledExactlyOnceWith({
      types: importFilePickerTypes(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED),
      excludeAcceptAllOption: true,
      multiple: false,
    });
  });

  it("reports a dismissed dialog as cancelled, not as an error", async () => {
    installPicker(
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );

    await expect(
      pickImportFile(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED),
    ).resolves.toEqual({ status: "cancelled" });
  });

  it("rethrows picker failures that are not a cancel", async () => {
    const blocked = new DOMException("no user gesture", "SecurityError");
    installPicker(vi.fn().mockRejectedValue(blocked));

    await expect(
      pickImportFile(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED),
    ).rejects.toBe(blocked);
  });

  it("rethrows when the picked file cannot be read", async () => {
    const gone = new DOMException("file moved", "NotFoundError");
    installPicker(
      vi.fn().mockResolvedValue([
        {
          getFile: async () => {
            throw gone;
          },
        },
      ]),
    );

    await expect(
      pickImportFile(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED),
    ).rejects.toBe(gone);
  });

  it("fails loudly when the browser has no native picker", async () => {
    await expect(
      pickImportFile(DESIGN_IMPORT_FORMATS, ALL_SUPPORTED),
    ).rejects.toThrow("native file picker is unavailable");
  });
});

describe("requestImportFile", () => {
  function run(
    overrides: Partial<Parameters<typeof requestImportFile>[0]> = {},
  ) {
    const handlers = {
      openFallbackInput: vi.fn(),
      onFile: vi.fn(),
      onError: vi.fn(),
    };
    requestImportFile({
      formats: DESIGN_IMPORT_FORMATS,
      allSupportedLabel: ALL_SUPPORTED,
      ...handlers,
      ...overrides,
    });
    return handlers;
  }

  it("falls back to the <input> synchronously when showOpenFilePicker is undefined", () => {
    expect(supportsNativeImportPicker()).toBe(false);
    const handlers = run();

    expect(handlers.openFallbackInput).toHaveBeenCalledOnce();
    expect(handlers.onFile).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("falls back to the <input> inside a cross-origin subframe", () => {
    const picker = pickerReturning(new File(["fig"], "Design.fig"));
    installPicker(picker);
    const top = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);

    const handlers = run();

    expect(handlers.openFallbackInput).toHaveBeenCalledOnce();
    expect(picker).not.toHaveBeenCalled();
    top.mockRestore();
  });

  it("hands the picked file to the existing import flow", async () => {
    const file = new File(["<main></main>"], "Landing.html");
    installPicker(pickerReturning(file));

    const handlers = run();

    await vi.waitFor(() => expect(handlers.onFile).toHaveBeenCalledWith(file));
    expect(handlers.openFallbackInput).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels", async () => {
    const picker = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    installPicker(picker);

    const handlers = run();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picker).toHaveBeenCalledOnce();
    expect(handlers.onFile).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.openFallbackInput).not.toHaveBeenCalled();
  });

  it("surfaces any other failure through onError", async () => {
    const blocked = new DOMException("no user gesture", "SecurityError");
    installPicker(vi.fn().mockRejectedValue(blocked));

    const handlers = run();

    await vi.waitFor(() =>
      expect(handlers.onError).toHaveBeenCalledWith(blocked),
    );
    expect(handlers.onFile).not.toHaveBeenCalled();
  });
});
