import { callAction } from "@agent-native/core/client/hooks";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import type { ImportResult } from "@/lib/design-import";
import { importResultSummary } from "@/lib/design-import";
import { resolveFigmaPasteImportCall } from "@/lib/figma-clipboard";

export interface ImportFigmaClipboardIntoDesignArgs {
  canEditDesign: boolean;
  figmaPasteImportingRef: RefObject<boolean>;
  id: string | undefined;
  navigate: NavigateFunction;
  queryClient: QueryClient;
  /** Prompts about image fills the clipboard could not carry. */
  showPastedImagesNotice: (args: { count: number; fileIds: string[] }) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runImportFigmaClipboardIntoDesign(
  {
    canEditDesign,
    figmaPasteImportingRef,
    id,
    navigate,
    queryClient,
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
    })) as ImportResult;
    if (result?.error) throw new Error(result.error);
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
      result?.files?.length
    ) {
      handledUnresolvedImages = true;
      showPastedImagesNotice({
        count: result.unresolvedImages!,
        fileIds: result.files.map((f) => f.id),
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
    void navigate(`/design/${result?.designId ?? id}?view=overview`);
  } catch (error) {
    toast.error(t("designEditor.import.errors.figmaPasteFailed"), {
      description:
        error instanceof Error ? error.message : t("common.genericError"),
    });
  } finally {
    figmaPasteImportingRef.current = false;
    toast.dismiss(loadingToastId);
  }
}
