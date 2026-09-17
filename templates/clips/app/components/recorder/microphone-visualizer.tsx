import { useT } from "@agent-native/core/client/i18n";
import { MIC_AUDIBLE_LEVEL, MIC_SILENCE_WARNING_MS } from "@shared/audio-meter";
import { LiveWaveform } from "@shared/live-waveform";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type MicrophoneTestStatus = "idle" | "starting" | "live" | "error";

export interface MicrophoneVisualizerProps {
  deviceId: string | null;
  disabled?: boolean;
  unlocked?: boolean;
  className?: string;
  onStatusChange?: (
    status: MicrophoneTestStatus,
    detail?: { error?: string | null },
  ) => void;
  onSignalChange?: (hasSignal: boolean) => void;
}

function getAudioContextCtor(): typeof AudioContext | null {
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  );
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

type MicrophonePermissionState = PermissionState | "unknown";
type Translate = ReturnType<typeof useT>;
type MicrophoneErrorKind =
  | "unsupported"
  | "policyBlocked"
  | "secureContextRequired"
  | "permissionBlockedBrowser"
  | "permissionBlockedDesktop"
  | "permissionDenied"
  | "notFound"
  | "inUse"
  | "startFailed"
  | "disconnected";

function isDesktopShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as typeof window & {
    electronAPI?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  if (w.electronAPI || w.__TAURI_INTERNALS__ || w.__TAURI__) return true;
  return (
    typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent)
  );
}

function microphoneErrorMessage(
  t: Translate,
  kind: MicrophoneErrorKind,
): string {
  switch (kind) {
    case "unsupported":
      return t("microphoneVisualizer.unsupported");
    case "policyBlocked":
      return t("microphoneVisualizer.policyBlocked");
    case "secureContextRequired":
      return t("microphoneVisualizer.secureContextRequired");
    case "permissionBlockedBrowser":
      return t("microphoneVisualizer.permissionBlockedBrowser");
    case "permissionBlockedDesktop":
      return t("microphoneVisualizer.permissionBlockedDesktop");
    case "permissionDenied":
      return t("microphoneVisualizer.permissionDenied");
    case "notFound":
      return t("microphoneVisualizer.notFound");
    case "inUse":
      return t("microphoneVisualizer.inUse");
    case "disconnected":
      return t("microphoneVisualizer.disconnected");
    case "startFailed":
      return t("microphoneVisualizer.startFailed");
  }
}

function micBlockedMessage(t: Translate): string {
  return microphoneErrorMessage(
    t,
    isDesktopShell() ? "permissionBlockedDesktop" : "permissionBlockedBrowser",
  );
}

function isMicrophoneBlockedByPolicy(): boolean {
  const policy =
    (
      document as Document & {
        permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
        featurePolicy?: { allowsFeature: (feature: string) => boolean };
      }
    ).permissionsPolicy ??
    (
      document as Document & {
        featurePolicy?: { allowsFeature: (feature: string) => boolean };
      }
    ).featurePolicy;
  if (!policy?.allowsFeature) return false;
  try {
    return !policy.allowsFeature("microphone");
  } catch {
    return false;
  }
}

async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state;
  } catch {
    return "unknown";
  }
}

export async function friendlyMicError(
  err: unknown,
  t: Translate,
): Promise<string> {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const combined = `${name} ${message}`;
  const permissionState = await getMicrophonePermissionState();
  const blockedByPolicy = isMicrophoneBlockedByPolicy();

  console.warn("[mic-check] getUserMedia failed", {
    name,
    message,
    permissionState,
    blockedByPolicy,
    isSecureContext: window.isSecureContext,
  });

  if (blockedByPolicy) {
    return microphoneErrorMessage(t, "policyBlocked");
  }
  if (!window.isSecureContext) {
    return microphoneErrorMessage(t, "secureContextRequired");
  }
  if (permissionState === "denied") {
    return micBlockedMessage(t);
  }
  if (/NotAllowedError|Permission denied|denied|blocked/i.test(combined)) {
    return microphoneErrorMessage(t, "permissionDenied");
  }
  if (
    /NotFoundError|DevicesNotFoundError|no device|not found/i.test(combined)
  ) {
    return microphoneErrorMessage(t, "notFound");
  }
  if (/NotReadableError|TrackStartError|in use/i.test(combined)) {
    return microphoneErrorMessage(t, "inUse");
  }
  return microphoneErrorMessage(t, "startFailed");
}

