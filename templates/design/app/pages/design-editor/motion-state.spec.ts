import { describe, expect, it } from "vitest";

import {
  applyMotionAnimationStyleToTargets,
  hasMotionTimelineContent,
  motionAnimationStyleDefinitionFromTracks,
  motionReactPreviewProofForTargets,
  motionReactSourceWriteCapabilityAllowsTargets,
  motionTimelineFingerprint,
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

describe("motionTimelineFingerprint", () => {
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

  it("includes native Figma styles so hydration sees style instance changes", () => {
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

  it("applies composite styles at the playhead and skips duplicate properties", () => {
    const result = applyMotionAnimationStyleToTargets({
      existingTracks: [
        {
          targetNodeId: "hero",
          label: "Hero",
          property: "opacity",
          keyframes: [
            { t: 0, value: "1" },
            { t: 1, value: "0.5" },
          ],
        },
      ],
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

describe("motionReactPreviewProofForTargets", () => {
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
      motionReactPreviewProofForTargets(
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
      motionReactPreviewProofForTargets(
        projection([node("hero"), node("hero")]),
        ["hero"],
      ),
    ).toBeNull();
    expect(
      motionReactPreviewProofForTargets(
        projection([node("hero"), node("label", "src/Other.tsx")]),
        ["hero", "label"],
      ),
    ).toBeNull();
    expect(
      motionReactPreviewProofForTargets(
        projection([node("hero", "../outside.tsx")]),
        ["hero"],
      ),
    ).toBeNull();
  });
});

describe("motionReactSourceWriteCapabilityAllowsTargets", () => {
  const proof = {
    modulePath: "src/components/Card.tsx",
    moduleVersionHash: "a".repeat(64),
    renderedNodeIds: ["hero", "label"],
  };

  it("requires a supported capability for the same source version and targets", () => {
    expect(
      motionReactSourceWriteCapabilityAllowsTargets(
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
      motionReactSourceWriteCapabilityAllowsTargets(
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
      motionReactSourceWriteCapabilityAllowsTargets(
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
      motionReactSourceWriteCapabilityAllowsTargets(
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
