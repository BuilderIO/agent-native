import { describe, expect, it } from "vitest";

import {
  buildCaptureTitle,
  inferWindowTitleFromDisplayStream,
} from "./recording-title";

function streamLabelled(label: string): MediaStream {
  return { getVideoTracks: () => [{ label }] } as unknown as MediaStream;
}

const NOW = new Date("2026-09-17T10:00:00Z");

describe("inferWindowTitleFromDisplayStream", () => {
  it("rejects Chromium's internal handle for the captured surface", () => {
    // Seen on a real capture 2026-09-17: this landed verbatim as the title.
    expect(
      inferWindowTitleFromDisplayStream(
        streamLabelled(
          "web-contents-media-stream://4DDFC4CE5C8FAC3935A8D908674C60F2",
        ),
      ),
    ).toBeNull();
    expect(
      inferWindowTitleFromDisplayStream(
        streamLabelled("4DDFC4CE5C8FAC3935A8D908674C60F2"),
      ),
    ).toBeNull();
    expect(
      inferWindowTitleFromDisplayStream(streamLabelled("screen:0:0")),
    ).toBe(null);
  });

  it("keeps a real window name", () => {
    expect(
      inferWindowTitleFromDisplayStream(
        streamLabelled("Checkout - Acme Admin"),
      ),
    ).toBe("Checkout - Acme Admin");
  });
});

describe("buildCaptureTitle for screenshots", () => {
  it("says what it is when there is nothing else to go on", () => {
    expect(
      buildCaptureTitle({
        mode: "screenshot",
        displaySurface: "monitor",
        now: NOW,
      }).title,
    ).toBe("Screenshot - 17 September 2026");
    expect(
      buildCaptureTitle({
        mode: "screenshot",
        displaySurface: "window",
        now: NOW,
      }).title,
    ).toBe("Window screenshot - 17 September 2026");
  });

  it("still prefers the captured window title", () => {
    const result = buildCaptureTitle({
      mode: "screenshot",
      windowTitle: "Checkout - Acme Admin",
      displaySurface: "window",
      now: NOW,
    });

    expect(result.title).toBe("Checkout - Acme Admin - 17 September 2026");
    expect(result.sourceWindowTitle).toBe("Checkout - Acme Admin");
  });

  it("leaves recording titles alone", () => {
    expect(
      buildCaptureTitle({ mode: "screen", displaySurface: "monitor", now: NOW })
        .title,
    ).toBe("Screen recording - 17 September 2026");
  });
});
