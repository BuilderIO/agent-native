import { describe, expect, it, vi } from "vitest";

import {
  canCopyPngToClipboard,
  copyPngPromiseToClipboard,
  PngClipboardError,
  type PngClipboardEnvironment,
} from "./png-clipboard";

function clipboardEnvironment(options?: {
  supports?: boolean;
  write?: (items: ClipboardItem[]) => Promise<void>;
}) {
  const constructed: Array<Record<string, Blob | Promise<Blob>>> = [];
  class FakeClipboardItem {
    static supports() {
      return options?.supports ?? true;
    }

    constructor(items: Record<string, Blob | Promise<Blob>>) {
      constructed.push(items);
    }
  }
  const write = vi.fn(options?.write ?? (async () => undefined));
  return {
    constructed,
    write,
    environment: {
      clipboard: { write },
      ClipboardItem: FakeClipboardItem,
    } as unknown as PngClipboardEnvironment,
  };
}

describe("PNG clipboard", () => {
  it("starts clipboard.write immediately with a promised image/png Blob", async () => {
    let resolveBlob!: (blob: Blob) => void;
    const pngBlob = new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    });
    const { constructed, environment, write } = clipboardEnvironment({
      write: async (items) => {
        expect(items).toHaveLength(1);
        const blob = await constructed[0]!["image/png"];
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe("image/png");
      },
    });

    const operation = copyPngPromiseToClipboard(pngBlob, environment);

    expect(write).toHaveBeenCalledTimes(1);
    expect(constructed).toHaveLength(1);
    expect(constructed[0]!["image/png"]).toBeInstanceOf(Promise);

    resolveBlob(new Blob(["png"], { type: "image/png" }));
    await operation;
  });

  it("reports unsupported browsers before attempting a write", async () => {
    const { environment, write } = clipboardEnvironment({ supports: false });

    expect(canCopyPngToClipboard(environment)).toBe(false);
    await expect(
      copyPngPromiseToClipboard(Promise.resolve(new Blob()), environment),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(write).not.toHaveBeenCalled();
  });

  it("classifies clipboard permission failures without hiding the cause", async () => {
    const permissionError = new DOMException("denied", "NotAllowedError");
    const { environment } = clipboardEnvironment({
      write: async () => {
        throw permissionError;
      },
    });

    const result = copyPngPromiseToClipboard(
      Promise.resolve(new Blob(["png"], { type: "image/png" })),
      environment,
    );
    await expect(result).rejects.toBeInstanceOf(PngClipboardError);
    await expect(result).rejects.toMatchObject({ code: "blocked" });
  });

  it("preserves a PNG renderer failure from the promised representation", async () => {
    const renderError = new Error("renderer failed");
    const { constructed, environment } = clipboardEnvironment({
      write: async () => {
        await constructed[0]!["image/png"];
      },
    });

    await expect(
      copyPngPromiseToClipboard(Promise.reject(renderError), environment),
    ).rejects.toBe(renderError);
  });
});
