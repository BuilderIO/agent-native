import { emit } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import {
  chooseFallbackAudioInput,
  isPseudoMediaDeviceId,
  isSelectableAudioInputDevice,
  normalizedMediaDeviceId,
} from "../lib/media-device-selection";
import {
  isHardCapturePermissionError,
  MACOS_CAPTURE_PERMISSION_MESSAGE,
} from "../lib/permissions";
import { loadString, saveString } from "../lib/storage";

const CAM_KEY = "clips:last-camera-id";
const MIC_KEY = "clips:last-mic-id";
const CAM_LABEL_KEY = "clips:last-camera-label";
const MIC_LABEL_KEY = "clips:last-mic-label";

function rawMicConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

function concreteMediaDeviceId(value: string | null | undefined): string {
  const id = normalizedMediaDeviceId(value);
  return id && !isPseudoMediaDeviceId(id) ? id : "";
}

function isSelectableMediaDevice(device: MediaDeviceInfo): boolean {
  return !!concreteMediaDeviceId(device.deviceId);
}

interface Props {
  // Mirrors whether the on-screen camera bubble owns the camera grant. While
  // it does, this page must never probe getUserMedia itself.
  bubbleActiveRef: MutableRefObject<boolean>;
  popoverVisible: boolean;
  setCameraError: (message: string | null) => void;
  setRecError: (message: string | null) => void;
}

export interface MediaDevicesState {
  cameraId: string;
  setCameraId: (id: string) => void;
  micId: string;
  setMicId: (id: string) => void;
  cameraLabel: string;
  setCameraLabel: (label: string) => void;
  micLabel: string;
  setMicLabel: (label: string) => void;
  selectedMicId: string;
  selectedMicLabel: string;
  cameraDevices: MediaDeviceInfo[];
  micDevices: MediaDeviceInfo[];
  loadDevices: () => Promise<void>;
  requestDeviceAccess: (kind: "camera" | "mic") => Promise<void>;
}

