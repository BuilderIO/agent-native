import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { IconArrowLeft, IconVideo } from "@tabler/icons-react";
import { RequireActiveOrg } from "@agent-native/core/client/org";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";

// Client-side app-state writer (the server module pulls in Node's `events`
// and cannot be bundled for the browser).
async function writeAppState(key: string, value: unknown): Promise<void> {
  await fetch(`/_agent-native/application-state/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

import { PreRecordPanel } from "@/components/recorder/pre-record-panel";
import { StorageSetupCard } from "@/components/recorder/storage-setup-card";
import { CountdownOverlay } from "@/components/recorder/countdown-overlay";
import { CameraBubble } from "@/components/recorder/camera-bubble";
import { RecordingToolbar } from "@/components/recorder/recording-toolbar";
import { DrawingCanvas } from "@/components/recorder/drawing-canvas";
import {
  ConfettiCanvas,
  type ConfettiHandle,
} from "@/components/recorder/confetti-canvas";
import {
  RecorderEngine,
  type RecordingMode,
} from "@/components/recorder/recorder-engine";
import type { CameraBubbleSize } from "@/components/recorder/camera-bubble";

export function meta() {
  return [{ title: "New recording — Clips" }];
}

type UiState =
  | "idle"
  | "pickingSources"
  | "countdown"
  | "recording"
  | "uploading"
  | "complete"
  | "error";

const MAC_SCREEN_RECORDING_PREF_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

function captureThumbnailFromPreview(
  video: HTMLVideoElement | null,
  recordingId: string,
): void {
  if (!video || !video.videoWidth || !video.videoHeight) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        fetch(`/api/recordings/${recordingId}/thumbnail`, {
          method: "POST",
          headers: { "Content-Type": blob.type || "image/jpeg" },
          body: blob,
        }).catch(() => {});
      },
      "image/jpeg",
      0.85,
    );
  } catch {
    // best effort — the player has a backfill path if this misses.
  }
}

interface PendingRecording {
  id: string;
  uploadChunkUrl: string;
  abortUrl: string;
}

export default function RecordRoute() {
  const navigate = useNavigate();
  const [uiState, setUiState] = useState<UiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraSize, setCameraSize] = useState<CameraBubbleSize>("md");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [recordingMode, setRecordingMode] =
    useState<RecordingMode>("screen+camera");

  const [storageConfigured, setStorageConfigured] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/_agent-native/file-upload/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { configured?: boolean } | null) => {
        if (cancelled) return;
        setStorageConfigured(!!s?.configured);
      })
      .catch(() => {
        if (!cancelled) setStorageConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const liveTranscription = useLiveTranscription();

  const engineRef = useRef<RecorderEngine | null>(null);
  const pendingRef = useRef<PendingRecording | null>(null);
  const confettiRef = useRef<ConfettiHandle>(null);
  // Tracks whether opening the stop-confirm dialog auto-paused a live
  // recording — so closing the dialog without choosing an action resumes
  // it, but doesn't unpause a recording the user had paused themselves.
  const autoPausedForStopConfirmRef = useRef(false);
  const pendingStartOptsRef = useRef<{
    mode: RecordingMode;
    micDeviceId: string | null;
    cameraDeviceId: string | null;
  } | null>(null);
  const tickRef = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (uiState !== "recording") {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = window.setInterval(() => {
      const e = engineRef.current?.getElapsedMs() ?? 0;
      setElapsedMs(e);
    }, 250);
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [uiState]);

  // -------------------------------------------------------------------------
  // Wire preview stream into its video element.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!previewVideoRef.current) return;
    previewVideoRef.current.srcObject = previewStream;
    if (previewStream) {
      previewVideoRef.current.play().catch(() => {});
    }
  }, [previewStream]);

  // -------------------------------------------------------------------------
  // Create recording row, acquire media, start countdown.
  // -------------------------------------------------------------------------
  const startFlow = useCallback(
    async (opts: {
      mode: RecordingMode;
      micDeviceId: string | null;
      cameraDeviceId: string | null;
    }) => {
      setError(null);
      setRecordingMode(opts.mode);
      pendingStartOptsRef.current = opts;
      setUiState("pickingSources");

      try {
        const statusRes = await fetch("/_agent-native/file-upload/status");
        if (statusRes.ok) {
          const status = (await statusRes.json()) as { configured?: boolean };
          if (!status.configured) {
            throw new Error(
              "No video storage configured. Open Settings to connect Builder.io or S3-compatible storage.",
            );
          }
        }

        // 1. Create the recording row server-side.
        const res = await fetch("/_agent-native/actions/create-recording", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled recording",
            hasCamera: opts.mode !== "screen",
            hasAudio: true,
          }),
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error("SESSION_EXPIRED");
          }
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(
            body?.error ?? `create-recording failed (${res.status})`,
          );
        }
        const created = (await res.json()) as {
          result?: {
            id: string;
            uploadChunkUrl: string;
            abortUrl: string;
          };
          id?: string;
          uploadChunkUrl?: string;
          abortUrl?: string;
        };
        const info = created.result ?? (created as PendingRecording);
        if (!info?.id) {
          throw new Error("create-recording did not return an id");
        }
        pendingRef.current = {
          id: info.id,
          uploadChunkUrl: info.uploadChunkUrl!,
          abortUrl: info.abortUrl!,
        };

        // 2. Build the engine and acquire media (triggers permission prompts).
        const engine = new RecorderEngine({
          recordingId: info.id,
          mode: opts.mode,
          micDeviceId: opts.micDeviceId,
          cameraDeviceId: opts.cameraDeviceId,
          uploadUrl: info.uploadChunkUrl,
          abortUrl: info.abortUrl,
          onError: (err) => {
            console.error("[recorder] error:", err);
            toast.error(err.message);
            setError(err.message);
          },
          onChunk: ({ index, bytes }) => {
            void writeAppState(`recording-upload-${info.id}`, {
              recordingId: info.id,
              status: "uploading",
              chunksReceived: index + 1,
              lastChunkBytes: bytes,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          },
        });
        engineRef.current = engine;

        const { previewStream: ps, cameraStream: cs } = await engine.acquire();
        setPreviewStream(ps);
        setCameraStream(cs);
        setUiState("countdown");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not start recording";
        setError(message);
        setUiState("error");
        if (
          !message.includes("No video storage configured") &&
          message !== "SESSION_EXPIRED"
        ) {
          toast.error(message);
        }
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // After countdown → actually start MediaRecorder.
  // -------------------------------------------------------------------------
  const onCountdownComplete = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.start();
      if (liveTranscription.supported) {
        liveTranscription.start();
      }
      setUiState("recording");
      setIsPaused(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start recorder";
      setError(message);
      setUiState("error");
      toast.error(message);
    }
  }, [liveTranscription]);

  // -------------------------------------------------------------------------
  // Stop / upload / navigate.
  // -------------------------------------------------------------------------
  const doStop = useCallback(async () => {
    const engine = engineRef.current;
    const pending = pendingRef.current;
    if (!engine || !pending) return;
    setUiState("uploading");
    try {
      // Capture a still-frame thumbnail from the preview while the stream is
      // still live — otherwise the library would show a blank card until the
      // owner opens the recording and triggers the player's backfill path.
      captureThumbnailFromPreview(previewVideoRef.current, pending.id);

      // Stop live transcription and save the browser transcript before the
      // engine finalizes. This gives the recording an instant transcript
      // (from Web Speech API) with no API key required. If Groq/OpenAI is
      // configured, request-transcript will refine it with Whisper later.
      const browserTranscript = liveTranscription.stop();
      if (browserTranscript.trim()) {
        void fetch("/_agent-native/actions/save-browser-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordingId: pending.id,
            fullText: browserTranscript,
          }),
        }).catch(() => {});
      }

      await engine.stop();
      setCameraStream(null);
      setPreviewStream(null);
      setUiState("complete");
      toast.success("Recording saved");

      await writeAppState("navigate", {
        view: "recording",
        recordingId: pending.id,
      });
      setTimeout(() => {
        navigate(`/r/${pending.id}`);
      }, 50);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      setUiState("error");
      toast.error(message);
    }
  }, [navigate, liveTranscription]);

  const requestStop = useCallback(() => {
    setIsDrawing(false);
    const engine = engineRef.current;
    if (engine && engine.getState() === "recording") {
      engine.pause();
      setIsPaused(true);
      autoPausedForStopConfirmRef.current = true;
    } else {
      autoPausedForStopConfirmRef.current = false;
    }
    setShowStopConfirm(true);
  }, []);

  const onStopConfirmOpenChange = useCallback((open: boolean) => {
    setShowStopConfirm(open);
    if (!open && autoPausedForStopConfirmRef.current) {
      const engine = engineRef.current;
      if (engine && engine.getState() === "paused") {
        engine.resume();
        setIsPaused(false);
      }
      autoPausedForStopConfirmRef.current = false;
    }
  }, []);

  const doCancel = useCallback(async () => {
    const engine = engineRef.current;
    const pendingId = pendingRef.current?.id;
    liveTranscription.stop();
    try {
      await engine?.cancel();
    } catch {
      // ignore
    }
    if (pendingId) {
      fetch("/_agent-native/actions/trash-recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingId }),
      }).catch(() => {});
    }
    setCameraStream(null);
    setPreviewStream(null);
    setIsPaused(false);
    setIsDrawing(false);
    setUiState("idle");
    pendingRef.current = null;
    engineRef.current = null;
  }, [liveTranscription]);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.getState() === "paused") {
      engine.resume();
      liveTranscription.resume();
      setIsPaused(false);
    } else {
      engine.pause();
      liveTranscription.pause();
      setIsPaused(true);
    }
  }, [liveTranscription]);

  const restart = useCallback(async () => {
    await doCancel();
    const opts = pendingStartOptsRef.current;
    if (opts) {
      await startFlow(opts);
    }
  }, [doCancel, startFlow]);

  const fireConfetti = useCallback(() => {
    confettiRef.current?.burst();
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts.
  // -------------------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const alt = e.altKey;
      const shift = e.shiftKey;
      const meta = e.metaKey;
      const ctrl = e.ctrlKey;
      const k = e.key.toLowerCase();

      // Esc — stop-confirm when recording. Skip during countdown (engine hasn't
      // started MediaRecorder yet; calling doStop would orphan the recording
      // row) and when the dialog is already open (AlertDialog handles its own
      // Esc-to-close; re-firing requestStop would clobber
      // autoPausedForStopConfirmRef and prevent resume).
      if (e.key === "Escape") {
        if (!showStopConfirm && uiState === "recording") {
          e.preventDefault();
          // Stop propagation so the same Esc keydown doesn't also trigger
          // the AlertDialog's built-in Esc-to-close handler, which would
          // immediately dismiss the dialog the moment it opens — leaving
          // the user trapped in recording state with a flickering dialog.
          e.stopPropagation();
          requestStop();
          return;
        }
      }

      // Opt/Alt+Shift+P — pause/resume
      if (alt && shift && k === "p") {
        if (uiState === "recording") {
          e.preventDefault();
          togglePause();
          return;
        }
      }

      // Opt/Alt+Shift+C — cancel
      if (alt && shift && k === "c") {
        if (uiState !== "idle") {
          e.preventDefault();
          void doCancel();
          return;
        }
      }

      // Opt/Alt+Shift+R — quick restart
      if (alt && shift && k === "r") {
        if (uiState === "recording" || uiState === "countdown") {
          e.preventDefault();
          void restart();
          return;
        }
      }

      // Cmd/Ctrl+Shift+D — toggle drawing
      if ((meta || ctrl) && shift && k === "d") {
        if (uiState === "recording") {
          e.preventDefault();
          setIsDrawing((v) => !v);
          return;
        }
      }

      // Ctrl+Cmd+C OR Ctrl+Alt+C — confetti
      if ((ctrl && meta && k === "c") || (ctrl && alt && k === "c")) {
        if (uiState === "recording") {
          e.preventDefault();
          fireConfetti();
          return;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    uiState,
    showStopConfirm,
    togglePause,
    doCancel,
    restart,
    fireConfetti,
    requestStop,
  ]);

  // -------------------------------------------------------------------------
  // Listen for `record-intent` app-state requests from the agent.
  // -------------------------------------------------------------------------
  // (We expose this as an entry point — when the agent writes `record-intent`
  // with mode, the UI auto-kicks off. The actual poll is owned by root.tsx;
  // this component only reads URL query params for simpler agent hand-off.)
  useEffect(() => {
    if (uiState !== "idle" || !storageConfigured) return;
    const url = new URL(window.location.href);
    const modeParam = url.searchParams.get("mode") as RecordingMode | null;
    if (
      modeParam &&
      (modeParam === "screen" ||
        modeParam === "camera" ||
        modeParam === "screen+camera")
    ) {
      void startFlow({
        mode: modeParam,
        micDeviceId: null,
        cameraDeviceId: null,
      });
    }
  }, [uiState, startFlow, storageConfigured]);

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------
  const showRecordingUi = uiState === "recording" || uiState === "uploading";
  const showCameraBubble =
    cameraStream !== null && recordingMode !== "screen" && uiState !== "idle";

  // `/record` is a fullscreen route outside the `_app` shell, so it has no
  // sidebar back-affordance. Surface a back arrow whenever there's nothing in
  // flight — during recording/countdown/uploading the toolbar's stop flow is
  // the exit path.
  const showBackButton = uiState === "idle" || uiState === "error";

  return (
    <div className="relative min-h-screen bg-background">
      {showBackButton && (
        <button
          type="button"
          aria-label="Back to library"
          onClick={async () => {
            // If we landed in `error` after partial media acquisition, the
            // engine may still hold live screen/camera tracks. doCancel()
            // releases them synchronously (see RecorderEngine.cancel —
            // hardware teardown runs before the server-abort fetch is
            // awaited), so navigate() can fire immediately while the
            // best-effort server abort settles in the background.
            void doCancel();
            navigate("/library");
          }}
          className="fixed left-4 top-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconArrowLeft className="h-5 w-5" />
        </button>
      )}

      {/* Idle / pre-record panel. `/record` sits outside the `_app`
          layout, so its own <RequireActiveOrg> gate is needed — otherwise
          a direct visit (URL bar, bookmark, agent intent) would skip the
          shell guard and hit a runtime error at create-recording. */}
      {uiState === "idle" && (
        <RequireActiveOrg
          title="Create your organization"
          description="Clips organizes recordings by team. Create an organization to continue — you can invite teammates afterward."
        >
          <div className="flex min-h-screen flex-col items-center justify-center px-4">
            <div className="mb-6 flex items-center gap-2 text-primary">
              <IconVideo className="h-6 w-6" />
              <span className="text-sm font-medium uppercase tracking-wide">
                Clips recorder
              </span>
            </div>
            {storageConfigured === null ? null : storageConfigured ? (
              <PreRecordPanel onStart={startFlow} />
            ) : (
              <StorageSetupCard
                onConfigured={() => setStorageConfigured(true)}
              />
            )}
          </div>
        </RequireActiveOrg>
      )}

      {uiState === "pickingSources" && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="text-sm">Preparing sources…</div>
          <div className="text-xs">Select what to share when prompted.</div>
        </div>
      )}

      {/* Countdown */}
      {uiState === "countdown" && (
        <CountdownOverlay seconds={3} onComplete={onCountdownComplete} />
      )}

      {/* Preview (camera-only mode renders camera full-screen; screen modes
          rely on the browser's "currently sharing" native pill). */}
      {recordingMode === "camera" && showRecordingUi && (
        <video
          ref={previewVideoRef}
          autoPlay
          muted
          playsInline
          className="fixed inset-0 h-full w-full object-cover [transform:scaleX(-1)]"
        />
      )}

      {recordingMode !== "camera" && showRecordingUi && (
        <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f1a] opacity-95">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">
            <div className="flex items-center gap-2 text-sm">
              <span className="relative inline-flex">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              Recording your screen — switch to the window you want to capture
            </div>
            <div className="text-[11px] text-white/50">
              Press <kbd className="rounded bg-white/10 px-1.5 py-0.5">Esc</kbd>{" "}
              to stop
            </div>
          </div>
        </div>
      )}

      {/* Camera bubble */}
      {showCameraBubble && (
        <CameraBubble
          stream={cameraStream}
          size={cameraSize}
          onSizeChange={setCameraSize}
          hidden={!showRecordingUi}
        />
      )}

      {/* Drawing overlay */}
      {showRecordingUi && (
        <DrawingCanvas enabled={isDrawing} fadeAfterSeconds={5} />
      )}

      {/* Confetti */}
      <ConfettiCanvas ref={confettiRef} />

      {/* Floating toolbar */}
      {showRecordingUi && (
        <RecordingToolbar
          elapsedMs={elapsedMs}
          isPaused={isPaused}
          isDrawing={isDrawing}
          onTogglePause={togglePause}
          onStop={requestStop}
          onToggleDrawing={() => setIsDrawing((v) => !v)}
          onConfetti={fireConfetti}
          onCancel={requestStop}
        />
      )}

      {/* Uploading overlay */}
      {uiState === "uploading" && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 bg-black/70 text-white backdrop-blur">
          <Spinner className="h-10 w-10 text-white/70" />
          <div className="text-sm">Saving your recording…</div>
        </div>
      )}

      {/* Error state */}
      {uiState === "error" && error && (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          {error.includes("No video storage configured") ? (
            <>
              <div className="mb-2 flex items-center gap-2 text-primary">
                <IconVideo className="h-6 w-6" />
                <span className="text-sm font-medium uppercase tracking-wide">
                  Clips recorder
                </span>
              </div>
              <StorageSetupCard
                onConfigured={() => {
                  setStorageConfigured(true);
                  setError(null);
                  setUiState("idle");
                }}
              />
            </>
          ) : error === "SESSION_EXPIRED" ? (
            <div className="max-w-md rounded-xl border border-border bg-card p-6">
              <div className="mb-2 text-sm font-semibold text-foreground">
                Session expired
              </div>
              <div className="text-sm text-muted-foreground">
                Your login session has expired. Log in again to start recording.
              </div>
              <div className="mt-4 flex justify-center">
                <Button onClick={() => window.location.reload()}>Log in</Button>
              </div>
            </div>
          ) : (
            <div className="max-w-md rounded-xl border border-border bg-card p-6">
              <div className="mb-2 text-sm font-semibold text-foreground">
                Couldn't start recording
              </div>
              <div className="text-sm text-muted-foreground">{error}</div>
              <div className="mt-4 flex justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setUiState("idle");
                  }}
                >
                  Try again
                </Button>
                {/screen|permission|denied|not allowed/i.test(error) &&
                  /^darwin|mac/i.test(
                    typeof navigator !== "undefined" ? navigator.platform : "",
                  ) && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        window.location.href = MAC_SCREEN_RECORDING_PREF_URL;
                      }}
                    >
                      Open Screen Recording settings
                    </Button>
                  )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stop confirmation */}
      <AlertDialog
        open={showStopConfirm}
        onOpenChange={onStopConfirmOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop recording?</AlertDialogTitle>
            <AlertDialogDescription>
              Save this recording to your library, discard it, or keep going.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                autoPausedForStopConfirmRef.current = false;
                setShowStopConfirm(false);
                void doCancel();
              }}
            >
              Discard
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                autoPausedForStopConfirmRef.current = false;
                setShowStopConfirm(false);
                void restart();
              }}
            >
              Restart
            </Button>
            <AlertDialogAction
              onClick={() => {
                autoPausedForStopConfirmRef.current = false;
                setShowStopConfirm(false);
                void doStop();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Stop and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
