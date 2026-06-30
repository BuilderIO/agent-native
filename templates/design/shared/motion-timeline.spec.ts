/**
 * motion-timeline.spec.ts
 *
 * Tests for the pure track-building helpers that back the MotionDock
 * "create the FIRST track" flow (§6.3). These are the logic that turns the dock
 * from a dead end (no path to create a track → "Write to CSS" permanently
 * disabled) into a working editor: a freshly selected element seeds a default
 * two-keyframe track via a property preset, which is then immediately
 * compilable and previewable.
 */

import { describe, expect, it } from "vitest";

import { compile } from "./motion-compiler";
import {
  MOTION_PROPERTY_PRESETS,
  createMotionTrack,
  createMotionTrackFromPreset,
  hasTrackFor,
  type MotionTimeline,
  type MotionTrack,
} from "./motion-timeline";

// ─── createMotionTrack ────────────────────────────────────────────────────────

describe("createMotionTrack", () => {
  it("seeds exactly two keyframes at t=0 and t=1", () => {
    const track = createMotionTrack("node-1", "opacity", {
      from: "0",
      to: "1",
    });
    expect(track.targetNodeId).toBe("node-1");
    expect(track.property).toBe("opacity");
    expect(track.keyframes).toHaveLength(2);
    expect(track.keyframes[0]).toMatchObject({ t: 0, value: "0" });
    expect(track.keyframes[1]).toMatchObject({ t: 1, value: "1" });
  });

  it("is valid for apply-motion-edit (>= 1 keyframe per track)", () => {
    const track = createMotionTrack("node-1", "opacity");
    expect(track.keyframes.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a neutral 0 → 1 pair when from/to are omitted", () => {
    const track = createMotionTrack("node-1", "opacity");
    expect(track.keyframes[0].value).toBe("0");
    expect(track.keyframes[1].value).toBe("1");
  });

  it("applies the supplied ease to both seeded keyframes", () => {
    const track = createMotionTrack("node-1", "opacity", {
      ease: "ease-out",
    });
    expect(track.keyframes[0].ease).toBe("ease-out");
    expect(track.keyframes[1].ease).toBe("ease-out");
  });

  it("omits ease entirely when none is supplied", () => {
    const track = createMotionTrack("node-1", "opacity");
    expect(track.keyframes[0].ease).toBeUndefined();
    expect(track.keyframes[1].ease).toBeUndefined();
  });
});

// ─── createMotionTrackFromPreset ──────────────────────────────────────────────

describe("createMotionTrackFromPreset", () => {
  it("forwards the preset property + from/to into the track", () => {
    const preset = MOTION_PROPERTY_PRESETS.find(
      (p) => p.label === "Slide up (translateY)",
    );
    expect(preset).toBeDefined();
    const track = createMotionTrackFromPreset("node-7", preset!);
    expect(track.targetNodeId).toBe("node-7");
    expect(track.property).toBe("transform");
    expect(track.keyframes[0].value).toBe("translateY(16px)");
    expect(track.keyframes[1].value).toBe("translateY(0px)");
  });

  it("every built-in preset compiles to valid, deterministic CSS", () => {
    // This is the core guarantee of the first-track path: whatever preset the
    // user picks, the resulting timeline compiles cleanly (one @keyframes block,
    // a reduced-motion block) so "Write to CSS" succeeds.
    for (const preset of MOTION_PROPERTY_PRESETS) {
      const track = createMotionTrackFromPreset("node-x", preset);
      const timeline: MotionTimeline = {
        id: "t1",
        designId: "d1",
        sourceRef: null,
        filePath: null,
        tracks: [track],
        durationMs: 600,
        defaultEase: "ease",
        compiledHash: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      const { css, hash } = compile(timeline);
      expect(css).toContain("@keyframes");
      expect(css).toContain(`${preset.property}:`);
      expect(css).toContain("prefers-reduced-motion");
      // Deterministic: re-compiling yields the identical hash.
      expect(compile(timeline).hash).toBe(hash);
    }
  });
});

// ─── hasTrackFor ──────────────────────────────────────────────────────────────

describe("hasTrackFor", () => {
  const tracks: MotionTrack[] = [
    createMotionTrack("node-1", "opacity"),
    createMotionTrack("node-1", "transform"),
    createMotionTrack("node-2", "opacity"),
  ];

  it("returns true for an existing (node, property) pair", () => {
    expect(hasTrackFor(tracks, "node-1", "opacity")).toBe(true);
    expect(hasTrackFor(tracks, "node-1", "transform")).toBe(true);
    expect(hasTrackFor(tracks, "node-2", "opacity")).toBe(true);
  });

  it("returns false for a property not yet tracked on that node", () => {
    expect(hasTrackFor(tracks, "node-2", "transform")).toBe(false);
  });

  it("returns false for an unknown node", () => {
    expect(hasTrackFor(tracks, "node-9", "opacity")).toBe(false);
  });

  it("returns false against an empty track list (the first-track case)", () => {
    expect(hasTrackFor([], "node-1", "opacity")).toBe(false);
  });
});

// ─── First-track flow integration (timeline → CSS) ───────────────────────────

describe("first-track flow → CSS compile", () => {
  it("a single seeded track produces compilable CSS that targets the node id", () => {
    // Simulates: user selects an element (node id "abc"), picks "Fade
    // (opacity)" from the empty-state picker → one track → Write to CSS.
    const preset = MOTION_PROPERTY_PRESETS[0];
    const track = createMotionTrackFromPreset("abc", preset);
    const { css } = compile({
      id: "",
      designId: "d1",
      sourceRef: null,
      filePath: null,
      tracks: [track],
      durationMs: 1000,
      defaultEase: "ease",
      compiledHash: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    // Element rule targets the literal node id via the data attribute.
    expect(css).toContain('[data-agent-native-node-id="abc"]');
    expect(css).toContain("animation-name:");
    expect(css).toContain("opacity: 0");
    expect(css).toContain("opacity: 1");
  });

  it("adding a keyframe to a seeded track stays compilable (3 stops)", () => {
    const track = createMotionTrack("abc", "opacity", { from: "0", to: "1" });
    // Mid keyframe inserted by the dock's addKeyframe at the playhead.
    track.keyframes.splice(1, 0, { t: 0.5, value: "0.5", ease: "linear" });
    const { css } = compile({
      id: "",
      designId: "d1",
      sourceRef: null,
      filePath: null,
      tracks: [track],
      durationMs: 1000,
      defaultEase: "ease",
      compiledHash: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(css).toContain("0% {");
    expect(css).toContain("50% {");
    expect(css).toContain("100% {");
  });
});
