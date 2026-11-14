import { describe, expect, it } from "vitest";

import {
  MAX_EMAIL_IMAGE_BYTES,
  verifyEmailImageResponse,
} from "./email-image-bytes.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z",
  "base64",
);

function response(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes));
}

describe("email image response bytes", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/gif", GIF],
  ])("accepts complete %s bytes", async (mediaType, bytes) => {
    await expect(
      verifyEmailImageResponse(response(bytes), mediaType),
    ).resolves.toEqual({ kind: "valid", mediaType });
  });

  it("distinguishes an advertised type from the actual image format", async () => {
    await expect(
      verifyEmailImageResponse(response(GIF), "image/png"),
    ).resolves.toEqual({ kind: "mime-mismatch", actual: "image/gif" });
  });

  it.each([new Uint8Array(), Buffer.from("<html>Sign in</html>")])(
    "rejects empty or non-image bytes despite an image label",
    async (bytes) => {
      await expect(
        verifyEmailImageResponse(response(bytes), "image/png"),
      ).resolves.toEqual({ kind: "invalid" });
    },
  );

  it.each([
    ["image/png", PNG.subarray(0, -1)],
    ["image/jpeg", JPEG.subarray(0, -1)],
    ["image/gif", GIF.subarray(0, -1)],
  ])("distinguishes incomplete %s bytes", async (mediaType, bytes) => {
    await expect(
      verifyEmailImageResponse(response(bytes), mediaType),
    ).resolves.toEqual({ kind: "truncated" });
  });

  it("rejects a complete container with invalid image dimensions", async () => {
    const bytes = Buffer.from(PNG);
    bytes.writeUInt32BE(0, 16);
    await expect(
      verifyEmailImageResponse(response(bytes), "image/png"),
    ).resolves.toEqual({ kind: "invalid" });
  });

  it("does not turn a failed body read into a valid or empty image", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("Connection interrupted"));
      },
    });
    await expect(
      verifyEmailImageResponse(new Response(body), "image/png"),
    ).resolves.toEqual({ kind: "unreadable" });
  });

  it.each([true, false])(
    "cancels oversized bodies with an advertised size of %s",
    async (advertised) => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(MAX_EMAIL_IMAGE_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      });
      const headers = advertised
        ? { "content-length": String(MAX_EMAIL_IMAGE_BYTES + 1) }
        : undefined;
      await expect(
        verifyEmailImageResponse(new Response(body, { headers }), "image/png"),
      ).resolves.toEqual({ kind: "too-large" });
      expect(cancelled).toBe(true);
    },
  );
});
