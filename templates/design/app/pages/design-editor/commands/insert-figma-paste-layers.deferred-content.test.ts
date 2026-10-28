// @vitest-environment happy-dom

import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DesignFile } from "@/pages/design-editor/types";

import { runInsertFigmaPasteLayers } from "./insert-figma-paste-layers";

const FRESH_CONTENT = `<!doctype html><html><body>
<main data-agent-native-node-id="fresh-document">Fresh document</main>
</body></html>`;
const STALE_CONTENT = `<!doctype html><html><body>
<main data-agent-native-node-id="stale-document">Stale pending document</main>
</body></html>`;
const PASTED_LAYER = `<div data-agent-native-node-id="pasted-layer" style="position:absolute;left:12px;top:18px;width:30px;height:20px">Pasted layer</div>`;

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

function designFile(id: string): DesignFile {
  return {
    id,
    filename: `${id}.html`,
    fileType: "html",
    content: FRESH_CONTENT,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function harness(options: {
  activeFileId: string;
  fallbackContent: string;
  fileId: string;
  pendingContent: string;
  deferCollabReconcile: boolean;
}) {
  const activeFile = designFile(options.activeFileId);
  const getFreshActiveContent = vi.fn(() => options.fallbackContent);
  const getScreenContent = vi.fn(() => options.fallbackContent);
  const applyFileContentUpdate = vi.fn(
    (
      _fileId: string,
      _nextContent: string,
      _options?: { forcePreviewFullDocument?: boolean },
    ) => {},
  );
  const applyLocalContentUpdate = vi.fn(
    (
      _nextContent: string,
      _options?: { forcePreviewFullDocument?: boolean },
    ) => {},
  );
  const selectInsertedLayers = vi.fn(
    (_screenId: string, _content: string, _rootNodeIds: string[]) => {},
  );
  const pendingLocalFileContentsRef = ref(
    new Map([
      [
        options.fileId,
        {
          content: options.pendingContent,
          deferCollabReconcile: options.deferCollabReconcile,
        },
      ],
    ]),
  );

  return {
    args: {
      activeFile,
      applyFileContentUpdate,
      applyLocalContentUpdate,
      canvasContainerRef: ref<HTMLDivElement | null>(null),
      getFreshActiveContent,
      getScreenContent,
      pendingLocalFileContentsRef,
      selectInsertedLayers,
      viewModeRef: ref<"single" | "overview">("single"),
    },
    applyFileContentUpdate,
    applyLocalContentUpdate,
    getFreshActiveContent,
    getScreenContent,
    selectInsertedLayers,
  };
}

function insert(h: ReturnType<typeof harness>, fileId: string) {
  return runInsertFigmaPasteLayers(h.args, fileId, null, [
    { html: PASTED_LAYER, headLinks: [], position: { x: 70, y: 90 } },
  ]);
}

describe("runInsertFigmaPasteLayers with deferred collaboration content", () => {
  it("uses the fresh active document when pending content defers collaboration reconciliation", () => {
    const h = harness({
      activeFileId: "screen-a",
      fallbackContent: FRESH_CONTENT,
      fileId: "screen-a",
      pendingContent: STALE_CONTENT,
      deferCollabReconcile: true,
    });

    expect(insert(h, "screen-a")).toBe(true);

    expect(h.getFreshActiveContent).toHaveBeenCalledOnce();
    expect(h.getScreenContent).not.toHaveBeenCalled();
    expect(h.applyLocalContentUpdate).toHaveBeenCalledOnce();
    expect(h.applyFileContentUpdate).not.toHaveBeenCalled();
    const insertedContent = h.applyLocalContentUpdate.mock.calls[0]![0];
    expect(insertedContent).toContain(
      'data-agent-native-node-id="fresh-document"',
    );
    expect(insertedContent).not.toContain(
      'data-agent-native-node-id="stale-document"',
    );
    expect(insertedContent).toContain("Pasted layer");
    expect(h.selectInsertedLayers).toHaveBeenCalledWith(
      "screen-a",
      insertedContent,
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("uses the current screen document for a nonactive target with deferred pending content", () => {
    const h = harness({
      activeFileId: "screen-active",
      fallbackContent: FRESH_CONTENT,
      fileId: "screen-target",
      pendingContent: STALE_CONTENT,
      deferCollabReconcile: true,
    });

    expect(insert(h, "screen-target")).toBe(true);

    expect(h.getFreshActiveContent).not.toHaveBeenCalled();
    expect(h.getScreenContent).toHaveBeenCalledOnce();
    expect(h.applyFileContentUpdate).toHaveBeenCalledOnce();
    expect(h.applyFileContentUpdate).toHaveBeenCalledWith(
      "screen-target",
      expect.stringContaining('data-agent-native-node-id="fresh-document"'),
      { forcePreviewFullDocument: true },
    );
    const insertedContent = h.applyFileContentUpdate.mock.calls[0]![1];
    expect(insertedContent).not.toContain(
      'data-agent-native-node-id="stale-document"',
    );
    expect(insertedContent).toContain("Pasted layer");
    expect(h.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(h.selectInsertedLayers).toHaveBeenCalledWith(
      "screen-target",
      insertedContent,
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("keeps an ordinary pending document ahead of the fresh active document", () => {
    const h = harness({
      activeFileId: "screen-a",
      fallbackContent: FRESH_CONTENT,
      fileId: "screen-a",
      pendingContent: STALE_CONTENT,
      deferCollabReconcile: false,
    });

    expect(insert(h, "screen-a")).toBe(true);

    expect(h.getFreshActiveContent).not.toHaveBeenCalled();
    const insertedContent = h.applyLocalContentUpdate.mock.calls[0]![0];
    expect(insertedContent).toContain(
      'data-agent-native-node-id="stale-document"',
    );
    expect(insertedContent).not.toContain(
      'data-agent-native-node-id="fresh-document"',
    );
    expect(insertedContent).toContain("Pasted layer");
  });

  it("returns false without updates when deferred content has no fallback document", () => {
    const h = harness({
      activeFileId: "screen-a",
      fallbackContent: "",
      fileId: "screen-a",
      pendingContent: STALE_CONTENT,
      deferCollabReconcile: true,
    });

    expect(insert(h, "screen-a")).toBe(false);

    expect(h.getFreshActiveContent).toHaveBeenCalledOnce();
    expect(h.applyLocalContentUpdate).not.toHaveBeenCalled();
    expect(h.applyFileContentUpdate).not.toHaveBeenCalled();
    expect(h.selectInsertedLayers).not.toHaveBeenCalled();
  });
});
