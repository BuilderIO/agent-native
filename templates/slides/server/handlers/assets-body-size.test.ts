import { assertBodySize, mockEvent } from "h3";
import { expect, it } from "vitest";

it("rejects a streamed request without Content-Length when its body is too large", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("--boundary\r\n"));
      controller.enqueue(new Uint8Array(32));
      controller.close();
    },
  });
  const request = new Request("http://localhost/api/assets/upload-video", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=boundary" },
    body,
    duplex: "half",
  } as RequestInit);
  const event = mockEvent(request);

  expect(event.req.headers.has("content-length")).toBe(false);
  await expect(assertBodySize(event, 8)).rejects.toMatchObject({ status: 413 });
});
