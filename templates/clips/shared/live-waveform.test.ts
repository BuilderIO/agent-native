import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The product had four live audio meters at once — the record pill's auto-gain
// bars, the meeting pill's three fixed-gain bars, the dictation bar's canvas
// (whose bars rode a sine phase, so they moved during silence), and the web mic
// test's oscilloscope. They drifted because nothing stopped a surface from
// drawing its own. This asserts every meter still resolves to the shared one.
describe("the live meter has a single source of truth", () => {
  it("keeps the component and its math in shared/", () => {
    expect(existsSync(new URL("./live-waveform.tsx", import.meta.url))).toBe(
      true,
    );
    expect(existsSync(new URL("./audio-meter.ts", import.meta.url))).toBe(true);
  });

  it("has no local fork in either app", () => {
    const forks = [
      new URL("../desktop/src/lib/audio-meter.ts", import.meta.url),
      new URL("../desktop/src/overlays/live-audio-bars.tsx", import.meta.url),
      new URL("../app/components/recorder/waveform-bars.tsx", import.meta.url),
    ];
    for (const fork of forks) {
      expect(existsSync(fork), fork.pathname).toBe(false);
    }
  });

  it("routes every meter through the shared component", () => {
    const consumers: Array<[URL, string]> = [
      [
        new URL("../desktop/src/components/live-waveform.tsx", import.meta.url),
        "../../../shared/live-waveform",
      ],
      [
        new URL(
          "../app/components/recorder/microphone-visualizer.tsx",
          import.meta.url,
        ),
        "@shared/live-waveform",
      ],
    ];
    for (const [consumer, specifier] of consumers) {
      const source = readFileSync(consumer, "utf8");
      expect(source, consumer.pathname).toContain(specifier);
    }
  });

  it("keeps the desktop overlays on the desktop wrapper, not their own bars", () => {
    const overlays = [
      new URL("../desktop/src/overlays/record-pill.tsx", import.meta.url),
      new URL("../desktop/src/overlays/recording-pill.tsx", import.meta.url),
      new URL("../desktop/src/overlays/flow-bar.tsx", import.meta.url),
    ];
    for (const overlay of overlays) {
      const source = readFileSync(overlay, "utf8");
      expect(source, overlay.pathname).toContain("live-waveform");
      // A canvas here is how the dictation bar ended up animating on a timer
      // instead of on the audio.
      expect(source, overlay.pathname).not.toContain('getContext("2d")');
    }
  });
});
