import { callClipsAction } from "./clips-api";

export type MobileCaptureView =
  | "home"
  | "dictate"
  | "meeting"
  | "video"
  | "clips";

export type MobileCapturePhase =
  | "idle"
  | "ready"
  | "recording"
  | "paused"
  | "saving"
  | "processing"
  | "review"
  | "browsing"
  | "playing"
  | "error";

export interface MobileCaptureStateInput {
  view: MobileCaptureView;
  phase: MobileCapturePhase;
  captureId?: string;
  recordingId?: string;
}

export interface MobileCaptureState extends MobileCaptureStateInput {
  updatedAt: string;
}

export type MobileCaptureStateWriteResult =
  | { ok: true; state: MobileCaptureState }
  | { ok: false; error: string };

export async function setMobileCaptureStateBestEffort(
  input: MobileCaptureStateInput,
): Promise<MobileCaptureStateWriteResult> {
  try {
    const state = await callClipsAction<MobileCaptureState>(
      "set-mobile-capture-state",
      { ...input },
    );
    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not update mobile capture state.",
    };
  }
}
