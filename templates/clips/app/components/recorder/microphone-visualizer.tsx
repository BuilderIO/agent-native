import { useT } from "@agent-native/core/client/i18n";
import { LiveWaveform } from "@shared/live-waveform";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MicrophoneTestStatus = "idle" | "starting" | "live" | "error";

export interface MicrophoneVisualizerProps {
  deviceId: string | null;
  disabled?: boolean;
  idleActionLabel?: string;
  idleHelper?: string;
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

function micBlockedMessage(): string {
  if (isDesktopShell()) {
    return "Microphone access is blocked for this app. Enable the microphone for the app in your system Privacy settings, then reopen the recorder.";
  }
  return "Your browser has blocked microphone access for this site, so it won't prompt. Allow the microphone in this site's settings, then reload.";
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

export async function friendlyMicError(err: unknown): Promise<string> {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = err instanceof Error ? err.message : String(err ?? "");
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
    return "This page is blocking microphone access via Permissions-Policy. Restart the dev server, reload /record, then try again.";
  }
  if (!window.isSecureContext) {
    return "Microphone prompts require HTTPS or localhost. Open this app on localhost or an HTTPS URL, then try again.";
  }
  if (permissionState === "denied") {
    return micBlockedMessage();
  }
  if (/NotAllowedError|Permission denied|denied|blocked/i.test(combined)) {
    return "The browser or operating system denied microphone access. Check this site's microphone setting and your system privacy settings for this browser, then reload.";
  }
  if (
    /NotFoundError|DevicesNotFoundError|no device|not found/i.test(combined)
  ) {
    return "No microphone was found. Plug one in or choose a different input.";
  }
  if (/NotReadableError|TrackStartError|in use/i.test(combined)) {
    return "That microphone is busy in another app. Close the other app or choose a different input.";
  }
  return message || "Could not start the microphone check.";
}

export function MicrophoneVisualizer({
  deviceId,
  disabled,
  idleActionLabel = "Test mic",
  idleHelper,
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
  const [level, setLevel] = useState<number | null>(null);
  const lastSignalAtRef = useRef(0);
  const previousDeviceIdRef = useRef(deviceId);

  const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasSignal, setHasSignalState] = useState(false);

  const setSignal = useCallback(
    (next: boolean) => {
      if (signalRef.current === next) return;
      signalRef.current = next;
      setHasSignalState(next);
      onSignalChange?.(next);
    },
    [onSignalChange],
  );

  const stopCurrent = useCallback(
    (emitSignal = true) => {
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
      lastSignalAtRef.current = 0;
      if (emitSignal) {
        setSignal(false);
      } else {
        signalRef.current = false;
      }
    },
    [setSignal],
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
        if (rms > 0.022) {
          lastSignalAtRef.current = now;
          setSignal(true);
        } else if (now - lastSignalAtRef.current > 700) {
          setSignal(false);
        }

        // The analyser is the only part of the meter this app owns; the shape
        // and the level math are shared with the desktop app so a microphone
        // reads the same here as it does in the recorder and the meeting pill.
        setLevel(rms);
        rafRef.current = requestAnimationFrame(draw);
      };

      draw();
    },
    [setSignal],
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
      const message =
        "Your browser doesn't support live microphone checks. Try a recent Brave, Chrome, Edge, Safari, or Firefox.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (isMicrophoneBlockedByPolicy()) {
      const message =
        "This page is blocking microphone access via Permissions-Policy. Restart the dev server, reload /record, then try again.";
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      return;
    }
    if (!window.isSecureContext) {
      const message =
        "Microphone prompts require HTTPS or localhost. Open this app on localhost or an HTTPS URL, then try again.";
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
      const message = micBlockedMessage();
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
      const message = await friendlyMicError(err);
      // friendlyMicError awaits the Permissions API, so re-check after.
      if (runIdRef.current !== runId) return;
      setSignal(false);
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
    }
  }, [deviceId, disabled, drawLive, onStatusChange, setSignal, stopCurrent]);

  useEffect(() => {
    if (disabled) {
      previousDeviceIdRef.current = deviceId;
      if (status === "live" || status === "starting") {
        stopTest();
      } else {
      }
      return;
    }
    if (previousDeviceIdRef.current === deviceId) return;
    previousDeviceIdRef.current = deviceId;
    if (status === "live" || status === "starting") {
      void startTest();
    }
  }, [deviceId, disabled, startTest, status, stopTest]);

  // Idle and error both rest the meter by holding `level` at null, so there is
  // nothing left to draw on a state change.
  useEffect(() => {
    if (status === "idle" || status === "error") setLevel(null);
  }, [status]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      stopCurrent(false);
    };
  }, [stopCurrent]);

  const live = status === "live";
  const starting = status === "starting";
  const statusLabel = disabled
    ? "Off"
    : error
      ? "Needs access"
      : live
        ? hasSignal
          ? "Signal"
          : "Listening"
        : starting
          ? "Opening"
          : null;

  return (
    <div className={cn("space-y-2", disabled && "opacity-70", className)}>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "relative h-7 min-w-0 flex-1 overflow-hidden rounded-full border bg-muted/20",
            live && hasSignal ? "border-foreground/35" : "border-border",
          )}
        >
          <span
            role="img"
            aria-label={t("clipsFinalRaw.selectedMicrophoneWaveform")}
            className="absolute inset-0 flex items-center justify-center"
          >
            <LiveWaveform
              level={live ? level : null}
              bars={18}
              barWidth={2}
              barGap={3}
            />
          </span>
          {statusLabel ? (
            <span
              className={cn(
                "pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm",
                error && "text-foreground",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant={live ? "outline" : "secondary"}
          size="sm"
          disabled={disabled || starting}
          onClick={live ? stopTest : startTest}
          className="h-7 shrink-0 px-2.5 text-xs"
        >
          {live ? "Stop" : starting ? "Opening..." : idleActionLabel}
        </Button>
      </div>
      {error ? (
        <p className="text-[11px] leading-snug text-foreground">{error}</p>
      ) : idleHelper && !live && !starting ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {idleHelper}
        </p>
      ) : null}
    </div>
  );
}
