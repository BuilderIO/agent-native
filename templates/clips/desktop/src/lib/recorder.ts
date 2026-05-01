/**
 * Native-first recording driver for the Clips tray.
 *
 * Orchestrates the full capture lifecycle without ever rendering a browser
 * window to the user:
 *
 *   1. request getDisplayMedia / getUserMedia (mic, optionally camera)
 *   2. spawn the countdown overlay window, wait for `clips:countdown-done`
 *   3. start MediaRecorder; POST each chunk to /api/uploads/:id/chunk
 *   4. spawn the toolbar overlay (bubble is already visible — owned by the
 *      popover's session effect, not the recorder)
 *   5. relay pause/resume/stop from the toolbar to MediaRecorder, with
 *      live `clips:recorder-state` updates back to the toolbar for the
 *      timer + paused styling
 *   6. on stop: isFinal=1 chunk → server finalizes the recording; pop the
 *      recording page open in the user's default browser for playback +
 *      sharing.
 *
 * Everything after step 1 happens off the tray popover: screen-only mode
 * never even needs the popover focused. This is what makes the UX feel
 * native instead of "app-in-a-tab".
 *
 * ## Camera bubble architecture (popover owns the full session)
 *
 * WebKit enforces a single-page capture-exclusion policy: when one page
 * calls `getDisplayMedia`/`getUserMedia`, WebKit MUTES all capture sources
 * in other pages in the same process (see WebKit bugs 179363, 237359,
 * 212040, 238456; changeset 271154). Tauri v2's macOS backend shares one
 * WebKit process across all webview windows. So if the bubble window
 * called `getUserMedia` itself, its camera track would stay
 * `readyState="live"` but frames would stop arriving — WebKit's documented
 * behavior, not fixable with retry loops.
 *
 * Fix: the POPOVER owns the camera for the entire session — both before
 * recording (so the user sees their face in the bubble the moment they
 * open the popover) and during recording. A session-long effect in
 * `app.tsx` calls `getUserMedia`, invokes `show_bubble`, and runs the
 * frame pump (see `bubble-pump.ts`). When the user clicks Start
 * Recording, the live `MediaStream` is handed to `startNativeRecording`
 * via `preAcquiredCameraStream` so the recorder reuses it for
 * MediaRecorder instead of calling `getUserMedia` a second time (which
 * was the source of the "bubble goes black" bug — the 2nd acquire
 * silently mutes the 1st under WebKit's capture-exclusion policy).
 *
 * The recorder does NOT start its own frame pump — the popover's pump
 * keeps running throughout recording. This means a single pump instance
 * survives the preview → recording transition with no handoff.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";

export type CaptureMode = "screen" | "screen-camera" | "camera";

export interface StartParams {
  serverUrl: string; // e.g. http://localhost:8080
  mode: CaptureMode;
  cameraId?: string;
  micId?: string;
  micOn: boolean;
  cameraOn: boolean;
  /**
   * Pre-acquired camera stream owned by the popover's session effect. The
   * popover keeps the camera open + the bubble visible + the frame pump
   * running for the FULL camera session — we just borrow the video track
   * for MediaRecorder. Re-acquiring the same device rapidly is the
   * documented WebKit capture-exclusion footgun (the 2nd acquire can
   * silently mute the 1st) — reusing the live stream sidesteps it and
   * means the bubble never goes black during the preview → recording
   * transition.
   *
   * Ownership stays with the popover. The recorder must NOT stop these
   * tracks on stop/cancel — the popover's session effect decides when
   * the stream lives and dies (it stops when the user closes the popover
   * or turns the camera off).
   */
  preAcquiredCameraStream?: MediaStream | null;
}

export interface RecorderHandle {
  /** Stop the recording and resolve once the server has finalized. */
  stop(): Promise<{ recordingId: string; viewUrl: string }>;
  /** Discard the recording without saving. */
  cancel(): Promise<void>;
}

function chunkUrl(
  serverUrl: string,
  id: string,
  idx: number,
  isFinal: boolean,
  extras: Record<string, string> = {},
) {
  const params = new URLSearchParams({
    index: String(idx),
    total: String(idx + 1),
    isFinal: isFinal ? "1" : "0",
    ...extras,
  });
  return `${serverUrl.replace(/\/+$/, "")}/api/uploads/${id}/chunk?${params}`;
}

