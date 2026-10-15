import { describe, expect, it } from "vitest";

import {
  imageAttachmentsFromUploadedFiles,
  MissingVisualImagePayloadError,
} from "./chat-image-attachments.js";

describe("imageAttachmentsFromUploadedFiles", () => {
  it("keeps valid parameterized image data URLs for visual inspection", () => {
    expect(
      imageAttachmentsFromUploadedFiles([
        {
          type: "image/png",
          name: "screenshot.png",
          dataUrl: "data:IMAGE/PNG;charset=binary;base64,AQID",
        },
      ]),
    ).toEqual(["data:IMAGE/PNG;charset=binary;base64,AQID"]);
  });

  it("fails clearly when an image payload is malformed", () => {
    expect(() =>
      imageAttachmentsFromUploadedFiles([
        {
          type: "image/png",
          name: "screenshot.png",
          dataUrl: "data:image/png",
        },
      ]),
    ).toThrow(MissingVisualImagePayloadError);
  });
});
