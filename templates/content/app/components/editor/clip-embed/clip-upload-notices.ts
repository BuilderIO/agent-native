import { callAction } from "@agent-native/core/client/hooks";
import {
  CLIP_CANCEL_OUTCOME,
  type ClipCancelResult,
} from "@shared/clips-peer-contract";
import { toast } from "sonner";

import { clipRecordingUrl } from "./use-clips-links";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Says what giving an upload up did. `cancelledKey` says why the upload was
 * given up, and shows only once Clips confirms the cancel: Clips may have
 * had the whole file first and kept the Clip.
 */
export async function announceClipCancel(
  cancelled: ClipCancelResult,
  input: { recordingId: string; cancelledKey: string; t: Translate },
): Promise<void> {
  const { recordingId, cancelledKey, t } = input;
  if (cancelled.outcome === CLIP_CANCEL_OUTCOME.cancelled) {
    toast.error(t(cancelledKey));
    return;
  }
  if (cancelled.outcome !== CLIP_CANCEL_OUTCOME.alreadyFinished) {
    toast.error(t("clipEmbed.uploadCancelUnconfirmed"));
    return;
  }
  await announceClipAlreadySaved({ recordingId, t });
}

/** Says Clips has the whole file and kept the Clip, linking to it there. */
export async function announceClipAlreadySaved(input: {
  recordingId: string;
  t: Translate;
}): Promise<void> {
  const { recordingId, t } = input;
  let appUrl: string | null = null;
  try {
    ({ appUrl } = await callAction<{ appUrl: string | null }>(
      "get-clips-links",
      {},
      { method: "GET" },
    ));
  } catch (error) {
    console.warn("[content-clips] couldn't link a saved upload to Clips", {
      recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const url = appUrl ? clipRecordingUrl(appUrl, recordingId) : null;
  toast.info(t("clipEmbed.uploadAlreadySaved"), {
    action: url
      ? {
          label: t("clipEmbed.openInClips"),
          onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
        }
      : undefined,
  });
}
