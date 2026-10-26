import { describe, expect, it, vi } from "vitest";

import {
  buildCreateRecordingRequestBody,
  buildVideoStorageSetupUrl,
  buildCreateRecordingRequestHeaders,
  isStorageSetupDenial,
  isStorageSetupFailureMessage,
  notifyStorageSetupRequired,
  onStorageSetupRequired,
} from "./recording-request";

describe("buildCreateRecordingRequestHeaders", () => {
  it("adds the desktop bearer token when one is available", () => {
    expect(buildCreateRecordingRequestHeaders("  desktop-token  ")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer desktop-token",
    });
  });

  it("does not send an empty authorization header", () => {
    expect(buildCreateRecordingRequestHeaders("  ")).toEqual({
      "Content-Type": "application/json",
    });
  });
});

describe("buildCreateRecordingRequestBody", () => {
  it("leaves visibility unset so the server can apply the saved default", () => {
    const body = buildCreateRecordingRequestBody(false, true, undefined, {
      mimeType: "video/mp4",
      requestStreaming: true,
      streamingUploadClient: "desktop-native",
    });

    expect(body).toEqual({
      hasCamera: false,
      hasAudio: true,
      spaceIds: [],
      recordingPlatform: "desktop",
      requestStreaming: true,
      mimeType: "video/mp4",
      streamingUploadClient: "desktop-native",
    });
    expect("visibility" in body).toBe(false);
  });

  it("preserves explicit private visibility for Rewind recordings", () => {
    expect(
      buildCreateRecordingRequestBody(false, true, undefined, {
        visibility: "private",
      }),
    ).toMatchObject({
      hasCamera: false,
      hasAudio: true,
      spaceIds: [],
      visibility: "private",
    });
  });

  it("sends the client platform when recording", () => {
    expect(buildCreateRecordingRequestBody(false, true)).toMatchObject({
      recordingPlatform: "desktop",
    });
  });
});

describe("isStorageSetupFailureMessage", () => {
  it("recognizes storage setup errors returned by create-recording", () => {
    expect(
      isStorageSetupFailureMessage('{"error":"No video storage configured"}'),
    ).toBe(true);
    expect(
      isStorageSetupFailureMessage('{"error":"Database unavailable"}'),
    ).toBe(false);
  });
});

describe("isStorageSetupFailureMessage hosted denial", () => {
  it("recognizes the 403 body create-recording returns without hosted storage", () => {
    expect(
      isStorageSetupFailureMessage(
        '{"error":"Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.","errorCode":"disabled","details":{"denyReason":"disabled"}}',
      ),
    ).toBe(true);
  });
});

describe("onStorageSetupRequired", () => {
  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onStorageSetupRequired(listener);
    notifyStorageSetupRequired();
    unsubscribe();
    notifyStorageSetupRequired();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("buildVideoStorageSetupUrl", () => {
  it("opts the browser out of the beta-lane redirect", () => {
    expect(buildVideoStorageSetupUrl("https://clips.agent-native.com/")).toBe(
      "https://clips.agent-native.com/record?connectStorage=1&force=true",
    );
  });
});

describe("isStorageSetupDenial", () => {
  const message =
    "Video storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to upload clips.";
  const body = (errorCode: string) =>
    JSON.stringify({ error: message, errorCode });

  it("routes disabled and exhausted denials to storage setup", () => {
    expect(isStorageSetupDenial(body("disabled"))).toBe(true);
    expect(isStorageSetupDenial(body("exhausted"))).toBe(true);
  });

  it("leaves sign_in_required to the session-expired path", () => {
    expect(isStorageSetupDenial(body("sign_in_required"))).toBe(false);
  });

  it("ignores unrelated errors", () => {
    expect(isStorageSetupDenial('{"error":"Database unavailable"}')).toBe(
      false,
    );
  });
});
