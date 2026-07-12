import { describe, expect, it } from "vitest";

import { shouldSkipDemoResponseRedaction } from "./fetch-interceptor.js";

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
});
