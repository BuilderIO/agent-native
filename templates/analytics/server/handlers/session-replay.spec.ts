import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { decodeSessionReplayRequestBody } from "./session-replay";

describe("session replay ingest handler", () => {
  it("decodes gzip-compressed replay request bodies", () => {
    const payload = {
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      events: [{ type: 4, data: { href: "/inbox" } }],
    };
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));

    const decoded = decodeSessionReplayRequestBody(compressed, "gzip");

    expect(decoded.requestBytes).toBe(compressed.byteLength);
    expect(decoded.body).toEqual(payload);
  });

  it("rejects unsupported replay request encodings", () => {
    expect(() =>
      decodeSessionReplayRequestBody(Buffer.from("{}"), "br"),
    ).toThrow("Unsupported replay request content-encoding: br");
  });
});
