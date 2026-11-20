import { invoke } from "@tauri-apps/api/core";

/**
 * A meeting the Mac records itself keeps its audio: Rust writes the
 * microphone and the system audio to two files while the meeting runs, and on
 * stop they are encoded to one stereo m4a (microphone left, system right) and
 * uploaded to the meeting's recording. The server then transcribes it with
 * speakers. The live transcript is saved either way; the audio is a bonus.
 */

export interface MeetingAudioUploadResult {
  uploaded: boolean;
  /** True when the local audio files could not be deleted afterwards. */
  cleanupFailed?: boolean;
  skipped?: string;
  durationMs: number;
  bytes: number;
}

export type MeetingAudioPlan =
  | { action: "upload"; recordingId: string }
  | { action: "discard"; reason: string }
  | { action: "none" };

/**
 * What to do with a meeting's kept audio when it stops.
 *
 * Quitting the app throws it away rather than hold the quit for an upload,
 * and so does a meeting that never got a recording to upload to.
 */
export function meetingAudioPlan(args: {
  audioKey: string | null;
  alreadySettled: boolean;
  stopReason: string;
  recordingId: string | null;
}): MeetingAudioPlan {
  if (!args.audioKey || args.alreadySettled) return { action: "none" };
  if (args.stopReason === "app-quit") {
    return { action: "discard", reason: "app-quit" };
  }
  if (!args.recordingId) {
    return { action: "discard", reason: "no-recording" };
  }
  return { action: "upload", recordingId: args.recordingId };
}

function newMeetingAudioKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Starts keeping this meeting's audio. Returns its key, or null when the user
 * turned it off or it could not start; the meeting goes on without audio.
 */
export async function beginMeetingAudio(): Promise<string | null> {
  const key = newMeetingAudioKey();
  try {
    const keeping = await invoke<boolean>("meeting_audio_begin", {
      meetingKey: key,
    });
    return keeping ? key : null;
  } catch (err) {
    console.warn("[meeting-audio] could not keep this meeting's audio:", err);
    return null;
  }
}

export async function discardMeetingAudio(key: string | null): Promise<void> {
  if (!key) return;
  await invoke("meeting_audio_discard", { meetingKey: key }).catch((err) => {
    console.warn("[meeting-audio] discard failed:", err);
  });
}

export async function uploadMeetingAudio(args: {
  key: string;
  serverUrl: string;
  recordingId: string;
  authToken: string;
}): Promise<MeetingAudioUploadResult> {
  return invoke<MeetingAudioUploadResult>("meeting_audio_upload", {
    meetingKey: args.key,
    serverUrl: args.serverUrl,
    recordingId: args.recordingId,
    authToken: args.authToken || null,
  });
}
