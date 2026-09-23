// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { readSystemClipboard } from "@/lib/design-clipboard";

import { runContextMenuPaste } from "./system-clipboard-paste";

describe("readSystemClipboard", () => {
  it("reads images and SVG code with a single clipboard.read()", async () => {
    const read = vi.fn(async () => [
      {
        types: ["image/png"],
        getType: async () => new Blob(["png"], { type: "image/png" }),
      },
      {
        types: ["text/plain"],
        getType: async () =>
          new Blob(['<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>']),
      },
    ]);
    const contents = await readSystemClipboard({
      clipboard: { read },
      trustToken: null,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(contents?.design).toBeNull();
    expect(contents?.files.map((file) => file.type)).toEqual([
      "image/png",
      "image/svg+xml",
    ]);
  });

  it("reports a denied read as unreadable, not as an empty clipboard", async () => {
    const contents = await readSystemClipboard({
      clipboard: {
        read: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
      trustToken: null,
    });
    expect(contents).toBeNull();
  });
});

describe("runContextMenuPaste", () => {
  const args = () => ({
    canEditDesign: true,
    clipboardFiles: [new File(["x"], "", { type: "image/png" })],
    handlePasteSelection: vi.fn(async () => {}),
    handlePastedImageFiles: vi.fn(() => true),
    insertDroppedImageFiles: vi.fn(),
  });

  it("drops OS images at the right-clicked point of the screen under it", async () => {
    const a = args();
    await runContextMenuPaste(a, {
      clientX: 1,
      clientY: 2,
      canvasX: 40,
      canvasY: 60,
      screenId: "screen-2",
    });
    expect(a.insertDroppedImageFiles).toHaveBeenCalledWith(
      a.clipboardFiles,
      "screen-2",
      { x: 40, y: 60 },
    );
  });

  it("anchors on the pointer when the menu opened over the canvas background", async () => {
    const a = args();
    await runContextMenuPaste(a, { clientX: 300, clientY: 200 });
    expect(a.handlePastedImageFiles).toHaveBeenCalledWith(a.clipboardFiles, {
      clientX: 300,
      clientY: 200,
    });
  });

  it("pastes the copied Design layer when the OS clipboard has no image", async () => {
    const a = { ...args(), clipboardFiles: [] };
    await runContextMenuPaste(a, {
      clientX: 0,
      clientY: 0,
      canvasX: 5,
      canvasY: 6,
    });
    expect(a.handlePasteSelection).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
});
