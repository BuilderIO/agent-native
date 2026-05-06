import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MicrophoneTestStatus = "idle" | "starting" | "live" | "error";

export interface MicrophoneVisualizerProps {
  deviceId: string | null;
  disabled?: boolean;
  selectedLabel?: string;
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

async function friendlyMicError(err: unknown): Promise<string> {
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
    return "Brave already has Microphone set to Block for this site, so it will not show the popup. Click the lock/tune icon in the address bar → Site settings → Microphone → Allow, then reload.";
  }
  if (/NotAllowedError|Permission denied|denied|blocked/i.test(combined)) {
    return "The browser or macOS denied microphone access. If no popup appeared, check Brave site settings and macOS System Settings → Privacy & Security → Microphone for Brave, then reload.";
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
  selectedLabel,
  className,
  onStatusChange,
  onSignalChange,
}: MicrophoneVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const signalRef = useRef(false);
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

  const syncCanvasSize = useCallback((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height, dpr };
  }, []);

  const drawIdle = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height, dpr } = syncCanvasSize(canvas);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(113, 113, 122, 0.22)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(113, 113, 122, 0.38)";
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.beginPath();
    const points = 72;
    for (let i = 0; i <= points; i++) {
      const x = (i / points) * width;
      const envelope = Math.sin((i / points) * Math.PI);
      const y =
        height / 2 +
        Math.sin((i / points) * Math.PI * 6) * envelope * height * 0.13;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [syncCanvasSize]);

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
      drawIdle();
    },
    [drawIdle, setSignal],
  );

  const drawLive = useCallback(
    (analyser: AnalyserNode) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const data = new Uint8Array(analyser.fftSize);

      const draw = () => {
        const { width, height, dpr } = syncCanvasSize(canvas);
        analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (const sample of data) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();
        if (rms > 0.035) {
          lastSignalAtRef.current = now;
          setSignal(true);
        } else if (now - lastSignalAtRef.current > 700) {
          setSignal(false);
        }

        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = "rgba(113, 113, 122, 0.2)";
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, "rgba(39, 39, 42, 0.55)");
        gradient.addColorStop(0.45, "rgba(24, 24, 27, 0.95)");
        gradient.addColorStop(1, "rgba(39, 39, 42, 0.55)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = Math.max(1.75 * dpr, Math.min(5 * dpr, rms * 22 * dpr));
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        const step = width / Math.max(1, data.length - 1);
        for (let i = 0; i < data.length; i++) {
          const x = i * step;
          const normalized = (data[i] - 128) / 128;
          const y = height / 2 + normalized * height * 0.42;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        rafRef.current = requestAnimationFrame(draw);
      };

      draw();
    },
    [setSignal, syncCanvasSize],
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
      const message =
        "Brave already has Microphone set to Block for this site, so it will not show the popup. Click the lock/tune icon in the address bar → Site settings → Microphone → Allow, then reload.";
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
      analyser.smoothingTimeConstant = 0.72;
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
      setSignal(false);
      setError(message);
      setStatus("error");
      onStatusChange?.("error", { error: message });
      drawIdle();
    }
  }, [
    deviceId,
    disabled,
    drawIdle,
    drawLive,
    onStatusChange,
    setSignal,
    stopCurrent,
  ]);

  useEffect(() => {
    if (disabled) {
      previousDeviceIdRef.current = deviceId;
      if (status === "live" || status === "starting") {
        stopTest();
      } else {
        drawIdle();
      }
      return;
    }
    if (previousDeviceIdRef.current === deviceId) return;
    previousDeviceIdRef.current = deviceId;
    if (status === "live" || status === "starting") {
      void startTest();
    } else {
      drawIdle();
    }
  }, [deviceId, disabled, drawIdle, startTest, status, stopTest]);

  useEffect(() => {
    if (status === "idle" || status === "error") drawIdle();
  }, [drawIdle, status]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      stopCurrent(false);
    };
  }, [stopCurrent]);

  const live = status === "live";
  const starting = status === "starting";
  const helper = disabled
    ? "Microphone is disabled for this recording."
    : error
      ? error
      : live
        ? hasSignal
          ? "Signal detected — your selected microphone is picking you up."
          : "Speak now — the waveform should move with your voice."
        : starting
          ? "Opening microphone…"
          : "Click Test mic, then speak to verify input before recording.";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/25 p-3",
        disabled && "opacity-70",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Mic check</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedLabel ?? "Selected microphone"}
          </div>
        </div>
        <Button
          type="button"
          variant={live ? "outline" : "secondary"}
          size="sm"
          disabled={disabled || starting}
          onClick={live ? stopTest : startTest}
          className="h-8 px-2.5 text-xs"
        >
          {live ? "Stop" : starting ? "Listening…" : "Test mic"}
        </Button>
      </div>
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border bg-background",
          live && hasSignal ? "border-foreground/40" : "border-border",
        )}
      >
        <canvas
          ref={canvasRef}
          aria-label="Selected microphone waveform"
          className="h-12 w-full"
        />
        {live && (
          <div
            className={cn(
              "pointer-events-none absolute right-2 top-2 h-2 w-2 rounded-full",
              hasSignal ? "bg-foreground" : "bg-muted-foreground/40",
            )}
          />
        )}
      </div>
      <p
        className={cn(
          "mt-2 text-[11px] leading-snug text-muted-foreground",
          error && "text-destructive",
        )}
      >
        {helper}
      </p>
    </div>
  );
}
