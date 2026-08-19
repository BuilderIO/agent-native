import { callAction } from "@agent-native/core/client/hooks";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
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
  setFigmaHydrationFileIds: Dispatch<SetStateAction<string[]>>;
  setFigmaHydrationImageCount: Dispatch<SetStateAction<number>>;
  setFigmaHydrationOpen: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runImportFigmaClipboardIntoDesign(
  {
    canEditDesign,
    figmaPasteImportingRef,
    id,
    navigate,
    queryClient,
    setFigmaHydrationFileIds,
    setFigmaHydrationImageCount,
    setFigmaHydrationOpen,
    t,
  }: ImportFigmaClipboardIntoDesignArgs,
  content: string,
) {
  if (!id) return;
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
    if (
      result?.strategy === "localKiwi" &&
      (result?.unresolvedImages ?? 0) > 0 &&
      result?.files?.length
    ) {
      const count = result.unresolvedImages!;
      const fileIds = result.files.map((f) => f.id);
      setFigmaHydrationFileIds(fileIds);
      setFigmaHydrationImageCount(count);
      setFigmaHydrationOpen(true);
      toast.info(
        t("designEditor.import.figmaPasteImagesNeedToken", {
          count,
          plural: count === 1 ? "" : "s",
        }),
      );
    } else if (result?.figmaApiKeyMissing) {
      toast.info(t("designEditor.import.figmaPasteApiKeyHint"));
    } else if (
      result?.strategy === "htmlFallback" &&
      (result?.matchStatus === "ambiguous" || result?.matchStatus === "none")
    ) {
      toast.info(t("designEditor.import.figmaPasteMatchGuidance"));
    }
    if (result?.warnings?.length) {
      toast.warning(t("designEditor.import.warningsToast"), {
        description: result.warnings[0],
      });
    }
    navigate(`/design/${result?.designId ?? id}?view=overview`);
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
