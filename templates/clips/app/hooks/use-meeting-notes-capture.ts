/**
 * Audio-only meeting-notes capture for the browser (Granola-web style).
 *
 * When the user clicks "Start notes" on a meeting in a plain browser (no
 * desktop app), we capture microphone audio and run the Web Speech API live so
 * the transcript appears from second zero — then, on stop, we upload the audio
 * through the same proven chunk pipeline the screen recorder uses so the linked
 * recording finalizes to a real `ready` row (no stuck `uploading` clip), and we
 * persist the native transcript so notes can be generated immediately.
 *
 * This is intentionally audio-only: meetings are notes-first, and skipping
 * screen/system capture keeps the gesture one-click and the upload tiny (well
 * under Builder's ~32 MB edge cap — see `app/lib/compress.ts`).
 *
 * On the desktop app the native tray/meeting flow owns capture instead, so the
 * meeting page only uses this hook when NOT running inside the desktop shell.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { agentNativePath, appBasePath } from "@agent-native/core/client";
import { useLiveTranscription } from "@agent-native/core/client/transcription/use-live-transcription";

/** Mirror the screen recorder's slice size so the chunk endpoint behaves
 * identically. Audio is small, so this is almost always a single chunk. */
const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

export type MeetingCaptureStatus =
  | "idle"
  | "starting"
  | "recording"
  | "finishing";

export interface MeetingNotesCaptureApi {
  status: MeetingCaptureStatus;
  /** True while recording or finishing — drives the live UI + Stop control. */
  isCapturing: boolean;
  /** Final transcript accumulated so far (for live display). */
  transcript: string;
  /** Current interim (unconfirmed) words being spoken. */
  interimText: string;
  /** Whether the browser supports the Web Speech API (instant transcript). */
  speechSupported: boolean;
  error: string | null;
  /** Begin capture for a meeting. Resolves with the linked recording id, or
   * throws (mic denied / start failed) so the caller can roll back optimism. */
  start: (meetingId: string) => Promise<{ recordingId: string }>;
  /** Stop capture: persist the transcript, upload the audio, end the meeting.
   * Best-effort — a failed audio upload still keeps the transcript/notes. */
  stop: () => Promise<{ recordingId: string | null; transcript: string }>;
}

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // Older browsers throw on isTypeSupported — fall through.
    }
  }
  return "";
}

function friendlyMicError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow the mic for this site and try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Connect a mic and try again.";
  }
  return err instanceof Error ? err.message : "Couldn't start the microphone.";
}

