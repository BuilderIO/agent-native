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

import type { VisibleCanvasRect } from "@/components/design/multi-screen/types";
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

import {
  runPasteSelection,
  type PasteSelectionArgs,
  type PastedClipboardLayerSource,
} from "./paste-selection";

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
    visibleRect?: VisibleCanvasRect | null;
    frames?: Record<
      string,
      { x: number; y: number; width: number; height: number }
    >;
    selectedScreenIds?: string[];
    pasteCascade?: number;
    pastedClipboardLayerSourcesRef?: RefObject<
      Map<string, PastedClipboardLayerSource>
    >;
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
  const pastedClipboardLayerSourcesRef =
    overrides.pastedClipboardLayerSourcesRef ??
    ref(new Map<string, PastedClipboardLayerSource>());

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
    canvasFrameGeometryById: overrides.frames ?? {},
    clearRedoStacks: () => {},
    clipboardPasteRedoStackRef: ref([]),
    clipboardPasteUndoStackRef: ref([]),
    files,
    getCanvasClipboardEntries: () => entries,
    getCanvasScreenClipboardEntries: () => [],
    getFreshActiveContent: () => contentByFileId.get(activeFile.id) ?? "",
    pastedClipboardLayerSourcesRef,
    getScreenContent: (screenId) => contentByFileId.get(screenId) ?? "",
    getVisibleCanvasRect: () => overrides.visibleRect ?? null,
    historyOrderRef: ref(
      [] as PasteSelectionArgs["historyOrderRef"]["current"],
    ),
    latestClipboardMutationContentRef: lineageRef as never,
    overviewScreens: files
      .filter((file) => file.id !== "board")
      .map((file) => ({
        id: file.id,
        filename: file.filename,
        content: file.content ?? "",
        updatedAt: file.updatedAt,
        heightPinned: false,
        width: 390,
        height: 844,
      })),
    overviewSelectedScreenIds: overrides.selectedScreenIds ?? [],
    pasteCascadeRef: ref(overrides.pasteCascade ?? 0),
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
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
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
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
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
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
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
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
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

