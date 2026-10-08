import { buildCodeLayerProjection } from "@shared/code-layer";
import { expect, it, vi } from "vitest";

import type { DesignFile } from "@/pages/design-editor/types";

const projected = vi.hoisted(() => [] as string[]);

vi.mock("@shared/code-layer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/code-layer")>();
  return {
    ...actual,
    buildCodeLayerProjection: (
      ...args: Parameters<typeof actual.buildCodeLayerProjection>
    ) => {
      projected.push(args[1]?.source?.fileId ?? "?");
      return actual.buildCodeLayerProjection(...args);
    },
  };
});

const { runGetSelectedLayerSnapshots } =
  await import("./get-selected-layer-snapshots");

function screen(id: string, nodeId: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content: `<!doctype html><html><body><div data-agent-native-node-id="${nodeId}">${id}</div></body></html>`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const files = [screen("a", "node-a"), screen("b", "node-b")];
const selectedId = buildCodeLayerProjection(files[1]!.content!, {
  source: { kind: "design-file", fileId: "b" },
}).nodes.find((node) => node.tag === "div")!.id;

function snapshots(layerOwnerFileId?: (layerId: string) => string | undefined) {
  projected.length = 0;
  return runGetSelectedLayerSnapshots({
    activeFile: files[1]!,
    designSourceType: "inline",
    files,
    getFreshActiveContent: () => files[1]!.content!,
    getScreenContent: (screenId) =>
      files.find((file) => file.id === screenId)!.content!,
    layerOwnerFileId,
    liveScreenSnapshotsById: {},
    overviewScreens: [],
    runtimeLayerSnapshotsById: {},
    selectedElement: null,
    selectedElementLayerId: selectedId,
    selectedLayerIdsState: [selectedId],
  });
}

it("projects only the screens that own the selection, with the same snapshots as a full scan", () => {
  const scanned = snapshots();
  expect(projected).toEqual(["a", "b"]);

  const owned = snapshots((layerId) =>
    layerId === selectedId ? "b" : undefined,
  );
  expect(projected).toEqual(["b"]);
  expect(owned.map((snapshot) => snapshot.html)).toEqual(
    scanned.map((snapshot) => snapshot.html),
  );
});

it("scans every screen when a selected layer has no known owner", () => {
  snapshots(() => undefined);
  expect(projected).toEqual(["a", "b"]);
});
