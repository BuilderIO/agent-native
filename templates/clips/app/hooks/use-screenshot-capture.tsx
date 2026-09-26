import { useT } from "@agent-native/core/client/i18n";
import { errorMessage } from "@shared/display-capture-errors";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ScreenshotRegionOverlay } from "@/components/recorder/screenshot-region-overlay";
import { useCreateScreenshot } from "@/hooks/use-library";
import {
  buildCaptureTitle,
  inferWindowTitleFromDisplayStream,
} from "@/lib/recording-title";
import {
  encodeScreenshotCanvas,
  grabScreenshotFrame,
  isScreenshotCancelled,
  requestScreenshotStream,
  ScreenshotCaptureError,
  screenshotCaptureUnsupportedReason,
  stopScreenshotStream,
} from "@/lib/screenshot-capture";

export interface ScreenshotCaptureScope {
  folderId?: string | null;
  spaceId?: string | null;
}

interface PendingCapture {
  canvas: HTMLCanvasElement;
  title: string;
  sourceAppName: string | null;
  sourceWindowTitle: string | null;
}

/**
 * Take a screenshot and store it as an image recording.
 *
 * Two stages, because the browser owns the first one: its picker chooses the
 * screen, window or tab, then Clips freezes that frame and lets the user drag
 * the part they actually want out of it. Freezing first is deliberate — the
 * captured picture cannot shift under the selection, so a menu or hover state
 * survives being cropped.
 *
 * `captureScreenshot` is not async: the picker has to be reached from the
 * click itself. Closing it is a silent no-op — the user changed their mind,
 * not an error to report.
 */
export function useScreenshotCapture({
  folderId,
  spaceId,
}: ScreenshotCaptureScope = {}) {
  const t = useT();
  const createScreenshot = useCreateScreenshot();
  const [isCapturing, setIsCapturing] = useState(false);
  const [pending, setPending] = useState<PendingCapture | null>(null);

  const captureScreenshot = useCallback(() => {
    if (isCapturing || pending) return;

    const unsupported = screenshotCaptureUnsupportedReason();
    if (unsupported) {
      toast.error(t(`screenshot.${unsupported.key}`));
      return;
    }

    // No `await` before this line: the screen picker needs the click's
    // transient activation.
    const streamPromise = requestScreenshotStream();
    setIsCapturing(true);

    void (async () => {
      let stream: MediaStream | null = null;
      let capturingToastId: string | number | undefined;
      try {
        stream = await streamPromise;
        // Waiting for a background source to draw something can take a couple
        // of seconds, and until the crop overlay opens there is nothing on
        // screen to say the click worked.
        capturingToastId = toast.loading(t("screenshot.capturing"));
        const frame = await grabScreenshotFrame(stream);
        // Read the track label before stopping: it is where the window /
        // tab name comes from, and a stopped track no longer reports one.
        const captureTitle = buildCaptureTitle({
          windowTitle: inferWindowTitleFromDisplayStream(stream),
          displaySurface: frame.displaySurface,
          mode: "screenshot",
        });
        // Stop sharing before the crop step: the browser's "you are sharing
        // your screen" bar should not sit there while the user drags.
        stopScreenshotStream(stream);
        stream = null;

        setPending({
          canvas: frame.canvas,
          title: captureTitle.title,
          sourceAppName: captureTitle.sourceAppName,
          sourceWindowTitle: captureTitle.sourceWindowTitle,
        });
      } catch (err) {
        if (!isScreenshotCancelled(err)) {
          toast.error(
            err instanceof ScreenshotCaptureError
              ? t(`screenshot.${err.key}`)
              : errorMessage(err) || t("screenshot.failed"),
          );
        }
      } finally {
        if (capturingToastId !== undefined) toast.dismiss(capturingToastId);
        stopScreenshotStream(stream);
        setIsCapturing(false);
      }
    })();
  }, [isCapturing, pending, t]);

  const saveCapture = useCallback(
    (capture: PendingCapture, canvas: HTMLCanvasElement) => {
      setPending(null);
      const pendingToastId = toast.loading(t("screenshot.saving"));

      void (async () => {
        try {
          await createScreenshot.mutateAsync({
            dataUrl: encodeScreenshotCanvas(canvas),
            width: canvas.width,
            height: canvas.height,
            title: capture.title,
            sourceAppName: capture.sourceAppName,
            sourceWindowTitle: capture.sourceWindowTitle,
            folderId: folderId ?? null,
            ...(spaceId ? { spaceIds: [spaceId] } : {}),
          });
          toast.success(t("screenshot.saved"), { id: pendingToastId });
        } catch (err) {
          toast.dismiss(pendingToastId);
          toast.error(errorMessage(err) || t("screenshot.failed"));
          // The capture exists nowhere else; a failed upload must not cost
          // the user a screen they may not be able to get back. The crop
          // step reopens on it, to save again or cancel.
          setPending((current) => current ?? capture);
        }
      })();
    },
    [createScreenshot, folderId, spaceId, t],
  );

  const overlay: ReactNode = pending ? (
    <ScreenshotRegionOverlay
      canvas={pending.canvas}
      onConfirm={(canvas) => saveCapture(pending, canvas)}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return {
    captureScreenshot,
    isCapturing: isCapturing || pending !== null,
    overlay,
  };
}