async function createRecording(
  serverUrl: string,
  hasCamera: boolean,
  hasAudio: boolean,
) {
  const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/create-recording`;
  console.log("[clips-recorder] POST", url, { hasCamera, hasAudio });
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Tauri webview is a different origin from the clips server. The dev
      // CORS middleware is permissive for "*" but won't accept credentialed
      // requests without Allow-Credentials — and dev auth is bypassed, so
      // cookies aren't needed.
      credentials: "include",
      body: JSON.stringify({ hasCamera, hasAudio, visibility: "public" }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[clips-recorder] fetch failed:", url, err);
    throw new Error(
      `Can't reach Clips server at ${url} — ${msg}. Is the dev server running on that port?`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[clips-recorder] bad response:", url, res.status, body);
    throw new Error(`create-recording ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as { id: string };
}

interface NativeTranscriptCapture {
  stop(): Promise<string>;
  cancel(): Promise<void>;
}

async function startNativeTranscriptCapture(): Promise<NativeTranscriptCapture | null> {
  let latestText = "";
  let settleFinal: ((text: string) => void) | null = null;
  const unlistens: UnlistenFn[] = [];

  const cleanup = () => {
    unlistens.splice(0).forEach((unlisten) => {
      try {
        unlisten();
      } catch {
        // ignore
      }
    });
  };

  try {
    unlistens.push(
      await listen<{ text: string }>("voice:partial-transcript", (event) => {
        const text = event.payload?.text?.trim();
        if (text) latestText = text;
      }),
      await listen<{ text: string }>("voice:final-transcript", (event) => {
        const text = event.payload?.text?.trim();
        if (text) latestText = text;
        settleFinal?.(latestText);
      }),
      await listen<{ error: string }>("voice:speech-error", (event) => {
        console.warn(
          "[clips-recorder] native transcript error:",
          event.payload?.error,
        );
        settleFinal?.(latestText);
      }),
    );

    await invoke("native_speech_start", {
      locale: navigator.language || "en-US",
    });
  } catch (err) {
    cleanup();
    console.warn("[clips-recorder] native transcript unavailable:", err);
    return null;
  }

  return {
    async stop() {
      const finalTextPromise = new Promise<string>((resolve) => {
        const timeout = window.setTimeout(() => resolve(latestText), 1800);
        settleFinal = (text) => {
          window.clearTimeout(timeout);
          resolve(text);
        };
      });

      try {
        await invoke("native_speech_stop");
      } catch (err) {
        console.warn("[clips-recorder] native_speech_stop failed:", err);
        cleanup();
        return latestText;
      }

      const finalText = await finalTextPromise;
      cleanup();
      return finalText.trim();
    },
    async cancel() {
      try {
        await invoke("native_speech_cancel");
      } catch {
        // ignore
      }
      cleanup();
    },
  };
}

async function saveNativeTranscript(
  serverUrl: string,
  recordingId: string,
  fullText: string,
): Promise<void> {
  const text = fullText.trim();
  if (!text) return;

  const url = `${serverUrl.replace(/\/+$/, "")}/_agent-native/actions/save-browser-transcript`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        recordingId,
        fullText: text,
        source: "macos-native",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        "[clips-recorder] save native transcript failed:",
        res.status,
        body.slice(0, 200),
      );
    }
  } catch (err) {
    console.warn("[clips-recorder] save native transcript failed:", err);
  }
}

/**
 * Counter of in-flight chunk POSTs. The bubble frame pump reads
 * `window.clipsChunkBusy` and SKIPS frame encoding while it's truthy,
 * so the pump and the chunk fetch don't fight for the same microtask
 * queue. Using a counter (rather than a boolean) handles overlapping
 * uploads correctly — WebKit's fetch can pipeline the last chunk's
 * body serializer with the next chunk's request, so the flag must
 * stay true until ALL chunks settle.
 *
 * The flag is attached to `window` so the pump can read it without
 * an import cycle (the pump lives in a separate module that must not
 * depend on the recorder).
 */
let inFlightChunks = 0;
function incChunkBusy(): void {
  inFlightChunks += 1;
  (window as unknown as { clipsChunkBusy?: boolean }).clipsChunkBusy = true;
}
function decChunkBusy(): void {
  inFlightChunks = Math.max(0, inFlightChunks - 1);
  if (inFlightChunks === 0) {
    (window as unknown as { clipsChunkBusy?: boolean }).clipsChunkBusy = false;
  }
}

async function uploadChunk(url: string, blob: Blob): Promise<void> {
  // Signal to the bubble frame pump that a chunk is being uploaded.
  // The pump's tick loop checks this flag and yields its slot to the
  // fetch for the ~150-300ms the POST takes to serialize and land.
  // Cleared in `finally` below so a throw still releases the pump.
  incChunkBusy();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      // Tauri webview runs on localhost:1420 (dev) or tauri://localhost (prod);
      // the clips server is a different origin. The framework's dev CORS is
      // permissive for "*" but won't accept credentialed requests without
      // Allow-Credentials — and in dev auth is bypassed anyway, so we don't
      // need cookies.
      credentials: "include",
      body: blob,
    });
  } finally {
    decChunkBusy();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      "[clips-recorder] chunk failed:",
      res.status,
      body.slice(0, 200),
    );
    throw new Error(`chunk ${res.status}: ${body.slice(0, 200)}`);
  }
  // Drain the response body even on success. If we don't consume the
  // body, WebKit can keep the network buffer resident until GC — that's
  // extra retention on top of the ~1MB Blob we just uploaded. Reading
  // and discarding is cheap (the body is usually tiny for a chunk ack)
  // and makes the memory footprint predictable.
  try {
    await res.text();
  } catch {
    // ignore — body drain is best-effort
  }
  console.log("[clips-recorder] chunk ok:", res.status, blob.size, "bytes");
}

async function waitForEvent(name: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let un: UnlistenFn | null = null;
    // Flag so that if the timeout fires BEFORE `listen()` resolves we can
    // still call the unlisten the instant it arrives — otherwise the
    // event handler closure stays registered for the life of the webview
    // (leaks the `resolve` / `reject` closures + anything they pin).
    let done = false;
    listen(name, () => {
      if (done) return;
      done = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      un?.();
      resolve();
    })
      .then((u) => {
        if (done) {
          // Timeout already fired — unregister immediately.
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        un = u;
      })
      .catch((err) => {
        if (done) return;
        done = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        reject(err);
      });
    timer = setTimeout(() => {
      if (done) return;
      done = true;
      un?.();
      reject(new Error(`timeout waiting for ${name}`));
    }, timeoutMs);
  });
}

function createSyntheticScreenStream(): {
  stream: MediaStream;
  cleanup: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.captureStream !== "function") {
    throw new Error("Synthetic capture unavailable in this WebView");
  }
  const startedAt = Date.now();
  const draw = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const hue = (elapsed * 24) % 360;
    ctx.fillStyle = `hsl(${hue}, 70%, 16%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 12; i++) {
      ctx.fillRect(i * 120 - ((elapsed * 8) % 120), 0, 52, canvas.height);
    }
    ctx.fillStyle = "white";
    ctx.font = "700 54px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText("Clips desktop synthetic capture", 64, 112);
    ctx.font = "500 32px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText(`Elapsed ${elapsed.toString().padStart(2, "0")}s`, 64, 170);
    ctx.font = "400 24px ui-sans-serif, system-ui, -apple-system";
    ctx.fillText(
      "Dev-only fallback used when macOS blocks getDisplayMedia automation.",
      64,
      220,
    );
  };
  draw();
  const interval = window.setInterval(draw, 250);
  const stream = canvas.captureStream(30);
  return {
    stream,
    cleanup: () => {
      window.clearInterval(interval);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

function createSyntheticAudioStream(): {
  stream: MediaStream;
  cleanup: () => void;
} | null {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.015;
    oscillator.connect(gain);
    gain.connect(dest);
    oscillator.start();
    return {
      stream: dest.stream,
      cleanup: () => {
        try {
          oscillator.stop();
        } catch {
          // ignore
        }
        dest.stream.getTracks().forEach((track) => track.stop());
        ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    console.warn("[clips-recorder] synthetic audio unavailable:", err);
    return null;
  }
}

export async function startNativeRecording(
  params: StartParams,
): Promise<RecorderHandle> {
  try {
    return await startNativeRecordingInner(params);
  } catch (err) {
    const e = err as { name?: string; message?: string } | null;
    console.error(
      "[clips-recorder] startNativeRecording threw:",
      e?.name,
      e?.message,
      err,
    );
    throw err;
  }
}

async function startNativeRecordingInner(
  params: StartParams,
): Promise<RecorderHandle> {
  const wantsScreen = params.mode !== "camera";
  const wantsCamera = params.mode !== "screen" && params.cameraOn;
  const wantsAudio = params.micOn;
  console.log("[clips-recorder] startNativeRecording", {
    serverUrl: params.serverUrl,
    mode: params.mode,
    wantsScreen,
    wantsCamera,
    wantsAudio,
  });

  // 1. Acquire streams BEFORE the countdown so the user gets the permission
  //    prompts out of the way while the popover is still focused.
  //
  // CRITICAL: WebKit requires `getDisplayMedia` to be called from a user
  // gesture handler. The first `await` consumes the user activation, so if
  // we awaited one stream before kicking off the next, the second call
  // would throw `getDisplayMedia must be called from a user gesture
  // handler.` To keep all three requests anchored to the same gesture, we
  // INITIATE every promise synchronously (no await between them) and then
  // Promise.all them together. The cross-page mute concern documented at
  // the top of this file is about which *page* owns the camera (popover vs
  // bubble window) — not the order of calls within this same page — so
  // starting all three in parallel is safe.
  // `video: false` on the audio getUserMedia is EXPLICIT — WebKit on macOS
  // has been observed to treat `{ audio: ... }` with no `video` key as
  // "caller hasn't expressed a video preference" and renegotiate the
  // page's media session in unpredictable ways.
  if (wantsCamera) {
    console.log(
      "[clips-recorder] acquiring camera in popover (owner for bubble overlay)",
    );
  }
  if (wantsScreen) {
    console.log("[clips-recorder] requesting display media");
  }
  if (wantsAudio) {
    console.log("[clips-recorder] acquiring audioStream (mic only)");
  }
  const streamCleanups: Array<() => void> = [];

  const displayStreamPromise: Promise<MediaStream> | null = wantsScreen
    ? (() => {
        const useSynthetic =
          import.meta.env.DEV &&
          localStorage.getItem("clips:dev-real-capture") !== "1";
        if (!useSynthetic) {
          return navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 },
            audio: true,
          });
        }
        console.warn(
          "[clips-recorder] using dev synthetic screen capture; set localStorage clips:dev-real-capture=1 to use the native picker",
        );
        const syntheticDisplay = createSyntheticScreenStream();
        streamCleanups.push(syntheticDisplay.cleanup);
        return Promise.resolve(syntheticDisplay.stream);
      })()
    : null;
  // If the popover handed us a live camera stream from the pre-record
  // preview we reuse it verbatim and SKIP getUserMedia — see the
  // `preAcquiredCameraStream` field doc for the WebKit rationale. This
  // also means the preview → recording transition is seamless (no black
  // flash while the camera renegotiates).
  const reusedCameraStream =
    wantsCamera && params.preAcquiredCameraStream
      ? params.preAcquiredCameraStream
      : null;
  if (reusedCameraStream) {
    console.log(
      "[clips-recorder] reusing pre-acquired camera stream from popover preview",
    );
  }
  const bubbleCameraStreamPromise: Promise<MediaStream> | null =
    wantsCamera && !reusedCameraStream
      ? navigator.mediaDevices.getUserMedia({
          video: params.cameraId
            ? { deviceId: { exact: params.cameraId } }
            : true,
          audio: false,
        })
      : null;
  const audioStreamPromise: Promise<MediaStream> | null = wantsAudio
    ? navigator.mediaDevices.getUserMedia({
        audio: params.micId ? { deviceId: { exact: params.micId } } : true,
        video: false,
      })
    : null;

  // Use allSettled so a single rejection (e.g. user cancels the macOS screen
  // picker → `NotAllowedError`) doesn't leave the OTHER resolved streams
  // orphaned with live tracks. If ANY of the three rejected, we stop every
  // track that DID resolve, then re-throw the original error so the caller's
  // catch still sees `NotAllowedError` / `AbortError` as before.
  console.log("[clips-recorder] allSettled IN — streams dispatched");
  const settled = await Promise.allSettled([
    displayStreamPromise,
    bubbleCameraStreamPromise,
    audioStreamPromise,
  ]);
  console.log(
    "[clips-recorder] allSettled OUT — settled statuses:",
    settled.map((s) => s.status),
  );
  const firstRejection = settled.find(
    (s): s is PromiseRejectedResult => s.status === "rejected",
  );
  if (firstRejection) {
    const canUseSyntheticScreen =
      import.meta.env.DEV && wantsScreen && displayStreamPromise != null;
    if (!canUseSyntheticScreen) {
      for (const s of settled) {
        if (s.status === "fulfilled" && s.value) {
          try {
            s.value.getTracks().forEach((t) => t.stop());
          } catch {
            // ignore — best-effort cleanup
          }
        }
      }
      // NOTE: we do NOT stop `reusedCameraStream` tracks here. The popover
      // owns the camera for the entire session (see top-of-file comment +
      // `preAcquiredCameraStream` doc) — it keeps the stream alive so the
      // bubble stays live while the user retries.
      const rejErr = firstRejection.reason;
      console.error(
        "[clips-recorder] stream acquisition failed:",
        (rejErr as { name?: string })?.name,
        (rejErr as { message?: string })?.message,
        rejErr,
      );
      throw firstRejection.reason;
    }
    console.warn(
      "[clips-recorder] using dev synthetic capture because native stream acquisition failed:",
      firstRejection.reason,
    );
  }
  let displayStream =
    settled[0].status === "fulfilled"
      ? (settled[0].value as MediaStream | null)
      : null;
  let freshlyAcquiredCameraStream =
    settled[1].status === "fulfilled"
      ? (settled[1].value as MediaStream | null)
      : null;
  let audioStream =
    settled[2].status === "fulfilled"
      ? (settled[2].value as MediaStream | null)
      : null;
  if (firstRejection && import.meta.env.DEV && wantsScreen && !displayStream) {
    [displayStream, freshlyAcquiredCameraStream, audioStream].forEach((s) =>
      s?.getTracks().forEach((track) => track.stop()),
    );
    const syntheticDisplay = createSyntheticScreenStream();
    displayStream = syntheticDisplay.stream;
    streamCleanups.push(syntheticDisplay.cleanup);
    if (wantsAudio && !audioStream) {
      const syntheticAudio = createSyntheticAudioStream();
      if (syntheticAudio) {
        audioStream = syntheticAudio.stream;
        streamCleanups.push(syntheticAudio.cleanup);
      }
    }
    freshlyAcquiredCameraStream = null;
  }
  // Reused (from preview) XOR freshly acquired — `bubbleCameraStreamPromise`
  // was null when we reused, so only one of the two can be non-null.
  const bubbleCameraStream =
    reusedCameraStream ?? freshlyAcquiredCameraStream ?? null;

  if (displayStream) {
    console.log(
      "[clips-recorder] display media acquired",
      displayStream.getTracks().map((t) => t.kind),
    );
  }
  if (bubbleCameraStream) {
    const vtrack = bubbleCameraStream.getVideoTracks()[0];
    console.log("[clips-recorder] camera acquired", {
      label: vtrack?.label,
      readyState: vtrack?.readyState,
      muted: vtrack?.muted,
    });
  }
  if (audioStream) {
    console.log(
      "[clips-recorder] audioStream acquired",
      audioStream.getAudioTracks().map((t) => ({
        label: t.label,
        readyState: t.readyState,
      })),
    );
  }

  // Choose the primary video track for MediaRecorder:
  //   - screen mode             → display
  //   - screen-camera mode      → display (camera is bubble overlay only)
  //   - camera mode             → camera
  const primaryVideo =
    displayStream ?? (params.mode === "camera" ? bubbleCameraStream : null);
  if (!primaryVideo) throw new Error("No video stream available");

  const combined = new MediaStream();
  primaryVideo.getVideoTracks().forEach((t) => combined.addTrack(t));
  // Prefer explicit mic over the system-audio track picked up by
  // getDisplayMedia — the mic track is what viewers expect to hear first.
  if (audioStream) {
    audioStream.getAudioTracks().forEach((t) => combined.addTrack(t));
  } else if (displayStream) {
    displayStream.getAudioTracks().forEach((t) => combined.addTrack(t));
  }

  // 2+3. Countdown + create-recording happen IN PARALLEL. The countdown is
  // pure visual feedback — gating it on a network round-trip makes the
  // 3-2-1 feel laggy after the user picks a screen. Kick both off and
  // wait at the end before starting the MediaRecorder.
  console.log("[clips-recorder] invoking show_countdown + createRecording");
  const countdownPromise = (async () => {
    try {
      await invoke("show_countdown");
    } catch (err) {
      console.error("[clips-recorder] show_countdown failed:", err);
    }
    try {
      await waitForEvent("clips:countdown-done", 4000);
    } catch {
      console.warn("[clips-recorder] countdown timed out — proceeding");
    }
  })();
  console.time("[clips-recorder] createRecording duration");
  const recordingPromise = createRecording(
    params.serverUrl,
    wantsCamera,
    wantsAudio,
  ).finally(() => {
    console.timeEnd("[clips-recorder] createRecording duration");
  });
  console.log("[clips-recorder] awaiting countdown + createRecording");
  const [, createRes] = await Promise.all([countdownPromise, recordingPromise]);
  const { id } = createRes;
  console.log(
    "[clips-recorder] countdown + createRecording both resolved, id=",
    id,
  );
  console.log("[clips-recorder] recording row created", { id });

  // 4. Start MediaRecorder with a 2-second timeslice — each `ondataavailable`
  //    streams a chunk to the server, so we don't hold 5-min buffers in memory.
  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  const mimeType =
    mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const recorder = new MediaRecorder(
    combined,
    mimeType ? { mimeType } : undefined,
  );
  let chunkIndex = 0;
  let failed: Error | null = null;
  // In-flight chunk uploads. We use a Set (not an array) so entries can be
  // removed as soon as each fetch settles — otherwise, for a 30-minute
  // recording the array grows to 900 Promises, and EACH promise closes over
  // the Blob it's uploading. MediaRecorder Blobs are the raw encoded video
  // chunk — ~500KB to ~1MB each. Holding 900 of them is a ~700MB leak per
  // recording, and cumulative across recordings in a long-lived process.
  // See `uploadChunk()` — it removes its own entry in `.finally()`.
  const inflight = new Set<Promise<void>>();

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const idx = chunkIndex++;
    const url = chunkUrl(params.serverUrl, id, idx, false, {
      mimeType: ev.data.type || mimeType || "video/webm",
    });
    // Wrap so `inflight.delete(p)` runs regardless of outcome. The closure
    // holds the Blob only for the duration of this fetch — once removed,
    // the Blob (and this promise) become GC-able. Note we assign `p` before
    // constructing the promise body so `inflight.delete(p)` inside the
    // `.finally` can reference the same handle we added.
    let p: Promise<void>;
    p = uploadChunk(url, ev.data)
      .catch((err) => {
        failed ??= err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        inflight.delete(p);
      });
    inflight.add(p);
  };

  const startedAt = Date.now();
  let pausedAt: number | null = null;
  let accumulatedPauseMs = 0;
  let stopped = false;
  let stateUnlistens: UnlistenFn[] = [];

  // The popover owns the camera stream when we're reusing a pre-acquired
  // one — its session effect decides when to close the stream + hide the
  // bubble + stop the pump. The recorder must NOT stop those tracks on
  // stop/cancel. For camera-only mode (rare path where popover didn't
  // hand us a stream) we own it ourselves.
  const popoverOwnsCamera = bubbleCameraStream === reusedCameraStream;

  function emitState(paused: boolean) {
    const now = Date.now();
    const pausedNowMs = paused && pausedAt ? now - pausedAt : 0;
    const elapsedMs = now - startedAt - accumulatedPauseMs - pausedNowMs;
    emit("clips:recorder-state", {
      paused,
      elapsedMs,
    }).catch(() => {});
  }
  const tickHandle = setInterval(() => emitState(pausedAt != null), 500);

  // 5. Wire toolbar events.
  const toolbarUnlistens = await Promise.all([
    listen("clips:recorder-pause", () => {
      if (recorder.state === "recording") {
        try {
          recorder.pause();
          pausedAt = Date.now();
          emitState(true);
        } catch {
          // ignore
        }
      }
    }),
    listen("clips:recorder-resume", () => {
      if (recorder.state === "paused") {
        try {
          recorder.resume();
          if (pausedAt) accumulatedPauseMs += Date.now() - pausedAt;
          pausedAt = null;
          emitState(false);
        } catch {
          // ignore
        }
      }
    }),
    listen("clips:recorder-stop", () => {
      console.log("[clips-recorder] stop event received");
      handle.stop().catch((err) => {
        console.error("[clips-recorder] handle.stop() threw:", err);
      });
    }),
    listen("clips:recorder-cancel", () => {
      console.log("[clips-recorder] cancel event received");
      handle.cancel().catch((err) => {
        console.error("[clips-recorder] handle.cancel() threw:", err);
      });
    }),
  ]);
  stateUnlistens = toolbarUnlistens;

  recorder.start(2_000);
  // The toolbar is already open (the popover's bubble-session effect
  // spawns it alongside the bubble in its pre-record, disabled state).
  // Now that MediaRecorder is actually ticking, flip the toolbar's
  // Stop / Pause buttons to enabled so the user can drive the recorder.
  emit("clips:toolbar-enabled", true).catch(() => {});
  // Seed the initial recorder-state so the time / paused styling match
  // MediaRecorder's real state (before the first 500ms tick).
  emitState(false);

  const nativeTranscriptPromise = params.micOn
    ? startNativeTranscriptCapture()
    : Promise.resolve(null);

  // 6. Bubble + toolbar visibility are owned by the popover's session
  // effect (see app.tsx + bubble-pump.ts) — not the recorder. Both open
  // as soon as the user opens the popover in screen-camera / camera mode
  // with cameraOn. The recorder just borrows the video track for
  // MediaRecorder and flips the toolbar from disabled → enabled above.

  const handle: RecorderHandle = {
    async stop() {
      if (stopped) return { recordingId: id, viewUrl: `/share/${id}` };
      stopped = true;
      console.log("[clips-recorder] stop requested");
      clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      stateUnlistens = [];

      // Flush the in-flight recorder buffer, then wait for it to fully stop
      // so we get the trailing dataavailable event.
      await new Promise<void>((resolve) => {
        if (recorder.state === "inactive") {
          resolve();
          return;
        }
        recorder.addEventListener("stop", () => resolve(), { once: true });
        try {
          if (recorder.state === "paused") recorder.resume();
        } catch {
          // ignore
        }
        try {
          recorder.requestData();
        } catch {
          // ignore
        }
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      });

      const nativeTranscriptCapture = await nativeTranscriptPromise.catch(
        () => null,
      );
      const nativeTranscript = await nativeTranscriptCapture
        ?.stop()
        .catch((err) => {
          console.warn("[clips-recorder] native transcript stop failed:", err);
          return "";
        });
      if (nativeTranscript) {
        await saveNativeTranscript(params.serverUrl, id, nativeTranscript);
      }

      // Null the data handler so the final MediaRecorder teardown
      // doesn't keep the closure (which captures `inflight`, the URL
      // builder, and indirectly the MediaStream) reachable after we're
      // done with it. WebKit's MediaRecorder can retain a reference to
      // its event handler for the life of the object if you leave a
      // non-null ondataavailable in place — null it to break the chain.
      recorder.ondataavailable = null;
      // Clear combined MediaStream's track list — just removing our
      // references to the tracks is enough; the tracks themselves are
      // owned by `displayStream` / `audioStream` / `bubbleCameraStream`
      // and get stopped below.
      try {
        combined.getTracks().forEach((t) => combined.removeTrack(t));
      } catch {
        // ignore — best-effort
      }

      // Stop the streams WE own so OS permission indicators clear. The
      // camera stream is owned by the popover when reused — we leave it
      // alone so the bubble stays live if the popover is still open.
      [displayStream, audioStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((t) => t.stop());
      }

      // Hide the recording-specific overlays (countdown + toolbar). The
      // bubble is managed by the popover's session effect — when the
      // popover is hidden or the user turns camera off, that effect tears
      // down the bubble. Closing it here would cause a flicker on the
      // cancel path where the popover re-appears with camera still on.
      console.log("[clips-recorder] hiding recording chrome");
      const chromeCmd = popoverOwnsCamera
        ? "hide_recording_chrome"
        : "hide_overlays";
      await invoke(chromeCmd).catch((err) =>
        console.error(`[clips-recorder] ${chromeCmd} failed:`, err),
      );

      // Show the full-screen "Finishing up your clip…" spinner overlay so
      // the user gets immediate feedback while we flush the recorder
      // buffer, wait for in-flight chunk uploads to settle, and POST the
      // finalize. Without this the screen goes blank between the toolbar
      // disappearing and the browser opening — several seconds of nothing
      // on a longer recording. The overlay ignores cursor events and is
      // closed right after openExternal below. Fired-and-forgotten (no
      // await) so we don't add latency to the finalize path.
      invoke("show_finalizing").catch((err) =>
        console.error("[clips-recorder] show_finalizing failed:", err),
      );

      // Wait for any in-flight chunk uploads to settle before sending the
      // final chunk. Otherwise the server could finalize before the last
      // few bytes land. Snapshot the current set — the `.finally` in each
      // upload will have already removed settled entries from `inflight`.
      const pending = Array.from(inflight);
      await Promise.allSettled(pending);
      inflight.clear();
      if (failed)
        console.error("[clips-recorder] chunk upload failed:", failed);

      const finalizeUrl = chunkUrl(params.serverUrl, id, chunkIndex, true, {
        mimeType: mimeType || "video/webm",
      });
      console.log("[clips-recorder] finalize POST", finalizeUrl, {
        chunksSent: chunkIndex,
        inflightAtFinalize: pending.length,
        anyFailed: !!failed,
      });
      try {
        const finalRes = await fetch(finalizeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          credentials: "include",
          body: new Blob([], { type: mimeType || "video/webm" }),
        });
        const bodyText = await finalRes.text().catch(() => "");
        console.log(
          "[clips-recorder] finalize response:",
          finalRes.status,
          bodyText.slice(0, 500),
        );
      } catch (err) {
        console.error("[clips-recorder] finalize fetch failed:", err);
      }

      // Finalize done (or tried and failed — the player page shows a clear
      // error state in either case). Open the browser to the playback URL
      // and THEN close the finalizing spinner. Closing before the browser
      // opens would leave the user staring at an empty desktop for the
      // brief moment while the OS launches / focuses the default browser.
      const viewUrl = `/share/${id}`;
      try {
        await openExternal(`${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`);
      } catch (err) {
        console.error("[clips-recorder] openExternal failed:", err);
      }
      invoke("hide_finalizing").catch((err) =>
        console.error("[clips-recorder] hide_finalizing failed:", err),
      );

      return { recordingId: id, viewUrl };
    },

    async cancel() {
      if (stopped) return;
      stopped = true;
      clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      stateUnlistens = [];
      nativeTranscriptPromise
        .then((capture) => capture?.cancel())
        .catch(() => {});
      // Remove MediaRecorder's data handler so any final `ondataavailable`
      // from the stop() below doesn't push a new Blob into `inflight`
      // after we've decided to discard everything.
      recorder.ondataavailable = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // ignore
      }
      // Drop the combined stream's track references — same rationale as
      // in stop(). Just detaches from `combined`; the originating
      // streams own the tracks and we stop them below.
      try {
        combined.getTracks().forEach((t) => combined.removeTrack(t));
      } catch {
        // ignore
      }
      // Stop the streams WE own. Camera stays alive when the popover
      // owns it (see stop() for the same split).
      [displayStream, audioStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );
      streamCleanups.forEach((cleanup) => cleanup());
      if (!popoverOwnsCamera) {
        bubbleCameraStream?.getTracks().forEach((t) => t.stop());
      }
      // Drop remaining in-flight chunk Blobs aggressively. Their fetches
      // will still settle (we don't AbortController them — dev server is
      // local and won't hang long) but we no longer hold references to the
      // Blobs via this Set. Combined with the `ondataavailable = null`
      // above, this guarantees no new Blobs latch on during the stop.
      inflight.clear();
      // Same split as stop(): leave the bubble alone when popover owns
      // the camera — the popover's session effect handles bubble teardown.
      const chromeCmd = popoverOwnsCamera
        ? "hide_recording_chrome"
        : "hide_overlays";
      await invoke(chromeCmd).catch(() => {});
      // Tell the server to abort the partial recording (drops chunks from
      // application_state, flips the recording row to 'failed'). Fire and
      // forget with a short-circuit on failure — we don't want to keep the
      // user waiting on a network call to a dev server that may be down.
      try {
        await fetch(
          `${params.serverUrl.replace(/\/+$/, "")}/api/uploads/${id}/abort`,
          { method: "POST", credentials: "include" },
        );
      } catch (err) {
        console.warn("[clips-recorder] abort failed (non-fatal):", err);
      }
    },
  };

  return handle;
}
