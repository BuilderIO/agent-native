import { useT } from "@agent-native/core/client/i18n";
import {
  MIC_AUDIBLE_LEVEL,
  MIC_SILENCE_WARNING_MS,
  micSignalWarning,
} from "@shared/audio-meter";
import { LiveWaveform } from "@shared/live-waveform";
import type {
  RecordingPlayheadConfirmChange,
  RecordingPlayheadIntent,
  RecordingPlayheadLayout,
} from "@shared/recording-playhead";
import { RecordingPlayhead } from "@shared/recording-playhead";
import {
  clampRecordingPlayheadPosition,
  dockRecordingPlayhead,
  resizeRecordingPlayheadPosition,
} from "@shared/recording-playhead-position";
import type {
  RecordingPlayheadPosition,
  RecordingPlayheadSize,
} from "@shared/recording-playhead-position";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

export interface RecordingToolbarProps {
  /** Whether the elapsed-time ticker should run — true only while actively
   * recording (not during upload/compress, which freeze the last value). */
  active: boolean;
  /** Reads the current elapsed time from the recorder engine on each tick. */
  getElapsedMs: () => number;
  /** Reads the microphone track already owned by the recorder engine. */
  getMicrophoneTrack: () => MediaStreamTrack | null;
  /** The recording was started with microphone capture enabled. */
  microphoneEnabled: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onStop: () => void;
  /** Used by the upload/compress state, where delete still opens the route's
   * existing confirmation dialog even though the playhead is not live. */
  onCancel: () => void;
  onConfirmAction: (intent: RecordingPlayheadIntent) => void;
  onConfirmChange: (change: RecordingPlayheadConfirmChange) => void;
}

// The shared playhead's resting width is the initial drag bound. The measured
// layout below expands that bound before the playhead reveals controls.
const TOOLBAR_HORIZONTAL_SIZE: RecordingPlayheadSize = {
  width: 150,
  height: 56,
};
const TOOLBAR_VERTICAL_SIZE: RecordingPlayheadSize = {
  width: 42,
  height: 118,
};
// Drop the toolbar just below the centered "Recording your screen…" status
// text (which sits at the viewport's vertical center) so the controls don't
// overlap it.
const TOOLBAR_TOP_OFFSET = 48;
const MICROPHONE_TRACK_RETRY_MS = 250;

function getAudioContextCtor(): typeof AudioContext | null {
  return (
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ??
    null
  );
}

