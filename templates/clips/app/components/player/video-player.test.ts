import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("video player duration probing", () => {
  it("rewinds the WebM duration probe before first play", () => {
    const videoPlayerSource = readSource("./video-player.tsx");
    const probeRewindGuard = videoPlayerSource.indexOf("v.currentTime > 1e7");
    const playAttempt = videoPlayerSource.indexOf("attachPlayPromise(v.play()");
    const webmDurationProbe = videoPlayerSource.lastIndexOf(
      "v.currentTime = 1e10;",
    );

    expect(probeRewindGuard).toBeGreaterThan(-1);
    expect(playAttempt).toBeGreaterThan(probeRewindGuard);
    expect(webmDurationProbe).toBeGreaterThan(playAttempt);
  });
});
