import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";

import { readRecoverableRecordingBackup } from "@/lib/recording-backup";

type PreviewState =
  | { status: "ready"; url: string }
  | { status: "unavailable" }
  | { status: "loading" };

export function LocalRecordingPreview({
  recordingId,
  fallbackBlob,
}: {
  recordingId: string;
  fallbackBlob: Blob | null;
}) {
  const t = useT();
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreview({ status: "loading" });

    void (async () => {
      let blob = fallbackBlob;
      try {
        const copy = await readRecoverableRecordingBackup(recordingId);
        blob = copy?.blob ?? blob;
      } catch (error) {
        console.warn("[recorder] reading the local preview failed:", error);
      }

      if (cancelled) return;
      if (!blob || blob.size === 0) {
        setPreview({ status: "unavailable" });
        return;
      }

      try {
        objectUrl = URL.createObjectURL(blob);
        setPreview({ status: "ready", url: objectUrl });
      } catch (error) {
        console.warn("[recorder] creating the local preview failed:", error);
        setPreview({ status: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallbackBlob, recordingId]);

  return (
    <section
      className="grid gap-2"
      aria-label={t("recordRoute.localRecordingPreview")}
    >
      {preview.status === "ready" ? (
        <video
          src={preview.url}
          controls
          playsInline
          preload="metadata"
          aria-label={t("recordRoute.localRecordingPreview")}
          className="aspect-video w-full rounded-lg border border-border bg-muted"
        />
      ) : preview.status === "unavailable" ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("recordRoute.localPreviewUnavailable")}
        </p>
      ) : (
        <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
      )}
    </section>
  );
}