function useLiveMicrophoneMeter({
  active,
  isPaused,
  getMicrophoneTrack,
  microphoneEnabled,
}: Pick<
  RecordingToolbarProps,
  "active" | "isPaused" | "getMicrophoneTrack" | "microphoneEnabled"
>) {
  const [level, setLevel] = useState<number | null>(null);
  const [silentForMs, setSilentForMs] = useState(0);
  const hadLiveAnalyserRef = useRef(false);
  const getMicrophoneTrackRef = useRef(getMicrophoneTrack);
  getMicrophoneTrackRef.current = getMicrophoneTrack;

  useEffect(() => {
    setLevel(null);
    setSilentForMs(0);
    if (!active) {
      hadLiveAnalyserRef.current = false;
      return;
    }
    if (isPaused || !microphoneEnabled) return;

    let disposed = false;
    let trackRetryTimeoutId: number | null = null;
    let cleanupAnalyser: (() => void) | null = null;
    const missingTrackStartedAt = performance.now();

    const attachAnalyser = (track: MediaStreamTrack) => {
      const AudioContextCtor = getAudioContextCtor();
      if (!AudioContextCtor) return;

      let context: AudioContext | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let analyser: AnalyserNode | null = null;
      try {
        context = new AudioContextCtor();
        source = context.createMediaStreamSource(new MediaStream([track]));
        analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);
      } catch {
        try {
          source?.disconnect();
          analyser?.disconnect();
        } catch {
          // A partial graph may already have been disconnected by the browser.
        }
        void context?.close().catch(() => {});
        return;
      }

      const liveContext = context;
      const liveSource = source;
      const liveAnalyser = analyser;
      hadLiveAnalyserRef.current = true;

      let rafId: number | null = null;
      let stopped = false;
      let silenceStartedAt: number | null = null;
      let silenceWarningTimeoutId: number | null = null;
      const samples = new Uint8Array(analyser.fftSize);

      const clearSilenceWarningTimeout = () => {
        if (silenceWarningTimeoutId === null) return;
        window.clearTimeout(silenceWarningTimeoutId);
        silenceWarningTimeoutId = null;
      };

      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        clearSilenceWarningTimeout();
        track.removeEventListener("ended", handleTrackEnded);
        try {
          liveSource.disconnect();
        } catch (error) {
          console.debug(
            "[recording-toolbar] audio source was already disconnected",
            error,
          );
        }
        try {
          liveAnalyser.disconnect();
        } catch (error) {
          console.debug(
            "[recording-toolbar] audio analyser was already disconnected",
            error,
          );
        }
        void liveContext.close().catch((error: unknown) => {
          console.debug(
            "[recording-toolbar] audio context was already closed",
            error,
          );
        });
      };

      const handleTrackEnded = () => {
        cleanup();
        if (disposed) return;
        setLevel(null);
        setSilentForMs(MIC_SILENCE_WARNING_MS);
      };

      const sample = () => {
        if (stopped) return;
        liveAnalyser.getByteTimeDomainData(samples);
        let squareSum = 0;
        for (const value of samples) {
          const normalized = (value - 128) / 128;
          squareSum += normalized * normalized;
        }
        const rms = Math.sqrt(squareSum / samples.length);
        const audible = rms >= MIC_AUDIBLE_LEVEL;
        const now = performance.now();

        if (audible) {
          silenceStartedAt = null;
          clearSilenceWarningTimeout();
          setLevel(rms);
          setSilentForMs(0);
        } else {
          setLevel(0);
          if (silenceStartedAt === null) {
            silenceStartedAt = now;
            silenceWarningTimeoutId = window.setTimeout(() => {
              silenceWarningTimeoutId = null;
              if (stopped || silenceStartedAt === null) return;
              setSilentForMs(MIC_SILENCE_WARNING_MS);
            }, MIC_SILENCE_WARNING_MS);
          }
        }

        rafId = requestAnimationFrame(sample);
      };

      cleanupAnalyser = cleanup;
      track.addEventListener("ended", handleTrackEnded);
      if (track.readyState === "ended") {
        handleTrackEnded();
        return;
      }
      if (liveContext.state === "suspended") {
        void liveContext.resume().catch(() => {});
      }
      sample();
    };

    const checkForTrack = () => {
      if (disposed) return;
      const track = getMicrophoneTrackRef.current();
      if (track && track.readyState !== "ended") {
        attachAnalyser(track);
        return;
      }
      if (hadLiveAnalyserRef.current) {
        setSilentForMs(MIC_SILENCE_WARNING_MS);
        return;
      }

      const remaining =
        MIC_SILENCE_WARNING_MS - (performance.now() - missingTrackStartedAt);
      if (remaining <= 0) {
        setSilentForMs(MIC_SILENCE_WARNING_MS);
        return;
      }
      trackRetryTimeoutId = window.setTimeout(
        checkForTrack,
        Math.min(MICROPHONE_TRACK_RETRY_MS, remaining),
      );
    };

    checkForTrack();

    return () => {
      disposed = true;
      if (trackRetryTimeoutId !== null) {
        window.clearTimeout(trackRetryTimeoutId);
      }
      cleanupAnalyser?.();
    };
  }, [active, isPaused, microphoneEnabled]);

  return {
    level,
    warning: micSignalWarning({
      microphoneEnabled,
      paused: isPaused || !active,
      silentForMs,
    }),
  };
}

