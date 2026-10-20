import { describe, expect, it } from "vitest";

import {
  detectMeetingPlatform,
  extractMeetingJoinUrl,
} from "./meeting-platform";

describe("meeting platform URL detection", () => {
  it("recognizes exact and subdomain Teams hosts", () => {
    expect(detectMeetingPlatform("https://teams.microsoft.com/meet/123")).toBe(
      "teams",
    );
    expect(detectMeetingPlatform("https://teams.live.com/meet/123")).toBe(
      "teams",
    );
    expect(
      detectMeetingPlatform("https://subdomain.teams.live.com/meet/123"),
    ).toBe("teams");
  });

  it("rejects lookalike hosts and non-HTTPS URLs", () => {
    expect(
      detectMeetingPlatform("https://teams.live.com.attacker.test/meet/123"),
    ).toBe("other");
    expect(detectMeetingPlatform("http://teams.live.com/meet/123")).toBe(
      "other",
    );
  });

  it("extracts supported Teams Live links from calendar text", () => {
    expect(
      extractMeetingJoinUrl(
        "Join the call: https://teams.live.com/meet/123). More details follow.",
      ),
    ).toBe("https://teams.live.com/meet/123");
  });

  it("does not extract a lookalike meeting host", () => {
    expect(
      extractMeetingJoinUrl("https://teams.live.com.attacker.test/meet/123"),
    ).toBeUndefined();
  });
});
