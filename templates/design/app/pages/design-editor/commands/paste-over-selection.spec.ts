// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import type { DesignFile } from "@/pages/design-editor/types";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import {
  resolvePasteOverPositions,
  runPasteOverSelection,
} from "./paste-over-selection";

const RECT_HTML = `<div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:120px;width:200px;height:100px;background:rgb(255 0 0)"></div>`;

const NESTED_CHILD_HTML = `<div data-agent-native-node-id="child-1" data-an-primitive="rectangle" style="position:absolute;left:40px;top:20px;width:80px;height:40px"></div>`;

const NESTED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" data-an-primitive="frame" style="position:absolute;left:300px;top:200px;width:400px;height:400px">
${NESTED_CHILD_HTML}
</div>
</body></html>`;

const HOME_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:0px;top:0px;width:390px;height:844px">
${RECT_HTML}
</div>
</body></html>`;

function designFile(content: string): DesignFile {
  return {
    id: "home",
    filename: "index.html",
    fileType: "html",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function selected(
  styles: Record<string, string>,
  boundingRect = { x: 900, y: 40, width: 200, height: 100 },
  sourceId?: string,
): ElementInfo {
  return {
    tagName: "DIV",
    classes: [],
    computedStyles: styles,
    boundingRect,
    ...(sourceId ? { sourceId } : {}),
  } as unknown as ElementInfo;
}

describe("resolvePasteOverPositions", () => {
  const entries: CanvasLayerClipboardEntry[] = [
    { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
  ];

  it("uses authored CSS left/top, never the selection bounding box", () => {
    expect(
      resolvePasteOverPositions(
        entries,
        selected({ left: "40px", top: "120px" }),
      ),
    ).toEqual([{ x: 56, y: 136 }]);
  });

  it("offsets from the copied layer CSS when the selection has no position", () => {
    expect(resolvePasteOverPositions(entries, selected({}))).toEqual([
      { x: 56, y: 136 },
    ]);
  });

  it("walks nested authored left/top to document-root coords", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: NESTED_CHILD_HTML,
            rootNodeId: "child-1",
            sourceFileId: "home",
          },
        ],
        selected({ left: "40px", top: "20px" }, undefined, "child-1"),
        NESTED_HTML,
      ),
    ).toEqual([{ x: 356, y: 236 }]);
  });

  it("walks nested authored left/top through relative ancestors", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: NESTED_CHILD_HTML,
            rootNodeId: "child-1",
            sourceFileId: "home",
          },
        ],
        selected({ left: "40px", top: "20px" }, undefined, "child-1"),
        `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" style="position:relative;left:300px;top:200px;width:400px;height:400px">
${NESTED_CHILD_HTML}
</div>
</body></html>`,
      ),
    ).toEqual([{ x: 356, y: 236 }]);
  });

  it("adds ancestor authored coords to computed left/top for class-based nested children", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: `<div data-agent-native-node-id="child-1" class="absolute left-10 top-5"></div>`,
            rootNodeId: "child-1",
            sourceFileId: "home",
          },
        ],
        selected({ left: "40px", top: "20px" }, undefined, "child-1"),
        `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" style="position:absolute;left:300px;top:200px;width:400px;height:400px">
<div data-agent-native-node-id="child-1" class="absolute left-10 top-5"></div>
</div>
</body></html>`,
      ),
    ).toEqual([{ x: 356, y: 236 }]);
  });

  it("adds relative ancestor coords to computed left/top for class-based children", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: `<div data-agent-native-node-id="child-1" class="absolute left-10 top-5"></div>`,
            rootNodeId: "child-1",
            sourceFileId: "home",
          },
        ],
        selected({ left: "40px", top: "20px" }, undefined, "child-1"),
        `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" style="position:relative;left:300px;top:200px;width:400px;height:400px">
<div data-agent-native-node-id="child-1" class="absolute left-10 top-5"></div>
</div>
</body></html>`,
      ),
    ).toEqual([{ x: 356, y: 236 }]);
  });

  it("does not add ancestor coords for class-positioned fixed selections", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: `<div data-agent-native-node-id="child-1" class="fixed left-10 top-5"></div>`,
            rootNodeId: "child-1",
            sourceFileId: "home",
          },
        ],
        selected(
          { position: "fixed", left: "40px", top: "20px" },
          undefined,
          "child-1",
        ),
        `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" style="position:absolute;left:300px;top:200px;width:400px;height:400px">
<div data-agent-native-node-id="child-1" class="fixed left-10 top-5"></div>
</div>
</body></html>`,
      ),
    ).toEqual([{ x: 56, y: 36 }]);
  });

  it("falls through to computed left/top when a class-positioned ancestor cannot be composed", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: `<div data-agent-native-node-id="child-1" class="absolute left-10 top-5"></div>`,
            rootNodeId: "child-1",
            sourceFileId: "home",
          },
        ],
        selected({ left: "40px", top: "20px" }, undefined, "child-1"),
        `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" style="position:absolute;left:300px;top:200px;width:400px;height:400px">
<div data-agent-native-node-id="mid-1" class="absolute left-20 top-10">
<div data-agent-native-node-id="child-1" class="absolute left-10 top-5"></div>
</div>
</div>
</body></html>`,
      ),
    ).toEqual([{ x: 56, y: 36 }]);
  });

  it("returns null when neither the selection nor the copy has CSS position", () => {
    expect(
      resolvePasteOverPositions(
        [
          {
            html: "<div>plain</div>",
            rootNodeId: "plain",
            sourceFileId: "home",
          },
        ],
        selected({}),
      ),
    ).toBeNull();
  });
});

