/**
 * Native-first recording driver for the Clips tray.
 *
 * Orchestrates the full capture lifecycle without ever rendering a browser
 * window to the user:
 *
 *   1. request getDisplayMedia / getUserMedia (mic, optionally camera)
 *   2. spawn the countdown overlay window, wait for `clips:countdown-done`
 *   3. start MediaRecorder; POST each chunk to /api/uploads/:id/chunk
 *   4. spawn the toolbar + (optional) camera bubble overlays
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
      body: JSON.stringify({ hasCamera, hasAudio }),
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

async function uploadChunk(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, {
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
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`chunk ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function waitForEvent(name: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let un: UnlistenFn | null = null;
    listen(name, () => {
      if (timer) clearTimeout(timer);
      un?.();
      resolve();
    })
      .then((u) => {
        un = u;
      })
      .catch(reject);
    timer = setTimeout(() => {
      un?.();
      reject(new Error(`timeout waiting for ${name}`));
    }, timeoutMs);
  });
}

export async function startNativeRecording(
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
  let displayStream: MediaStream | null = null;
  if (wantsScreen) {
    console.log("[clips-recorder] requesting display media");
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
    console.log(
      "[clips-recorder] display media acquired",
      displayStream.getTracks().map((t) => t.kind),
    );
  }
  let audioStream: MediaStream | null = null;
  if (wantsAudio) {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: params.micId ? { deviceId: { exact: params.micId } } : true,
    });
  }

  // For the camera-only mode the bubble's own getUserMedia is the primary
  // video source. We don't need a second stream in the popover.
  let cameraStream: MediaStream | null = null;
  if (params.mode === "camera") {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: params.cameraId ? { deviceId: { exact: params.cameraId } } : true,
      audio: false,
    });
  }

  const primaryVideo = displayStream ?? cameraStream;
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

  // 2. Create the recording row up-front so we have an id to stream chunks
  //    against even before the first dataavailable fires.
  const { id } = await createRecording(
    params.serverUrl,
    wantsCamera,
    wantsAudio,
  );
  console.log("[clips-recorder] recording row created", { id });

  // 3. Countdown overlay. The popover can hide (or even blur) during the
  //    countdown — the overlay is a standalone window.
  console.log("[clips-recorder] invoking show_countdown");
  try {
    await invoke("show_countdown");
    console.log("[clips-recorder] show_countdown returned");
  } catch (err) {
    console.error("[clips-recorder] show_countdown failed:", err);
  }
  try {
    await waitForEvent("clips:countdown-done", 4000);
    console.log("[clips-recorder] countdown-done received");
  } catch {
    console.log(
      "[clips-recorder] countdown-done not received within 4s — proceeding",
    );
  }

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
  const uploadQueue: Promise<void>[] = [];

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const idx = chunkIndex++;
    const url = chunkUrl(params.serverUrl, id, idx, false, {
      mimeType: ev.data.type || mimeType || "video/webm",
    });
    const p = uploadChunk(url, ev.data).catch((err) => {
      failed ??= err instanceof Error ? err : new Error(String(err));
    });
    uploadQueue.push(p);
  };

  const startedAt = Date.now();
  let pausedAt: number | null = null;
  let accumulatedPauseMs = 0;
  let stopped = false;
  let stateUnlistens: UnlistenFn[] = [];

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
      void handle.stop();
    }),
    listen("clips:recorder-cancel", () => {
      void handle.cancel();
    }),
  ]);
  stateUnlistens = toolbarUnlistens;

  recorder.start(2_000);
  console.log("[clips-recorder] MediaRecorder started");

  // 6. Show the floating toolbar + camera bubble.
  try {
    await invoke("show_toolbar");
    console.log("[clips-recorder] show_toolbar ok");
  } catch (err) {
    console.error("[clips-recorder] show_toolbar failed:", err);
  }
  if (wantsCamera) {
    try {
      await invoke("show_bubble");
      console.log("[clips-recorder] show_bubble ok");
    } catch (err) {
      console.error("[clips-recorder] show_bubble failed:", err);
    }
    // Tell the bubble which device to use (if any). It grabs its own stream.
    setTimeout(() => {
      emit("clips:bubble-config", { deviceId: params.cameraId }).catch((err) =>
        console.error("[clips-recorder] bubble-config emit failed:", err),
      );
    }, 300);
  }

  const handle: RecorderHandle = {
    async stop() {
      if (stopped) return { recordingId: id, viewUrl: `/r/${id}` };
      stopped = true;
      clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());

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

      // Stop every track so OS permission indicators clear immediately.
      [displayStream, audioStream, cameraStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );

      // Drain pending chunk uploads, then send the isFinal marker.
      await Promise.allSettled(uploadQueue);
      if (failed) throw failed;

      const finalizeUrl = chunkUrl(params.serverUrl, id, chunkIndex, true, {
        mimeType: mimeType || "video/webm",
      });
      const finalRes = await fetch(finalizeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        // Tauri webview runs on localhost:1420 (dev) or tauri://localhost (prod);
        // the clips server is a different origin. The framework's dev CORS is
        // permissive for "*" but won't accept credentialed requests without
        // Allow-Credentials — and in dev auth is bypassed anyway, so we don't
        // need cookies.
        credentials: "include",
        body: new Blob([], { type: mimeType || "video/webm" }),
      });
      if (!finalRes.ok) {
        const body = await finalRes.text().catch(() => "");
        throw new Error(`finalize ${finalRes.status}: ${body.slice(0, 200)}`);
      }

      await invoke("hide_overlays").catch(() => {});
      const viewUrl = `/r/${id}`;
      openExternal(`${params.serverUrl.replace(/\/+$/, "")}${viewUrl}`).catch(
        () => {},
      );
      return { recordingId: id, viewUrl };
    },

    async cancel() {
      if (stopped) return;
      stopped = true;
      clearInterval(tickHandle);
      stateUnlistens.forEach((u) => u());
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        // ignore
      }
      [displayStream, audioStream, cameraStream].forEach((s) =>
        s?.getTracks().forEach((t) => t.stop()),
      );
      await invoke("hide_overlays").catch(() => {});
      // Tell the server to abort the partial recording.
      await fetch(
        `${params.serverUrl.replace(/\/+$/, "")}/api/uploads/${id}/abort`,
        { method: "POST", credentials: "include" },
      ).catch(() => {});
    },
  };

  return handle;
}
