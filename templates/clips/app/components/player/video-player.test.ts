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

  it("exposes Loom-style 5 second skip controls after the play control", () => {
    const playerControlsSource = readSource("./player-controls.tsx");
    const videoPlayerSource = readSource("./video-player.tsx");
    const playButton = playerControlsSource.indexOf(
      'tooltip={isPlaying ? "Pause (K)" : "Play (K)"}',
    );
    const backButton = playerControlsSource.indexOf(
      "onSeekRelative(-PLAYER_SEEK_STEP_MS)",
    );
    const forwardButton = playerControlsSource.indexOf(
      "onSeekRelative(PLAYER_SEEK_STEP_MS)",
    );

    expect(playerControlsSource).toContain(
      "export const PLAYER_SEEK_STEP_MS = 5_000;",
    );
    expect(playButton).toBeGreaterThan(-1);
    expect(backButton).toBeGreaterThan(playButton);
    expect(forwardButton).toBeGreaterThan(backButton);
    expect(videoPlayerSource).not.toContain("function CenterSeekButton");
    expect(videoPlayerSource).not.toContain("<CenterSeekButton");
    expect(videoPlayerSource).toContain("onSeekRelative={seekByMs}");
  });

  it("routes video surface clicks and taps through the same playback activation", () => {
    const videoPlayerSource = readSource("./video-player.tsx");
    const activation = videoPlayerSource.indexOf("const activateVideoSurface");
    const touchTap = videoPlayerSource.indexOf("activateVideoSurface();");
    const clickTap = videoPlayerSource.lastIndexOf("activateVideoSurface();");

    expect(activation).toBeGreaterThan(-1);
    expect(touchTap).toBeGreaterThan(activation);
    expect(clickTap).toBeGreaterThan(touchTap);
  });
});
