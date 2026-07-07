import { describe, expect, it } from "vitest";

import { shouldSendKeepalive } from "./DesignEditor";

describe("shouldSendKeepalive (§stale-mirror keepalive guard)", () => {
  it("sends when collab is not live, regardless of whether a hash is known", () => {
    expect(shouldSendKeepalive(false, false)).toBe(true);
    expect(shouldSendKeepalive(true, false)).toBe(true);
  });

  it("sends when collab is live but a known acked hash can guard the write", () => {
    expect(shouldSendKeepalive(true, true)).toBe(true);
  });

  it("skips when collab is live and no hash is known — an unguarded full-doc write on unload risks clobbering newer content the collab layer already holds", () => {
    expect(shouldSendKeepalive(false, true)).toBe(false);
  });
});
