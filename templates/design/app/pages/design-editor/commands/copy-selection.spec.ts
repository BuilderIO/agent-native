// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import type { RefObject } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clipboard = vi.hoisted(() => ({
  getDesignClipboardTrustToken: vi.fn(() => "local-clipboard-token"),
  plainTextFromDesignHtml: vi.fn(() => "Badge"),
  writeDesignClipboard: vi.fn<
    (representations: { plainText: string; html: string }) => Promise<void>
  >(async () => {}),
}));

vi.mock("@/lib/design-clipboard", () => clipboard);

import type {
  FrameElementTarget,
  PortableStyleSnapshotRead,
} from "@/components/design/multi-screen/read-portable-style-snapshot";
import type {
  ElementInfo,
  PortableStyleSnapshot,
} from "@/components/design/types";
import { parseDesignClipboardMarker } from "@/lib/design-import";
import type { DesignClipboardScreenEntry } from "@/lib/design-import";
import { portableStyleSnapshotForPasteTarget } from "@/pages/design-editor/clone-and-pen-edit";
import type {
  CanvasLayerClipboardEntry,
  LiveScreenSnapshot,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { DesignFile } from "@/pages/design-editor/types";

import { runCopySelection } from "./copy-selection";
import { runGetSelectedLayerSnapshots } from "./get-selected-layer-snapshots";

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

function noFrameAnswers(): PortableStyleSnapshotRead {
  return { status: "missing" };
}

describe("copying a runtime-projected layer", () => {
  beforeEach(() => clipboard.writeDesignClipboard.mockClear());

  it("preserves a failed style-capture marker through the OS clipboard payload", async () => {
    const file: DesignFile = {
      id: "live",
      filename: "live.html",
      fileType: "html",
      content:
        '<!doctype html><html><body><div class="class-painted" data-agent-native-node-id="node-1">Copy</div></body></html>',
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const copiedLayerEntriesRef = ref<CanvasLayerClipboardEntry[]>([]);
    const copiedLayerHtmlRef = ref<string | null>(null);
    const copiedScreenEntriesRef = ref<
      DesignClipboardScreenEntry[] | undefined
    >(undefined);
    const projection = buildCodeLayerProjection(file.content!, {
      source: { kind: "design-file", fileId: "live" },
    });
    const selectedNode = projection.nodes.find((node) => node.tag === "div")!;
    const snapshots = runGetSelectedLayerSnapshots({
      activeFile: file,
      designSourceType: "inline",
      files: [file],
      getFreshActiveContent: () => file.content!,
      getScreenContent: () => file.content!,
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      runtimeLayerSnapshotsById: {},
      selectedElement: {
        styleSnapshotCaptureFailed: true,
      } as ElementInfo,
      selectedElementLayerId: selectedNode.id,
      selectedLayerIdsState: [selectedNode.id],
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.styleSnapshotCaptureFailed).toBe(true);

    await runCopySelection({
      canvasFrameGeometryById: {},
      copiedLayerEntriesRef,
      copiedLayerHtmlRef,
      copiedScreenEntriesRef,
      designSourceType: "localhost",
      files: [file],
      getScreenContent: () => file.content!,
      getSelectedLayerSnapshots: () => snapshots,
      lastWrittenClipboardMarkerRef: ref<string | null>(null),
      lastWrittenClipboardPlainTextRef: ref<string | null>(null),
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      pasteCascadeRef: ref(0),
      readPortableStyleSnapshot: noFrameAnswers,
      runtimeLayerSnapshotsById: {},
      setHasCanvasClipboard: () => {},
      t: (key) => key,
      viewModeRef: ref<"single" | "overview">("single"),
    });

    expect(copiedLayerEntriesRef.current[0]?.styleSnapshotCaptureFailed).toBe(
      true,
    );
    expect(
      parseDesignClipboardMarker(
        copiedLayerHtmlRef.current,
        "local-clipboard-token",
      )?.entries[0]?.styleSnapshotCaptureFailed,
    ).toBe(true);
    expect(
      parseDesignClipboardMarker(
        clipboard.writeDesignClipboard.mock.calls[0]?.[0].html,
        "local-clipboard-token",
      )?.entries[0]?.styleSnapshotCaptureFailed,
    ).toBe(true);
  });

  it("writes cached enriched multi-selection to the system marker during activation", async () => {
    const file: DesignFile = {
      id: "screen-a",
      filename: "index.html",
      fileType: "html",
      content:
        '<!doctype html><html><body><div data-agent-native-node-id="node-1">Copy</div><div data-agent-native-node-id="node-2">Copy too</div></body></html>',
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const projection = buildCodeLayerProjection(file.content!, {
      source: { kind: "design-file", fileId: file.id },
    });
    const selectedNodes = projection.nodes.filter((node) => node.tag === "div");
    const lightweightSnapshots = runGetSelectedLayerSnapshots({
      activeFile: file,
      designSourceType: "inline",
      files: [file],
      getFreshActiveContent: () => file.content!,
      getScreenContent: () => file.content!,
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      runtimeLayerSnapshotsById: {},
      selectedElement: null,
      selectedElementLayerId: null,
      selectedLayerIdsState: selectedNodes.map((node) => node.id),
    });
    const portableStyleSnapshot: PortableStyleSnapshot = {
      version: 1,
      rootSourceId: "node-1",
      nodes: [
        {
          sourceId: "node-1",
          path: [],
          styles: { color: "rgb(255, 0, 0)" },
        },
      ],
    };
    const fullSnapshots = lightweightSnapshots.map((snapshot) => ({
      ...snapshot,
      portableStyleSnapshot: {
        ...portableStyleSnapshot,
        rootSourceId: snapshot.rootNodeId,
      },
    }));
    const copiedLayerEntriesRef = ref<CanvasLayerClipboardEntry[]>([]);
    const copiedLayerHtmlRef = ref<string | null>(null);
    const copiedScreenEntriesRef = ref<
      DesignClipboardScreenEntry[] | undefined
    >(undefined);
    const copying = runCopySelection({
      canvasFrameGeometryById: {},
      copiedLayerEntriesRef,
      copiedLayerHtmlRef,
      copiedScreenEntriesRef,
      designSourceType: "inline",
      files: [file],
      getScreenContent: () => file.content!,
      getSelectedLayerSnapshots: () => fullSnapshots,
      lastWrittenClipboardMarkerRef: ref<string | null>(null),
      lastWrittenClipboardPlainTextRef: ref<string | null>(null),
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      pasteCascadeRef: ref(0),
      readPortableStyleSnapshot: noFrameAnswers,
      runtimeLayerSnapshotsById: {},
      setHasCanvasClipboard: () => {},
      t: (key) => key,
      viewModeRef: ref<"single" | "overview">("overview"),
    });

    expect(clipboard.writeDesignClipboard).toHaveBeenCalledTimes(1);
    await copying;

    expect(copiedLayerEntriesRef.current).toHaveLength(2);
    expect(
      parseDesignClipboardMarker(
        clipboard.writeDesignClipboard.mock.calls[0]?.[0].html,
        "local-clipboard-token",
      )?.entries.map((entry) => entry.portableStyleSnapshot),
    ).toEqual(fullSnapshots.map((snapshot) => snapshot.portableStyleSnapshot));
  });

  it("matches an enriched override by source id and preserves an explicit failure", () => {
    const file: DesignFile = {
      id: "screen-a",
      filename: "index.html",
      fileType: "html",
      content:
        '<!doctype html><html><body><div data-agent-native-node-id="source-id">Copy</div></body></html>',
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const snapshots = runGetSelectedLayerSnapshots({
      activeFile: file,
      designSourceType: "inline",
      files: [file],
      getFreshActiveContent: () => file.content!,
      getScreenContent: () => file.content!,
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      runtimeLayerSnapshotsById: {},
      selectedElement: null,
      selectedElementsByLayerId: new Map([
        ["source-id", { styleSnapshotCaptureFailed: true } as ElementInfo],
      ]),
      selectedElementLayerId: null,
      selectedLayerIdsState: ["source-id"],
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.styleSnapshotCaptureFailed).toBe(true);
  });

  it("keeps the source group id in memory and in the system clipboard marker", async () => {
    const liveUrl = "https://example.com/live";
    const file: DesignFile = {
      id: "live",
      filename: "live.html",
      fileType: "html",
      content: liveUrl,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const overviewScreens: OverviewScreen[] = [
      {
        id: file.id,
        filename: file.filename,
        content: liveUrl,
        updatedAt: file.updatedAt,
        sourceType: "localhost",
        heightPinned: false,
      },
    ];
    const runtimeSnapshot: RuntimeLayerSnapshot = {
      html: `<!doctype html><html><body data-agent-native-node-id="runtime-body">
        <div data-agent-native-node-id="runtime-group" data-agent-native-group-wrapper="true">
          <div data-agent-native-node-id="runtime-child" style="position:absolute;left:40px;top:120px;width:200px;height:100px;transform:rotate(12deg)"></div>
        </div>
      </body></html>`,
      nodeCount: 2,
    };
    const runtimeLayerSnapshotsById = { [file.id]: runtimeSnapshot };
    const snapshots = runGetSelectedLayerSnapshots({
      activeFile: file,
      designSourceType: "localhost",
      files: [file],
      getFreshActiveContent: () => liveUrl,
      getScreenContent: () => liveUrl,
      liveScreenSnapshotsById: {} satisfies Record<string, LiveScreenSnapshot>,
      overviewScreens,
      runtimeLayerSnapshotsById,
      selectedElement: null,
      selectedElementLayerId: null,
      selectedLayerIdsState: ["runtime-child"],
    });
    const copiedLayerEntriesRef = ref<CanvasLayerClipboardEntry[]>([]);
    const copiedLayerHtmlRef = ref<string | null>(null);
    const copiedScreenEntriesRef = ref<
      DesignClipboardScreenEntry[] | undefined
    >(undefined);

    await runCopySelection({
      canvasFrameGeometryById: {},
      copiedLayerEntriesRef,
      copiedLayerHtmlRef,
      copiedScreenEntriesRef,
      designSourceType: "localhost",
      files: [file],
      getScreenContent: () => liveUrl,
      getSelectedLayerSnapshots: () => snapshots,
      lastWrittenClipboardMarkerRef: ref<string | null>(null),
      lastWrittenClipboardPlainTextRef: ref<string | null>(null),
      liveScreenSnapshotsById: {},
      overviewScreens,
      overviewSelectedScreenIds: [],
      pasteCascadeRef: ref(0),
      readPortableStyleSnapshot: noFrameAnswers,
      runtimeLayerSnapshotsById,
      setHasCanvasClipboard: () => {},
      t: (key) => key,
      viewModeRef: ref<"single" | "overview">("single"),
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.sourceParentNodeId).toBe("runtime-group");
    expect(copiedLayerEntriesRef.current[0]?.sourceParentNodeId).toBe(
      "runtime-group",
    );
    expect(
      parseDesignClipboardMarker(
        copiedLayerHtmlRef.current,
        "local-clipboard-token",
      )?.entries[0]?.sourceParentNodeId,
    ).toBe("runtime-group");
    expect(clipboard.writeDesignClipboard).toHaveBeenCalledTimes(1);
  });
});

describe("copying a layer whose selection carries no style snapshot", () => {
  const file: DesignFile = {
    id: "screen-a",
    filename: "index.html",
    fileType: "html",
    content:
      '<!doctype html><html><body><div class="card" data-agent-native-node-id="node-1">Copy</div></body></html>',
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const capturedSnapshot: PortableStyleSnapshot = {
    version: 1,
    rootSourceId: "node-1",
    nodes: [
      { sourceId: "node-1", path: [], styles: { color: "rgb(1, 2, 3)" } },
    ],
  };

  beforeEach(() => clipboard.writeDesignClipboard.mockClear());

  function copyWith(
    readPortableStyleSnapshot: (
      screenId: string,
      target: FrameElementTarget,
    ) => PortableStyleSnapshotRead,
    selectedElement = { tagName: "div", classes: ["card"] } as ElementInfo,
  ) {
    const projection = buildCodeLayerProjection(file.content!, {
      source: { kind: "design-file", fileId: file.id },
    });
    const node = projection.nodes.find((candidate) => candidate.tag === "div")!;
    const snapshots = runGetSelectedLayerSnapshots({
      activeFile: file,
      designSourceType: "inline",
      files: [file],
      getFreshActiveContent: () => file.content!,
      getScreenContent: () => file.content!,
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      runtimeLayerSnapshotsById: {},
      selectedElement,
      selectedElementLayerId: node.id,
      selectedLayerIdsState: [node.id],
    });
    expect(snapshots[0]?.portableStyleSnapshot).toBeUndefined();
    const copiedLayerEntriesRef = ref<CanvasLayerClipboardEntry[]>([]);
    const copying = runCopySelection({
      canvasFrameGeometryById: {},
      copiedLayerEntriesRef,
      copiedLayerHtmlRef: ref<string | null>(null),
      copiedScreenEntriesRef: ref<DesignClipboardScreenEntry[] | undefined>(
        undefined,
      ),
      designSourceType: "inline",
      files: [file],
      getScreenContent: () => file.content!,
      getSelectedLayerSnapshots: () => snapshots,
      lastWrittenClipboardMarkerRef: ref<string | null>(null),
      lastWrittenClipboardPlainTextRef: ref<string | null>(null),
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      pasteCascadeRef: ref(0),
      readPortableStyleSnapshot,
      runtimeLayerSnapshotsById: {},
      setHasCanvasClipboard: () => {},
      t: (key) => key,
      viewModeRef: ref<"single" | "overview">("single"),
    });
    return { copying, copiedLayerEntriesRef };
  }

  it("reads the snapshot from the layer's frame and writes it during the gesture", async () => {
    const read = vi.fn(
      (): PortableStyleSnapshotRead => ({
        status: "captured",
        snapshot: capturedSnapshot,
      }),
    );
    const { copying, copiedLayerEntriesRef } = copyWith(read);

    expect(read).toHaveBeenCalledWith("screen-a", {
      selector: '[data-agent-native-node-id="node-1"]',
      instanceIndex: 1,
    });
    expect(clipboard.writeDesignClipboard).toHaveBeenCalledTimes(1);
    expect(
      parseDesignClipboardMarker(
        clipboard.writeDesignClipboard.mock.calls[0]?.[0].html,
        "local-clipboard-token",
      )?.entries[0]?.portableStyleSnapshot,
    ).toEqual(capturedSnapshot);
    await copying;
    expect(copiedLayerEntriesRef.current[0]?.portableStyleSnapshot).toEqual(
      capturedSnapshot,
    );
  });

  it("marks the entry as a failed capture when the frame could not capture it", async () => {
    const { copying, copiedLayerEntriesRef } = copyWith(() => ({
      status: "failed",
    }));
    await copying;

    expect(copiedLayerEntriesRef.current[0]).toMatchObject({
      styleSnapshotCaptureFailed: true,
    });
    expect(
      copiedLayerEntriesRef.current[0]?.portableStyleSnapshot,
    ).toBeUndefined();
  });

  it("marks the entry failed when the frame that holds its snapshot no longer has it", async () => {
    const { copying, copiedLayerEntriesRef } = copyWith(noFrameAnswers, {
      tagName: "div",
      classes: ["card"],
      styleSnapshotReadOnDemand: true,
    } as ElementInfo);
    await copying;

    const entry = copiedLayerEntriesRef.current[0]!;
    expect(entry.styleSnapshotCaptureFailed).toBe(true);
    expect(portableStyleSnapshotForPasteTarget(entry, "screen-b")).toBeNull();
  });

  it("copies without a snapshot when no frame renders the layer", async () => {
    const { copying, copiedLayerEntriesRef } = copyWith(noFrameAnswers);
    await copying;

    expect(copiedLayerEntriesRef.current[0]?.portableStyleSnapshot).toBe(
      undefined,
    );
    expect(copiedLayerEntriesRef.current[0]?.styleSnapshotCaptureFailed).toBe(
      undefined,
    );
  });
});

describe("copying one instance of a repeated list", () => {
  const file: DesignFile = {
    id: "screen-a",
    filename: "index.html",
    fileType: "html",
    content:
      '<!doctype html><html><body><ul data-agent-native-node-id="list"><template x-for="item in items"><li data-agent-native-node-id="row" :class="item.tone" x-text="item.label"></li></template></ul></body></html>',
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const snapshotFor = (color: string): PortableStyleSnapshot => ({
    version: 1,
    rootSourceId: "row",
    nodes: [{ sourceId: "row", path: [], styles: { color } }],
  });

  it("reads the instance the user selected, not the first one with its id", async () => {
    const projection = buildCodeLayerProjection(file.content!, {
      source: { kind: "design-file", fileId: file.id },
    });
    const row = projection.nodes.find((node) => node.tag === "li")!;
    const thirdItem = {
      tagName: "li",
      classes: ["accent"],
      styleSnapshotReadOnDemand: true,
      repeat: {
        sourceSelector: '[data-agent-native-node-id="row"]',
        instanceCount: 3,
        instanceIndex: 3,
        xFor: "item in items",
        itemIndex: 2,
        textBinding: "item.label",
        keyExpression: "",
        itemKey: "",
      },
    } as ElementInfo;
    const snapshots = runGetSelectedLayerSnapshots({
      activeFile: file,
      designSourceType: "inline",
      files: [file],
      getFreshActiveContent: () => file.content!,
      getScreenContent: () => file.content!,
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      runtimeLayerSnapshotsById: {},
      selectedElement: thirdItem,
      selectedElementLayerId: row.id,
      selectedLayerIdsState: [row.id],
    });
    const read = vi.fn(
      (_screenId: string, target: FrameElementTarget) =>
        ({
          status: "captured",
          snapshot: snapshotFor(
            target.instanceIndex === 3 ? "rgb(220, 38, 38)" : "rgb(0, 0, 0)",
          ),
        }) as PortableStyleSnapshotRead,
    );
    const copiedLayerEntriesRef = ref<CanvasLayerClipboardEntry[]>([]);

    await runCopySelection({
      canvasFrameGeometryById: {},
      copiedLayerEntriesRef,
      copiedLayerHtmlRef: ref<string | null>(null),
      copiedScreenEntriesRef: ref<DesignClipboardScreenEntry[] | undefined>(
        undefined,
      ),
      designSourceType: "inline",
      files: [file],
      getScreenContent: () => file.content!,
      getSelectedLayerSnapshots: () => snapshots,
      lastWrittenClipboardMarkerRef: ref<string | null>(null),
      lastWrittenClipboardPlainTextRef: ref<string | null>(null),
      liveScreenSnapshotsById: {},
      overviewScreens: [],
      overviewSelectedScreenIds: [],
      pasteCascadeRef: ref(0),
      readPortableStyleSnapshot: read,
      runtimeLayerSnapshotsById: {},
      setHasCanvasClipboard: () => {},
      t: (key) => key,
      viewModeRef: ref<"single" | "overview">("single"),
    });

    expect(read).toHaveBeenCalledWith("screen-a", {
      selector: '[data-agent-native-node-id="row"]',
      instanceIndex: 3,
    });
    expect(copiedLayerEntriesRef.current[0]?.portableStyleSnapshot).toEqual(
      snapshotFor("rgb(220, 38, 38)"),
    );
  });
});