export function MicrophoneVisualizer({
  deviceId,
  disabled,
  unlocked = false,
  className,
  onStatusChange,
  onSignalChange,
}: MicrophoneVisualizerProps) {
  const t = useT();
  const rafRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const signalRef = useRef(false);
  const noSignalRef = useRef(false);
  const [level, setLevel] = useState<number | null>(null);
  const lastSignalAtRef = useRef<number | null>(null);
  const silenceStartedAtRef = useRef<number | null>(null);
  const previousDeviceIdRef = useRef(deviceId);

  const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasSignal, setHasSignalState] = useState(false);
  const [noSignal, setNoSignalState] = useState(false);

  const setSignal = useCallback(
    (next: boolean) => {
      if (signalRef.current === next) return;
      signalRef.current = next;
      setHasSignalState(next);
      onSignalChange?.(next);
    },
    [onSignalChange],
  );

  const setNoSignal = useCallback((next: boolean) => {
    if (noSignalRef.current === next) return;
    noSignalRef.current = next;
    setNoSignalState(next);
  }, []);

  const stopCurrent = useCallback(
    (emitSignal = true, emitState = true) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        sourceRef.current?.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
      stopStream(streamRef.current);
      streamRef.current = null;
      lastSignalAtRef.current = null;
      silenceStartedAtRef.current = null;
      if (emitState) {
        setLevel(null);
        setNoSignal(false);
      } else {
        noSignalRef.current = false;
      }
      if (emitSignal) {
        setSignal(false);
      } else {
        signalRef.current = false;
      }
    },
    [setNoSignal, setSignal],
  );

  const drawLive = useCallback(
    (analyser: AnalyserNode) => {
      const data = new Uint8Array(analyser.fftSize);

      const draw = () => {
        analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (const sample of data) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        const audible = rms >= MIC_AUDIBLE_LEVEL;
        if (audible) {
          lastSignalAtRef.current = now;
          silenceStartedAtRef.current = null;
          setSignal(true);
          setNoSignal(false);
        } else {
          silenceStartedAtRef.current ??= now;
          if (
            lastSignalAtRef.current === null ||
            now - lastSignalAtRef.current > 700
          ) {
            setSignal(false);
          }
          if (now - silenceStartedAtRef.current >= MIC_SILENCE_WARNING_MS) {
            setNoSignal(true);
          }
        }

        // The analyser is the only part of the meter this app owns; the shape
        // and the level math are shared with the desktop app so a microphone
        // reads the same here as it does in the recorder and the meeting pill.
        // Sub-threshold room noise is silence, not decorative activity.
        setLevel(audible ? rms : 0);
        rafRef.current = requestAnimationFrame(draw);
      };

      draw();
    },
    [setNoSignal, setSignal],
  );

  const stopTest = useCallback(() => {
    runIdRef.current += 1;
    stopCurrent();
    setError(null);
    setStatus("idle");
    onStatusChange?.("idle", { error: null });
  }, [onStatusChange, stopCurrent]);

  const startTest = useCallback(async () => {
    if (disabled) return;
    const AudioContextCtor = getAudioContextCtor();
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      const message = microphoneErrorMessage(t, "unsupported");
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (isMicrophoneBlockedByPolicy()) {
      const message = microphoneErrorMessage(t, "policyBlocked");
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (!window.isSecureContext) {
      const message = microphoneErrorMessage(t, "secureContextRequired");
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }

    // Claim runId before the first await so a stale call can't win the race.
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    const permissionState = await getMicrophonePermissionState();
    if (runIdRef.current !== runId) return;
    if (permissionState === "denied") {
      const message = micBlockedMessage(t);
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }

    stopCurrent();
    setError(null);
    setStatus("starting");
    onStatusChange?.("starting", { error: null });

    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      audioContext = new AudioContextCtor();
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      if (runIdRef.current !== runId) {
        try {
          source.disconnect();
        } catch {
          // ignore
        }
        if (audioContext.state !== "closed") {
          audioContext.close().catch(() => {});
        }
        stopStream(stream);
        return;
      }

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      const startedAt = performance.now();
      lastSignalAtRef.current = null;
      silenceStartedAtRef.current = startedAt;
      setNoSignal(false);
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => {
          if (runIdRef.current !== runId) return;
          runIdRef.current += 1;
          stopCurrent();
          const message = microphoneErrorMessage(t, "disconnected");
          setError(message);
          setStatus("error");
          onStatusChange?.("error", { error: message });
        });
      }
      setStatus("live");
      onStatusChange?.("live", { error: null });
      drawLive(analyser);
    } catch (err) {
      try {
        source?.disconnect();
      } catch {
        // ignore
      }
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
      stopStream(stream);
      if (runIdRef.current !== runId) return;
      const message = await friendlyMicError(err, t);
      // friendlyMicError awaits the Permissions API, so re-check after.
      if (runIdRef.current !== runId) return;
      setSignal(false);
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
    }
  }, [
    deviceId,
    disabled,
    drawLive,
    onStatusChange,
    setNoSignal,
    setSignal,
    stopCurrent,
    t,
  ]);

  useEffect(() => {
    const deviceChanged = previousDeviceIdRef.current !== deviceId;
    previousDeviceIdRef.current = deviceId;
    if (disabled || !unlocked) {
      if (status !== "idle") stopTest();
      return;
    }
    if (deviceChanged || status === "idle") void startTest();
  }, [deviceId, disabled, startTest, status, stopTest, unlocked]);

  // Idle and error both rest the meter by holding `level` at null, so there is
  // nothing left to draw on a state change.
  useEffect(() => {
    if (status === "idle" || status === "error") setLevel(null);
  }, [status]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      stopCurrent(false, false);
    };
  }, [stopCurrent]);

  const live = status === "live";
  const starting = status === "starting";
  const noAudioDetected = live && noSignal;
  const statusLabel = error
    ? t("microphoneVisualizer.needsAttention")
    : live
      ? noAudioDetected
        ? t("preRecord.noAudio")
        : hasSignal
          ? t("microphoneVisualizer.signal")
          : t("microphoneVisualizer.listening")
      : starting
        ? t("microphoneVisualizer.opening")
        : t("clipsFinalRaw.selectedMicrophoneWaveform");

  return (
    <span
      data-microphone-visualizer="inline"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex min-w-12 flex-1 items-center justify-end overflow-hidden text-muted-foreground",
        (error || noAudioDetected) && "text-destructive",
        className,
      )}
    >
      {error || noAudioDetected ? (
        <IconAlertTriangle
          className="size-3.5 shrink-0"
          stroke={2}
          aria-hidden="true"
        />
      ) : starting ? (
        <IconLoader2
          className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
          stroke={2}
          aria-hidden="true"
        />
      ) : (
        <LiveWaveform
          level={live ? level : null}
          bars={14}
          barWidth={2}
          barGap={2}
          dimmed={disabled || !unlocked}
        />
      )}
      <span className="sr-only">{statusLabel}</span>
    </span>
  );
}
