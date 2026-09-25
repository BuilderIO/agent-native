import type { RefObject } from "react";

import { withHeadLinks } from "@/lib/figma-paste-layers";
import { insertClonedHtmlLayers } from "@/pages/design-editor/clone-and-pen-edit";
import { containingBlockOffset } from "@/pages/design-editor/figma-paste-scene";
import type { DesignFile } from "@/pages/design-editor/types";

import type { FigmaPasteLayerInsert } from "./import-figma-clipboard-into-design";

export interface InsertFigmaPasteLayersArgs {
  activeFile: DesignFile | undefined;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: { forcePreviewFullDocument?: boolean },
  ) => unknown;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: { forcePreviewFullDocument?: boolean },
  ) => unknown;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  pendingLocalFileContentsRef: RefObject<Map<string, { content: string }>>;
  selectInsertedLayers: (
    screenId: string,
    content: string,
    rootNodeIds: string[],
  ) => void;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runInsertFigmaPasteLayers(
  {
    activeFile,
    applyFileContentUpdate,
    applyLocalContentUpdate,
    canvasContainerRef,
    getFreshActiveContent,
    getScreenContent,
    pendingLocalFileContentsRef,
    selectInsertedLayers,
    viewModeRef,
  }: InsertFigmaPasteLayersArgs,
  fileId: string,
  selector: string | null,
  layers: FigmaPasteLayerInsert[],
): boolean {
  const baseContent =
    pendingLocalFileContentsRef.current?.get(fileId)?.content ??
    (fileId === activeFile?.id
      ? getFreshActiveContent()
      : getScreenContent(fileId));
  if (!baseContent) return false;
  const offset = selector
    ? containingBlockOffset({
        canvasRoot: canvasContainerRef.current,
        viewMode: viewModeRef.current,
        fileId,
        selector,
      })
    : { x: 0, y: 0 };
  const inserted = insertClonedHtmlLayers(
    withHeadLinks(
      baseContent,
      Array.from(new Set(layers.flatMap((layer) => layer.headLinks))),
    ),
    layers.map((layer) => layer.html),
    {
      ...(selector
        ? { targetSelectors: [selector], placement: "inside" as const }
        : {}),
      stripRootPosition: true,
      positions: layers.map((layer) =>
        layer.position
          ? {
              x: layer.position.x + offset.x,
              y: layer.position.y + offset.y,
              space: "layout" as const,
            }
          : null,
      ),
    },
  );
  if (!inserted) return false;
  if (fileId === activeFile?.id) {
    applyLocalContentUpdate(inserted.content, {
      forcePreviewFullDocument: true,
    });
  } else {
    applyFileContentUpdate(fileId, inserted.content, {
      forcePreviewFullDocument: true,
    });
  }
  selectInsertedLayers(fileId, inserted.content, inserted.rootNodeIds);
  return true;
}