const OTHER_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="box" data-an-primitive="frame" data-agent-native-layer-name="Box" style="position:absolute;left:20px;top:20px;width:300px;height:300px"></div>
</body></html>`;

const SCREEN_FRAMES = {
  home: { x: 0, y: 0, width: 390, height: 844 },
  other: { x: 5000, y: 0, width: 390, height: 844 },
};
const OFF_SCREEN_VIEW: VisibleCanvasRect = {
  x: 3000,
  y: 3000,
  width: 1000,
  height: 600,
};
const OVER_OTHER_VIEW: VisibleCanvasRect = {
  x: 4900,
  y: 200,
  width: 600,
  height: 400,
};
const OVER_HOME_VIEW: VisibleCanvasRect = {
  x: 0,
  y: 0,
  width: 1000,
  height: 800,
};

function viewFiles() {
  return [
    designFile("home", "index.html", HOME_HTML),
    designFile("other", "other.html", OTHER_HTML),
    designFile("board", "__board__.html", BOARD_HTML),
  ];
}

function selectedRect(): ElementInfo {
  return {
    tagName: "div",
    sourceId: "rect-1",
    selector: '[data-agent-native-node-id="rect-1"]',
    classes: [],
    computedStyles: {},
    boundingRect: { x: 40, y: 120, width: 200, height: 100 },
    isFlexChild: false,
    isFlexContainer: false,
  };
}

describe("pasting copied layers while the original is off-screen", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("pastes onto empty canvas at the view center even though the copied layer is still selected", async () => {
    const { args, writes, selections } = harness({
      files: viewFiles(),
      activeFileId: "home",
      selectedElement: selectedRect(),
      frames: SCREEN_FRAMES,
      visibleRect: OFF_SCREEN_VIEW,
    });
    args.selectedCanvasSelector = selectedRect().selector!;

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["board"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.tagName).toBe("BODY");
    expect(pixels(copy.style.left)).toBe(3500);
    expect(pixels(copy.style.top)).toBe(3300);
    expect(copy.style.width).toBe("200px");
    expect(copy.style.height).toBe("100px");
    expect(selections.map((selection) => selection.screenId)).toEqual([
      "board",
    ]);
  });

  it("pastes into the screen under the view center at that point", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "board",
      frames: SCREEN_FRAMES,
      visibleRect: OVER_OTHER_VIEW,
    });

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["other"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.tagName).toBe("BODY");
    expect(pixels(copy.style.left)).toBe(200);
    expect(pixels(copy.style.top)).toBe(400);
  });

  it("steps each repeated paste so copies do not stack exactly", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "board",
      frames: SCREEN_FRAMES,
      visibleRect: OFF_SCREEN_VIEW,
    });

    await runPasteSelection(args);
    await runPasteSelection(args);

    const copies = pastedCopies(writes[1]!.content);
    expect(copies.map((copy) => pixels(copy.style.left)).sort()).toEqual([
      3500, 3516,
    ]);
    expect(copies.map((copy) => pixels(copy.style.top)).sort()).toEqual([
      3300, 3316,
    ]);
  });

  it("keeps pasting next to the original while its screen is in view", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "board",
      frames: SCREEN_FRAMES,
      visibleRect: OVER_HOME_VIEW,
    });

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["home"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "frame-1",
    );
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
  });

  it("centers in the view once the original's screen has moved off-screen", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "board",
      frames: SCREEN_FRAMES,
      visibleRect: OVER_HOME_VIEW,
    });
    args.canvasFrameGeometryById = {
      ...SCREEN_FRAMES,
      home: { x: 8000, y: 0, width: 390, height: 844 },
    };

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["board"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(pixels(copy.style.left)).toBe(500);
    expect(pixels(copy.style.top)).toBe(400);
  });

  it("pastes next to the original once its screen has moved into view", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "board",
      frames: SCREEN_FRAMES,
      visibleRect: OVER_OTHER_VIEW,
    });
    args.canvasFrameGeometryById = {
      ...SCREEN_FRAMES,
      home: { x: 4950, y: 250, width: 390, height: 844 },
    };

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["home"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
  });

  it("keeps pasting into a selected screen that is in view", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "other",
      frames: SCREEN_FRAMES,
      visibleRect: OVER_OTHER_VIEW,
      selectedScreenIds: ["other"],
    });

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["other"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
  });

  it("keeps pasting into a selected container that is in view", async () => {
    const selectedBox: ElementInfo = {
      ...selectedRect(),
      sourceId: "box",
      selector: '[data-agent-native-node-id="box"]',
      boundingRect: { x: 20, y: 20, width: 300, height: 300 },
    };
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "other",
      selectedElement: selectedBox,
      frames: SCREEN_FRAMES,
      visibleRect: OVER_OTHER_VIEW,
    });
    args.selectedCanvasSelector = selectedBox.selector!;

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["other"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "box",
    );
  });

  it("does not guess for a board object, whose position the clipboard cannot place", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      entries: [
        {
          html: BOARD_NOTE_HTML,
          rootNodeId: "board-note",
          sourceFileId: "board",
        },
      ],
      frames: SCREEN_FRAMES,
      visibleRect: OFF_SCREEN_VIEW,
    });

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["board"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "board-group",
    );
  });

  it("pastes at an explicit point even when the original is off-screen", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      frames: SCREEN_FRAMES,
      visibleRect: OFF_SCREEN_VIEW,
    });

    await runPasteSelection(args, { x: 50, y: 40 });

    expect(writes.map((write) => write.fileId)).toEqual(["board"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(pixels(copy.style.left)).toBe(50);
    expect(pixels(copy.style.top)).toBe(40);
  });

  it("leaves the single-screen editor pasting next to the original", async () => {
    const { args, writes } = harness({
      files: viewFiles(),
      activeFileId: "home",
      frames: SCREEN_FRAMES,
      visibleRect: OFF_SCREEN_VIEW,
    });
    args.viewModeRef.current = "single";

    await runPasteSelection(args);

    expect(writes.map((write) => write.fileId)).toEqual(["home"]);
    const copy = pastedCopies(writes[0]!.content)[0]!;
    expect(pixels(copy.style.left)).toBe(40);
    expect(pixels(copy.style.top)).toBe(120);
  });
});

describe("clipboard source placement", () => {
  const card = `<section data-agent-native-node-id="card" style="position:absolute;left:40px;top:60px;width:260px"><button data-agent-native-node-id="child">Child</button></section>`;
  const source = `<!doctype html><html><body><main data-agent-native-node-id="source-root">${card}<p data-agent-native-node-id="peer">Peer</p></main></body></html>`;
  const selected = (id: string): ElementInfo => ({
    ...selectedRect(),
    sourceId: id,
    selector: `[data-agent-native-node-id="${id}"]`,
    tagName: "section",
  });

  it("pastes a copied container beside its original at its authored position", async () => {
    const { args, writes } = harness({
      files: [designFile("home", "index.html", source)],
      activeFileId: "home",
      entries: [{ html: card, rootNodeId: "card", sourceFileId: "home" }],
      selectedElement: selected("card"),
    });
    const getPreparedPasteVisualOffset = vi.fn(() => ({ x: 5, y: 7 }));
    args.getPreparedPasteVisualOffset = getPreparedPasteVisualOffset;
    await runPasteSelection(args);
    const copy = pastedCopies(writes[0]!.content).find(
      (node) => node.tagName === "SECTION",
    )!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "source-root",
    );
    expect(
      copy.previousElementSibling?.getAttribute("data-agent-native-node-id"),
    ).toBe("card");
    expect([copy.style.left, copy.style.top]).toEqual(["40px", "60px"]);
    expect(getPreparedPasteVisualOffset).not.toHaveBeenCalled();
  });

  it("measures visual HTML paste in the body where it will be inserted", async () => {
    const target =
      '<!doctype html><html><body data-agent-native-node-id="target-body"></body></html>';
    const { args, writes } = harness({
      files: [designFile("target", "target.html", target)],
      activeFileId: "target",
      entries: [{ html: card, rootNodeId: "card", sourceFileId: "home" }],
    });
    args.viewModeRef.current = "single";
    const getPreparedPasteVisualOffset = vi.fn(() => ({ x: 4, y: 8 }));
    args.getPreparedPasteVisualOffset = getPreparedPasteVisualOffset;

    await runPasteSelection(args, { x: 200, y: 220 });

    expect(getPreparedPasteVisualOffset).toHaveBeenCalledWith(
      expect.objectContaining({
        targetFileId: "target",
        targetSelector: "body",
        placement: "inside",
        layerHtml: card,
      }),
    );
    const copy = pastedCopies(writes[0]!.content).find(
      (node) => node.tagName === "SECTION",
    )!;
    expect([copy.style.left, copy.style.top]).toEqual(["196px", "212px"]);
  });

  it("measures visual live paste against its actual body insertion context", async () => {
    const { args, runtimeInsertRequests } = harness({
      files: [designFile("live", "live.html", "https://example.com/live")],
      activeFileId: "live",
      entries: [
        {
          html: GROUPED_TRANSFORMED_HTML,
          rootNodeId: "runtime-group-child",
          sourceFileId: "live",
        },
      ],
    });
    args.viewModeRef.current = "single";
    const getPreparedPasteVisualOffset = vi.fn(() => ({ x: 5, y: 7 }));
    args.getPreparedPasteVisualOffset = getPreparedPasteVisualOffset;

    await runPasteSelection(args, { x: 200, y: 210 });

    expect(getPreparedPasteVisualOffset).toHaveBeenCalledWith(
      expect.objectContaining({
        targetFileId: "live",
        targetSelector: "body",
        placement: "inside",
      }),
    );
    expect(runtimeInsertRequests).toHaveLength(1);
    const copy = new DOMParser().parseFromString(
      runtimeInsertRequests[0]!.html,
      "text/html",
    ).body.firstElementChild as HTMLElement;
    expect([copy.style.left, copy.style.top]).toEqual(["195px", "203px"]);
    expect(
      args.pastedClipboardLayerSourcesRef?.current.get(
        JSON.stringify([
          "live",
          copy.getAttribute("data-agent-native-node-id"),
        ]),
      ),
    ).toEqual({ sourceFileId: "live", rootNodeId: "runtime-group-child" });
  });

  it("measures visual paste inside its shared source parent", async () => {
    const first = '<section data-agent-native-node-id="card">Card</section>';
    const second = '<p data-agent-native-node-id="peer">Peer</p>';
    const content = `<!doctype html><html><body><main data-agent-native-node-id="source-root">${first}${second}</main></body></html>`;
    const { args } = harness({
      files: [designFile("home", "index.html", content)],
      activeFileId: "home",
      entries: [
        { html: first, rootNodeId: "card", sourceFileId: "home" },
        { html: second, rootNodeId: "peer", sourceFileId: "home" },
      ],
    });
    const getPreparedPasteVisualOffset = vi.fn(() => ({ x: 0, y: 0 }));
    args.getPreparedPasteVisualOffset = getPreparedPasteVisualOffset;

    await runPasteSelection(args);

    expect(getPreparedPasteVisualOffset).toHaveBeenCalledTimes(2);
    expect(getPreparedPasteVisualOffset).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        targetSelector: '[data-agent-native-node-id="source-root"]',
        placement: "inside",
      }),
    );
    expect(getPreparedPasteVisualOffset).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        targetSelector: '[data-agent-native-node-id="source-root"]',
        placement: "inside",
      }),
    );
  });

  it("measures visual paste after its original source layer", async () => {
    const entryHtml =
      '<section data-agent-native-node-id="card">Clipboard layer</section>';
    const { args } = harness({
      files: [designFile("home", "index.html", source)],
      activeFileId: "home",
      entries: [{ html: entryHtml, rootNodeId: "card", sourceFileId: "home" }],
    });
    const getPreparedPasteVisualOffset = vi.fn(() => ({ x: 0, y: 0 }));
    args.getPreparedPasteVisualOffset = getPreparedPasteVisualOffset;

    await runPasteSelection(args);

    expect(getPreparedPasteVisualOffset).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSelector: '[data-agent-native-node-id="card"]',
        placement: "after",
      }),
    );
  });

  it("measures visual live paste inside its copied source parent", async () => {
    const { args, runtimeInsertRequests } = harness({
      files: [designFile("live", "live.html", "https://example.com/live")],
      activeFileId: "live",
      entries: [
        {
          html: "<div data-agent-native-node-id=child>Child</div>",
          rootNodeId: "child",
          sourceFileId: "live",
          sourceParentNodeId: "runtime-group",
        },
      ],
    });
    const getPreparedPasteVisualOffset = vi.fn(() => ({ x: 0, y: 0 }));
    args.getPreparedPasteVisualOffset = getPreparedPasteVisualOffset;

    await runPasteSelection(args);

    expect(getPreparedPasteVisualOffset).toHaveBeenCalledWith(
      expect.objectContaining({
        targetFileId: "live",
        targetSelector: '[data-agent-native-node-id="runtime-group"]',
        placement: "inside",
      }),
    );
    expect(runtimeInsertRequests[0]?.placement).toBe("inside");
  });

  it("uses the session map to paste a selected live URL clone beside itself", async () => {
    const sourceHtml =
      '<div data-agent-native-node-id="runtime-group-child" style="position:absolute;left:40px;top:120px;width:200px;height:100px;transform:translateX(20px) rotate(12deg)"></div>';
    const { args, runtimeInsertRequests } = harness({
      files: [designFile("live", "live.html", "https://example.com/live")],
      activeFileId: "live",
      entries: [
        {
          html: sourceHtml,
          rootNodeId: "runtime-group-child",
          sourceFileId: "live",
        },
      ],
    });
    args.viewModeRef.current = "single";

    await runPasteSelection(args);

    expect(runtimeInsertRequests).toHaveLength(1);
    const firstRequest = runtimeInsertRequests[0]!;
    expect(firstRequest.screenId).toBe("live");
    expect(firstRequest.anchor).toEqual({ selector: "body" });
    expect(firstRequest.placement).toBe("inside");
    const firstCopy = new DOMParser().parseFromString(
      firstRequest.html,
      "text/html",
    ).body.firstElementChild as HTMLElement;
    const firstCopyId = firstCopy.getAttribute("data-agent-native-node-id")!;
    expect(firstCopyId).not.toBe("runtime-group-child");
    expect([firstCopy.style.left, firstCopy.style.top]).toEqual([
      "40px",
      "120px",
    ]);
    expect(
      args.pastedClipboardLayerSourcesRef!.current.get(
        JSON.stringify(["live", firstCopyId]),
      ),
    ).toEqual({
      sourceFileId: "live",
      rootNodeId: "runtime-group-child",
    });

    const selector = `[data-agent-native-node-id="${firstCopyId}"]`;
    args.selectedElement = {
      ...selected(firstCopyId),
      tagName: "div",
      runtimeSourceId: firstCopyId,
      runtimeSelector: selector,
    };
    args.selectedCanvasSelector = selector;

    await runPasteSelection(args);

    expect(runtimeInsertRequests).toHaveLength(2);
    const repeatedRequest = runtimeInsertRequests[1]!;
    expect(repeatedRequest.screenId).toBe("live");
    expect(repeatedRequest.anchor).toEqual({
      selector,
      sourceId: firstCopyId,
    });
    expect(repeatedRequest.placement).toBe("after");
    const repeatedCopy = new DOMParser().parseFromString(
      repeatedRequest.html,
      "text/html",
    ).body.firstElementChild as HTMLElement;
    expect(repeatedCopy.getAttribute("data-agent-native-node-id")).not.toBe(
      firstCopyId,
    );
    expect([repeatedCopy.style.left, repeatedCopy.style.top]).toEqual([
      "56px",
      "136px",
    ]);
    expect([
      repeatedCopy.style.width,
      repeatedCopy.style.height,
      repeatedCopy.style.transform,
    ]).toEqual(["200px", "100px", "translateX(20px) rotate(12deg)"]);
  });

  it("refuses visual paste when prepared geometry is invalid", async () => {
    const target =
      '<!doctype html><html><body data-agent-native-node-id="target-body"></body></html>';
    const { args, writes } = harness({
      files: [designFile("target", "target.html", target)],
      activeFileId: "target",
      entries: [{ html: card, rootNodeId: "card", sourceFileId: "home" }],
    });
    args.viewModeRef.current = "single";
    args.getPreparedPasteVisualOffset = vi.fn(() => null);
    toastError.mockClear();

    await runPasteSelection(args, { x: 200, y: 220 });

    expect(writes).toEqual([]);
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.toasts.layerMoveFailed",
      { duration: 4000 },
    );
  });

  it("pastes beside the selected previous copy rather than nesting in it", async () => {
    const target =
      '<!doctype html><html><body data-agent-native-node-id="target-body"></body></html>';
    const styleSnapshot = {
      version: 1 as const,
      rootSourceId: "card",
      nodes: [{ path: [], sourceId: "card", styles: { width: "260px" } }],
    };
    const firstPaste = harness({
      files: [
        designFile("home", "index.html", source),
        designFile("target", "target.html", target),
      ],
      activeFileId: "target",
      entries: [
        {
          html: card,
          rootNodeId: "card",
          sourceFileId: "home",
          portableStyleSnapshot: styleSnapshot,
        },
      ],
    });
    firstPaste.args.viewModeRef.current = "single";
    await runPasteSelection(firstPaste.args, { x: 40, y: 60 });
    const previous = pastedCopies(firstPaste.writes[0]!.content).find(
      (node) => node.tagName === "SECTION",
    )!;
    expect(previous.getAttribute("data-agent-native-clone-root")).toBe("true");
    expect(
      previous.hasAttribute("data-agent-native-clone-source-file-id"),
    ).toBe(false);
    expect(
      previous.hasAttribute("data-agent-native-clone-source-node-id"),
    ).toBe(false);
    expect([
      ...firstPaste.args.pastedClipboardLayerSourcesRef!.current.values(),
    ]).toContainEqual({ sourceFileId: "home", rootNodeId: "card" });
    expect(
      firstPaste.args.pastedClipboardLayerSourcesRef!.current.get(
        JSON.stringify([
          "target",
          previous.getAttribute("data-agent-native-node-id"),
        ]),
      ),
    ).toEqual({ sourceFileId: "home", rootNodeId: "card" });

    const repeatedPaste = harness({
      files: [
        designFile("home", "index.html", source),
        designFile("target", "target.html", firstPaste.writes[0]!.content),
      ],
      activeFileId: "target",
      entries: [
        {
          html: card,
          rootNodeId: "card",
          sourceFileId: "home",
          portableStyleSnapshot: styleSnapshot,
        },
      ],
      selectedElement: selected(
        previous.getAttribute("data-agent-native-node-id")!,
      ),
      pastedClipboardLayerSourcesRef:
        firstPaste.args.pastedClipboardLayerSourcesRef!,
    });
    repeatedPaste.args.selectedCanvasSelector =
      repeatedPaste.args.selectedElement!.selector!;

    await runPasteSelection(repeatedPaste.args);

    const copy = pastedCopies(repeatedPaste.writes[0]!.content).find(
      (node) =>
        node.tagName === "SECTION" &&
        node.getAttribute("data-agent-native-node-id") !==
          previous.getAttribute("data-agent-native-node-id"),
    )!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "target-body",
    );
    expect(
      copy.previousElementSibling?.getAttribute("data-agent-native-node-id"),
    ).toBe(previous.getAttribute("data-agent-native-node-id"));
    expect([copy.style.left, copy.style.top]).toEqual(["40px", "60px"]);
  });

  it("does not treat an unrelated marked clone as the current clipboard root", async () => {
    const previous = card.replace(
      'data-agent-native-node-id="card"',
      'data-agent-native-node-id="previous" data-agent-native-clone-root="true" data-agent-native-clone-source-file-id="home" data-agent-native-clone-source-node-id="older-card"',
    );
    const unrelated =
      '<button data-agent-native-node-id="unrelated" style="position:absolute;left:72px;top:88px">Unrelated</button>';
    const target = `<!doctype html><html><body data-agent-native-node-id="target-body">${previous}</body></html>`;
    const { args, writes } = harness({
      files: [
        designFile("home", "index.html", source),
        designFile("target", "target.html", target),
      ],
      activeFileId: "target",
      entries: [
        { html: unrelated, rootNodeId: "unrelated", sourceFileId: "home" },
      ],
      selectedElement: selected("previous"),
    });

    await runPasteSelection(args);

    const copy = pastedCopies(writes[0]!.content).find(
      (node) => node.tagName === "BUTTON",
    )!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "previous",
    );
    expect([copy.style.left, copy.style.top]).toEqual(["72px", "88px"]);
  });

  it("ignores matching legacy clone attributes without a current paste record", async () => {
    const previous = card.replace(
      'data-agent-native-node-id="card"',
      'data-agent-native-node-id="previous" data-agent-native-clone-root="true" data-agent-native-clone-source-file-id="home" data-agent-native-clone-source-node-id="card"',
    );
    const target = `<!doctype html><html><body data-agent-native-node-id="target-body">${previous}</body></html>`;
    const { args, writes } = harness({
      files: [
        designFile("home", "index.html", source),
        designFile("target", "target.html", target),
      ],
      activeFileId: "target",
      entries: [{ html: card, rootNodeId: "card", sourceFileId: "home" }],
      selectedElement: selected("previous"),
    });

    await runPasteSelection(args);

    const copy = pastedCopies(writes[0]!.content).find(
      (node) => node.tagName === "SECTION",
    )!;
    expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
      "previous",
    );
    expect([copy.style.left, copy.style.top]).toEqual(["40px", "60px"]);
  });

  it("preserves legacy clone attributes from clipboard HTML without rewriting them", async () => {
    const inherited = card.replace(
      'data-agent-native-node-id="card"',
      'data-agent-native-node-id="copied-card" data-agent-native-clone-source-file-id="stale-file" data-agent-native-clone-source-node-id="stale-card"',
    );
    const target =
      '<!doctype html><html><body data-agent-native-node-id="target-body"></body></html>';
    const { args, writes } = harness({
      files: [designFile("target", "target.html", target)],
      activeFileId: "target",
      entries: [
        {
          html: inherited,
          rootNodeId: "copied-card",
          sourceFileId: "target",
        },
      ],
    });
    args.viewModeRef.current = "single";

    await runPasteSelection(args, { x: 140, y: 160 });

    const copy = pastedCopies(writes[0]!.content).find(
      (node) => node.tagName === "SECTION",
    )!;
    expect(copy.getAttribute("data-agent-native-clone-source-file-id")).toBe(
      "stale-file",
    );
    expect(copy.getAttribute("data-agent-native-clone-source-node-id")).toBe(
      "stale-card",
    );
  });

  it("preserves cross-screen positions and spacing of all copied layers", async () => {
    const peer = `<button data-agent-native-node-id="copied-peer" style="position:absolute;left:340px;top:80px">Peer</button>`;
    const { args, writes } = harness({
      files: [
        designFile("home", "index.html", source),
        designFile(
          "target",
          "target.html",
          '<!doctype html><html><body data-agent-native-node-id="target-body"></body></html>',
        ),
      ],
      activeFileId: "target",
      entries: [
        { html: card, rootNodeId: "card", sourceFileId: "home" },
        { html: peer, rootNodeId: "copied-peer", sourceFileId: "home" },
      ],
    });
    await runPasteSelection(args);
    const copies = pastedCopies(writes[0]!.content).filter(
      (node) =>
        node.parentElement?.getAttribute("data-agent-native-node-id") ===
        "target-body",
    );
    expect(copies.map((node) => [node.style.left, node.style.top])).toEqual([
      ["40px", "60px"],
      ["340px", "80px"],
    ]);
  });

  it("applies the current cascade uniformly to source-positioned live roots", async () => {
    const peer = `<button data-agent-native-node-id="runtime-peer" style="position:absolute;left:340px;top:80px">Peer</button>`;
    const { args, runtimeInsertRequests } = harness({
      files: [designFile("live", "live.html", "https://example.com/live")],
      activeFileId: "live",
      entries: [
        {
          html: GROUPED_TRANSFORMED_HTML,
          rootNodeId: "runtime-group-child",
          sourceFileId: "live",
        },
        { html: peer, rootNodeId: "runtime-peer", sourceFileId: "live" },
      ],
      selectedElement: selected("runtime-group-child"),
      pasteCascade: 1,
    });
    await runPasteSelection(args);

    expect(runtimeInsertRequests).toHaveLength(1);
    const request = runtimeInsertRequests[0]!;
    expect(request.anchor).toEqual({
      selector: '[data-agent-native-node-id="runtime-group-child"]',
      sourceId: "runtime-group-child",
    });
    expect(request.placement).toBe("after");
    const positions = [request.html, ...(request.additionalHtml ?? [])].map(
      (html) => {
        const root = new DOMParser().parseFromString(html, "text/html").body
          .firstElementChild as HTMLElement;
        return [pixels(root.style.left), pixels(root.style.top)];
      },
    );
    expect(positions).toEqual([
      [56, 136],
      [356, 96],
    ]);
  });
});

it("pastes an auto-sized flow child as a positioned child of a free frame", async () => {
  const alpha =
    '<div data-agent-native-node-id="alpha" style="padding:12px 16px">Alpha</div>';
  const content = `<!doctype html><html><body><section data-agent-native-node-id="row" style="display:flex">${alpha}</section><div data-agent-native-node-id="free" style="position:relative;width:360px;height:200px"></div></body></html>`;
  const { args, writes } = harness({
    files: [designFile("home", "index.html", content)],
    activeFileId: "home",
    entries: [{ html: alpha, rootNodeId: "alpha", sourceFileId: "home" }],
    selectedElement: {
      ...selectedRect(),
      sourceId: "free",
      selector: '[data-agent-native-node-id="free"]',
    },
  });
  await runPasteSelection(args);
  const copy = pastedCopies(writes[0]!.content)[0]!;
  expect(copy.parentElement?.getAttribute("data-agent-native-node-id")).toBe(
    "free",
  );
  expect(copy.style.position).toBe("absolute");
  expect([copy.style.left, copy.style.top]).toEqual(["0px", "0px"]);
  expect(copy.style.width).toBe("");
  expect(copy.style.height).toBe("");
});
