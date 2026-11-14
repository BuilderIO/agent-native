import { describe, expect, it } from "vitest";

import { readCollabBody } from "./payload.js";

function eventWithJsonBody(
  body: string,
  headers?: HeadersInit,
  maxPayloadBytes = 8,
) {
  const req = new Request("http://localhost/collab", {
    method: "POST",
    body,
    headers,
  });
  return {
    req,
    res: { status: 200, statusText: "", headers: new Headers() },
    context: { _collabMaxPayloadBytes: maxPayloadBytes },
  } as any;
}

describe("readCollabBody", () => {
  it("bounds streamed payloads without Content-Length", async () => {
    const event = eventWithJsonBody('{"ok":true}');
    expect(event.req.headers.has("content-length")).toBe(false);

    await expect(readCollabBody(event)).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(event.res.status).toBe(413);
  });

  it("bounds streamed payloads when Content-Length understates the body", async () => {
    const event = eventWithJsonBody('{"ok":true}', {
      "content-length": "1",
    });

    await expect(readCollabBody(event)).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(event.res.status).toBe(413);
  });

  it("reuses the bounded body read for the same request", async () => {
    const event = eventWithJsonBody(
      '{"state":null}',
      { "content-length": "14" },
      32,
    );
    const first = readCollabBody(event);

    expect(readCollabBody(event)).toBe(first);
    await expect(first).resolves.toEqual({ state: null });
  });
});
