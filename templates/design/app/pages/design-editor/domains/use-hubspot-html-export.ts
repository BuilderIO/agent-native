import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

import {
  runDownloadHubspotHtml,
  type DownloadHubspotHtmlArgs,
} from "../commands/download-hubspot-html";
import type { DesignFile } from "../types";

export interface HubspotEmailConversion {
  designId: string;
  fileId: string;
  title: string;
  expectedVersionHash: string;
  reason: string;
}

export function useHubspotHtmlExport({
  designId,
  selectedFile,
  getScreenContent,
  flushPendingFileContentSaves,
  triggerBlobDownload,
  t,
}: Pick<
  DownloadHubspotHtmlArgs,
  "getScreenContent" | "flushPendingFileContentSaves" | "triggerBlobDownload"
> & {
  designId: string | undefined;
  selectedFile: DesignFile | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [hubspotHtmlExporting, setHubspotHtmlExporting] = useState(false);
  const exportingRef = useRef(false);
  const [hubspotEmailConversion, setHubspotEmailConversion] =
    useState<HubspotEmailConversion | null>(null);
  const conversionRef = useRef<HubspotEmailConversion | null>(null);
  const currentDesignIdRef = useRef(designId);
  currentDesignIdRef.current = designId;
  const canExportHubspotHtml = selectedFile?.fileType === "html";

  const closeHubspotEmailConversion = useCallback(() => {
    conversionRef.current = null;
    setHubspotEmailConversion(null);
  }, []);

  useEffect(() => {
    closeHubspotEmailConversion();
  }, [designId, closeHubspotEmailConversion]);

  const handleDownloadHubspotHtml = useCallback(() => {
    if (!designId || selectedFile?.fileType !== "html") return;
    const source = {
      designId,
      fileId: selectedFile.id,
      title: selectedFile.filename.slice(0, 160),
    };
    return runDownloadHubspotHtml({
      designId,
      fileId: source.fileId,
      exportingRef,
      setExporting: setHubspotHtmlExporting,
      getScreenContent,
      flushPendingFileContentSaves,
      triggerBlobDownload,
      onInvalidEmail: (failure) => {
        if (currentDesignIdRef.current !== designId) return;
        const conversion = { ...source, ...failure };
        conversionRef.current = conversion;
        setHubspotEmailConversion(conversion);
      },
      t,
    });
  }, [
    designId,
    selectedFile,
    getScreenContent,
    flushPendingFileContentSaves,
    triggerBlobDownload,
    t,
  ]);

  const handleConvertHubspotEmailWithAgent = useCallback(() => {
    const conversion = conversionRef.current;
    if (!conversion || conversion.designId !== currentDesignIdRef.current)
      return;
    // Consume the clicked source before dispatch so repeated clicks cannot submit twice.
    closeHubspotEmailConversion();
    try {
      sendToDesignAgentChat({
        message: t("designEditor.hubspotConversion.prompt"),
        context: JSON.stringify({
          designId: conversion.designId,
          fileId: conversion.fileId,
          title: conversion.title,
          exportAttemptVersionHash: conversion.expectedVersionHash,
          validationIssue: conversion.reason.slice(0, 600),
        }),
        mode: "act",
        submit: true,
        openSidebar: true,
      });
    } catch (error) {
      conversionRef.current = conversion;
      setHubspotEmailConversion(conversion);
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.hubspotHtmlExportError"),
      );
    }
  }, [closeHubspotEmailConversion, t]);

  return {
    handleDownloadHubspotHtml,
    canExportHubspotHtml,
    hubspotHtmlExporting,
    hubspotEmailConversion,
    closeHubspotEmailConversion,
    handleConvertHubspotEmailWithAgent,
  };
}
