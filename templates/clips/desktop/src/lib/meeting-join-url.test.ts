import { describe, expect, it } from "vitest";

import { resolveDesktopMeetingJoinUrl } from "./meeting-join-url";

describe("resolveDesktopMeetingJoinUrl", () => {
  it("opens Zoom meeting links in the native desktop app", () => {
    expect(
      resolveDesktopMeetingJoinUrl(
        "https://zoom.us/j/123456789?pwd=fake-passcode",
      ),
    ).toBe(
      "zoommtg://zoom.us/join?action=join&confno=123456789&pwd=fake-passcode",
    );
  });

  it("preserves Zoom account subdomains and encoded passcodes", () => {
    expect(
      resolveDesktopMeetingJoinUrl(
        "https://example.zoom.us/j/11122233344?pwd=fake%2Fpasscode",
      ),
    ).toBe(
      "zoommtg://example.zoom.us/join?action=join&confno=11122233344&pwd=fake%2Fpasscode",
    );
  });

  it("supports Zoom meetings without an embedded passcode", () => {
    expect(
      resolveDesktopMeetingJoinUrl("https://us02web.zoom.us/j/99988877766"),
    ).toBe("zoommtg://us02web.zoom.us/join?action=join&confno=99988877766");
  });

  it.each([
    "https://meet.google.com/abc-defg-hij",
    "https://zoom.us/my/example",
    "https://zoom.us.example.com/j/123456789",
    "not a URL",
  ])("leaves unsupported join URLs unchanged: %s", (joinUrl) => {
    expect(resolveDesktopMeetingJoinUrl(joinUrl)).toBe(joinUrl);
  });
});
