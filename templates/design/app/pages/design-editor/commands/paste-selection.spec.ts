// @vitest-environment happy-dom

import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const shaderWrites = vi.hoisted(() => new Set<string>());
vi.mock("@/components/design/inspector/GlslShaderPanel", () => ({
  isShaderWriteInFlight: (fileId: string | undefined) =>
    Boolean(fileId && shaderWrites.has(fileId)),
}));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { buildCodeLayerProjection } from "@shared/code-layer";
import { analyzeComponentLinks } from "@shared/component-links";
import { COMPONENT_REF_ATTR } from "@shared/component-model";
import { sourceContentHash } from "@shared/source-workspace";

import type {
  ElementInfo,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import {
  publishClipboardContentMutation,
  type ClipboardContentLineage,
} from "@/lib/clipboard-content-lineage";
import type { CanvasLayerClipboardEntry } from "@/pages/design-editor/command-types";
import type { GeometryHistorySelection } from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

import { runPasteSelection, type PasteSelectionArgs } from "./paste-selection";

const RECT_HTML = `<div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:120px;width:200px;height:100px;background:rgb(255 0 0)"></div>`;

const HOME_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="frame-1" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:0px;top:0px;width:390px;height:844px">
${RECT_HTML}
</div>
</body></html>`;

const BOARD_NOTE_HTML = `<div data-agent-native-node-id="board-note" data-agent-native-layer-name="Note" style="position:absolute;left:20px;top:30px;width:120px;height:60px;transform:rotate(12deg);transform-origin:top left"></div>`;

const BOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><style>body { margin: 0; position: relative; overflow: visible; }</style></head><body>
<div data-agent-native-node-id="board-group" data-agent-native-layer-name="Group" style="position:absolute;left:200px;top:120px;width:600px;height:400px">
${BOARD_NOTE_HTML}
</div>
</body></html>`;

const GROUPED_TRANSFORMED_HTML = `<div data-agent-native-node-id="group-child" data-an-primitive="rectangle" data-agent-native-layer-name="Badge" style="position:absolute;left:40px;top:120px;width:200px;height:100px;transform:translateX(20px) rotate(12deg)"></div>`;
const GROUPED_BOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="group-1" data-agent-native-group-wrapper="true" data-agent-native-layer-name="Group" style="position:absolute;left:0px;top:0px;width:390px;height:844px">
${GROUPED_TRANSFORMED_HTML}
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
  runtimeInsertRequests: Array<
    RuntimeStructureInsertRequest & { screenId: string }
  >;
}