export function useMediaDevices({
  bubbleActiveRef,
  popoverVisible,
  setCameraError,
  setRecError,
}: Props): MediaDevicesState {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  // Device lists relayed from the bubble page when IT owns the camera grant
  // (full-screen / local-camera path). The popover page can't enumerate device
  // labels itself there without muting the live bubble, so we use these lists
  // when our own enumeration comes back empty.
  const [cameraId, setCameraId] = useState<string>(() =>
    loadString(CAM_KEY, ""),
  );
  const [micId, setMicId] = useState<string>(() => loadString(MIC_KEY, ""));
  // Remembered human labels for the saved ids, so a cold launch (device list
  // still locked behind a getUserMedia grant) can show the device by name
  // instead of "Selected camera unavailable".
  const [cameraLabel, setCameraLabel] = useState<string>(() =>
    loadString(CAM_LABEL_KEY, ""),
  );
  const [micLabel, setMicLabel] = useState<string>(() =>
    loadString(MIC_LABEL_KEY, ""),
  );

  const selectedMicId = useMemo(() => concreteMediaDeviceId(micId), [micId]);
  const cameraDevices = cameras;
  const micDevices = mics;
  const selectedMicLabel = useMemo(
    () =>
      selectedMicId
        ? (mics.find((mic) => mic.deviceId === selectedMicId)?.label ?? "")
        : "",
    [selectedMicId, mics],
  );

  // ---- device enumeration -------------------------------------------------
  // WebKit only returns full device labels after getUserMedia() has granted
  // access once. Enumerating itself is safe; the unlock helper below is careful
  // to never touch the OS default input just to populate labels.
  const loadDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      setCameras(
        list.filter(
          (d) => d.kind === "videoinput" && isSelectableMediaDevice(d),
        ),
      );
      setMics(list.filter((d) => isSelectableAudioInputDevice(d)));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
    };
  }, [loadDevices]);

  // Reopening the popover doesn't reliably re-fire the Tauri
  // `clips:popover-visible` event (the WebView is shown/hidden, not
  // remounted, and the native side only ever emits the `false`/hidden
  // transition). Without this, a webcam unplugged while the popover was
  // closed would still show the previous session's device list — the exact
  // "reopen without my webcam, it still shows the old camera selected" bug.
  // Cover reopen via both signals so it works whether the WebView regains
  // focus or only its document visibility flips.
  useEffect(() => {
    const onFocus = (): void => {
      loadDevices();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") loadDevices();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadDevices]);

  const unlockDeviceLabels = useCallback(async () => {
    // Audio-only probe to unlock mic labels. We INTENTIONALLY skip video —
    // the on-screen camera bubble window owns the camera, and probing
    // video here would race for the hardware and knock the bubble's
    // stream offline (macOS can't reliably share a camera across two
    // WebViews in the same process). Camera-label text is low-value
    // anyway; most machines have one.
    //
    // Do not probe `audio: true` or WebKit's pseudo `default` device here.
    // On macOS that opens the system default input, which can shove
    // Bluetooth headphones into hands-free mode just from opening the Clips
    // popover. If the user has picked a concrete mic, use that exact device;
    // otherwise leave labels locked until a real user action needs access.
    try {
      if (!selectedMicId) {
        await loadDevices();
        return;
      }
      const s = await navigator.mediaDevices.getUserMedia({
        audio: rawMicConstraints(selectedMicId),
        video: false,
      });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      // permission denied — labels stay empty until the user grants
    }
    await loadDevices();
  }, [loadDevices, selectedMicId]);

  const requestDeviceAccess = useCallback(
    async (kind: "camera" | "mic") => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Device selection is not available in this WebView.");
        }
        const stream = await navigator.mediaDevices.getUserMedia(
          kind === "camera"
            ? { video: true, audio: false }
            : {
                audio: rawMicConstraints(selectedMicId || undefined),
                video: false,
              },
        );
        stream.getTracks().forEach((track) => track.stop());
        await loadDevices();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isPermissionError =
          isHardCapturePermissionError(message) ||
          /notallowed|permission|denied/i.test(message);
        if (kind === "camera") {
          setCameraError(
            isPermissionError
              ? MACOS_CAPTURE_PERMISSION_MESSAGE
              : `Camera unavailable: ${message}`,
          );
        } else {
          setRecError(
            isPermissionError
              ? "Microphone access is blocked. Open System Settings → Privacy & Security → Microphone, allow Clips, then try again."
              : `Microphone unavailable: ${message}`,
          );
        }
        await loadDevices();
      }
    },
    [bubbleActiveRef, loadDevices, selectedMicId, setCameraError, setRecError],
  );

  // Defer device-label unlocking until the popover is first shown. Even the
  // selected-device probe can trigger a macOS permission dialog, so keep it
  // attached to visible UI instead of firing on hidden webview mount.
  const deviceLabelsUnlocked = useRef(false);
  useEffect(() => {
    loadDevices();
    if (popoverVisible && !deviceLabelsUnlocked.current) {
      deviceLabelsUnlocked.current = true;
      unlockDeviceLabels();
    }
  }, [loadDevices, unlockDeviceLabels, popoverVisible]);

  useEffect(() => {
    if (!micId || !isPseudoMediaDeviceId(micId) || mics.length === 0) return;
    const fallback = chooseFallbackAudioInput(mics, {
      savedLabel: micLabel,
      avoidDeviceIds: [micId],
    });
    if (!fallback) return;
    console.warn("[clips-recorder] resolved pseudo mic id to concrete input", {
      previousDeviceId: micId,
      nextDeviceId: fallback.deviceId,
      reason: fallback.reason,
    });
    setMicId(fallback.deviceId);
    setMicLabel(fallback.label);
  }, [micId, micLabel, mics]);

  // A stored device id that no longer matches anything enumerated (e.g. the
  // webcam/mic was unplugged since the app last ran) must not be rewritten to
  // the OS default. Keep the explicit choice unless we can rematch it by saved
  // label, because macOS default can point at Continuity/iPhone.
  //
  // Only trust a NON-EMPTY list, though: enumeration legitimately returns an
  // empty list on a transient error or before permission is granted, and
  // clearing a valid saved selection over that would destroy the user's
  // choice for no reason.
  useEffect(() => {
    if (!cameraId || cameras.length === 0) return;
    if (cameras.some((d) => d.deviceId === cameraId)) return;
    setCameraId("");
    setCameraLabel("");
  }, [cameraId, cameras]);
  useEffect(() => {
    if (isPseudoMediaDeviceId(micId) || !micId || mics.length === 0) return;
    if (mics.some((d) => d.deviceId === micId)) return;
    // The selected mic (e.g. Bluetooth headset unplugged mid-session) is gone.
    // Prefer rematching by saved label, then fall back to the best available
    // input so we don't stay pinned to a device that no longer exists.
    const fallback = chooseFallbackAudioInput(mics, {
      savedLabel: micLabel,
      avoidDeviceIds: [micId],
    });
    if (!fallback) {
      // Nothing concrete left; drop to the OS default rather than keeping the
      // disconnected device selected.
      setMicId("");
      setMicLabel("");
      return;
    }
    console.warn(
      "[clips-recorder] saved mic id was missing; fell back to available input",
      {
        previousDeviceId: micId,
        nextDeviceId: fallback.deviceId,
        reason: fallback.reason,
      },
    );
    setMicId(fallback.deviceId);
    setMicLabel(fallback.label);
  }, [micId, micLabel, mics]);

  useEffect(() => saveString(CAM_KEY, cameraId), [cameraId]);
  useEffect(() => saveString(MIC_KEY, micId), [micId]);
  useEffect(() => saveString(CAM_LABEL_KEY, cameraLabel), [cameraLabel]);
  useEffect(() => saveString(MIC_LABEL_KEY, micLabel), [micLabel]);

  // Once the device list unlocks (after a grant), refresh the remembered
  // label for the saved id so the persisted name stays current.
  useEffect(() => {
    if (!cameraId) return;
    const match = cameraDevices.find((d) => d.deviceId === cameraId);
    if (match?.label) setCameraLabel(match.label);
  }, [cameraDevices, cameraId]);
  useEffect(() => {
    if (!micId) return;
    const match = micDevices.find((d) => d.deviceId === micId);
    if (match?.label) setMicLabel(match.label);
  }, [micDevices, micId]);

  return {
    cameraId,
    setCameraId,
    micId,
    setMicId,
    cameraLabel,
    setCameraLabel,
    micLabel,
    setMicLabel,
    selectedMicId,
    selectedMicLabel,
    cameraDevices,
    micDevices,
    loadDevices,
    requestDeviceAccess,
  };
}
