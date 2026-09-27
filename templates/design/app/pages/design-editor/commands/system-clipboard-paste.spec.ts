// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

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

  it("prefers SVG text when one clipboard item also exposes a raster image", async () => {
    const contents = await readSystemClipboard({
      clipboard: {
        read: async () => [
          {
            types: ["text/plain", "image/png"],
            getType: async (type: string) =>
              type === "text/plain"
                ? new Blob(['<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'])
                : new Blob(["png"], { type: "image/png" }),
          },
        ],
      },
      trustToken: null,
    });
    expect(contents?.files.map((file) => file.type)).toEqual(["image/svg+xml"]);
  });

  it("prefers an SVG image representation over raster when text is unavailable", async () => {
    const contents = await readSystemClipboard({
      clipboard: {
        read: async () => [
          {
            types: ["image/png", "image/svg+xml"],
            getType: async (type: string) =>
              new Blob([type === "image/svg+xml" ? "<svg></svg>" : "png"], {
                type,
              }),
          },
        ],
      },
      trustToken: null,
    });
    expect(contents?.files.map((file) => file.type)).toEqual(["image/svg+xml"]);
  });

  it("continues after one clipboard item rejects a representation read", async () => {
    const contents = await readSystemClipboard({
      clipboard: {
        read: async () => [
          {
            types: ["image/png"],
            getType: async () => Promise.reject(new Error("denied")),
          },
          {
            types: ["image/png"],
            getType: async () => new Blob(["png"], { type: "image/png" }),
          },
        ],
      },
      trustToken: null,
    });
    expect(contents?.files).toHaveLength(1);
    expect(contents?.readErrors).toHaveLength(1);
  });

  it("keeps a successful empty read distinct from denied item reads", async () => {
    await expect(
      readSystemClipboard({ clipboard: { read: async () => [] } }),
    ).resolves.toEqual({ design: null, files: [] });
    await expect(
      readSystemClipboard({
        clipboard: {
          read: async () => [
            {
              types: ["image/png"],
              getType: async () => Promise.reject(new Error("denied")),
            },
          ],
        },
      }),
    ).resolves.toBeNull();
  });

  it("uses readText when rich clipboard reads are unavailable", async () => {
    await expect(
      readSystemClipboard({
        clipboard: { readText: async () => "ordinary clipboard text" },
      }),
    ).resolves.toEqual({ design: null, files: [] });
    await expect(
      readSystemClipboard({
        clipboard: {
          readText: async () => {
            throw new DOMException("denied", "NotAllowedError");
          },
        },
      }),
    ).resolves.toBeNull();
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

  it("routes SVG clipboard files through the same screen-local paste path", async () => {
    const a = {
      ...args(),
      clipboardFiles: [
        new File(["<svg></svg>"], "icon.svg", { type: "image/svg+xml" }),
      ],
    };
    await runContextMenuPaste(a, {
      clientX: 30,
      clientY: 40,
      canvasX: 12,
      canvasY: 18,
      screenId: "screen-svg",
    });
    expect(a.insertDroppedImageFiles).toHaveBeenCalledWith(
      a.clipboardFiles,
      "screen-svg",
      { x: 12, y: 18 },
    );
    expect(a.handlePastedImageFiles).not.toHaveBeenCalled();
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

describe("DesignEditor context-menu clipboard snapshot", () => {
  it("clears stale files on reopen and ignores reads from older menu sessions", () => {
    const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
    const menuSection = source.slice(
      source.indexOf("// U4/U8: hasCanvasClipboard"),
    );
    const openChange = menuSection.match(
      /onOpenChange=\{\(open\) => \{([\s\S]*?)\n            \}\}/,
    )?.[1];

    if (!openChange) throw new Error("Expected context-menu open handler");
    expect(openChange).toMatch(
      /if \(!open\)[\s\S]*?menuClipboardReadIdRef\.current \+= 1/,
    );
    expect(openChange).toMatch(
      /if \(open\)[\s\S]*?menuClipboardFilesRef\.current = \[\]/,
    );
    expect(openChange).toMatch(
      /if \(readId !== menuClipboardReadIdRef\.current\) return/,
    );
    expect(source).toContain("clipboardFiles: menuClipboardFilesRef.current");
    expect(
      openChange.indexOf("menuClipboardFilesRef.current = []"),
    ).toBeLessThan(openChange.indexOf("readSystemClipboard().then"));
    expect(
      openChange.indexOf(
        "if (readId !== menuClipboardReadIdRef.current) return",
      ),
    ).toBeLessThan(
      openChange.indexOf(
        "menuClipboardFilesRef.current = contents?.files ?? []",
      ),
    );
  });
});
