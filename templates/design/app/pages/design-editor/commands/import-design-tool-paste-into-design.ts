import { callAction } from "@agent-native/core/client/hooks";
import { utf8ByteLength } from "@shared/fig-bytes";
import type {
  FigmaPasteLayer,
  FigmaPasteScene,
} from "@shared/figma-paste-plan";
import { planFigmaPaste } from "@shared/figma-paste-plan";
import { MAX_FIG_FRAME_HTML_BYTES } from "@shared/import-limits";
import type { QueryClient } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import type { DesignTool, DesignToolPaste } from "@/lib/design-tool-paste";
import { hostRemoteImages } from "@/lib/design-tool-paste/images";
import { pushWarning } from "@/lib/design-tool-paste/ir";
import {
  frameFilename,
  framePositions,
  packBatches,
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
  /**
   * Hosts a remote image in our storage under a receipt `key`, or throws with
   * the reason it could not.
   */
  mirrorImage: (url: string, key: string) => Promise<string>;
  /** Keeps (release) or removes (delete) an upload made by `mirrorImage`. */
  settleImage: (key: string, mode: "release" | "delete") => Promise<void>;
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

// import-design-source accepts at most this many frames per request, and its
// body limit is 4 MiB; frames are packed under both, leaving headroom for JSON.
const MAX_FRAMES_PER_REQUEST = 32;
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
// Separators around each frame in the request's frames array.
const FRAME_REQUEST_SLACK = 16;
// Frame titles are labels from the copy, so they are bounded like any input.
const MAX_FRAME_TITLE_LENGTH = 200;
const RELEASE_ATTEMPTS = 3;
const RELEASE_RETRY_MS = 250;

/** The batch import failed and clearing it failed too, so screens may remain. */
class PartialImportError extends Error {
  constructor(readonly original: unknown) {
    super("could not remove a partial import");
  }
}

/**
 * Creates one screen per frame through the batch import: each request is one
 * transaction, retries are idempotent, and a failure removes whatever the
 * batch created, including when the response that reported it was lost.
 */
async function createScreens(
  designId: string,
  layers: FigmaPasteLayer[],
  placeAt: { x: number; y: number } | null,
  batchId: string,
): Promise<string[]> {
  for (const layer of layers) {
    // The server refuses an oversized frame after the earlier ones are made.
    if (utf8ByteLength(layer.content) > MAX_FIG_FRAME_HTML_BYTES) {
      throw new Error(
        `frame "${layer.title}" is over the ${MAX_FIG_FRAME_HTML_BYTES} byte import limit`,
      );
    }
  }
  const positions = framePositions(layers, placeAt);
  const ids: string[] = [];
  const importFrames = (body: Record<string, unknown>) =>
    callAction("import-design-source", {
      designId,
      sourceType: "fig-frame",
      clientImportBatchId: batchId,
      ...body,
    }) as Promise<{ error?: string; files?: Array<{ id: string }> }>;
  const frames = layers.map((layer, index) => {
    const position = positions[index];
    return {
      content: layer.content,
      originalName: frameFilename(layer.title),
      frameTitle: layer.title.slice(0, MAX_FRAME_TITLE_LENGTH),
      ...(layer.width !== null ? { frameWidth: layer.width } : {}),
      ...(layer.height !== null ? { frameHeight: layer.height } : {}),
      ...(position ? { frameX: position.x, frameY: position.y } : {}),
      clientImportId: `${batchId}:${index}`,
    };
  });
  // Sized as the JSON that is sent, not as raw HTML: escaping control
  // characters and backslashes can double a frame on the wire.
  const sized = frames.map((frame) => ({
    frame,
    size: utf8ByteLength(JSON.stringify(frame)) + FRAME_REQUEST_SLACK,
  }));
  for (const { frame, size } of sized) {
    // A frame that passed the HTML check can still be too big once escaped.
    if (size > MAX_REQUEST_BYTES) {
      throw new Error(
        `frame "${frame.frameTitle}" is ${size} bytes once serialized, over the ${MAX_REQUEST_BYTES} byte request limit`,
      );
    }
  }
  const batches = packBatches(
    sized,
    (entry) => entry.size,
    MAX_FRAMES_PER_REQUEST,
    MAX_REQUEST_BYTES,
  );
  try {
    for (const [batchIndex, batch] of batches.entries()) {
      const result = await importFrames({
        clientImportFinalBatch: batchIndex === batches.length - 1,
        frames: batch.map(({ item }) => item.frame),
      });
      if (result.error) throw new Error(result.error);
      ids.push(...(result.files ?? []).map((file) => file.id));
    }
  } catch (error) {
    let cleared = true;
    try {
      const aborted = await importFrames({ abort: true });
      if (aborted.error) cleared = false;
    } catch (abortError) {
      cleared = false;
      console.error(
        "[design-paste] could not remove a partial import:",
        abortError,
      );
    }
    // Earlier batches may have committed; the user has to hear that.
    if (!cleared) throw new PartialImportError(error);
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
    settleImage,
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
  // Read now: the selection or canvas can change while images upload, and the
  // paste belongs where it was made.
  const scene = resolvePasteScene();
  const pasteId = browserImportId();
  // Receipts live outside the screen batch's id prefix, so the server's final
  // commit never sees an upload that is pending, failed or unused; this code
  // releases or deletes every one of them itself.
  const receiptPrefix = `images:${pasteId}:`;
  let hostedKeys: string[] = [];
  // True once screens or layers may point at the hosted images, after which
  // deleting them would break what the paste made.
  let referenced = false;
  const deleteHostedImages = () =>
    Promise.all(
      hostedKeys.map((key) =>
        settleImage(key, "delete").catch((settleError: unknown) => {
          console.error(
            "[design-paste] could not delete an upload:",
            settleError,
          );
        }),
      ),
    );
  /** Keeps the hosted images, retrying; returns how many were not confirmed. */
  const releaseHostedImages = async (): Promise<number> => {
    const confirmed = await Promise.all(
      hostedKeys.map(async (key) => {
        for (let attempt = 1; attempt <= RELEASE_ATTEMPTS; attempt += 1) {
          try {
            await settleImage(key, "release");
            return true;
          } catch (releaseError) {
            if (attempt === RELEASE_ATTEMPTS) {
              console.error(
                "[design-paste] could not confirm an upload was kept:",
                releaseError,
              );
              return false;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, RELEASE_RETRY_MS * attempt),
            );
          }
        }
        return false;
      }),
    );
    return confirmed.filter((ok) => !ok).length;
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
          receiptPrefix,
        );
        layers = hosted.layers;
        hostedKeys = hosted.keys;
        // An upload that failed may still have left a receipt behind.
        const failedKeys = hosted.attemptedKeys.filter(
          (key) => !hosted.keys.includes(key),
        );
        void Promise.all(
          failedKeys.map((key) =>
            settleImage(key, "delete").catch((settleError: unknown) => {
              console.error(
                "[design-paste] could not clear a failed upload:",
                settleError,
              );
            }),
          ),
        );
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
    const plan = planFigmaPaste(layers, scene);
    if (plan.kind === "screens") {
      const createdIds = await createScreens(id, layers, plan.placeAt, pasteId);
      referenced = true;
      const unsavedScreens = await releaseHostedImages();
      if (unsavedScreens > 0) {
        pushWarning(warnings, {
          kind: "images-unsaved",
          count: unsavedScreens,
        });
      }
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
    referenced = true;
    const unsaved = await releaseHostedImages();
    if (unsaved > 0)
      pushWarning(warnings, { kind: "images-unsaved", count: unsaved });
    announceOutcome([fileId]);
  } catch (error) {
    if (error instanceof PartialImportError) {
      // Screens may remain and point at the hosted images; keep them.
      referenced = true;
      await releaseHostedImages();
    }
    if (!referenced) await deleteHostedImages();
    if (error instanceof ShownPasteError) {
      failed(error.message);
      return;
    }
    if (error instanceof PartialImportError) {
      console.error(`[design-paste] ${tool} import failed:`, error.original);
      failed(t("designEditor.import.pastePartialImport"));
      return;
    }
    console.error(`[design-paste] ${tool} import failed:`, error);
    failed(t("common.genericError"));
  }
}
