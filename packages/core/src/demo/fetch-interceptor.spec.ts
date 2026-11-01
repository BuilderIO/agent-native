import { describe, expect, it, vi } from "vitest";

import { fetchTransport } from "../client/fetch-transport.js";
import {
  ensureDemoModeFetchInterceptor,
  shouldSkipDemoResponseRedaction,
} from "./fetch-interceptor.js";
import { redactDemoData } from "./redact.js";

describe("shouldSkipDemoResponseRedaction", () => {
  it.each([
    "/api/session-replay/recordings/sr_1/chunks?seqs=0,1",
    "/api/session-replay/recordings/sr_1/chunks/0",
    "/api/session-replay/recordings/sr_1/events?limit=1000",
    "/api/session-replay/agent-events.json?id=sr_1",
  ])("bypasses raw replay payload %s", (url) => {
    expect(shouldSkipDemoResponseRedaction(url)).toBe(true);
  });

  it.each([
    "/api/session-replay/recordings",
    "/api/session-replay/recordings/sr_1",
    "/api/session-replay/recordings/sr_1/manifest",
    "/api/emails",
  ])("keeps rendered record response %s eligible", (url) => {
    expect(shouldSkipDemoResponseRedaction(url)).toBe(false);
  });

  it("keeps replay manifest visitor identity eligible for demo redaction", () => {
    const manifestUrl =
      "/api/session-replay/recordings/sr_1/manifest?include=recording";
    expect(shouldSkipDemoResponseRedaction(manifestUrl)).toBe(false);

    const manifest = {
      recording: {
        userId: "visitor@example.com",
        userKey: "visitor@example.com",
      },
      chunks: [{ seq: 0, byteLength: 4200 }],
    };
    const redacted = redactDemoData(manifest, {
      redactNumbers: false,
      redactProtectedEmails: true,
    }) as typeof manifest;

    expect(redacted.recording).toEqual({
      userId: "anonymous@builder.io",
      userKey: "anonymous@builder.io",
    });
    expect(redacted.chunks).toEqual(manifest.chunks);
  });
});

describe("the demo fetch interceptor's transport", () => {
  it("sends requests with the credentials of the fetch underneath", () => {
    const pageFetch = vi.fn(async () => new Response("{}")) as typeof fetch;
    vi.stubGlobal("window", { fetch: pageFetch });
    try {
      ensureDemoModeFetchInterceptor();
      expect(window.fetch).not.toBe(pageFetch);
      expect(fetchTransport(window.fetch)).toBe(pageFetch);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
