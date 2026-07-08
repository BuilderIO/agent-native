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

describe("video player mobile controls", () => {
  it("handles touch taps before the synthetic click can double-toggle", () => {
    const videoPlayerSource = readSource("./video-player.tsx");

    expect(videoPlayerSource).toContain("touchTapCandidateRef");
    expect(videoPlayerSource).toContain("suppressNextClickRef.current = true");
    expect(videoPlayerSource).toContain("onPointerUp={handlePlayerPointerUp}");
  });

  it("exposes 15 second skip controls beside play controls", () => {
    const playerControlsSource = readSource("./player-controls.tsx");
    const videoPlayerSource = readSource("./video-player.tsx");

    expect(playerControlsSource).toContain(
      "export const PLAYER_SEEK_STEP_MS = 15_000;",
    );
    expect(playerControlsSource).toContain(
      "onSeekRelative(-PLAYER_SEEK_STEP_MS)",
    );
    expect(playerControlsSource).toContain(
      "onSeekRelative(PLAYER_SEEK_STEP_MS)",
    );
    expect(videoPlayerSource).toContain("function CenterSeekButton");
    expect(videoPlayerSource).toContain("onSeekRelative={seekByMs}");
  });
});
