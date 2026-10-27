import { fetchUploadStatus } from "./upload-request";

export async function getRecordingUploadRecoveryEnabled(
  recordingId: string,
): Promise<boolean> {
  const response = await fetchUploadStatus(recordingId);
  if (!response.ok) {
    throw new Error(`Could not check recording recovery (${response.status}).`);
  }
  const body = (await response.json()) as {
    recording?: { recoveryEnabled?: unknown };
  };
  if (typeof body.recording?.recoveryEnabled !== "boolean") {
    throw new Error("Recording recovery status is unreadable.");
  }
  return body.recording.recoveryEnabled;
}
