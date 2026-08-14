import {
  chooseFallbackAudioInput,
  enumerateAudioInputDevices,
  isLikelyPhoneMicLabel,
  normalizedMediaDeviceId,
  type AudioInputFallback,
} from "../../../shared/media-device-selection";

export const VOICE_FOCUSED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
};

const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 1 },
};

export function voiceFocusedAudioConstraints(
  deviceId?: string | null,
  voiceCleanupEnabled = true,
): MediaTrackConstraints {
  const id = deviceId?.trim();
  return {
    ...(voiceCleanupEnabled
      ? VOICE_FOCUSED_AUDIO_CONSTRAINTS
      : RAW_AUDIO_CONSTRAINTS),
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

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

async function getVoiceFocusedAudioStream(
  deviceId?: string | null,
  voiceCleanupEnabled = true,
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: voiceFocusedAudioConstraints(deviceId, voiceCleanupEnabled),
    video: false,
  });
}

async function fallbackAudioInput(
  savedLabel?: string | null,
  avoidDeviceIds: Array<string | null | undefined> = [],
): Promise<AudioInputFallback | null> {
  try {
    return chooseFallbackAudioInput(await enumerateAudioInputDevices(), {
      savedLabel,
      avoidDeviceIds,
    });
  } catch (err) {
    console.warn(
      "[clips-recorder] could not enumerate fallback microphones",
      err,
    );
    return null;
  }
}

async function tryFallbackAudioInput(
  savedLabel: string | null | undefined,
  avoidDeviceIds: Array<string | null | undefined>,
  voiceCleanupEnabled = true,
): Promise<MediaStream | null> {
  const fallback = await fallbackAudioInput(savedLabel, avoidDeviceIds);
  if (!fallback) return null;
  try {
    console.warn(
      `[clips-recorder] selected mic unavailable; retrying ${fallback.reason} microphone`,
      { deviceId: fallback.deviceId, label: fallback.label },
    );
    return await getVoiceFocusedAudioStream(
      fallback.deviceId,
      voiceCleanupEnabled,
    );
  } catch (fallbackErr) {
    if (!isMediaConstraintFailure(fallbackErr)) throw fallbackErr;
    console.warn(
      "[clips-recorder] explicit mic fallback failed; continuing fallback chain",
      fallbackErr,
    );
    return null;
  }
}

async function getDefaultAudioStreamWithBasicFallback(
  reason: unknown,
  voiceCleanupEnabled = true,
): Promise<MediaStream> {
  try {
    return await getVoiceFocusedAudioStream(undefined, voiceCleanupEnabled);
  } catch (fallbackErr) {
    if (!isMediaConstraintFailure(fallbackErr)) throw fallbackErr;
    console.warn(
      "[clips-recorder] voice-focused mic constraints failed; retrying basic audio",
      fallbackErr,
    );
    return navigator.mediaDevices.getUserMedia({
      audio: voiceCleanupEnabled ? true : RAW_AUDIO_CONSTRAINTS,
      video: false,
    });
  } finally {
    if (reason) {
      console.warn(
        "[clips-recorder] no explicit mic fallback was available; using system default mic",
        reason,
      );
    }
  }
}

async function replacePhoneDefaultMicIfPossible(
  stream: MediaStream,
  voiceCleanupEnabled = true,
): Promise<MediaStream> {
  const track = stream.getAudioTracks()[0];
  if (!track || !isLikelyPhoneMicLabel(track.label)) return stream;
  const settings = track.getSettings?.();
  const replacement = await tryFallbackAudioInput(
    null,
    [settings?.deviceId ?? null],
    voiceCleanupEnabled,
  );
  if (!replacement) return stream;
  console.warn(
    "[clips-recorder] default mic resolved to a phone-like input; using explicit fallback mic",
    { label: track.label },
  );
  stopStream(stream);
  return replacement;
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
  savedLabel?: string | null,
  voiceCleanupEnabled = true,
): Promise<MediaStream> {
  const id = deviceId?.trim();

  try {
    const stream = await getVoiceFocusedAudioStream(id, voiceCleanupEnabled);
    return id
      ? stream
      : replacePhoneDefaultMicIfPossible(stream, voiceCleanupEnabled);
  } catch (err) {
    let deviceGone = false;
    if (id && err instanceof DOMException && err.name === "NotAllowedError") {
      try {
        deviceGone = !(await enumerateAudioInputDevices()).some(
          (device) => normalizedMediaDeviceId(device.deviceId) === id,
        );
      } catch (enumerateErr) {
        console.warn(
          "[clips-recorder] could not confirm saved mic is still present after NotAllowedError",
          enumerateErr,
        );
        deviceGone = true;
      }
    }
    if (deviceGone) {
      console.warn(
        "[clips-recorder] saved mic no longer enumerated after NotAllowedError; falling back",
        { deviceId: id },
      );
    }
    if (!isMediaConstraintFailure(err) && !deviceGone) throw err;
    if (id) {
      const fallback = await tryFallbackAudioInput(
        savedLabel,
        [id],
        voiceCleanupEnabled,
      );
      if (fallback) return fallback;
    }

    const defaultStream = await getDefaultAudioStreamWithBasicFallback(
      err,
      voiceCleanupEnabled,
    );
    return replacePhoneDefaultMicIfPossible(defaultStream, voiceCleanupEnabled);
  }
}
