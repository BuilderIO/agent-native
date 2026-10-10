import { useCallback, useEffect, useRef, useState } from "react";

import {
  LocalNativeExportArtifactError,
  saveLocalNativeExportArtifact,
} from "@/lib/local-native-export-artifact";

import { nativeExportLocalQaSinkEnabled } from "./native-scene-export-client";

export interface RetainedNativeExport {
  href: string;
  filename: string;
  format:
    | "png"
    | "jpg"
    | "webp"
    | "avif"
    | "mp4"
    | "svg"
    | "pdf"
    | "zip"
    | "html";
  localEvidence?: {
    status: "pending" | "saved" | "failed";
    artifactId?: string;
    errorCode?: string;
  };
}

export function useRetainedNativeExport(
  ownerId: string | undefined,
  onLocalEvidenceError?: (error: unknown) => void,
) {
  const [result, setResult] = useState<RetainedNativeExport | null>(null);
  const activeHandoff = useRef<AbortController | null>(null);
  const retainedHref = useRef<string | null>(null);
  const onErrorRef = useRef(onLocalEvidenceError);
  onErrorRef.current = onLocalEvidenceError;

  useEffect(() => {
    setResult(null);
    return () => {
      activeHandoff.current?.abort();
      activeHandoff.current = null;
      if (retainedHref.current) URL.revokeObjectURL(retainedHref.current);
      retainedHref.current = null;
    };
  }, [ownerId]);

  const download = useCallback(
    (blob: Blob, filename: string, format: RetainedNativeExport["format"]) => {
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.rel = "noopener";
      try {
        document.body.appendChild(anchor);
        anchor.click();
      } catch (error) {
        URL.revokeObjectURL(href);
        throw error;
      } finally {
        anchor.remove();
      }

      if (retainedHref.current) URL.revokeObjectURL(retainedHref.current);
      retainedHref.current = href;
      activeHandoff.current?.abort();
      activeHandoff.current = null;
      const shouldSaveLocalEvidence = nativeExportLocalQaSinkEnabled(blob);
      setResult({
        href,
        filename,
        format,
        ...(shouldSaveLocalEvidence
          ? { localEvidence: { status: "pending" as const } }
          : {}),
      });
      if (!shouldSaveLocalEvidence) return;
      if (!ownerId) {
        const error = new LocalNativeExportArtifactError("invalid-design-id");
        setResult((current) =>
          current?.href === href
            ? {
                ...current,
                localEvidence: { status: "failed", errorCode: error.code },
              }
            : current,
        );
        onErrorRef.current?.(error);
        return;
      }

      const controller = new AbortController();
      activeHandoff.current = controller;
      void saveLocalNativeExportArtifact({
        designId: ownerId,
        blob,
        signal: controller.signal,
      }).then(
        (artifact) => {
          if (controller.signal.aborted) return;
          setResult((current) =>
            current?.href === href
              ? {
                  ...current,
                  localEvidence: {
                    status: "saved",
                    artifactId: artifact.artifactId,
                  },
                }
              : current,
          );
          if (activeHandoff.current === controller)
            activeHandoff.current = null;
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setResult((current) =>
            current?.href === href
              ? {
                  ...current,
                  localEvidence: {
                    status: "failed",
                    errorCode:
                      error instanceof LocalNativeExportArtifactError
                        ? error.code
                        : "handoff-failed",
                  },
                }
              : current,
          );
          if (activeHandoff.current === controller)
            activeHandoff.current = null;
          onErrorRef.current?.(error);
        },
      );
    },
    [ownerId],
  );

  return { result, download };
}
