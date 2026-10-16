import { buildCodeLayerProjection } from "@shared/code-layer";
import type { MotionAnimationStyleDefinition } from "@shared/motion-animation-styles";
import { MOTION_BUILT_IN_RECIPES } from "@shared/motion-built-in-recipes";
import { describe, expect, it } from "vitest";

import {
  applyMotionAnimationStyleToTargets,
  applyMotionBuiltInRecipeToTargets,
  applyMotionStyleKeyframeEdit,
  captureMotionSourceVersionBaseline,
  hasMotionTimelineContent,
  motionAnimationStyleDefinitionFromTracks,
  motionSourcePreviewProofForTargets,
  motionSourceWriteCapabilityAllowsTargets,
  motionTimelineFingerprint,
  motionTextDocumentAsDockTracks,
  motionTextDockProperty,
  motionTextAnimationsFromDockTracks,
  motionTextPropertyFromDockTrack,
  resolveSelectedMotionTargets,
} from "./motion-state";

const baseTimeline = {
  id: "timeline-1",
  designId: "design-1",
  sourceRef: "file-1",
  filePath: null,
  tracks: [],
  durationMs: 2000,
  defaultEase: "ease",
  compiledHash: "hash-1",
  createdAt: null,
  updatedAt: "2026-10-11T00:00:00.000Z",
};

