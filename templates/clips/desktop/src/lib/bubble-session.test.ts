import { describe, expect, it } from "vitest";

import { shouldKeepBubbleSession } from "./bubble-session";

describe("shouldKeepBubbleSession", () => {
  it("ends the session once a hidden popover finishes recording", () => {
    expect(
      shouldKeepBubbleSession({
        wantsCamera: true,
        popoverVisible: false,
        recordingInFlight: false,
      }),
    ).toBe(false);
  });

  it("keeps the session while recording with the popover hidden", () => {
    expect(
      shouldKeepBubbleSession({
        wantsCamera: true,
        popoverVisible: false,
        recordingInFlight: true,
      }),
    ).toBe(true);
  });
});
