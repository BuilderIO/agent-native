import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { agentNativePath, appBasePath, useActionMutation } from "@agent-native/core/client";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";
import {
  IconMicrophone,
  IconPlayerStop,
  IconPlayerPause,
  IconPlayerPlay,
  IconVideo,
  IconVideoOff,
  IconAlertCircle,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RecState =
  | "idle"
  | "prompting"
  | "recording"
  | "paused"
  | "uploading"
  | "error";

function pickMime(wantsVideo: boolean): string {
  const candidates = wantsVideo
    ? [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      // ignore
    }
  }
  return "";
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

interface InBrowserRecorderProps {
  folderId?: string | null;
  workspaceId?: string | null;
  className?: string;
}

export function InBrowserRecorder({
  folderId,
  workspaceId,
  className,
}: InBrowserRecorderProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<RecState>("idle");
  const [withCamera, setWithCamera] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAtRef = useRef<number>(0);
  const pausedAccumRef = useRef<number>(0);
  const pausedStartedRef = useRef<number | null>(null);
  const chunkIndexRef = useRef<number>(0);
  const callIdRef = useRef<string | null>(null);
  const mimeRef = useRef<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const uploadQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const tickRef = useRef<number | null>(null);

  const createCall = useActionMutation<
    { id: string },
    {
      title: string;
      folderId?: string | null;
      workspaceId?: string | null;
      source: "browser";
      mediaKind: "video" | "audio";
      mediaFormat: string;
    }
  >("create-call");

  const liveTranscription = useLiveTranscription();

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        // ignore
      }
    });
    streamRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    audioAnalyserRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  useEffect(() => {
    if (state === "recording") {
      tickRef.current = window.setInterval(() => {
        const now = performance.now();
        const paused = pausedStartedRef.current
          ? now - pausedStartedRef.current
          : 0;
        setElapsed(
          Math.max(
            0,
            now - startedAtRef.current - pausedAccumRef.current - paused,
          ),
        );
      }, 250);
    } else {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }
    return () => {
      if (tickRef.current != null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [state]);

  function startLevelMeter(stream: MediaStream) {
    const Ctor =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    audioAnalyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      if (!audioAnalyserRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 3));
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }

  async function start() {
    setError(null);
    setState("prompting");
    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: withCamera
          ? { width: 1280, height: 720, facingMode: "user" }
          : false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (withCamera && videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      startLevelMeter(stream);

      const mime = pickMime(withCamera);
      mimeRef.current = mime;
      const created = await createCall.mutateAsync({
        title: withCamera ? "Browser recording" : "Voice recording",
        folderId: folderId ?? null,
        workspaceId: workspaceId ?? undefined,
        source: "browser",
        mediaKind: withCamera ? "video" : "audio",
        mediaFormat: withCamera
          ? "webm"
          : mime.includes("mp4")
            ? "m4a"
            : "webm",
      });
      callIdRef.current = created.id;
      chunkIndexRef.current = 0;

      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (e) => {
        if (!e.data || e.data.size === 0) return;
        const idx = chunkIndexRef.current++;
        queueChunk(e.data, idx, false);
      });
      recorder.addEventListener("error", () => handleError("Recorder error"));
      recorder.start(2000);
      startedAtRef.current = performance.now();
      pausedAccumRef.current = 0;
      pausedStartedRef.current = null;
      setState("recording");
      if (liveTranscription.supported) {
        liveTranscription.start();
      }
    } catch (err) {
      cleanupStream();
      const m =
        err instanceof Error ? err.message : "Microphone access was denied";
      handleError(m);
    }
  }

  function pause() {
    if (!recorderRef.current || recorderRef.current.state !== "recording")
      return;
    recorderRef.current.pause();
    liveTranscription.pause();
    pausedStartedRef.current = performance.now();
    setState("paused");
  }

  function resume() {
    if (!recorderRef.current || recorderRef.current.state !== "paused") return;
    recorderRef.current.resume();
    liveTranscription.resume();
    if (pausedStartedRef.current != null) {
      pausedAccumRef.current += performance.now() - pausedStartedRef.current;
      pausedStartedRef.current = null;
    }
    setState("recording");
  }

  async function stop() {
    const recorder = recorderRef.current;
    const callId = callIdRef.current;
    if (!recorder || !callId) return;
    setState("uploading");

    // Stop live transcription and save the browser transcript before the
    // recorder finalizes. This gives the call an instant transcript
    // (from Web Speech API) with no API key required. If Deepgram is
    // configured, request-transcript will refine it with diarized output later.
    const browserTranscript = liveTranscription.stop();
    if (browserTranscript.trim()) {
      void fetch(agentNativePath("/_agent-native/actions/save-browser-transcript"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId,
          fullText: browserTranscript,
        }),
      }).catch(() => {});
    }

    const finalBlob = await new Promise<Blob>((resolve) => {
      const onData = (e: BlobEvent) => {
        recorder.removeEventListener("dataavailable", onData);
        resolve(e.data);
      };
      recorder.addEventListener("dataavailable", onData, { once: true });
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }).catch(() => new Blob([], { type: mimeRef.current }));
    const finalIndex = chunkIndexRef.current++;
    await uploadQueueRef.current.catch(() => {});
    const durationMs = Math.round(
      performance.now() - startedAtRef.current - pausedAccumRef.current,
    );
    try {
      await uploadChunk(finalBlob, finalIndex, {
        isFinal: true,
        total: chunkIndexRef.current,
        mimeType: mimeRef.current,
        durationMs,
      });
      cleanupStream();
      setState("idle");
      setElapsed(0);
      toast.success("Recording uploaded");
      navigate(`/calls/${callId}`);
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function cancel() {
    liveTranscription.stop();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    const callId = callIdRef.current;
    if (callId) {
      fetch(`${appBasePath()}/api/uploads/${callId}/abort`, {
        method: "POST",
      }).catch(() => {});
    }
    cleanupStream();
    callIdRef.current = null;
    chunkIndexRef.current = 0;
    setElapsed(0);
    setState("idle");
  }

  function handleError(msg: string) {
    setError(msg);
    setState("error");
    cleanupStream();
  }

  function queueChunk(blob: Blob, index: number, isFinal: boolean) {
    uploadQueueRef.current = uploadQueueRef.current.then(() =>
      uploadChunk(blob, index, { isFinal }).catch((err) =>
        handleError(err instanceof Error ? err.message : "Upload failed"),
      ),
    );
  }

  async function uploadChunk(
    blob: Blob,
    index: number,
    extra: {
      isFinal?: boolean;
      total?: number;
      mimeType?: string;
      durationMs?: number;
    },
  ): Promise<void> {
    const callId = callIdRef.current;
    if (!callId) throw new Error("No call id");
    const params = new URLSearchParams();
    params.set("index", String(index));
    if (extra.total !== undefined) params.set("total", String(extra.total));
    params.set("isFinal", extra.isFinal ? "1" : "0");
    if (extra.mimeType) params.set("mimeType", extra.mimeType);
    if (extra.durationMs !== undefined)
      params.set("durationMs", String(Math.round(extra.durationMs)));
    const res = await fetch(
      `${appBasePath()}/api/uploads/${callId}/chunk?${params.toString()}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            blob.type || mimeRef.current || "application/octet-stream",
        },
        body: await blob.arrayBuffer(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Upload failed (${res.status}): ${text || res.statusText}`,
      );
    }
  }

  const isActive = state === "recording" || state === "paused";

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconMicrophone className="h-4 w-4" />
          Record now
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Capture an ad-hoc call or voice note right from your browser. We
          upload while you record.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            {withCamera ? (
              <IconVideo className="h-4 w-4 text-foreground" />
            ) : (
              <IconVideoOff className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <Label htmlFor="rec-camera" className="text-sm font-medium">
                Include webcam
              </Label>
              <div className="text-xs text-muted-foreground">
                Off by default — audio only captures just your voice.
              </div>
            </div>
          </div>
          <Switch
            id="rec-camera"
            checked={withCamera}
            onCheckedChange={(v) => setWithCamera(!!v)}
            disabled={isActive || state === "uploading"}
          />
        </div>

        {withCamera && (
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
            <video
              ref={videoRef}
              muted
              playsInline
              className={cn(
                "h-full w-full object-cover",
                !isActive && "opacity-50",
              )}
            />
            {!isActive && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Camera preview appears when recording starts
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-center rounded-md border border-border bg-muted/40 px-4 py-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 tabular-nums text-3xl font-semibold text-foreground">
              {state === "recording" && (
                <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse" />
              )}
              {fmt(elapsed)}
            </div>
            <LevelMeter level={level} active={state === "recording"} />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <IconAlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">{error}</div>
          </div>
        )}

        <div className="flex items-center justify-center gap-2">
          {(state === "idle" || state === "error") && (
            <Button
              type="button"
              size="lg"
              onClick={start}
              className="gap-2 px-6"
            >
              <IconMicrophone className="h-5 w-5" />
              Record
            </Button>
          )}

          {state === "prompting" && (
            <Button disabled size="lg" className="gap-2 px-6">
              Waiting for permission…
            </Button>
          )}

          {state === "recording" && (
            <>
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={pause}
                className="gap-2"
              >
                <IconPlayerPause className="h-4 w-4" />
                Pause
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={stop}
                className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <IconPlayerStop className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}

          {state === "paused" && (
            <>
              <Button
                type="button"
                size="lg"
                onClick={resume}
                className="gap-2"
              >
                <IconPlayerPlay className="h-4 w-4" />
                Resume
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={stop}
                className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <IconPlayerStop className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}

          {state === "uploading" && (
            <Button disabled size="lg" className="gap-2 px-6">
              Finalizing…
            </Button>
          )}

          {isActive && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={cancel}
              className="gap-2 text-muted-foreground"
            >
              <IconTrash className="h-4 w-4" />
              Discard
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 16;
  const active_bars = Math.round(level * bars);
  return (
    <div className="flex items-end gap-[3px] h-5">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-1 rounded-sm bg-muted",
            active && i < active_bars && "bg-foreground",
          )}
          style={{
            height: `${20 + (i / bars) * 80}%`,
          }}
        />
      ))}
    </div>
  );
}
