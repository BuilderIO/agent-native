import { callAction } from "@agent-native/core/client/hooks";
import type {
  FigmaPasteLayer,
  FigmaPasteScene,
} from "@shared/figma-paste-plan";
import { planFigmaPaste } from "@shared/figma-paste-plan";
import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import type { DesignTool, DesignToolPaste } from "@/lib/design-tool-paste";
import { hostRemoteImages } from "@/lib/design-tool-paste/images";
import {
  frameFilename,
  framePositions,
} from "@/lib/design-tool-paste/placement";
import { describePasteWarnings } from "@/lib/design-tool-paste/warnings";
import { browserImportId } from "@/lib/fig-client-import";
import { figmaPasteLayerHtml } from "@/lib/figma-paste-layers";

import type { FigmaPasteLayerInsert } from "./insert-figma-paste-layers";

export interface ImportDesignToolPasteArgs {
  boardFileId: string | undefined;
  canEditDesign: boolean;
  id: string | undefined;
  insertPasteLayers: (
    fileId: string,
    selector: string | null,
    layers: FigmaPasteLayerInsert[],
  ) => boolean;
  navigate: NavigateFunction;
  queryClient: QueryClient;
  /** Hosts a remote image in our storage, or throws with the reason it could not. */
  mirrorImage: (url: string) => Promise<string>;
  resolvePasteScene: () => FigmaPasteScene;
  showPastedImagesNotice: (args: { count: number; fileIds: string[] }) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function designToolPasteFailureTitle(
  tool: DesignTool,
  t: ImportDesignToolPasteArgs["t"],
): string {
  switch (tool) {
    case "figma":
      return t("designEditor.import.errors.figmaPasteFailed");
    case "paper":
      return t("designEditor.import.errors.paperPasteFailed");
    case "wonder":
      return t("designEditor.import.errors.wonderPasteFailed");
  }
}

/** A failure whose message is already localized and safe to show as it is. */
class ShownPasteError extends Error {}

// import-design-source accepts at most this many frames per request.
const MAX_FRAMES_PER_REQUEST = 32;

/**
 * Creates one screen per frame through the batch import: each request is one
 * transaction, retries are idempotent, and a later failure removes the screens
 * an earlier request already created.
 */
async function createScreens(
  designId: string,
  layers: FigmaPasteLayer[],
  placeAt: { x: number; y: number } | null,
): Promise<string[]> {
  const batchId = browserImportId();
  const positions = framePositions(layers, placeAt);
  const ids: string[] = [];
  const importFrames = (body: Record<string, unknown>) =>
    callAction("import-design-source", {
      designId,
      sourceType: "fig-frame",
      clientImportBatchId: batchId,
      ...body,
    }) as Promise<{ error?: string; files?: Array<{ id: string }> }>;
  try {
    for (
      let start = 0;
      start < layers.length;
      start += MAX_FRAMES_PER_REQUEST
    ) {
      const chunk = layers.slice(start, start + MAX_FRAMES_PER_REQUEST);
      const result = await importFrames({
        clientImportFinalBatch: start + MAX_FRAMES_PER_REQUEST >= layers.length,
        frames: chunk.map((layer, offset) => {
          const position = positions[start + offset];
          return {
            content: layer.content,
            originalName: frameFilename(layer.title),
            frameTitle: layer.title,
            ...(layer.width !== null ? { frameWidth: layer.width } : {}),
            ...(layer.height !== null ? { frameHeight: layer.height } : {}),
            ...(position ? { frameX: position.x, frameY: position.y } : {}),
            clientImportId: `${batchId}:${start + offset}`,
          };
        }),
      });
      if (result.error) throw new Error(result.error);
      ids.push(...(result.files ?? []).map((file) => file.id));
    }
  } catch (error) {
    if (ids.length > 0) {
      await importFrames({ abort: true }).catch((abortError: unknown) => {
        console.error(
          "[design-paste] could not remove a partial import:",
          abortError,
        );
      });
    }
    throw error;
  }
  return ids;
}

export async function runImportDesignToolPasteIntoDesign(
  {
    boardFileId,
    canEditDesign,
    id,
    insertPasteLayers,
    mirrorImage,
    navigate,
    queryClient,
    resolvePasteScene,
    showPastedImagesNotice,
    t,
  }: ImportDesignToolPasteArgs,
  {
    tool,
    layers: pastedLayers,
    warnings: readWarnings,
    unresolvedImages = 0,
    remoteImages = [],
  }: DesignToolPaste,
) {
  const failed = (description: string): void => {
    toast.error(designToolPasteFailureTitle(tool, t), { description });
  };
  if (!canEditDesign) return;
  if (!id) return failed(t("common.genericError"));
  if (pastedLayers.length === 0) return failed(t("common.genericError"));
  const warnings = [...readWarnings];
  const announceOutcome = (fileIds: string[]) => {
    if (unresolvedImages > 0 && fileIds.length > 0) {
      showPastedImagesNotice({ count: unresolvedImages, fileIds });
    }
    const lines = describePasteWarnings(warnings, tool, t);
    if (lines.length === 0) return;
    toast.warning(t("designEditor.import.warningsToast"), {
      description: lines.join(" "),
    });
  };
  try {
    let layers = pastedLayers;
    if (remoteImages.length > 0) {
      const progressId = toast.loading(
        t("designEditor.import.figUploadProcessing"),
      );
      try {
        const hosted = await hostRemoteImages(
          pastedLayers,
          remoteImages,
          mirrorImage,
        );
        layers = hosted.layers;
        if (hosted.kept > 0) {
          warnings.push({
            kind: "images-linked",
            count: hosted.kept,
            reason: hosted.reason,
          });
        }
      } finally {
        toast.dismiss(progressId);
      }
    }
    const plan = planFigmaPaste(layers, resolvePasteScene());
    if (plan.kind === "screens") {
      const createdIds = await createScreens(id, layers, plan.placeAt);
      await queryClient.invalidateQueries({ queryKey: ["action"] });
      const overviewPath = `/design/${id}?editorView=overview`;
      const firstFileId = createdIds[0];
      void navigate(
        firstFileId
          ? `${overviewPath}&screen=${encodeURIComponent(firstFileId)}`
          : overviewPath,
      );
      announceOutcome(createdIds);
      return;
    }
    const fileId = plan.kind === "layers" ? plan.fileId : boardFileId;
    const inserts = layers.map((layer, index) => {
      const fragment = figmaPasteLayerHtml(layer);
      return fragment
        ? { ...fragment, position: plan.positions[index] ?? null }
        : null;
    });
    if (
      !fileId ||
      inserts.some((insert) => insert === null) ||
      !insertPasteLayers(
        fileId,
        plan.kind === "layers" ? plan.selector : null,
        inserts as FigmaPasteLayerInsert[],
      )
    ) {
      throw new ShownPasteError(t("designEditor.toasts.primitiveInsertFailed"));
    }
    announceOutcome([fileId]);
  } catch (error) {
    if (error instanceof ShownPasteError) {
      failed(error.message);
      return;
    }
    console.error(`[design-paste] ${tool} import failed:`, error);
    failed(t("common.genericError"));
  }
}