async function postAction<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(agentNativePath(`/_agent-native/actions/${action}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON body — fall through to the status check below.
  }
  if (!res.ok) {
    throw new Error(json?.error || `${action} failed (${res.status})`);
  }
  // Actions return either the bare result or `{ result }`.
  return (json?.result ?? json) as T;
}

export function useMeetingNotesCapture(): MeetingNotesCaptureApi {
  const [status, setStatus] = useState<MeetingCaptureStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const live = useLiveTranscription();

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const recordingIdRef = useRef<string | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);

  const hardStopHardware = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // ignore — best effort.
      }
    }
    recorderRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
  }, []);

  // Release the mic if the user navigates away mid-capture.
  useEffect(() => {
    return () => {
      try {
        live.stop();
      } catch {
        // ignore
      }
      hardStopHardware();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    async (meetingId: string): Promise<{ recordingId: string }> => {
      if (status !== "idle") {
        throw new Error("A meeting capture is already in progress.");
      }
      setError(null);
      setStatus("starting");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (err) {
        setStatus("idle");
        const message = friendlyMicError(err);
        setError(message);
        throw new Error(message);
      }

      let recordingId: string;
      try {
        const result = await postAction<{ recording?: { id?: string } }>(
          "start-meeting-recording",
          { meetingId, hasAudio: true, hasCamera: false },
        );
        const id = result?.recording?.id;
        if (!id) throw new Error("start-meeting-recording returned no id");
        recordingId = id;
      } catch (err) {
        // Release the mic we just acquired before bailing out.
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            // ignore
          }
        }
        setStatus("idle");
        const message =
          err instanceof Error ? err.message : "Couldn't start the meeting.";
        setError(message);
        throw new Error(message);
      }

      const mimeType = pickAudioMimeType();
      mimeTypeRef.current = mimeType || "audio/webm";
      chunksRef.current = [];
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(
          stream,
          mimeType
            ? { mimeType, audioBitsPerSecond: 96_000 }
            : { audioBitsPerSecond: 96_000 },
        );
      } catch {
        // Some browsers reject the bitrate hint — retry with defaults.
        recorder = new MediaRecorder(stream);
      }
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      streamRef.current = stream;
      recorderRef.current = recorder;
      recordingIdRef.current = recordingId;
      meetingIdRef.current = meetingId;
      startedAtRef.current = Date.now();

      try {
        recorder.start(3000);
      } catch (err) {
        hardStopHardware();
        setStatus("idle");
        const message =
          err instanceof Error ? err.message : "Couldn't start recording.";
        setError(message);
        throw new Error(message);
      }

      // Web Speech runs alongside MediaRecorder for an instant transcript.
      try {
        live.start();
      } catch {
        // Unsupported / blocked — audio still uploads and cloud transcription
        // fills in later. Not fatal.
      }

      setStatus("recording");
      return { recordingId };
    },
    [status, live, hardStopHardware],
  );

  const uploadAudio = useCallback(
    async (recordingId: string, blob: Blob, durationMs: number) => {
      const mimeType = mimeTypeRef.current || "audio/webm";
      const uploadBase = `${appBasePath()}/api/uploads/${recordingId}/chunk`;
      const totalChunks = Math.max(
        1,
        Math.ceil(blob.size / UPLOAD_CHUNK_BYTES),
      );
      for (let i = 0; i < totalChunks; i++) {
        const startByte = i * UPLOAD_CHUNK_BYTES;
        const endByte = Math.min(startByte + UPLOAD_CHUNK_BYTES, blob.size);
        const slice = blob.slice(startByte, endByte, mimeType);
        const isFinal = i === totalChunks - 1;
        const params = new URLSearchParams({
          index: String(i),
          total: String(totalChunks),
          isFinal: isFinal ? "1" : "0",
          mimeType,
        });
        if (isFinal) {
          params.set("durationMs", String(Math.max(0, Math.round(durationMs))));
          params.set("hasAudio", "1");
          params.set("hasCamera", "0");
        }
        const res = await fetch(`${uploadBase}?${params.toString()}`, {
          method: "POST",
          headers: { "Content-Type": mimeType },
          body: await slice.arrayBuffer(),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `Audio upload failed at chunk ${i + 1}/${totalChunks}: ${
              text || res.statusText
            }`,
          );
        }
      }
    },
    [],
  );

  const stop = useCallback(async (): Promise<{
    recordingId: string | null;
    transcript: string;
  }> => {
    const recordingId = recordingIdRef.current;
    const meetingId = meetingIdRef.current;
    if (status !== "recording" || !recordingId) {
      return { recordingId, transcript: live.transcript };
    }
    setStatus("finishing");

    // 1. Flush the live transcript (waits briefly for the last words).
    let transcript = "";
    try {
      transcript = (await live.stopAndWait(1500)).trim();
    } catch {
      transcript = live.transcript.trim();
    }

    // 2. Stop MediaRecorder and wait for the final buffered audio.
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        recorder.onstop = finish;
        // Guard against a browser that never fires onstop.
        window.setTimeout(finish, 2000);
        try {
          recorder.stop();
        } catch {
          finish();
        }
      });
    }
    const durationMs = startedAtRef.current
      ? Date.now() - startedAtRef.current
      : 0;
    const blob = new Blob(chunksRef.current, {
      type: mimeTypeRef.current || "audio/webm",
    });
    chunksRef.current = [];
    hardStopHardware();

    // 3. Persist the native transcript FIRST so it wins over the cloud pass
    //    that finalize-recording kicks off (native-first per the skill).
    if (transcript) {
      try {
        await postAction("save-browser-transcript", {
          recordingId,
          fullText: transcript,
          source: "web-speech",
        });
      } catch (err) {
        console.warn("[meeting-notes] save transcript failed", err);
      }
    }

    // 4. Upload the audio so the recording finalizes to a real `ready` row.
    //    Best-effort: if it fails, the transcript + notes still stand.
    if (blob.size > 0) {
      try {
        await uploadAudio(recordingId, blob, durationMs);
      } catch (err) {
        console.warn("[meeting-notes] audio upload failed", err);
        setError(
          "Saved your notes, but the audio recording couldn't be uploaded.",
        );
      }
    }

    // 5. Stamp the meeting as ended.
    if (meetingId) {
      try {
        await postAction("stop-meeting-recording", { meetingId });
      } catch (err) {
        console.warn("[meeting-notes] stop-meeting-recording failed", err);
      }
    }

    recordingIdRef.current = null;
    meetingIdRef.current = null;
    setStatus("idle");
    return { recordingId, transcript };
  }, [status, live, hardStopHardware, uploadAudio]);

  return {
    status,
    isCapturing: status === "recording" || status === "finishing",
    transcript: live.transcript,
    interimText: live.interimText,
    speechSupported: live.supported,
    error,
    start,
    stop,
  };
}
