import { callAction } from "@agent-native/core/client/hooks";
import type {
  FigmaPasteLayer,
  FigmaPastePlan,
  FigmaPasteScene,
} from "@shared/figma-paste-plan";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import type { ImportResult } from "@/lib/design-import";
import { importResultSummary } from "@/lib/design-import";
import { resolveFigmaPasteImportCall } from "@/lib/figma-clipboard";
import { figmaPasteLayerHtml } from "@/lib/figma-paste-layers";

function figmaPasteFailureDescription(
  error: unknown,
  t: (key: string) => string,
): string {
  const failure = error as
    | {
        errorCode?: unknown;
        statusCode?: unknown;
        details?: Record<string, unknown>;
      }
    | undefined;
  if (failure?.errorCode === "figma_auth_required") {
    return t("designEditor.import.figmaPasteApiKeyHint");
  }
  if (
    failure?.errorCode === "figma_request_failed" &&
    (failure.statusCode === 403 || failure.details?.figmaStatus === 403)
  ) {
    return t("designEditor.import.figmaPasteAccessDenied");
  }
  return error instanceof Error ? error.message : t("common.genericError");
}

export interface FigmaPasteLayerInsert {
  html: string;
  headLinks: string[];
  /** null: append as a flow child of an auto-layout container. */
  position: { x: number; y: number } | null;
}

export interface ImportFigmaClipboardIntoDesignArgs {
  canEditDesign: boolean;
  boardFileId: string | undefined;
  figmaPasteImportingRef: RefObject<boolean>;
  id: string | undefined;
  /** Inserts the layers into the file (inside `selector` when given) and
   * selects them; false if refused. */
  insertPasteLayers: (
    fileId: string,
    selector: string | null,
    layers: FigmaPasteLayerInsert[],
  ) => boolean;
  navigate: NavigateFunction;
  queryClient: QueryClient;
  resolvePasteScene: () => FigmaPasteScene;
  /** Prompts about image fills the clipboard could not carry. */
  showPastedImagesNotice: (args: { count: number; fileIds: string[] }) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runImportFigmaClipboardIntoDesign(
  {
    boardFileId,
    canEditDesign,
    figmaPasteImportingRef,
    id,
    insertPasteLayers,
    navigate,
    queryClient,
    resolvePasteScene,
    showPastedImagesNotice,
    t,
  }: ImportFigmaClipboardIntoDesignArgs,
  content: string,
) {
  // A paste that lands before the editor has a design id must say so; a bare
  // return here is indistinguishable from the paste never firing.
  if (!id) {
    toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
      description: "Open a design before pasting from Figma." /* i18n-ignore */,
    });
    return;
  }
  if (!canEditDesign) {
    toast.error("Import requires editor access" /* i18n-ignore */);
    return;
  }
  if (figmaPasteImportingRef.current) {
    toast.info(t("designEditor.import.figUploadProcessing"));
    return;
  }
  figmaPasteImportingRef.current = true;
  const loadingToastId = toast.loading(
    t("designEditor.import.figUploadProcessing"),
  );
  try {
    const figmaPasteCall = resolveFigmaPasteImportCall(content);
    const result = (await callAction(figmaPasteCall.action, {
      designId: id,
      ...figmaPasteCall.payload,
      ...(figmaPasteCall.action === "import-figma-clipboard"
        ? { pasteScene: resolvePasteScene() }
        : {}),
    })) as ImportResult & {
      errorCode?: unknown;
      statusCode?: unknown;
      details?: Record<string, unknown>;
      layers?: FigmaPasteLayer[];
      plan?: Exclude<FigmaPastePlan, { kind: "screens" }>;
    };
    if (result?.error) {
      throw Object.assign(new Error(result.error), {
        errorCode: result.errorCode,
        statusCode: result.statusCode,
        details: result.details,
      });
    }
    const { layers, plan } = result;
    if (plan && layers?.length) {
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
        throw new Error(t("designEditor.toasts.primitiveInsertFailed"));
      }
      announceImport(result, [fileId]);
      return;
    }
    if (!result?.files?.length) {
      toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
        description:
          result?.guidance ?? t("designEditor.import.figmaPasteMatchGuidance"),
      });
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["action", "get-design"] }),
      queryClient.invalidateQueries({ queryKey: ["action"] }),
    ]);
    announceImport(
      result,
      result.files.map((f) => f.id),
    );
    const overviewPath = `/design/${result?.designId ?? id}?editorView=overview`;
    const firstImportedFileId = result.files[0]?.id;
    void navigate(
      firstImportedFileId
        ? `${overviewPath}&screen=${encodeURIComponent(firstImportedFileId)}`
        : overviewPath,
    );
  } catch (error) {
    toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
      description: figmaPasteFailureDescription(error, t),
    });
  } finally {
    figmaPasteImportingRef.current = false;
    toast.dismiss(loadingToastId);
  }

  function announceImport(result: ImportResult, fileIds: string[]) {
    const figmaStrategyLabel =
      result?.strategy === "restNodes"
        ? t("designEditor.import.figmaPasteRestLabel")
        : result?.strategy === "htmlFallback"
          ? t("designEditor.import.figmaPasteHtmlLabel")
          : result?.strategy === "localKiwi"
            ? t("designEditor.import.figmaPasteLocalKiwiLabel")
            : undefined;
    toast.success(
      importResultSummary(result, t("designEditor.import.figmaSuccess")),
      figmaStrategyLabel ? { description: figmaStrategyLabel } : undefined,
    );
    let handledUnresolvedImages = false;
    if (
      result?.strategy === "localKiwi" &&
      (result?.unresolvedImages ?? 0) > 0 &&
      fileIds.length
    ) {
      handledUnresolvedImages = true;
      showPastedImagesNotice({
        count: result.unresolvedImages!,
        fileIds,
      });
    } else if (result?.figmaApiKeyMissing) {
      toast.info(t("designEditor.import.figmaPasteApiKeyHint"));
    } else if (
      result?.strategy === "htmlFallback" &&
      (result?.matchStatus === "ambiguous" || result?.matchStatus === "none")
    ) {
      toast.info(t("designEditor.import.figmaPasteMatchGuidance"));
    }
    // The unresolved-image warning is the notice above, worded for the server.
    // Repeating it here stacked three toasts on one paste, two of them saying
    // the same thing.
    const remainingWarnings = handledUnresolvedImages
      ? (result?.warnings ?? []).filter(
          (warning) => !/images? could not be loaded/i.test(warning),
        )
      : (result?.warnings ?? []);
    if (remainingWarnings.length) {
      toast.warning(t("designEditor.import.warningsToast"), {
        description: remainingWarnings[0],
      });
    }
  }
}
