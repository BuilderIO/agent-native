// @vitest-environment happy-dom

import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

const clipboard = vi.hoisted(() => ({
  getDesignClipboardTrustToken: vi.fn(() => "local-clipboard-token"),
  plainTextFromDesignHtml: vi.fn(() => "Badge"),
  writeDesignClipboard: vi.fn(async () => {}),
}));

vi.mock("@/lib/design-clipboard", () => clipboard);

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