describe("hasMotionTimelineContent", () => {
  const emptyContent = {
    id: null,
    tracks: [],
    animationStyles: [],
    nativeStyles: [],
    easingVariables: [],
    textDocument: null,
    audioClips: [],
  };

  it("treats native-style-only content as a timeline for CSS keyframing", () => {
    expect(
      hasMotionTimelineContent({
        ...emptyContent,
        nativeStyles: [
          {
            type: "FIGMA",
            styleKey: "Position",
            sourceStyleId: "source-style-1",
            sourceInstanceId: "source-instance-1",
            nameKey: "motion.preset_name.position",
            duration: 0.5,
            timelineOffset: 0,
            targetNodeId: "node-1",
            props: { type: "moveIn" },
          },
        ],
      }),
    ).toBe(true);
  });

  it("returns false when no timeline or authored content exists", () => {
    expect(hasMotionTimelineContent(emptyContent)).toBe(false);
  });

  it("treats audio-only content as a timeline", () => {
    expect(
      hasMotionTimelineContent({
        ...emptyContent,
        audioClips: [
          {
            id: "clip-1",
            sourceUrl: "https://example.com/audio.mp3",
            timelineStartMs: 0,
            sourceTrimStartMs: 0,
            durationMs: 500,
            volume: 1,
            muted: false,
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("motion style keyframe identity", () => {
  const tracks = [
    {
      id: "opacity-first",
      label: "Opacity first",
      targetNodeId: "hero",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "0.5" },
      ],
    },
    {
      id: "opacity-second",
      label: "Opacity second",
      targetNodeId: "hero",
      property: "opacity",
      keyframes: [
        { t: 0, value: "0.5" },
        { t: 1, value: "1" },
      ],
    },
  ];

  it("edits the selected duplicate and leaves ambiguous edits unchanged", () => {
    const edit = {
      targetNodeId: "hero",
      label: "Hero",
      styles: { opacity: "0.75" },
      playhead: 0.5,
      timelineDurationMs: 2000,
      autoKeyframeEnabled: false,
    };

    expect(applyMotionStyleKeyframeEdit(tracks, edit)).toBe(tracks);
    const updated = applyMotionStyleKeyframeEdit(tracks, {
      ...edit,
      trackId: "opacity-second",
    });
    expect(updated[0]?.keyframes).toEqual(tracks[0]?.keyframes);
    expect(updated[1]?.keyframes).toContainEqual({ t: 0.5, value: "0.75" });
  });
});

describe("built-in motion recipe application", () => {
  it("appends ordered rows with fresh identities for every target", () => {
    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (candidate) => candidate.id === "enter.recipe-04",
    );
    if (!recipe) throw new Error("Expected the indexed recipe to exist");

    const result = applyMotionBuiltInRecipeToTargets({
      recipe,
      targets: [
        { nodeId: "hero", label: "Hero" },
        { nodeId: "badge", label: "Badge" },
      ],
      currentTimeMs: 50,
      timelineDurationMs: 1000,
    });

    expect(
      result.tracks.map(({ targetNodeId, property }) => [
        targetNodeId,
        property,
      ]),
    ).toEqual([
      ["hero", "translate"],
      ["hero", "translate"],
      ["hero", "scale"],
      ["hero", "translate"],
      ["hero", "scale"],
      ["hero", "opacity"],
      ["badge", "translate"],
      ["badge", "translate"],
      ["badge", "scale"],
      ["badge", "translate"],
      ["badge", "scale"],
      ["badge", "opacity"],
    ]);
    const ids = result.tracks.map((track) => track.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      result.tracks.every(
        (track) => !recipe.tracks.some((row) => row.id === track.id),
      ),
    ).toBe(true);

    expect(result.tracks.slice(0, 5)).toMatchObject([
      {
        targetNodeId: "hero",
        label: "Hero",
        property: "translate",
        composition: "add",
        delayMs: 50,
        durationMs: 100,
        keyframes: [
          { t: 0, value: "0px -120px", ease: "cubic-bezier(0.58,0.26,1,1)" },
          { t: 1, value: "0px 0px" },
        ],
      },
      {
        targetNodeId: "hero",
        property: "translate",
        composition: "add",
        delayMs: 150,
        durationMs: 30,
      },
      {
        targetNodeId: "hero",
        property: "scale",
        delayMs: 150,
        durationMs: 30,
      },
      {
        targetNodeId: "hero",
        property: "translate",
        composition: "add",
        delayMs: 180,
        durationMs: 1080,
      },
      {
        targetNodeId: "hero",
        property: "scale",
        delayMs: 180,
        durationMs: 1080,
      },
    ]);
    expect(result.tracks[0]?.keyframes).toEqual([
      { t: 0, value: "0px -120px", ease: "cubic-bezier(0.58,0.26,1,1)" },
      { t: 1, value: "0px 0px" },
    ]);
    expect(result.timelineDurationMs).toBe(1000);
  });

  it("appends a repeated recipe at the playhead with distinct ordered tracks", () => {
    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (candidate) => candidate.id === "enter.recipe-04",
    );
    if (!recipe) throw new Error("Expected the indexed recipe to exist");
    const target = [{ nodeId: "hero", label: "Hero" }];
    const first = applyMotionBuiltInRecipeToTargets({
      recipe,
      targets: target,
      currentTimeMs: 0,
      timelineDurationMs: 2000,
    });
    const second = applyMotionBuiltInRecipeToTargets({
      recipe,
      targets: target,
      currentTimeMs: 250,
      timelineDurationMs: first.timelineDurationMs,
    });

    expect(second.tracks).toHaveLength(recipe.tracks.length);
    expect(second.tracks.map((track) => track.property)).toEqual(
      recipe.tracks.map((track) => track.property),
    );
    expect(second.tracks.map((track) => track.delayMs ?? 0)).toEqual(
      recipe.tracks.map((track) => 250 + track.delayMs),
    );
    const allIds = [...first.tracks, ...second.tracks].map((track) => track.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(second.timelineDurationMs).toBe(2000);
  });

  it("keeps recipe content past the timeline duration without extending it", () => {
    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (candidate) => candidate.id === "enter.recipe-01",
    );
    if (!recipe) throw new Error("Expected the indexed recipe to exist");

    const result = applyMotionBuiltInRecipeToTargets({
      recipe,
      targets: [{ nodeId: "hero", label: "Hero" }],
      currentTimeMs: 120_000,
      timelineDurationMs: 120_000,
    });

    expect(result.tracks).toHaveLength(recipe.tracks.length);
    expect(result.tracks.map((track) => track.delayMs)).toEqual(
      recipe.tracks.map(() => 120_000),
    );
    expect(result.tracks.map((track) => track.durationMs)).toEqual(
      recipe.tracks.map((track) => track.durationMs),
    );
    expect(result.skippedTrackCount).toBe(0);
    expect(result.timelineDurationMs).toBe(120_000);
  });

  it("reports recipe tracks whose delayed start cannot be represented", () => {
    const recipe = MOTION_BUILT_IN_RECIPES.find(
      (candidate) => candidate.id === "enter.recipe-04",
    );
    if (!recipe) throw new Error("Expected the indexed recipe to exist");

    const result = applyMotionBuiltInRecipeToTargets({
      recipe,
      targets: [{ nodeId: "hero", label: "Hero" }],
      currentTimeMs: 120_000,
      timelineDurationMs: 120_000,
    });

    expect(result.tracks).toEqual([]);
    expect(result.skippedTrackCount).toBe(
      recipe.tracks.filter((track) => track.delayMs > 0).length,
    );
    expect(result.timelineDurationMs).toBe(120_000);
  });
});

describe("motionTimelineFingerprint", () => {
  it("includes the verified source version so HMR edits rehydrate Motion", () => {
    expect(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        sourceVersionHash: "a".repeat(64),
      }),
    ).not.toBe(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        sourceVersionHash: "b".repeat(64),
      }),
    );
  });

  it("includes audio clips so edits rehydrate after save", () => {
    expect(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        audioClips: [],
      }),
    ).not.toBe(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        audioClips: [
          {
            id: "clip-1",
            sourceUrl: "https://example.com/audio.mp3",
            timelineStartMs: 0,
            sourceTrimStartMs: 0,
            durationMs: 500,
            volume: 1,
            muted: false,
          },
        ],
      }),
    );
  });

  it("includes playback mode so hydration tracks Text-only playback changes", () => {
    expect(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        playbackMode: "loop",
      }),
    ).not.toBe(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        playbackMode: "ping-pong",
      }),
    );
  });

  it("includes reusable animation styles so hydration sees source changes", () => {
    expect(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        animationStyles: [],
      }),
    ).not.toBe(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        animationStyles: [
          {
            id: "enter.fade-up",
            name: "Fade up",
            category: "enter",
            tracks: [
              {
                property: "opacity",
                keyframes: [
                  { t: 0, value: "0" },
                  { t: 1, value: "1" },
                ],
              },
            ],
          },
        ],
      }),
    );
  });

  it("includes native style instances so hydration sees instance changes", () => {
    expect(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        nativeStyles: [],
      }),
    ).not.toBe(
      motionTimelineFingerprint("file-1", {
        ...baseTimeline,
        nativeStyles: [
          {
            type: "FIGMA",
            styleKey: "Opacity",
            sourceStyleId: "source-style-1",
            sourceInstanceId: "source-instance-1",
            nameKey: "motion.preset_name.opacity",
            duration: 0.5,
            timelineOffset: 0.25,
            targetNodeId: "node-1",
            props: { type: "fadeIn", futureOption: { enabled: true } },
          },
        ],
      }),
    );
  });
});

