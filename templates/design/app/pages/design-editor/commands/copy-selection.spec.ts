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
  ElementInfo,
  PortableStyleSnapshot,
} from "@/components/design/types";
import { parseDesignClipboardMarker } from "@/lib/design-import";
import type { DesignClipboardScreenEntry } from "@/lib/design-import";
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
