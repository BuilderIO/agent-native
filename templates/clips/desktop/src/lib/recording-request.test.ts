import { describe, expect, it } from "vitest";

import { buildCreateRecordingRequestBody } from "./recording-request";

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
