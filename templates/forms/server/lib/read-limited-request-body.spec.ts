import { mockEvent, readBody, readMultipartFormData } from "h3";
import { describe, expect, it } from "vitest";

import {
  readLimitedRequestBody,
  RequestBodyTooLargeError,
} from "./read-limited-request-body.js";

describe("bounded H3 request parsing", () => {
  it("parses accepted JSON from the bounded request", async () => {
    const event = mockEvent("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "yes" }),
    });

    await readLimitedRequestBody(event, 100);

    expect(await readBody(event)).toEqual({ answer: "yes" });
  });

  it("parses accepted multipart data from the bounded request", async () => {
    const form = new FormData();
    form.set("fieldId", "attachment");
    form.set(
      "file",
      new Blob(["file data"], { type: "text/plain" }),
      "note.txt",
    );
    const event = mockEvent("/upload", { method: "POST", body: form });

    await readLimitedRequestBody(event, 1024);

    const parts = await readMultipartFormData(event);
    expect(parts?.map((part) => part.name)).toEqual(["fieldId", "file"]);
    expect(parts?.[1]?.filename).toBe("note.txt");
    expect(new TextDecoder().decode(parts?.[1]?.data)).toBe("file data");
  });

  it.each([undefined, "1"])(
    "cancels an oversized stream with declared length %s before either parser runs",
    async (declaredLength) => {
      let readCount = 0;
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          readCount++;
          controller.enqueue(new Uint8Array(8));
        },
        cancel() {
          cancelled = true;
        },
      });
      const event = mockEvent("/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(declaredLength ? { "content-length": declaredLength } : {}),
        },
        body: stream,
      });

      await expect(readLimitedRequestBody(event, 10)).rejects.toBeInstanceOf(
        RequestBodyTooLargeError,
      );
      expect(cancelled).toBe(true);
      expect(readCount).toBeLessThan(4);
      expect(event.req.bodyUsed).toBe(true);
    },
  );
});
