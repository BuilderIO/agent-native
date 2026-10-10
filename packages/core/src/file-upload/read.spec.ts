import { describe, expect, it } from "vitest";

import { FileUploadReadError, readBoundedUploadResponse } from "./read.js";

describe("bounded uploaded file reads", () => {
  it("reads a valid bounded body and preserves its MIME type", async () => {
    const result = await readBoundedUploadResponse(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png; charset=binary" },
      }),
      3,
    );
    expect(result).toEqual({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
  });

  it("rejects a streamed body that exceeds the limit without returning partial bytes", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    await expect(
      readBoundedUploadResponse(
        new Response(body, { headers: { "content-type": "image/png" } }),
        3,
      ),
    ).rejects.toMatchObject({
      code: "limit",
    } satisfies Partial<FileUploadReadError>);
  });

  it("does not turn a missing MIME type or unreadable status into an empty success", async () => {
    await expect(
      readBoundedUploadResponse(new Response(new Uint8Array([1])), 10),
    ).rejects.toMatchObject({ code: "unreadable" });
    await expect(
      readBoundedUploadResponse(new Response("missing", { status: 404 }), 10),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