export function RecordingToolbar({
  active,
  getElapsedMs,
  getMicrophoneTrack,
  microphoneEnabled,
  isPaused,
  onTogglePause,
  onStop,
  onCancel,
  onConfirmAction,
  onConfirmChange,
}: RecordingToolbarProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const microphoneMeter = useLiveMicrophoneMeter({
    active,
    isPaused,
    getMicrophoneTrack,
    microphoneEnabled,
  });
  // Own the elapsed-time poll here instead of in the route component, so the
  // 4x/sec tick only re-renders this toolbar rather than the whole record page.
  const [elapsedMs, setElapsedMs] = useState(0);
  const getElapsedMsRef = useRef(getElapsedMs);
  getElapsedMsRef.current = getElapsedMs;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setElapsedMs(getElapsedMsRef.current());
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);

  const [pos, setPos] = useState<RecordingPlayheadPosition>(() =>
    typeof window === "undefined"
      ? {
          left: 16,
          top: 16,
          orientation: "horizontal",
          dock: "free",
          slot: null,
        }
      : {
          left: Math.max(
            16,
            (window.innerWidth - TOOLBAR_HORIZONTAL_SIZE.width) / 2,
          ),
          top: Math.max(16, window.innerHeight / 2 + TOOLBAR_TOP_OFFSET),
          orientation: "horizontal",
          dock: "free",
          slot: null,
        },
  );
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragPositionRef = useRef(pos);
  const activePointerIdRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const [toolbarLayout, setToolbarLayout] = useState<RecordingPlayheadLayout>(
    TOOLBAR_HORIZONTAL_SIZE,
  );
  const playheadSizesRef = useRef({
    horizontal: TOOLBAR_HORIZONTAL_SIZE,
    vertical: TOOLBAR_VERTICAL_SIZE,
  });
  const [pendingAction, setPendingAction] =
    useState<RecordingPlayheadIntent | null>(null);
  const toolbarLayoutRef = useRef(toolbarLayout);
  toolbarLayoutRef.current = toolbarLayout;

  useEffect(() => {
    if (!active) setPendingAction(null);
  }, [active]);

  function handlePlayheadLayoutChange(layout: RecordingPlayheadLayout) {
    const orientation = posRef.current.orientation;
    const minimum =
      orientation === "vertical"
        ? TOOLBAR_VERTICAL_SIZE
        : TOOLBAR_HORIZONTAL_SIZE;
    const nextLayout = {
      width: Math.max(minimum.width, Math.ceil(layout.width)),
      height: Math.max(minimum.height, Math.ceil(layout.height)),
    } satisfies RecordingPlayheadLayout;
    playheadSizesRef.current[orientation] = nextLayout;
    toolbarLayoutRef.current = nextLayout;
    setToolbarLayout((previous) =>
      previous.width === nextLayout.width &&
      previous.height === nextLayout.height
        ? previous
        : nextLayout,
    );
    setPos((previous) => {
      const next = resizeRecordingPlayheadPosition(
        previous,
        playheadSizesRef.current,
        {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
      );
      if (
        next.left === previous.left &&
        next.top === previous.top &&
        next.orientation === previous.orientation
      ) {
        return previous;
      }
      return next;
    });
  }

  function handlePlayheadConfirmAction(intent: RecordingPlayheadIntent) {
    setPendingAction(intent);
    onConfirmAction(intent);
  }

  useEffect(() => {
    function onResize() {
      setPos((p) => {
        return resizeRecordingPlayheadPosition(p, playheadSizesRef.current, {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        });
      });
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-recording-playhead-button]")) return;
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    dragPositionRef.current = posRef.current;
    dragOffsetRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    rootRef.current.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    const { dx, dy } = dragOffsetRef.current;
    const orientation = posRef.current.orientation;
    const layout = playheadSizesRef.current[orientation];
    const clamped = clampRecordingPlayheadPosition(
      e.clientX - dx,
      e.clientY - dy,
      layout,
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) => ({
      ...prev,
      left: clamped.left,
      top: clamped.top,
      dock: "free",
      slot: null,
    }));
    dragPositionRef.current = {
      ...posRef.current,
      left: clamped.left,
      top: clamped.top,
      dock: "free",
      slot: null,
    };
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const current = dockRecordingPlayhead(
      dragPositionRef.current.left,
      dragPositionRef.current.top,
      playheadSizesRef.current,
      {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    );
    dragPositionRef.current = current;
    setPos(current);
  }

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={
        dragging ? "fixed z-[95] cursor-grabbing" : "fixed z-[95] cursor-grab"
      }
      style={{
        left: pos.left,
        top: pos.top,
        width: "max-content",
        minWidth:
          pos.orientation === "horizontal"
            ? TOOLBAR_HORIZONTAL_SIZE.width
            : undefined,
        minHeight: toolbarLayout.height,
        touchAction: "none",
      }}
    >
      <RecordingPlayhead
        elapsedMs={elapsedMs}
        paused={isPaused}
        orientation={pos.orientation}
        enabled={active}
        pendingAction={pendingAction}
        meter={
          microphoneMeter.warning !== null ? (
            <span
              role="status"
              aria-label={t("preRecord.noAudio")}
              className="inline-flex size-[18px] items-center justify-center text-current"
              style={{ color: "var(--playhead-rec)" }}
            >
              <IconAlertTriangle aria-hidden className="size-4" />
            </span>
          ) : (
            <LiveWaveform
              level={microphoneMeter.level}
              dimmed={!active || isPaused}
            />
          )
        }
        labels={{
          controls: t("recordingToolbar.controls"),
          stop: t("recordingToolbar.stop"),
          pause: t("recordingToolbar.pauseRecording"),
          resume: t("recordingToolbar.resumeRecording"),
          pauseShortcut: t("recordingToolbar.pauseShortcut"),
          resumeShortcut: t("recordingToolbar.resumeShortcut"),
          restart: t("recordingToolbar.restart"),
          restartShortcut: t("recordingToolbar.restartShortcut"),
          delete: t("recordingToolbar.cancel"),
          deleteShortcut: t("recordingToolbar.cancelShortcut"),
          restartQuestion: t("recordingToolbar.restartQuestion"),
          deleteQuestion: () => t("recordingToolbar.discardConfirmTitle"),
          restartConfirm: t("recordingToolbar.restartConfirm"),
          deleteConfirm: t("recordingToolbar.discardRecording"),
          resumeConfirm: t("recordingToolbar.resume"),
        }}
        onStop={onStop}
        onTogglePause={onTogglePause}
        onConfirmAction={handlePlayheadConfirmAction}
        onDeleteRequest={onCancel}
        onConfirmChange={onConfirmChange}
        onLayoutChange={handlePlayheadLayoutChange}
        className={active ? undefined : "opacity-80"}
      />
    </div>
  );
}