function pastedCopies(content: string) {
  const doc = new DOMParser().parseFromString(content, "text/html");
  return Array.from(
    doc.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
  ).filter((element) =>
    (element.getAttribute("data-agent-native-node-id") ?? "").startsWith(
      "copy-",
    ),
  );
}

function pixels(value: string) {
  return Number.parseFloat(value.replace("px", ""));
}

describe("runPasteOverSelection", () => {
  it("pastes at CSS coordinates instead of the canvas bounding box", () => {
    const writes: string[] = [];
    const selections: string[][] = [];
    runPasteOverSelection({
      activeFile: designFile(HOME_HTML),
      applyLocalContentUpdate: (nextContent) => {
        writes.push(nextContent);
      },
      getCanvasClipboardEntries: () => [
        { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
      ],
      getFreshActiveContent: () => HOME_HTML,
      handlePasteSelection: async () => {
        throw new Error("should not fall through to paste");
      },
      selectedElement: selected({ left: "40px", top: "120px" }),
      selectInsertedLayers: (_screenId, _content, rootNodeIds) => {
        selections.push(rootNodeIds);
      },
      t: (key) => key,
    });
    expect(writes).toHaveLength(1);
    const copies = pastedCopies(writes[0]!);
    expect(copies).toHaveLength(1);
    expect(pixels(copies[0]!.style.left)).toBe(56);
    expect(pixels(copies[0]!.style.top)).toBe(136);
    expect(selections).toHaveLength(1);
  });

  it("pastes a nested layer at document-root coords, not containing-block left/top", () => {
    const writes: string[] = [];
    runPasteOverSelection({
      activeFile: designFile(NESTED_HTML),
      applyLocalContentUpdate: (nextContent) => {
        writes.push(nextContent);
      },
      getCanvasClipboardEntries: () => [
        {
          html: NESTED_CHILD_HTML,
          rootNodeId: "child-1",
          sourceFileId: "home",
        },
      ],
      getFreshActiveContent: () => NESTED_HTML,
      handlePasteSelection: async () => {
        throw new Error("should not fall through to paste");
      },
      selectedElement: selected(
        { left: "40px", top: "20px" },
        undefined,
        "child-1",
      ),
      selectInsertedLayers: () => {},
      t: (key) => key,
    });
    expect(writes).toHaveLength(1);
    const copies = pastedCopies(writes[0]!);
    expect(copies).toHaveLength(1);
    expect(pixels(copies[0]!.style.left)).toBe(356);
    expect(pixels(copies[0]!.style.top)).toBe(236);
  });

  it("falls through to ordinary paste when no CSS position can be resolved", () => {
    const handlePasteSelection = vi.fn(async () => {});
    runPasteOverSelection({
      activeFile: designFile(HOME_HTML),
      applyLocalContentUpdate: () => {
        throw new Error("should not write");
      },
      getCanvasClipboardEntries: () => [
        { html: "<span>copy</span>", rootNodeId: "copy", sourceFileId: "home" },
      ],
      getFreshActiveContent: () => HOME_HTML,
      handlePasteSelection,
      selectedElement: selected({}),
      selectInsertedLayers: () => {},
      t: (key) => key,
    });
    expect(handlePasteSelection).toHaveBeenCalledOnce();
  });

  it("toasts when the insert fails", () => {
    toastError.mockClear();
    runPasteOverSelection({
      activeFile: designFile(HOME_HTML),
      applyLocalContentUpdate: () => {
        throw new Error("should not write");
      },
      getCanvasClipboardEntries: () => [
        { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
      ],
      getFreshActiveContent: () => "http://localhost:5173/",
      handlePasteSelection: async () => {},
      selectedElement: selected({ left: "40px", top: "120px" }),
      selectInsertedLayers: () => {},
      t: (key) => key,
    });
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.primitiveInsertFailed",
      { duration: 4000 },
    );
  });
});