describe("captureMotionSourceVersionBaseline", () => {
  it("waits for a source version when the first edit has no preview proof", () => {
    const waiting = captureMotionSourceVersionBaseline(
      { captured: false, versionHash: null },
      null,
    );

    expect(waiting).toEqual({ captured: false, versionHash: null });
    expect(captureMotionSourceVersionBaseline(waiting, "a".repeat(64))).toEqual(
      { captured: true, versionHash: "a".repeat(64) },
    );
  });

  it("captures the preview version for a new empty timeline and keeps it while dirty", () => {
    const firstEdit = captureMotionSourceVersionBaseline(
      { captured: false, versionHash: null },
      "a".repeat(64),
    );

    expect(firstEdit).toEqual({ captured: true, versionHash: "a".repeat(64) });
    expect(captureMotionSourceVersionBaseline(firstEdit, "b".repeat(64))).toBe(
      firstEdit,
    );
  });

  it("preserves a hydrated timeline version instead of the current preview version", () => {
    const hydrated = { captured: false, versionHash: "a".repeat(64) };

    expect(
      captureMotionSourceVersionBaseline(hydrated, "b".repeat(64)),
    ).toEqual({ captured: true, versionHash: "a".repeat(64) });
  });
});

describe("source-backed animation style helpers", () => {
  it("copies only a target's tracks into a reusable definition", () => {
    const definition = motionAnimationStyleDefinitionFromTracks({
      id: "enter.fade-up",
      name: "Fade up",
      category: "enter",
      description: "Reveal while moving into place.",
      targetNodeId: "node-1",
      tracks: [
        {
          targetNodeId: "node-1",
          property: "opacity",
          delayMs: 40,
          durationMs: 420,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
        {
          targetNodeId: "node-2",
          property: "scale",
          keyframes: [
            { t: 0, value: "0.8" },
            { t: 1, value: "1" },
          ],
        },
      ],
    });

    expect(definition).toEqual({
      id: "enter.fade-up",
      name: "Fade up",
      category: "enter",
      description: "Reveal while moving into place.",
      tracks: [
        {
          property: "opacity",
          delayMs: 40,
          durationMs: 420,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    });
    expect(
      motionAnimationStyleDefinitionFromTracks({
        id: "empty",
        name: "Empty",
        category: "basic",
        targetNodeId: "missing",
        tracks: [],
      }),
    ).toBeNull();
  });

  it("applies composite styles at the playhead even when a property already exists", () => {
    const result = applyMotionAnimationStyleToTargets({
      style: {
        id: "enter.fade-up",
        name: "Fade up",
        category: "enter",
        tracks: [
          {
            property: "opacity",
            keyframes: [
              { t: 0, value: "0" },
              { t: 1, value: "1" },
            ],
          },
          {
            property: "translate",
            delayMs: 50,
            durationMs: 400,
            keyframes: [
              { t: 0, value: "0px 12px" },
              { t: 1, value: "0px 0px" },
            ],
          },
        ],
      },
      targets: [{ nodeId: "hero", label: "Hero" }],
      currentTimeMs: 500,
      timelineDurationMs: 1000,
    });

    expect(result.tracks).toEqual([
      {
        targetNodeId: "hero",
        label: "Hero",
        property: "opacity",
        delayMs: 500,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
      {
        targetNodeId: "hero",
        label: "Hero",
        property: "translate",
        delayMs: 550,
        durationMs: 400,
        keyframes: [
          { t: 0, value: "0px 12px" },
          { t: 1, value: "0px 0px" },
        ],
      },
    ]);
    expect(result.timelineDurationMs).toBe(1000);
  });

  it("combines staged same-property style segments into one source track", () => {
    const result = applyMotionAnimationStyleToTargets({
      style: {
        id: "enter.slam",
        name: "Slam",
        category: "enter",
        tracks: [
          {
            property: "translate",
            durationMs: 100,
            keyframes: [
              {
                t: 0,
                value: "0px -120px",
                ease: "cubic-bezier(0.58, 0.26, 1, 1)",
              },
              { t: 1, value: "0px 0px" },
            ],
          },
          {
            property: "translate",
            delayMs: 100,
            durationMs: 30,
            keyframes: [
              {
                t: 0,
                value: "0px 0px",
                ease: "cubic-bezier(0.15, 0.85, 0.3, 1)",
              },
              { t: 1, value: "0px -4px" },
            ],
          },
          {
            property: "translate",
            delayMs: 130,
            durationMs: 1080,
            keyframes: [
              {
                t: 0,
                value: "0px -4px",
                ease: "spring(0.6667)",
              },
              { t: 1, value: "0px 0px" },
            ],
          },
          {
            property: "opacity",
            durationMs: 80,
            keyframes: [
              { t: 0, value: "0", ease: "cubic-bezier(0.5, 0, 0.5, 1)" },
              { t: 1, value: "1" },
            ],
          },
        ],
      },
      targets: [{ nodeId: "hero", label: "Hero" }],
      currentTimeMs: 20,
      timelineDurationMs: 2000,
    });

    expect(result.unsupportedSequenceProperty).toBeUndefined();
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toMatchObject({
      targetNodeId: "hero",
      property: "translate",
      delayMs: 20,
      durationMs: 1210,
      keyframes: [
        {
          t: 0,
          value: "0px -120px",
          ease: "cubic-bezier(0.58, 0.26, 1, 1)",
        },
        {
          value: "0px 0px",
          ease: "cubic-bezier(0.15, 0.85, 0.3, 1)",
        },
        {
          value: "0px -4px",
          ease: "spring(0.6667)",
        },
        { t: 1, value: "0px 0px" },
      ],
    });
    expect(result.tracks[0]!.keyframes[1]!.t).toBeCloseTo(100 / 1210);
    expect(result.tracks[0]!.keyframes[2]!.t).toBeCloseTo(130 / 1210);
    expect(result.tracks[1]).toMatchObject({
      targetNodeId: "hero",
      property: "opacity",
      durationMs: 80,
    });
    expect(result.timelineDurationMs).toBe(2000);
  });

  it("rejects overlapping or discontinuous same-property segments", () => {
    const style: MotionAnimationStyleDefinition = {
      id: "invalid.sequence",
      name: "Invalid sequence",
      category: "enter",
      tracks: [
        {
          property: "opacity",
          durationMs: 200,
          keyframes: [
            { t: 0, value: "0" },
            { t: 1, value: "1" },
          ],
        },
        {
          property: "opacity",
          delayMs: 100,
          durationMs: 200,
          keyframes: [
            { t: 0, value: "1" },
            { t: 1, value: "0" },
          ],
        },
      ],
    };

    const result = applyMotionAnimationStyleToTargets({
      style,
      targets: [{ nodeId: "hero", label: "Hero" }],
      currentTimeMs: 0,
      timelineDurationMs: 2000,
    });

    expect(result).toEqual({
      tracks: [],
      timelineDurationMs: 2000,
      unsupportedSequenceProperty: "opacity",
    });
  });
});

describe("Motion Text timeline track identities", () => {
  it("keeps each text property as a separate dock track for its target", () => {
    const projection = buildCodeLayerProjection(
      '<h1 data-agent-native-node-id="title-1">Hello</h1>',
    );
    const tracks = motionTextDocumentAsDockTracks(
      {
        version: 1,
        animations: [
          {
            targetNodeId: "title-1",
            unit: "word",
            direction: "forward",
            staggerMs: 40,
            property: "opacity",
            durationMs: 400,
            keyframes: [
              { t: 0, value: "0" },
              { t: 1, value: "1" },
            ],
          },
          {
            targetNodeId: "title-1",
            unit: "word",
            direction: "forward",
            staggerMs: 40,
            property: "translate",
            durationMs: 300,
            keyframes: [
              { t: 0, value: "0px" },
              { t: 1, value: "12px" },
            ],
          },
        ],
      },
      projection,
    );

    expect(
      tracks.map(({ targetNodeId, property, isTextAnimation }) => [
        targetNodeId,
        property,
        isTextAnimation,
      ]),
    ).toEqual([
      ["title-1", motionTextDockProperty("opacity"), true],
      ["title-1", motionTextDockProperty("translate"), true],
    ]);
    expect(motionTextPropertyFromDockTrack("text:rotate")).toBe("rotate");
    expect(motionTextPropertyFromDockTrack("text:fill")).toBeNull();
  });

  it("writes dock edits back to the matching property track", () => {
    const projection = buildCodeLayerProjection(
      '<h1 data-agent-native-node-id="title-1">Hello</h1>',
    );
    const document = {
      version: 1 as const,
      animations: [
        {
          targetNodeId: "title-1",
          unit: "word" as const,
          direction: "forward" as const,
          staggerMs: 40,
          property: "opacity" as const,
          durationMs: 400,
          keyframes: [
            { t: 0, value: "0" },
            { t: 1, value: "1" },
          ],
        },
        {
          targetNodeId: "title-1",
          unit: "word" as const,
          direction: "forward" as const,
          staggerMs: 40,
          property: "translate" as const,
          durationMs: 300,
          keyframes: [
            { t: 0, value: "0px" },
            { t: 1, value: "12px" },
          ],
        },
      ],
    };
    const tracks = motionTextDocumentAsDockTracks(document, projection);
    const [opacityTrack, translateTrack] = tracks;
    const updated = motionTextAnimationsFromDockTracks(document, [
      { ...opacityTrack!, delayMs: 25, durationMs: 450 },
      translateTrack!,
    ]);

    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({
      property: "opacity",
      delayMs: 25,
      durationMs: 450,
    });
    expect(updated[1]).toMatchObject({
      property: "translate",
      delayMs: 0,
      durationMs: 300,
      keyframes: [
        { t: 0, value: "0px" },
        { t: 1, value: "12px" },
      ],
    });
    expect(
      motionTextAnimationsFromDockTracks(document, [translateTrack!]),
    ).toMatchObject([{ property: "translate" }]);
  });

  it("round-trips text filter tracks through the dock", () => {
    const projection = buildCodeLayerProjection(
      '<h1 data-agent-native-node-id="title-1">Hello</h1>',
    );
    const document = {
      version: 1 as const,
      animations: [
        {
          targetNodeId: "title-1",
          unit: "word" as const,
          direction: "forward" as const,
          staggerMs: 40,
          property: "filter" as const,
          durationMs: 400,
          keyframes: [
            { t: 0, value: "blur(0px)" },
            { t: 1, value: "blur(8px)" },
          ],
        },
      ],
    };

    const [track] = motionTextDocumentAsDockTracks(document, projection);

    expect(track?.property).toBe("text:filter");
    expect(motionTextPropertyFromDockTrack(track!.property)).toBe("filter");
    expect(
      motionTextAnimationsFromDockTracks(document, [
        { ...track!, durationMs: 700 },
      ]),
    ).toMatchObject([
      {
        property: "filter",
        durationMs: 700,
        keyframes: [
          { t: 0, value: "blur(0px)" },
          { t: 1, value: "blur(8px)" },
        ],
      },
    ]);
  });
});

describe("resolveSelectedMotionTargets", () => {
  it("resolves inspector identities to durable source node IDs", () => {
    const element = {
      sourceLayerIdentity: { screenId: "screen-1", nodeId: "layer:17" },
      tagName: "button",
      textContent: "Start building",
    };

    expect(
      resolveSelectedMotionTargets({
        elements: [element],
        activeScreenId: "screen-1",
        nodes: [
          {
            id: "layer:17",
            dataAttributes: { "data-agent-native-node-id": "an-hero-cta" },
            layerName: "Hero CTA",
            paintsOwnText: true,
          },
        ],
        preferredTarget: {
          nodeId: "an-hero-cta",
          label: "Hero CTA",
          isText: true,
        },
      }),
    ).toEqual([
      {
        nodeId: "an-hero-cta",
        label: "Hero CTA",
        isText: true,
        element,
      },
    ]);
  });

  it("excludes layers from another screen or without a durable node ID", () => {
    const elements = [
      {
        sourceLayerIdentity: { screenId: "other-screen", nodeId: "layer:1" },
        tagName: "div",
      },
      {
        sourceLayerIdentity: { screenId: "screen-1", nodeId: "layer:2" },
        tagName: "div",
      },
    ];

    expect(
      resolveSelectedMotionTargets({
        elements,
        activeScreenId: "screen-1",
        nodes: [
          {
            id: "layer:1",
            dataAttributes: { "data-agent-native-node-id": "other" },
          },
          { id: "layer:2", dataAttributes: {} },
        ],
      }),
    ).toEqual([]);
  });
});

describe("motionSourcePreviewProofForTargets", () => {
  const modulePath = "src/components/Card.tsx";
  const moduleVersionHash = "a".repeat(64);
  const projection = (nodes: Array<Record<string, unknown>>) =>
    ({ nodes }) as unknown as import("@shared/code-layer").CodeLayerProjection;
  const node = (id: string, path = modulePath, hash = moduleVersionHash) =>
    ({
      id: `layer-${id}`,
      dataAttributes: {
        "data-agent-native-node-id": id,
        "data-agent-native-motion-source-file": path,
        "data-agent-native-motion-source-hash": hash,
      },
    }) as Record<string, unknown>;

  it("returns only targets from one witnessed module version", () => {
    expect(
      motionSourcePreviewProofForTargets(
        projection([node("hero"), node("label")]),
        ["hero"],
      ),
    ).toEqual({
      modulePath,
      moduleVersionHash,
      renderedNodeIds: ["hero", "label"],
    });
  });

  it("rejects duplicate, mixed-module, and malformed proofs", () => {
    expect(
      motionSourcePreviewProofForTargets(
        projection([node("hero"), node("hero")]),
        ["hero"],
      ),
    ).toBeNull();
    expect(
      motionSourcePreviewProofForTargets(
        projection([node("hero"), node("label", "src/Other.tsx")]),
        ["hero", "label"],
      ),
    ).toBeNull();
    expect(
      motionSourcePreviewProofForTargets(
        projection([node("hero", "../outside.tsx")]),
        ["hero"],
      ),
    ).toBeNull();
  });

  it("accepts only the linked React or HTML entry source types", () => {
    expect(
      motionSourcePreviewProofForTargets(
        projection([node("hero", "pages/index.htm")]),
        ["hero"],
      ),
    ).toEqual({
      modulePath: "pages/index.htm",
      moduleVersionHash,
      renderedNodeIds: ["hero"],
    });
    expect(
      motionSourcePreviewProofForTargets(
        projection([node("hero", "pages/index.js")]),
        ["hero"],
      ),
    ).toBeNull();
  });
});

describe("motionSourceWriteCapabilityAllowsTargets", () => {
  const proof = {
    modulePath: "src/components/Card.tsx",
    moduleVersionHash: "a".repeat(64),
    renderedNodeIds: ["hero", "label"],
  };

  it("requires a supported capability for the same source version and targets", () => {
    expect(
      motionSourceWriteCapabilityAllowsTargets(
        {
          status: "supported",
          modulePath: proof.modulePath,
          moduleVersionHash: proof.moduleVersionHash,
          targetNodeIds: ["hero"],
        },
        proof,
        ["hero"],
      ),
    ).toBe(true);

    expect(
      motionSourceWriteCapabilityAllowsTargets(
        {
          status: "unsupported",
          modulePath: proof.modulePath,
          moduleVersionHash: proof.moduleVersionHash,
          targetNodeIds: ["hero"],
          code: "unsupported-root",
          reason: "Motion source writes require one unconditional JSX return.",
        },
        proof,
        ["hero"],
      ),
    ).toBe(false);
  });

  it("rejects capabilities for stale source versions or incomplete target sets", () => {
    expect(
      motionSourceWriteCapabilityAllowsTargets(
        {
          status: "supported",
          modulePath: proof.modulePath,
          moduleVersionHash: "b".repeat(64),
          targetNodeIds: ["hero"],
        },
        proof,
        ["hero"],
      ),
    ).toBe(false);
    expect(
      motionSourceWriteCapabilityAllowsTargets(
        {
          status: "supported",
          modulePath: proof.modulePath,
          moduleVersionHash: proof.moduleVersionHash,
          targetNodeIds: ["hero"],
        },
        proof,
        ["hero", "label"],
      ),
    ).toBe(false);
  });
});
