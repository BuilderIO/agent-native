export const VOICE_FOCUSED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
};

export function voiceFocusedAudioConstraints(
  deviceId?: string | null,
): MediaTrackConstraints {
  const id = deviceId?.trim();
  return {
    ...VOICE_FOCUSED_AUDIO_CONSTRAINTS,
    ...(id ? { deviceId: { exact: id } } : {}),
  };
}

export function buildDesktopDisplayMediaOptions({
  audio,
  frameRate,
  maxWidth,
  maxHeight,
}: {
  audio: boolean;
  frameRate: number;
  maxWidth: number;
  maxHeight: number;
}): DisplayMediaStreamOptions {
  return {
    video: {
      frameRate: {
        ideal: frameRate,
        max: frameRate,
      },
      width: { ideal: maxWidth },
      height: { ideal: maxHeight },
    },
    audio,
  };
}

export function isMediaConstraintFailure(err: unknown): boolean {
  const name =
    err instanceof DOMException || err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError" ||
    name === "NotFoundError" ||
    /invalid constraint|overconstrained|could not satisfy constraint|device not found|requested device not found/i.test(
      message,
    )
  );
}

export async function getCameraStreamWithFallback(
  deviceId?: string | null,
  videoConstraints?: MediaTrackConstraints,
): Promise<MediaStream> {
  const id = deviceId?.trim();
  // Extra constraints (e.g. the bubble's ideal resolution) apply to both the
  // exact-device attempt and the default-camera retry; with no extras the
  // fallback stays a plain `video: true` request.
  const baseVideo: MediaStreamConstraints["video"] =
    videoConstraints && Object.keys(videoConstraints).length > 0
      ? videoConstraints
      : true;
  const exactConstraints: MediaStreamConstraints = {
    video: id ? { ...videoConstraints, deviceId: { exact: id } } : baseVideo,
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(exactConstraints);
  } catch (err) {
    if (!id || !isMediaConstraintFailure(err)) throw err;
    console.warn(
      "[clips-recorder] selected camera constraint failed; retrying default camera",
      err,
    );
    return navigator.mediaDevices.getUserMedia({
      video: baseVideo,
      audio: false,
    });
  }
}

export async function getAudioStreamWithFallback(
  deviceId?: string | null,
): Promise<MediaStream> {
  const id = deviceId?.trim();

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: voiceFocusedAudioConstraints(id),
      video: false,
    });
  } catch (err) {
    if (!isMediaConstraintFailure(err)) throw err;
    if (id) {
      console.warn(
        "[clips-recorder] selected mic constraint failed; retrying default mic",
        err,
      );
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: VOICE_FOCUSED_AUDIO_CONSTRAINTS,
          video: false,
        });
      } catch (fallbackErr) {
        if (!isMediaConstraintFailure(fallbackErr)) throw fallbackErr;
        console.warn(
          "[clips-recorder] voice-focused mic constraints failed; retrying basic audio",
          fallbackErr,
        );
        return navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }
    }

    console.warn(
      "[clips-recorder] voice-focused mic constraints failed; retrying basic audio",
      err,
    );
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  }
}
