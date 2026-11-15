import { describe, expect, it, vi } from "vitest";

// Imported through the package entry, which is how apps reach the reader.
import {
  MAX_PRIVATE_MEDIA_BYTES,
  MAX_PRIVATE_MEDIA_MULTIPART_BYTES,
  PrivateMediaValidationError,
  readPrivateMediaUploadFormData,
} from "./index.js";

function upload(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/private-media", {
    method: "POST",
    body,
    headers,
  });
}

async function rejection(request: Request) {
  try {
    await readPrivateMediaUploadFormData(request);
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateMediaValidationError);
    return error as InstanceType<typeof PrivateMediaValidationError>;
  }
  throw new Error("expected the upload to be refused");
}

describe("readPrivateMediaUploadFormData", () => {
  it("leaves room for the form around a maximum-size image", () => {
    expect(MAX_PRIVATE_MEDIA_MULTIPART_BYTES).toBe(
      MAX_PRIVATE_MEDIA_BYTES + 64 * 1024,
    );
  });

  it("reads the page and the image from an upload", async () => {
    const form = new FormData();
    form.set("documentId", "document-1");
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" }),
    );
    const parsed = await readPrivateMediaUploadFormData(upload(form));
    expect(parsed.get("documentId")).toBe("document-1");
    const file = parsed.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(3);
  });

  it("refuses a body over the limit with a 413 that names the image limit", async () => {
    const cancel = vi.fn();
    const error = await rejection(
      new Request("https://app.example.test/api/private-media", {
        method: "POST",
        body: new ReadableStream({ cancel }, { highWaterMark: 0 }),
        duplex: "half",
        headers: {
          "content-type": "multipart/form-data; boundary=example-boundary",
          "content-length": String(MAX_PRIVATE_MEDIA_MULTIPART_BYTES + 1),
        },
      } as RequestInit),
    );
    expect(error.statusCode).toBe(413);
    expect(error.message).toBe("Images can be up to 10 MB.");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("refuses a body that isn't multipart with a 400", async () => {
    const error = await rejection(
      upload("not a form", {
        "content-type": "multipart/form-data; boundary=example-boundary",
      }),
    );
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe("Invalid image upload.");
  });
});
