import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("video player duration probing", () => {
  it("does not seek to the WebM duration probe when server duration is reliable", () => {
    const videoPlayerSource = readSource("./video-player.tsx");
    const reliableDurationGuard = videoPlayerSource.indexOf(
      "if (hasReliableDurationProp) return;",
    );
    const webmDurationProbe = videoPlayerSource.indexOf(
      "v.currentTime = 1e10;",
    );

    expect(reliableDurationGuard).toBeGreaterThan(-1);
    expect(webmDurationProbe).toBeGreaterThan(reliableDurationGuard);
  });
});
