/**
 * motion-timeline.spec.ts
 *
 * Tests for the pure track-building helpers that back the MotionDock
 * "create the FIRST track" flow (§6.3). These are the logic that turns the dock
 * from a dead end into a working editor: a freshly selected element seeds a
 * default two-keyframe track via a property preset, which is then immediately
 * compilable, previewable, and persistable.
 */

import { describe, expect, it } from "vitest";

import { compile } from "./motion-compiler";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  MOTION_KEYFRAME_TIME_EPSILON,
  MOTION_PROPERTY_PRESETS,
  applyMotionAutoKeyframe,
  copyLayerAnimation,
  createMotionTrack,
  createMotionTrackFromPreset,
  evaluateMotionEase,
  getMotionTrackTiming,
  hasTrackFor,
  lerpMotionValues,
  parseMotionPlaybackMode,
  pasteLayerAnimation,
  readTimelinePlaybackMode,
  sampleMotionKeyframesAt,
  sampleMotionTrackAtTimelineTime,
  sortMotionKeyframes,
  staggerLayerTracks,
  timelineTimeToTrackTime,
  upsertMotionKeyframeAtTime,
  withTimelinePlaybackMode,
  type MotionKeyframe,
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
    const preset = MOTION_PROPERTY_PRESETS.find((p) => p.label === "Position");
    expect(preset).toBeDefined();
    const track = createMotionTrackFromPreset("node-7", preset!);
    expect(track.targetNodeId).toBe("node-7");
    expect(track.property).toBe("translate");
    expect(track.keyframes[0].value).toBe("0px 16px");
    expect(track.keyframes[1].value).toBe("0px 0px");
  });

  it("matches Figma Motion's Add-motion submenu verbatim", () => {
    const primary = MOTION_PROPERTY_PRESETS.filter(
      (p) => p.group === "primary",
    ).map((p) => p.label);
    const more = MOTION_PROPERTY_PRESETS.filter((p) => p.group === "more").map(
      (p) => p.label,
    );
    expect(primary).toEqual(["Position", "Scale", "Rotation", "Opacity"]);
    expect(more).toEqual([
      "Corner radius",
      "Fill",
      "Stroke paint",
      "Stroke weight",
      "Drop shadow",
    ]);
  });

  it("maps transform channels to individual CSS transform properties", () => {
    // translate / scale / rotate are separate CSS properties, so position,
    // scale, and rotation tracks never collide on one (node, property) pair.
    const byLabel = new Map(
      MOTION_PROPERTY_PRESETS.map((p) => [p.label, p.property]),
    );
    expect(byLabel.get("Position")).toBe("translate");
    expect(byLabel.get("Scale")).toBe("scale");
    expect(byLabel.get("Rotation")).toBe("rotate");
  });

  it("every built-in preset compiles to valid, deterministic CSS", () => {
    // This is the core guarantee of the first-track path: whatever preset the
    // user picks, the resulting timeline compiles cleanly (one @keyframes block,
    // a reduced-motion block) so autosave can persist it.
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
    // Simulates: user selects an element (node id "abc"), picks "Opacity"
    // from the Add-motion picker, and autosave persists one track.
    const preset = MOTION_PROPERTY_PRESETS.find((p) => p.label === "Opacity")!;
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

// ─── sortMotionKeyframes ──────────────────────────────────────────────────────

describe("sortMotionKeyframes", () => {
  it("returns a sorted copy without mutating the input", () => {
    const keyframes: MotionKeyframe[] = [
      { t: 1, value: "1" },
      { t: 0, value: "0" },
      { t: 0.5, value: "0.5" },
    ];
    const sorted = sortMotionKeyframes(keyframes);
    expect(sorted.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(keyframes.map((k) => k.t)).toEqual([1, 0, 0.5]);
  });
});

// ─── upsertMotionKeyframeAtTime (epsilon dedupe) ─────────────────────────────

describe("upsertMotionKeyframeAtTime", () => {
  const base: MotionKeyframe[] = [
    { t: 0, value: "0" },
    { t: 1, value: "1" },
  ];

  it("inserts a new keyframe in sorted position", () => {
    const next = upsertMotionKeyframeAtTime(base, { t: 0.5, value: "0.5" });
    expect(next.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(base).toHaveLength(2);
  });

  it("replaces an existing keyframe within the epsilon window instead of duplicating", () => {
    const withMid = upsertMotionKeyframeAtTime(base, { t: 0.5, value: "0.5" });
    const replaced = upsertMotionKeyframeAtTime(withMid, {
      t: 0.5 + MOTION_KEYFRAME_TIME_EPSILON / 2,
      value: "0.75",
    });
    expect(replaced).toHaveLength(3);
    expect(replaced[1].value).toBe("0.75");
  });

  it("repeated adds at the same playhead never accumulate", () => {
    let keyframes = base;
    for (let i = 0; i < 5; i++) {
      keyframes = upsertMotionKeyframeAtTime(keyframes, {
        t: 0.25,
        value: String(i),
      });
    }
    expect(keyframes).toHaveLength(3);
    expect(keyframes[1]).toMatchObject({ t: 0.25, value: "4" });
  });
});

// ─── evaluateMotionEase ───────────────────────────────────────────────────────

describe("evaluateMotionEase", () => {
  it("is identity for linear", () => {
    expect(evaluateMotionEase("linear", 0.25)).toBeCloseTo(0.25, 6);
    expect(evaluateMotionEase("linear", 0)).toBe(0);
    expect(evaluateMotionEase("linear", 1)).toBe(1);
  });

  it("pins endpoints for every supported form", () => {
    for (const ease of [
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "cubic-bezier(0.4, 0, 0.2, 1)",
      "cubic-bezier(0.34,1.56,0.64,1)",
      "steps(4, end)",
      "spring",
    ]) {
      expect(evaluateMotionEase(ease, 0)).toBe(0);
      expect(evaluateMotionEase(ease, 1)).toBe(1);
    }
  });

  it("matches known cubic-bezier midpoints", () => {
    // ease-in-out is symmetric: midpoint maps to 0.5.
    expect(evaluateMotionEase("ease-in-out", 0.5)).toBeCloseTo(0.5, 3);
    // ease-in starts slow: below linear early on.
    expect(evaluateMotionEase("ease-in", 0.25)).toBeLessThan(0.25);
    // ease-out starts fast: above linear early on.
    expect(evaluateMotionEase("ease-out", 0.25)).toBeGreaterThan(0.25);
  });

  it("supports overshoot cubic-bezier (spring preset) beyond 1", () => {
    const values = [0.5, 0.6, 0.7, 0.8].map((x) =>
      evaluateMotionEase("cubic-bezier(0.34,1.56,0.64,1)", x),
    );
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it("holds steps() and step keywords", () => {
    expect(evaluateMotionEase("step-start", 0.01)).toBe(1);
    expect(evaluateMotionEase("step-end", 0.99)).toBe(0);
    expect(evaluateMotionEase("steps(4, end)", 0.3)).toBeCloseTo(0.25, 6);
    expect(evaluateMotionEase("steps(4, start)", 0.3)).toBeCloseTo(0.5, 6);
    expect(evaluateMotionEase("steps(4, end)", 1)).toBe(1);
  });

  it("falls back to linear for unknown strings and missing ease", () => {
    expect(evaluateMotionEase("bouncy-nonsense", 0.4)).toBeCloseTo(0.4, 6);
    expect(evaluateMotionEase(undefined, 0.4)).not.toBeNaN();
  });
});

// ─── lerpMotionValues + sampleMotionKeyframesAt ──────────────────────────────

describe("sampleMotionKeyframesAt", () => {
  it("lerps plain numeric values linearly", () => {
    const keyframes: MotionKeyframe[] = [
      { t: 0, value: "0", ease: "linear" },
      { t: 1, value: "1", ease: "linear" },
    ];
    expect(sampleMotionKeyframesAt(keyframes, 0.5)).toBe("0.5");
  });

  it("lerps unit values inside a matching skeleton", () => {
    const keyframes: MotionKeyframe[] = [
      { t: 0, value: "translateY(16px)", ease: "linear" },
      { t: 1, value: "translateY(0px)", ease: "linear" },
    ];
    expect(sampleMotionKeyframesAt(keyframes, 0.5)).toBe("translateY(8px)");
  });

  it("honours per-keyframe easing between stops", () => {
    const keyframes: MotionKeyframe[] = [
      { t: 0, value: "0", ease: "steps(1, end)" },
      { t: 1, value: "1" },
    ];
    // step-end style hold: value stays at the FROM value until the end.
    expect(sampleMotionKeyframesAt(keyframes, 0.9)).toBe("0");
  });

  it("clamps outside the keyframe range and handles unsorted input", () => {
    const keyframes: MotionKeyframe[] = [
      { t: 1, value: "1", ease: "linear" },
      { t: 0.5, value: "0.5", ease: "linear" },
      { t: 0, value: "0", ease: "linear" },
    ];
    expect(sampleMotionKeyframesAt(keyframes, -1)).toBe("0");
    expect(sampleMotionKeyframesAt(keyframes, 2)).toBe("1");
    expect(sampleMotionKeyframesAt(keyframes, 0.75)).toBe("0.75");
  });

  it("holds the from value for non-interpolable values", () => {
    const keyframes: MotionKeyframe[] = [
      { t: 0, value: "none", ease: "linear" },
      { t: 1, value: "block", ease: "linear" },
    ];
    expect(sampleMotionKeyframesAt(keyframes, 0.4)).toBe("none");
  });

  it("lerps hex colors channel-wise", () => {
    expect(lerpMotionValues("#000000", "#ffffff", 0.5)).toBe(
      "rgb(128, 128, 128)",
    );
  });
});

// ─── Extended easing: real springs + CSS linear() ────────────────────────────

describe("evaluateMotionEase — springs and linear()", () => {
  it("evaluates spring tokens with real physics (settles, overshoots)", () => {
    expect(evaluateMotionEase("spring(0.69)", 0)).toBe(0);
    expect(evaluateMotionEase("spring(0.69)", 1)).toBe(1);
    let max = 0;
    for (let i = 0; i <= 100; i++) {
      max = Math.max(max, evaluateMotionEase("spring(0.69)", i / 100));
    }
    expect(max).toBeGreaterThan(1.1);
    // Zero bounce never overshoots.
    for (let i = 0; i <= 100; i++) {
      expect(evaluateMotionEase("spring(0)", i / 100)).toBeLessThanOrEqual(
        1.0001,
      );
    }
  });

  it("evaluates CSS linear() stop lists", () => {
    expect(evaluateMotionEase("linear(0, 0.5, 1)", 0.25)).toBeCloseTo(0.25, 6);
    expect(evaluateMotionEase("linear(0, 0.9 20%, 1)", 0.2)).toBeCloseTo(
      0.9,
      6,
    );
  });
});

// ─── Track timing (offsets + per-track duration) ─────────────────────────────

describe("getMotionTrackTiming / timelineTimeToTrackTime", () => {
  it("spans the whole timeline when delay/duration are omitted (legacy)", () => {
    expect(getMotionTrackTiming({}, 2000)).toEqual({
      startMs: 0,
      durationMs: 2000,
      endMs: 2000,
    });
    expect(timelineTimeToTrackTime({}, 1000, 2000)).toBeCloseTo(0.5, 6);
  });

  it("maps timeline time into an offset track's local time", () => {
    const track = { delayMs: 500, durationMs: 1000 };
    expect(getMotionTrackTiming(track, 2000)).toEqual({
      startMs: 500,
      durationMs: 1000,
      endMs: 1500,
    });
    expect(timelineTimeToTrackTime(track, 500, 2000)).toBe(0);
    expect(timelineTimeToTrackTime(track, 1000, 2000)).toBeCloseTo(0.5, 6);
    expect(timelineTimeToTrackTime(track, 1500, 2000)).toBe(1);
    // Clamped outside the span (animation-fill-mode: both semantics).
    expect(timelineTimeToTrackTime(track, 0, 2000)).toBe(0);
    expect(timelineTimeToTrackTime(track, 2000, 2000)).toBe(1);
  });

  it("samples an offset track at absolute timeline times", () => {
    const track: MotionTrack = {
      targetNodeId: "n",
      property: "opacity",
      delayMs: 1000,
      durationMs: 1000,
      keyframes: [
        { t: 0, value: "0", ease: "linear" },
        { t: 1, value: "1", ease: "linear" },
      ],
    };
    expect(sampleMotionTrackAtTimelineTime(track, 0, 2000)).toBe("0");
    expect(sampleMotionTrackAtTimelineTime(track, 1500, 2000)).toBe("0.5");
    expect(sampleMotionTrackAtTimelineTime(track, 2000, 2000)).toBe("1");
  });
});

// ─── Playback mode persistence ───────────────────────────────────────────────

describe("timeline playback mode stamping", () => {
  const twoTracks = (): MotionTrack[] => [
    {
      targetNodeId: "a",
      property: "opacity",
      keyframes: [{ t: 0, value: "0" }],
    },
    {
      targetNodeId: "b",
      property: "rotate",
      keyframes: [{ t: 0, value: "0deg" }],
    },
  ];

  it("stamps the mode on the first track only and reads it back", () => {
    const stamped = withTimelinePlaybackMode(twoTracks(), "ping-pong");
    expect(stamped[0].timelinePlaybackMode).toBe("ping-pong");
    expect(stamped[1].timelinePlaybackMode).toBeUndefined();
    expect(readTimelinePlaybackMode(stamped)).toBe("ping-pong");
  });

  it("returns null for legacy tracks without a stamp", () => {
    expect(readTimelinePlaybackMode(twoTracks())).toBeNull();
    expect(MOTION_DEFAULT_PLAYBACK_MODE).toBe("once");
  });

  it("re-stamping moves the mode to the first track", () => {
    const stale = twoTracks();
    stale[1].timelinePlaybackMode = "loop";
    const stamped = withTimelinePlaybackMode(stale, "once");
    expect(stamped[0].timelinePlaybackMode).toBe("once");
    expect(stamped[1].timelinePlaybackMode).toBeUndefined();
  });

  it("parseMotionPlaybackMode narrows unknown values", () => {
    expect(parseMotionPlaybackMode("loop")).toBe("loop");
    expect(parseMotionPlaybackMode("ping-pong")).toBe("ping-pong");
    expect(parseMotionPlaybackMode("bounce")).toBeNull();
    expect(parseMotionPlaybackMode(undefined)).toBeNull();
  });
});

// ─── Auto-keyframe (pure logic) ──────────────────────────────────────────────

describe("applyMotionAutoKeyframe", () => {
  const baseTracks = (): MotionTrack[] => [
    {
      targetNodeId: "hero",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0", ease: "linear" },
        { t: 1, value: "1", ease: "linear" },
      ],
    },
  ];

  it("creates a keyframe at the playhead when none exists there", () => {
    const next = applyMotionAutoKeyframe(baseTracks(), {
      targetNodeId: "hero",
      property: "opacity",
      value: "0.25",
      playheadT: 0.5,
      timelineDurationMs: 2000,
    });
    expect(next).not.toBeNull();
    expect(next![0].keyframes).toHaveLength(3);
    const created = next![0].keyframes.find((kf) => kf.t === 0.5);
    expect(created?.value).toBe("0.25");
  });

  it("replaces the value when the playhead sits on an existing keyframe", () => {
    const next = applyMotionAutoKeyframe(baseTracks(), {
      targetNodeId: "hero",
      property: "opacity",
      value: "0.9",
      playheadT: 1,
      timelineDurationMs: 2000,
    });
    expect(next![0].keyframes).toHaveLength(2);
    expect(next![0].keyframes[1]).toMatchObject({
      t: 1,
      value: "0.9",
      ease: "linear", // preserves the existing keyframe's ease
    });
  });

  it("maps the playhead through the track's own offset span", () => {
    const tracks: MotionTrack[] = [
      {
        targetNodeId: "hero",
        property: "opacity",
        delayMs: 1000,
        durationMs: 1000,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ];
    const next = applyMotionAutoKeyframe(tracks, {
      targetNodeId: "hero",
      property: "opacity",
      value: "0.5",
      playheadT: 0.75, // 1500ms of 2000 → local t 0.5
      timelineDurationMs: 2000,
    });
    expect(next![0].keyframes.map((kf) => kf.t)).toContain(0.5);
  });

  it("returns null when no track animates the edited property", () => {
    expect(
      applyMotionAutoKeyframe(baseTracks(), {
        targetNodeId: "hero",
        property: "rotate",
        value: "45deg",
        playheadT: 0.5,
        timelineDurationMs: 2000,
      }),
    ).toBeNull();
  });
});

// ─── Copy / paste animation + stagger ────────────────────────────────────────

describe("copyLayerAnimation / pasteLayerAnimation / staggerLayerTracks", () => {
  const tracks = (): MotionTrack[] => [
    {
      targetNodeId: "a",
      property: "opacity",
      timelinePlaybackMode: "loop",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    },
    {
      targetNodeId: "a",
      property: "translate",
      delayMs: 200,
      keyframes: [
        { t: 0, value: "0px 16px" },
        { t: 1, value: "0px 0px" },
      ],
    },
    {
      targetNodeId: "b",
      property: "opacity",
      keyframes: [
        { t: 0, value: "1" },
        { t: 1, value: "0" },
      ],
    },
  ];

  it("copies a layer's tracks without node id or playback-mode stamp", () => {
    const clip = copyLayerAnimation(tracks(), "a");
    expect(clip).not.toBeNull();
    expect(clip!.tracks).toHaveLength(2);
    for (const track of clip!.tracks) {
      expect("targetNodeId" in track).toBe(false);
      expect("timelinePlaybackMode" in track).toBe(false);
    }
    expect(copyLayerAnimation(tracks(), "missing")).toBeNull();
  });

  it("pastes onto a target node, replacing same-property tracks", () => {
    const clip = copyLayerAnimation(tracks(), "a")!;
    const pasted = pasteLayerAnimation(tracks(), clip, "b");
    const bTracks = pasted.filter((t) => t.targetNodeId === "b");
    expect(bTracks.map((t) => t.property).sort()).toEqual([
      "opacity",
      "translate",
    ]);
    // b's opacity was replaced by a's copied opacity track.
    expect(
      bTracks.find((t) => t.property === "opacity")!.keyframes[0].value,
    ).toBe("0");
    // The clip's per-track offset came along.
    expect(bTracks.find((t) => t.property === "translate")!.delayMs).toBe(200);
    // Timeline playback mode stays stamped on the first track.
    expect(readTimelinePlaybackMode(pasted)).toBe("loop");
  });

  it("staggers listed layers by index * step, preserving internal offsets", () => {
    const staggered = staggerLayerTracks(tracks(), ["a", "b"], 60);
    expect(
      staggered.find((t) => t.targetNodeId === "a" && t.property === "opacity")!
        .delayMs,
    ).toBeUndefined();
    expect(
      staggered.find(
        (t) => t.targetNodeId === "a" && t.property === "translate",
      )!.delayMs,
    ).toBe(200);
    for (const track of staggered.filter((t) => t.targetNodeId === "b")) {
      expect(track.delayMs).toBe(60);
    }
  });
});