function harness(
  overrides: {
    entries?: CanvasLayerClipboardEntry[];
    files?: DesignFile[];
    activeFileId?: string;
    selectedElement?: ElementInfo | null;
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
  const runtimeInsertRequests: Array<
    RuntimeStructureInsertRequest & { screenId: string }
  > = [];

  const container = document.createElement("div");
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1200, height: 800 }) as DOMRect;

  const entries = overrides.entries ?? [
    { html: RECT_HTML, rootNodeId: "rect-1", sourceFileId: "home" },
  ];

  const lineageRef = ref(new Map<string, ClipboardContentLineage>());

  const args: PasteSelectionArgs = {
    activeFile,
    designId: "design-1",
    applyFileContentUpdate: (fileId, nextContent) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId,
        fileType: "html",
      });
      writes.push({ fileId, content: publication.content });
      contentByFileId.set(fileId, publication.content);
      return { status: "accepted", ...publication };
    },
    applyLocalContentUpdate: (nextContent) => {
      const publication = prepareCanonicalSourceContent(nextContent, {
        fileId: activeFile.id,
        fileType: activeFile.fileType,
      });
      writes.push({ fileId: activeFile.id, content: publication.content });
      contentByFileId.set(activeFile.id, publication.content);
      return { status: "accepted", ...publication };
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
    historyOrderRef: ref(
      [] as PasteSelectionArgs["historyOrderRef"]["current"],
    ),
    latestClipboardMutationContentRef: lineageRef as never,
    pasteCascadeRef: ref(0),
    pasteCopiedScreens: () => {},
    pendingLocalFileContentsRef: ref(new Map()),
    publishAuthoritativeClipboardMutation: (publishArgs) => {
      const next = publishClipboardContentMutation({
        current: lineageRef.current.get(publishArgs.fileId),
        baseContentHash: sourceContentHash(publishArgs.baseContent),
        fileId: publishArgs.fileId,
        fileType: files.find((file) => file.id === publishArgs.fileId)
          ?.fileType,
        nextContent: publishArgs.nextContent,
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
    selectedElement: overrides.selectedElement ?? null,
    setRuntimeStructureInsertRequest: (next) => {
      const request = typeof next === "function" ? next(null) : next;
      if (request) runtimeInsertRequests.push(request);
    },
    syncUndoRedoState: () => {},
    t: (key) => key,
    undoManagerRef: ref(null),
    viewModeRef: ref("overview" as const),
    zoom: 100,
  };

  return { args, contentByFileId, writes, selections, runtimeInsertRequests };
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
    args.historyOrderRef.current = ["selection"];

    await runPasteSelection(args);

    expect(args.historyOrderRef.current).toEqual([
      "selection",
      "clipboard-paste",
    ]);
    expect(writes.map((write) => write.fileId)).toEqual(["home"]);
    const acceptedContent = writes[0]!.content;
    const lineage = args.latestClipboardMutationContentRef.current.get("home");
    const clipboardUndoStack = args.clipboardPasteUndoStackRef.current;
    const clipboardUndo = clipboardUndoStack[clipboardUndoStack.length - 1];
    expect(lineage?.content).toBe(acceptedContent);
    expect(lineage?.contentHash).toBe(sourceContentHash(acceptedContent));
    expect(clipboardUndo?.after).toBe(acceptedContent);
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

  it("does not reserve paste history while the target shader write is active", async () => {
    const { args, writes } = harness();
    shaderWrites.add("home");
    try {
      await runPasteSelection(args);

      expect(writes).toEqual([]);
      expect(args.clipboardPasteUndoStackRef.current).toEqual([]);
      expect(args.historyOrderRef.current).toEqual([]);
      expect(args.latestClipboardMutationContentRef.current.has("home")).toBe(
        false,
      );
    } finally {
      shaderWrites.delete("home");
    }
  });

  it("keeps a same-Design pasted main linked after the clipboard clone", async () => {
    const componentHtml = `<button data-agent-native-node-id="button-main" data-agent-native-component-id="cmp-button" data-agent-native-component="Button">Save</button>`;
    const content = `<!doctype html><html><body>${componentHtml}<p data-agent-native-node-id="after">After</p></body></html>`;
    const { args, writes } = harness({
      files: [designFile("home", "index.html", content)],
      activeFileId: "home",
      entries: [
        {
          html: componentHtml,
          rootNodeId: "button-main",
          sourceFileId: "home",
        },
      ],
    });

    await runPasteSelection(args);

    expect(writes).toHaveLength(1);
    const source = {
      kind: "design-file" as const,
      designId: "design-1",
      fileId: "home",
      filename: "index.html",
    };
    const projection = buildCodeLayerProjection(writes[0]!.content, { source });
    const references = projection.nodes.filter(
      (node) => node.dataAttributes[COMPONENT_REF_ATTR] === "cmp-button",
    );
    expect(references).toHaveLength(1);
    expect(
      analyzeComponentLinks([projection]).components.find(
        (component) => component.componentId === "cmp-button",
      )?.status,
    ).toBe("resolved");
  });

  it("dispatches a pasted interior clone as one deferred linked snapshot", async () => {
    const componentHtml = `<span data-agent-native-node-id="label">Label</span>`;
    const content = `<!doctype html>\n<html><head><!--keep--></head><body><section data-agent-native-node-id="main" data-agent-native-component-id="cmp-card">${componentHtml}<span data-agent-native-node-id="after">After</span></section></body></html>`;
    const { args, writes } = harness({
      files: [designFile("home", "index.html", content)],
      activeFileId: "home",
      entries: [
        {
          html: componentHtml,
          rootNodeId: "label",
          sourceFileId: "home",
          sourceParentNodeId: "main",
        },
      ],
    });
    const projection = buildCodeLayerProjection(content, {
      source: { kind: "design-file", fileId: "home" },
    });
    const label = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "label",
    );
    expect(label).toBeDefined();
    if (!label) return;
    const selectionBefore: GeometryHistorySelection = {
      activeFileId: "home",
      overviewSelectedScreenIds: ["home"],
      selectedLayerIds: [label.id],
      sourceContentByFileId: {},
      sourceFileIdByFileId: {},
    };
    const applyLinkedComponentEdit = vi.fn();
    const remapMotionTracksForClone = vi.fn();
    args.applyLinkedComponentEdit = applyLinkedComponentEdit;
    args.remapMotionTracksForClone = remapMotionTracksForClone;
    args.selectionBefore = selectionBefore;

    await runPasteSelection(args);

    expect(writes).toEqual([]);
    expect(applyLinkedComponentEdit).toHaveBeenCalledOnce();
    const [targetFileId, targetNodeId, edit, receivedSelection, onApplied] =
      applyLinkedComponentEdit.mock.calls[0]!;
    expect(targetFileId).toBe("home");
    expect(targetNodeId).toBe("main");
    expect(edit.kind).toBe("structure");
    expect(edit.before).toBe(content);
    expect(edit.after).toContain('data-agent-native-node-id="copy-');
    expect(edit.selectionNodeIds).toHaveLength(1);
    expect(receivedSelection).toEqual(selectionBefore);
    expect(onApplied).toEqual(expect.any(Function));
    expect(remapMotionTracksForClone).not.toHaveBeenCalled();

    onApplied();
    expect(remapMotionTracksForClone).toHaveBeenCalledOnce();
    expect(remapMotionTracksForClone).toHaveBeenCalledWith(
      expect.any(Map),
      "home",
    );
  });

  it("pastes directly above the source, not appended after a later sibling", async () => {
    const GROUP_HTML = `<!DOCTYPE html>
<html lang="en"><head></head><body>
<div data-agent-native-node-id="group" data-agent-native-layer-name="Group" style="position:absolute;left:0px;top:0px;width:400px;height:300px">
<div data-agent-native-node-id="original" data-agent-native-layer-name="Original" style="position:absolute;left:0px;top:0px;width:120px;height:60px"></div>
<div data-agent-native-node-id="sibling" data-agent-native-layer-name="Sibling" style="position:absolute;left:0px;top:80px;width:120px;height:60px"></div>
</div>
</body></html>`;
    const { args, writes } = harness({
      files: [designFile("home", "index.html", GROUP_HTML)],
      activeFileId: "home",
      entries: [
        {
          html: `<div data-agent-native-node-id="original" data-agent-native-layer-name="Original" style="position:absolute;left:0px;top:0px;width:120px;height:60px"></div>`,
          rootNodeId: "original",
          sourceFileId: "home",
        },
      ],
    });

    await runPasteSelection(args);

    const doc = new DOMParser().parseFromString(
      writes[0]!.content,
      "text/html",
    );
    const group = doc.querySelector('[data-agent-native-node-id="group"]')!;
    const childIds = Array.from(group.children).map((el) =>
      el.getAttribute("data-agent-native-node-id"),
    );
    const copyId = childIds.find((id) => id !== "original" && id !== "sibling");
    expect(copyId).toBeTruthy();
    expect(childIds).toEqual(["original", copyId, "sibling"]);
  });

  it("pastes a transformed layer inside its source group and preserves size", async () => {
    const { args, writes } = harness({
      files: [
        designFile("home", "index.html", HOME_HTML),
        designFile("board", "__board__.html", GROUPED_BOARD_HTML),
      ],
      entries: [
        {
          html: GROUPED_TRANSFORMED_HTML,
          rootNodeId: "group-child",
          sourceFileId: "board",
        },
      ],
    });

    await runPasteSelection(args);

    expect(writes[0]?.fileId).toBe("board");
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "group-1",
    );
    expect(pixels(copy.style.left)).toBe(50);
    expect(pixels(copy.style.top)).toBe(130);
    expect(copy.style.width).toBe("200px");
    expect(copy.style.height).toBe("100px");
    expect(copy.style.transform).toBe("translateX(20px) rotate(12deg)");
  });

  it("keeps a selected grouped child positioned next to its source", async () => {
    const selectedElement: ElementInfo = {
      tagName: "div",
      sourceId: "group-child",
      selector: '[data-agent-native-node-id="group-child"]',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 40, y: 120, width: 200, height: 100 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    const { args, writes } = harness({
      files: [
        designFile("home", "index.html", GROUPED_BOARD_HTML),
        designFile("board", "__board__.html", BOARD_HTML),
      ],
      activeFileId: "home",
      entries: [
        {
          html: GROUPED_TRANSFORMED_HTML,
          rootNodeId: "group-child",
          sourceFileId: "home",
        },
      ],
      selectedElement,
    });
    args.selectedCanvasSelector = selectedElement.selector!;

    await runPasteSelection(args);

    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "group-1",
    );
    expect(pixels(copy.style.left)).toBe(50);
    expect(pixels(copy.style.top)).toBe(130);
    expect(copy.style.width).toBe("200px");
    expect(copy.style.height).toBe("100px");
    expect(copy.style.transform).toBe("translateX(20px) rotate(12deg)");
  });

  it("keeps a selected live grouped child positioned next to its source", async () => {
    const selectedElement: ElementInfo = {
      tagName: "div",
      sourceId: "runtime-group-child",
      runtimeSourceId: "runtime-group-child",
      selector: '[data-agent-native-node-id="source-group-child"]',
      runtimeSelector: '[data-agent-native-node-id="runtime-group-child"]',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 40, y: 120, width: 200, height: 100 },
      isFlexChild: false,
      isFlexContainer: false,
    };
    const { args, runtimeInsertRequests } = harness({
      files: [
        designFile("home", "index.html", HOME_HTML),
        designFile("board", "__board__.html", BOARD_HTML),
        designFile("live", "live.html", "https://example.com/live"),
      ],
      activeFileId: "live",
      entries: [
        {
          html: GROUPED_TRANSFORMED_HTML,
          rootNodeId: "runtime-group-child",
          sourceFileId: "live",
        },
      ],
      selectedElement,
    });
    args.selectedCanvasSelector = selectedElement.selector!;

    await runPasteSelection(args);

    expect(runtimeInsertRequests).toHaveLength(1);
    const request = runtimeInsertRequests[0]!;
    expect(request.anchor).toEqual({
      selector: selectedElement.runtimeSelector,
      sourceId: selectedElement.runtimeSourceId,
    });
    expect(request.placement).toBe("after");
    const copy = new DOMParser().parseFromString(request.html, "text/html").body
      .firstElementChild as HTMLElement;
    expect(pixels(copy.style.left)).toBe(50);
    expect(pixels(copy.style.top)).toBe(130);
    expect(copy.style.width).toBe("200px");
    expect(copy.style.height).toBe("100px");
    expect(copy.style.transform).toBe("translateX(20px) rotate(12deg)");
  });

  it("anchors a deselected live paste inside its copied source group", async () => {
    const sourceEntry = {
      html: GROUPED_TRANSFORMED_HTML,
      rootNodeId: "runtime-group-child",
      sourceFileId: "live",
      sourceParentNodeId: "runtime-group",
    };
    const { args, runtimeInsertRequests } = harness({
      files: [
        designFile("home", "index.html", HOME_HTML),
        designFile("board", "__board__.html", BOARD_HTML),
        designFile("live", "live.html", "https://example.com/live"),
      ],
      activeFileId: "live",
      entries: [sourceEntry],
    });

    await runPasteSelection(args);

    expect(runtimeInsertRequests).toHaveLength(1);
    const request = runtimeInsertRequests[0]!;
    expect(request.anchor).toEqual({
      selector: "",
      sourceId: "runtime-group",
    });
    expect(request.placement).toBe("inside");
    const copy = new DOMParser().parseFromString(request.html, "text/html").body
      .firstElementChild as HTMLElement;
    expect(pixels(copy.style.left)).toBe(50);
    expect(pixels(copy.style.top)).toBe(130);
    expect(copy.style.width).toBe("200px");
    expect(copy.style.height).toBe("100px");
    expect(copy.style.transform).toBe("translateX(20px) rotate(12deg)");
  });

  it("puts the copy somewhere visible when its source parent is gone", async () => {
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
    for (const copy of copies) {
      expect(
        copy.parentElement?.getAttribute("data-agent-native-node-id"),
      ).not.toBe("frame-1");
      expect(pixels(copy.style.left)).toBeGreaterThanOrEqual(24);
    }
  });

  it("rebases on the latest edit, not the last clipboard mutation", async () => {
    const { args, writes } = harness();
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
    expect(rects).toHaveLength(1);
  });

  it("ignores the clipboard lineage once the save has cleared pending", async () => {
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
    expect(copies[0]!.style.width).toBe("120px");
    expect(copies[0]!.style.height).toBe("60px");
    expect(copies[0]!.style.transform).toBe("rotate(12deg)");
    expect(copies[0]!.style.transformOrigin).toBe("top left");
    expect(
      copies[0]!.parentElement?.getAttribute("data-agent-native-node-id"),
    ).toBe("board-group");
    expect(pixels(copies[0]!.style.left)).toBeLessThan(600);
    expect(pixels(copies[0]!.style.top)).toBeLessThan(400);
  });

  it("places a transformed copy at the explicit canvas point", async () => {
    const html = `<div data-agent-native-node-id="translated" data-agent-native-layer-name="Translated" style="position:absolute;left:100px;top:40px;width:100px;height:50px;transform:translateX(100px)"></div>`;
    const { args, writes } = harness({
      entries: [{ html, rootNodeId: "translated", sourceFileId: "home" }],
    });

    await runPasteSelection(args, { x: 50, y: 40 });

    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(pixels(copy.style.left)).toBe(-50);
    expect(pixels(copy.style.top)).toBe(40);
    expect(copy.style.transform).toBe("translateX(100px)");
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

  it("refuses cross-file paste when snapshot capture failed and leaves the destination untouched", async () => {
    const { args, writes, runtimeInsertRequests } = harness({
      entries: [
        {
          html: `<div class=\"source-class\" data-agent-native-node-id=\"source\">Styled</div>`,
          rootNodeId: "source",
          sourceFileId: "home",
          styleSnapshotCaptureFailed: true,
        },
      ],
    });

    await runPasteSelection(args, { x: 240, y: 150 });

    expect(writes).toEqual([]);
    expect(runtimeInsertRequests).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("allows same-file duplication after capture failure using the copied source markup", async () => {
    const { args, writes } = harness({
      activeFileId: "home",
      entries: [
        {
          html: `<div class=\"source-class\" data-agent-native-node-id=\"source\">Styled</div>`,
          rootNodeId: "source",
          sourceFileId: "home",
          styleSnapshotCaptureFailed: true,
        },
      ],
    });
    args.viewModeRef.current = "single";

    await runPasteSelection(args, { x: 250, y: 160 });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.fileId).toBe("home");
    const doc = new DOMParser().parseFromString(
      writes[0]!.content,
      "text/html",
    );
    const copies = Array.from(doc.querySelectorAll(".source-class"));
    expect(copies).toHaveLength(1);
    expect(copies[0]?.textContent).toBe("Styled");
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each(["", "missing-file"])(
    "treats absent or unknown source ownership as cross-file for failed snapshots (%s)",
    async (sourceFileId) => {
      const { args, writes } = harness({
        entries: [
          {
            html: `<div data-agent-native-node-id=\"source\">Styled</div>`,
            rootNodeId: "source",
            sourceFileId,
            styleSnapshotCaptureFailed: true,
          },
        ],
      });

      await runPasteSelection(args, { x: 240, y: 150 });

      expect(writes).toEqual([]);
      expect(toastError).toHaveBeenCalledTimes(1);
    },
  );

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
