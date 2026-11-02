import { appBasePath } from "@agent-native/core/client/api-path";

export async function prepareRecordingUploadRetry(
  recordingId: string,
  options: {
    mimeType: string;
    signal?: AbortSignal;
    expectedOwnerEmail?: string;
    expectedOrgId?: string;
  },
): Promise<{ attemptId: string; uploadGenerationId: string }> {
  const attemptId = crypto.randomUUID();
  const identity = new URLSearchParams({ attemptId });
  if (options.expectedOwnerEmail)
    identity.set("expectedOwnerEmail", options.expectedOwnerEmail);
  if (options.expectedOrgId)
    identity.set("expectedOrgId", options.expectedOrgId);
  const resumeUrl = `${appBasePath()}/api/uploads/${encodeURIComponent(recordingId)}/resume?${identity}`;
  const resumeRes = await fetch(resumeUrl, {
    method: "GET",
    credentials: "include",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!resumeRes.ok) {
    // coercion-ok: response text only enriches an already-failing claim error.
    const text = await resumeRes.text().catch(() => "");
    throw new Error(
      `Couldn't claim the upload retry (resume ${resumeRes.status}). ${
        text || resumeRes.statusText
      }`,
    );
  }
  let resume: {
    resumable?: unknown;
    attemptId?: unknown;
    uploadGenerationId?: unknown;
  };
  try {
    resume = (await resumeRes.json()) as typeof resume;
  } catch {
    throw new Error("The upload retry claim returned an unreadable response.");
  }
  if (resume.resumable !== true || resume.attemptId !== attemptId) {
    throw new Error("The upload retry could not claim this recording.");
  }
  const claimedGenerationId =
    typeof resume.uploadGenerationId === "string" && resume.uploadGenerationId
      ? resume.uploadGenerationId
      : undefined;

  const resetUrl = `${appBasePath()}/api/uploads/${recordingId}/reset-chunks`;
  const resetRes = await fetch(resetUrl, {
    method: "POST",
    credentials: "include",
    ...(options.signal ? { signal: options.signal } : {}),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestStreaming: true,
      mimeType: options.mimeType,
      attemptId,
      expectedOwnerEmail: options.expectedOwnerEmail,
      expectedOrgId: options.expectedOrgId,
      useGenerationFence: true,
      ...(claimedGenerationId
        ? { uploadGenerationId: claimedGenerationId }
        : {}),
    }),
  });
  if (!resetRes.ok) {
    // coercion-ok: the request already failed; this only fills in the
    // human-readable detail on the error we're about to throw.
    const text = await resetRes.text().catch(() => "");
    throw new Error(
      `Couldn't restart the upload (reset-chunks ${resetRes.status}). ${
        text || resetRes.statusText
      }`,
    );
  }
  let reset: { uploadGenerationId?: unknown };
  try {
    reset = (await resetRes.json()) as typeof reset;
  } catch {
    throw new Error("Upload retry setup returned an unreadable response.");
  }
  if (
    typeof reset.uploadGenerationId !== "string" ||
    !reset.uploadGenerationId
  ) {
    throw new Error("Upload retry setup returned no upload generation.");
  }
  const uploadGenerationId = reset.uploadGenerationId;

  return { attemptId, uploadGenerationId };
}
