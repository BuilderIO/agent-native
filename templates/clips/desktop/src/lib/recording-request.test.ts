import { describe, expect, it } from "vitest";

import {
  buildCreateRecordingRequestBody,
  buildCreateRecordingRequestHeaders,
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
});
