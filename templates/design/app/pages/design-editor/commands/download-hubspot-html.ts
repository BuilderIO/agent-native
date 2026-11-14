import {
  actionErrorCode,
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { sourceContentHash } from "@shared/source-workspace";
import type { RefObject } from "react";
import { toast } from "sonner";

import { flushCommitsAfterPaint } from "../commit-after-paint";

export interface DownloadHubspotHtmlArgs {
  designId: string;
  fileId: string;
  exportingRef: RefObject<boolean>;
  setExporting: (exporting: boolean) => void;
  getScreenContent: (fileId: string) => string;
  flushPendingFileContentSaves: () => Promise<void>;
  triggerBlobDownload: (blob: Blob, filename: string) => void;
  onInvalidEmail: (failure: {
    expectedVersionHash: string;
    reason: string;
  }) => void;
  t: (key: string) => string;
}

export async function runDownloadHubspotHtml({
  designId,
  fileId,
  exportingRef,
  setExporting,
  getScreenContent,
  flushPendingFileContentSaves,
  triggerBlobDownload,
  onInvalidEmail,
  t,
}: DownloadHubspotHtmlArgs): Promise<void> {
  if (exportingRef.current) return;
  exportingRef.current = true;
  setExporting(true);
  const pendingToast = toast.loading(
    t("designEditor.toasts.hubspotHtmlExporting"),
  );
  try {
    flushCommitsAfterPaint();
    const expectedVersionHash = sourceContentHash(getScreenContent(fileId));
    await flushPendingFileContentSaves();
    let result: { html: string; filename: string };
    try {
      result = await callAction<{ html: string; filename: string }>(
        "export-hubspot-html",
        { id: designId, fileId, expectedVersionHash },
      );
    } catch (error) {
      if (actionErrorCode(error) !== "invalid_hubspot_email") throw error;
      onInvalidEmail({
        expectedVersionHash,
        reason:
          actionErrorMessage(error) ??
          t("designEditor.toasts.hubspotHtmlExportError"),
      });
      return;
    }
    if (
      typeof result.html !== "string" ||
      typeof result.filename !== "string"
    ) {
      toast.error(t("designEditor.toasts.htmlCreateError"));
      return;
    }
    triggerBlobDownload(
      new Blob([result.html], { type: "text/html;charset=utf-8" }),
      result.filename,
    );
    toast.success(t("designEditor.toasts.hubspotHtmlDownloaded"));
  } catch (error) {
    toast.error(
      actionErrorMessage(error) ??
        t("designEditor.toasts.hubspotHtmlExportError"),
    );
  } finally {
    toast.dismiss(pendingToast);
    exportingRef.current = false;
    setExporting(false);
  }
}
