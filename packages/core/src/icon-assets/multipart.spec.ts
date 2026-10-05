import { describe, expect, it, vi } from "vitest";

import {
  IconUploadBodyError,
  MAX_ICON_MULTIPART_BYTES,
  readIconUploadFormData,
} from "./multipart.js";

function streamedRequest(stream: ReadableStream<Uint8Array>, length?: string) {
  return new Request("https://app.example.test/upload", {
    method: "POST",
    body: stream,
    duplex: "half",
    headers: {
      "content-type": "multipart/form-data; boundary=example-boundary",
      ...(length ? { "content-length": length } : {}),
    },
  } as RequestInit);
}

describe("bounded icon multipart reader", () => {
  it.each([undefined, "1"])(
    "stops and cancels an overflowing stream with declared length %s before parsing",
    async (length) => {
      const cancel = vi.fn();
      const pull = vi.fn(
        (controller: ReadableStreamDefaultController<Uint8Array>) => {
          controller.enqueue(
            new Uint8Array(
              pull.mock.calls.length === 1 ? MAX_ICON_MULTIPART_BYTES : 1,
            ),
          );
        },
      );
      const request = streamedRequest(
        new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
        length,
      );
      const parse = vi.spyOn(Response.prototype, "formData");
      try {
        await expect(readIconUploadFormData(request)).rejects.toMatchObject({
          statusCode: 413,
        });
        expect(pull).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(parse).not.toHaveBeenCalled();
        expect(request.body?.locked).toBe(false);
      } finally {
        parse.mockRestore();
      }
    },
  );

  it("cancels a declared oversized body without reading it", async () => {
    const cancel = vi.fn();
    const pull = vi.fn();
    const request = streamedRequest(
      new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
      String(MAX_ICON_MULTIPART_BYTES + 1),
    );
    await expect(readIconUploadFormData(request)).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["declared", "streamed"])(
    "retains a 413 with its cancellation failure for %s overflow",
    async (overflow) => {
      const failure = new Error("example cancellation failure");
      const cancel = vi.fn(() => Promise.reject(failure));
      const pull = vi.fn(
        (controller: ReadableStreamDefaultController<Uint8Array>) => {
          controller.enqueue(new Uint8Array(MAX_ICON_MULTIPART_BYTES + 1));
        },
      );
      const request = streamedRequest(
        new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
        overflow === "declared" ? String(MAX_ICON_MULTIPART_BYTES + 1) : "1",
      );
      await expect(readIconUploadFormData(request)).rejects.toMatchObject({
        statusCode: 413,
        cause: failure,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(pull).toHaveBeenCalledTimes(overflow === "declared" ? 0 : 1);
      expect(request.body?.locked).toBe(false);
    },
  );

  it("parses ordinary multipart fields and files without a content-length header", async () => {
    const form = new FormData();
    form.set("documentId", "document-1");
    form.set(
      "file",
      new File([Uint8Array.of(1, 2)], "logo.png", { type: "image/png" }),
    );
    const request = new Request("https://app.example.test/upload", {
      method: "POST",
      body: form,
    });
    expect(request.headers.has("content-length")).toBe(false);
    const parsed = await readIconUploadFormData(request);
    expect(parsed.get("documentId")).toBe("document-1");
    const file = parsed.get("file") as File;
    expect(file.name).toBe("logo.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      Uint8Array.of(1, 2),
    );
  });

  it("distinguishes malformed multipart from a failed source stream", async () => {
    await expect(
      readIconUploadFormData(
        new Request("https://app.example.test/upload", {
          method: "POST",
          body: "invalid multipart",
        }),
      ),
    ).rejects.toBeInstanceOf(IconUploadBodyError);
    const failure = new Error("example source read failure");
    const request = streamedRequest(
      new ReadableStream({
        pull(controller) {
          controller.error(failure);
        },
      }),
    );
    await expect(readIconUploadFormData(request)).rejects.toBe(failure);
    expect(request.body?.locked).toBe(false);
  });
});
