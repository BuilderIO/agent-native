import { gzipSync } from "node:zlib";

import { H3Event } from "h3";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

vi.mock("../lib/session-replay.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/session-replay.js")>()),
  parseSessionReplayIngestPayload: (body: unknown) => body,
  recordSessionReplayChunks: mocks.record,
}));

import {
  decodeSessionReplayRequestBody,
  handleSessionReplayIngest,
} from "./session-replay";

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

  it("accepts decoded JSON bodies when the gzip header is preserved", () => {
    const payload = {
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      events: [{ type: 4, data: { href: "/inbox" } }],
    };
    const decoded = decodeSessionReplayRequestBody(
      Buffer.from(JSON.stringify(payload), "utf8"),
      "gzip",
    );

    expect(decoded.requestBytes).toBe(
      Buffer.byteLength(JSON.stringify(payload), "utf8"),
    );
    expect(decoded.body).toEqual(payload);
  });

  it("recovers text-wrapped binary gzip bodies from Netlify", () => {
    const payload = {
      publicKey: "anpk_test",
      replayId: "recording_1",
      sessionId: "session_1",
      events: [{ type: 4, data: { href: "/inbox" } }],
    };
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
    const textWrapped = Buffer.from(compressed.toString("latin1"), "utf8");

    const decoded = decodeSessionReplayRequestBody(textWrapped, "gzip");

    expect(textWrapped.byteLength).toBeGreaterThan(compressed.byteLength);
    expect(decoded.requestBytes).toBe(compressed.byteLength);
    expect(decoded.body).toEqual(payload);
  });

  it("still rejects malformed gzip replay request bodies", () => {
    expect(() =>
      decodeSessionReplayRequestBody(Buffer.from("not gzip"), "gzip"),
    ).toThrow("Invalid gzip-compressed replay body");
  });

  it("rejects unsupported replay request encodings", () => {
    expect(() =>
      decodeSessionReplayRequestBody(Buffer.from("{}"), "br"),
    ).toThrow("Unsupported replay request content-encoding: br");
  });

  it("keeps a storage failure's details out of the reply", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error(
      'Failed query: insert into "session_recordings" params: rec_1,internal-detail',
    );
    mocks.record.mockRejectedValueOnce(failure);
    const event = new H3Event(
      new Request("https://analytics.example.test/api/analytics/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: "anpk_x", sessionId: "s1" }),
      }),
    );

    await expect(handleSessionReplayIngest(event)).resolves.toEqual({
      error: "Internal server error",
    });
    expect(event.res.status).toBe(500);
    expect(log).toHaveBeenCalledWith(
      "[session-replay] Unexpected request failure:",
      failure,
    );
    log.mockRestore();
  });
});
