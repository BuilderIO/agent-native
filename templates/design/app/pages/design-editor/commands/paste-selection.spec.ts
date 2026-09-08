// @vitest-environment happy-dom

import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { sourceContentHash } from "@shared/source-workspace";

import {
  publishClipboardContentMutation,
  type ClipboardContentLineage,
} from "@/lib/clipboard-content-lineage";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import type { DesignFile } from "@/pages/design-editor/types";

import { runPasteSelection, type PasteSelectionArgs } from "./paste-selection";

const RECT_HTML = `<div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:120px;width:200px;height:100px;background:rgb(255 0 0)"></div>`;

const HOME_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:0px;top:0px;width:390px;height:844px">
${RECT_HTML}
</div>
</body></html>`;

const BOARD_NOTE_HTML = `<div data-agent-native-node-id="board-note" data-agent-native-layer-name="Note" style="position:absolute;left:20px;top:30px;width:120px;height:60px"></div>`;

const BOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><style>body { margin: 0; position: relative; overflow: visible; }</style></head><body>
<div data-agent-native-node-id="board-group" data-agent-native-layer-name="Group" style="position:absolute;left:200px;top:120px;width:600px;height:400px">
${BOARD_NOTE_HTML}
</div>
</body></html>`;

function designFile(id: string, filename: string, content: string): DesignFile {
  return {
    id,
    filename,
    fileType: "html",
    content,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

interface Harness {
  args: PasteSelectionArgs;
  contentByFileId: Map<string, string>;
  writes: Array<{ fileId: string; content: string }>;
  selections: Array<{ screenId: string; rootNodeIds: string[] }>;
}

function harness(
  overrides: {
    entries?: CanvasLayerClipboardEntry[];
    files?: DesignFile[];
    activeFileId?: string;
  } = {},
): Harness {
  const files = overrides.files ?? [
    designFile("home", "index.html", HOME_HTML),
    designFile("board", "__board__.html", BOARD_HTML),
  ];
  const contentByFileId = new Map(files.map((file) => [file.id, file.content]));
  const activeFile = files.find(
    (file) => file.id === (overrides.activeFileId ?? "board"),
  )!;
  const writes: Array<{ fileId: string; content: string }> = [];
  const selections: Array<{ screenId: string; rootNodeIds: string[] }> = [];

  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1200, height: 800 }) as DOMRect;

  const entries = overrides.entries ?? [
    { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
  ];

  const lineageRef = ref(new Map<string, ClipboardContentLineage>());

  const args: PasteSelectionArgs = {
    activeFile,
    applyFileContentUpdate: (fileId, nextContent) => {
      writes.push({ fileId, content: nextContent });
      contentByFileId.set(fileId, nextContent);
    },
    applyLocalContentUpdate: (nextContent) => {
      writes.push({ fileId: activeFile.id, content: nextContent });
      contentByFileId.set(activeFile.id, nextContent);
    },
    boardFileId: "board",
    canEditDesign: true,
    canvasContainerRef: ref(container),
    clearRedoStacks: () => {},
    clipboardPasteRedoStackRef: ref([]),
    clipboardPasteUndoStackRef: ref([]),
    files,
    getCanvasClipboardEntries: () => entries,
    getCanvasScreenClipboardEntries: () => [],
    getFreshActiveContent: () => contentByFileId.get(activeFile.id) ?? "",
    getScreenContent: (screenId) => contentByFileId.get(screenId) ?? "",
    latestClipboardMutationContentRef: lineageRef as never,
    pasteCascadeRef: ref(0),
    pasteCopiedScreens: () => {},
    pendingLocalFileContentsRef: ref(new Map()),
    // Mirrors DesignEditor's real publisher. A stub that always succeeds hides
    // every refusal, which is how a paste that the lineage blocks outright
    // still passed here.
    publishAuthoritativeClipboardMutation: (publishArgs) => {
      const next = publishClipboardContentMutation({
        current: lineageRef.current.get(publishArgs.fileId),
        baseContentHash: sourceContentHash(publishArgs.baseContent),
        nextContent: publishArgs.nextContent,
        nextContentHash: sourceContentHash(publishArgs.nextContent),
        origin: publishArgs.origin,
        baseSource: publishArgs.baseSource,
      });
      if (!next) return null;
      lineageRef.current.set(publishArgs.fileId, next);
      return {
        mutationId: next.mutationId,
        contentHash: next.contentHash,
        origin: next.origin,
      };
    },
    refreshClipboardFromSystemClipboard: async () => {},
    remapMotionTracksForClone: () => {},
    runtimeStructureInsertRevisionRef: ref(0),
    selectInsertedLayers: (screenId, _content, rootNodeIds) => {
      selections.push({ screenId, rootNodeIds });
    },
    selectedCanvasSelector: "",
    selectedElement: null,
    setRuntimeStructureInsertRequest: () => {},
    syncUndoRedoState: () => {},
    t: (key) => key,
    undoManagerRef: ref(null),
    viewModeRef: ref("overview" as const),
    zoom: 100,
  };

  return { args, contentByFileId, writes, selections };
}

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

describe("pasting copied layers with no explicit drop point", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("keeps the copy inside the frame it came from when the board is the active surface", async () => {
    const { args, writes } = harness();

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["home"]);
    const copies = pastedCopies(writes[0]!.content);
    expect(copies).toHaveLength(1);
    expect(
      copies[0]!.parentElement?.getAttribute("data-agent-native-node-id"),
    ).toBe("frame-1");
    const left = pixels(copies[0]!.style.left);
    const top = pixels(copies[0]!.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(390);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(844);
  });

  it("puts the copy somewhere visible when its source parent is gone", async () => {
    // Stored left/top belong to the deleted parent, so reusing them at the
    // screen root can place the copy off screen.
    const { args, writes } = harness();
    const deleted = HOME_HTML.replace(RECT_HTML, "");
    args.getScreenContent = () => deleted;
    args.getFreshActiveContent = () => deleted;

    await runPasteSelection(args);

    const copies = pastedCopies(writes[0]?.content ?? "");
    expect(copies).toHaveLength(1);
    expect(pixels(copies[0]!.style.left)).toBe(24);
    expect(pixels(copies[0]!.style.top)).toBe(24);
  });

  it("refuses to guess a parent when the copies came from different ones", async () => {
    const SECOND_FRAME = `<div data-agent-native-node-id="frame-2" data-an-primitive="frame" style="position:absolute;left:400px;top:0px;width:390px;height:844px"><div data-agent-native-node-id="rect-2" data-an-primitive="rectangle" style="position:absolute;left:10px;top:10px;width:50px;height:50px"></div></div>`;
    const twoFrames = HOME_HTML.replace("</body>", `${SECOND_FRAME}</body>`);
    const { args, writes } = harness({
      files: [
        designFile("home", "index.html", twoFrames),
        designFile("board", "__board__.html", BOARD_HTML),
      ],
      entries: [
        { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
        {
          html: `<div data-agent-native-node-id="rect-2" data-an-primitive="rectangle" style="position:absolute;left:10px;top:10px;width:50px;height:50px"></div>`,
          rootNodeId: "rect-2",
          sourceFileId: "home",
        },
      ],
    });

    await runPasteSelection(args);

    const copies = pastedCopies(writes[0]?.content ?? "");
    expect(copies).toHaveLength(2);
    // frame-1 owns only rect-1, so adopting both would move rect-2's copy.
    for (const copy of copies) {
      expect(
        copy.parentElement?.getAttribute("data-agent-native-node-id"),
      ).not.toBe("frame-1");
      expect(pixels(copy.style.left)).toBeGreaterThanOrEqual(24);
    }
  });

  it("rebases on the latest edit, not the last clipboard mutation", async () => {
    const { args, writes } = harness();
    // The clipboard cache still describes the pre-delete document; a delete
    // carries no publication so nothing supersedes it. Rebasing there undoes
    // the delete and the removed element comes back with the paste.
    const deleted = HOME_HTML.replace(RECT_HTML, "");
    args.latestClipboardMutationContentRef.current.set("home", {
      content: HOME_HTML,
      contentHash: "stale",
      mutationId: 1,
      origin: "clipboard-paste",
    } as never);
    args.pendingLocalFileContentsRef.current.set("home", {
      content: deleted,
    } as never);

    await runPasteSelection(args);

    expect(writes).toHaveLength(1);
    const written = writes[0]!.content;
    const rects = written.match(/data-an-primitive="rectangle"/g) ?? [];
    // One pasted copy only — the deleted original must not be resurrected.
    expect(rects).toHaveLength(1);
  });

  it("ignores the clipboard lineage once the save has cleared pending", async () => {
    // pending is dropped on save-ack, so after a delete + save the lineage is
    // the only stale copy left and paste must not fall back to it.
    const { args, writes } = harness();
    args.latestClipboardMutationContentRef.current.set("home", {
      content: HOME_HTML,
      contentHash: "stale",
      mutationId: 1,
      origin: "clipboard-paste",
    } as never);
    args.pendingLocalFileContentsRef.current.clear();
    args.getScreenContent = (id: string) =>
      id === "home" ? HOME_HTML.replace(RECT_HTML, "") : "";
    args.getFreshActiveContent = () => HOME_HTML.replace(RECT_HTML, "");

    await runPasteSelection(args);

    expect(writes).toHaveLength(1);
    const rects =
      writes[0]!.content.match(/data-an-primitive="rectangle"/g) ?? [];
    expect(rects).toHaveLength(1);
  });

  it("keeps a copied board object inside the group it came from", async () => {
    const { args, writes } = harness({
      entries: [
        {
          html: BOARD_NOTE_HTML,
          rootNodeId: "board-note",
          sourceFileId: "board",
        },
      ],
    });

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["board"]);
    const copies = pastedCopies(writes[0]!.content);
    expect(copies).toHaveLength(1);
    expect(
      copies[0]!.parentElement?.getAttribute("data-agent-native-node-id"),
    ).toBe("board-group");
    expect(pixels(copies[0]!.style.left)).toBeLessThan(600);
    expect(pixels(copies[0]!.style.top)).toBeLessThan(400);
  });

  it("reports a paste it cannot place instead of dropping it on the board", async () => {
    const { args, writes } = harness({
      entries: [
        { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
        {
          html: BOARD_NOTE_HTML,
          rootNodeId: "board-note",
          sourceFileId: "gone",
        },
      ],
    });

    await runPasteSelection(args);

    expect(writes).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("reports a paste the destination document refuses to clone into", async () => {
    const { args, writes } = harness({ activeFileId: "home" });
    args.pendingLocalFileContentsRef.current.set("home", {
      content: "https://example.com/home",
      startedAt: 0,
    });

    await runPasteSelection(args);

    expect(writes).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("reports a paste a concurrent edit rejected instead of silently dropping it", async () => {
    const { args, writes } = harness();
    args.publishAuthoritativeClipboardMutation = () => null;

    await runPasteSelection(args);

    expect(writes).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
