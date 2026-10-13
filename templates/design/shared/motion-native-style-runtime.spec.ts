import { describe, expect, it } from "vitest";

import { compileMotionCode, decodeMotionCodeMetadata } from "./motion-code";
import { compile } from "./motion-compiler";
import type { MotionNativeStyleInstance } from "./motion-native-style";
import {
  MotionNativeStyleRuntimeError,
  createMotionNativeStyleInstance,
  motionNativeStyleEndTimeMs,
  motionNativeStyleWithPathTrimTrack,
  motionNativeStyleWithPositionTrack,
  motionNativeStylesToTracks,
  motionNativeStylesToTextAnimations,
  motionTextDocumentWithNativeStyles,
  motionTextDocumentWithoutNativeStyles,
  switchMotionNativeStyleKey,
} from "./motion-native-style-runtime";
import type { MotionTextDocument } from "./motion-text-code";
import type { MotionPathSegmentV1, MotionTimeline } from "./motion-timeline";

function compileTracks(tracks: MotionTimeline["tracks"]): string {
  return compile({
    id: "timeline",
    designId: "design",
    sourceRef: null,
    filePath: null,
    tracks,
    durationMs: 1000,
    defaultEase: "ease",
    compiledHash: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  }).css;
}

function withEasing(
  style: MotionNativeStyleInstance,
  easing: string,
): MotionNativeStyleInstance {
  return {
    ...style,
    props: {
      ...style.props,
      easing,
    },
  };
}

function expectRuntimeError(
  run: () => unknown,
  code: MotionNativeStyleRuntimeError["code"],
): void {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(MotionNativeStyleRuntimeError);
  expect(error).toMatchObject({ code });
}

describe("native Figma Motion runtime adapter", () => {
  it("derives default TextStagger as an editable text property track", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });

    expect(motionNativeStylesToTracks([style])).toEqual([]);
    expect(motionNativeStylesToTextAnimations([style])).toEqual([
      {
        targetNodeId: "hero",
        unit: "character",
        direction: "forward",
        staggerMs: 250,
        delayMs: 0,
        property: "translate",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "0px -40px", ease: "ease-out" },
          { t: 1, value: "0px 0px" },
        ],
      },
    ]);
  });

  it("projects native Path trim endpoints and preserves opaque source props on edits", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "Path",
      targetNodeId: "path-1",
    });
    const track = motionNativeStylesToTracks([style])[0]!;

    expect(track).toMatchObject({
      targetNodeId: "path-1",
      property: "path-trim",
      delayMs: 0,
      durationMs: 1000,
      keyframes: [
        { t: 0, value: "100% 20%", ease: "ease-out" },
        { t: 1, value: "0% 100%" },
      ],
    });

    const authored = {
      ...style,
      props: { ...style.props, extensionField: { untouched: true } },
    };
    const editedTrack = {
      ...track,
      keyframes: [
        { t: 0, value: "85% 15%", ease: "ease-out" },
        { t: 1, value: "10% 90%" },
      ],
    };
    const edited = motionNativeStyleWithPathTrimTrack(authored, editedTrack);

    expect(edited.props).toMatchObject({
      type: "custom",
      pathStartStartFrame: 85,
      pathEndStartWithoutDivider: 15,
      pathStartEndWithoutDivider: 10,
      pathEndEndFrame: 90,
      extensionField: { untouched: true },
    });
    expect(motionNativeStylesToTracks([edited])[0]).toMatchObject({
      property: "path-trim",
      keyframes: [
        { t: 0, value: "85% 15%" },
        { t: 1, value: "10% 90%" },
      ],
    });
  });

  it("keeps disabled native Path styles inert and rejects unsupported types or percentages", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "Path",
      targetNodeId: "path-1",
    });
    expect(motionNativeStylesToTracks([{ ...style, enabled: false }])).toEqual(
      [],
    );
    expectRuntimeError(
      () =>
        motionNativeStylesToTracks([
          { ...style, props: { ...style.props, type: "spiral" } },
        ]),
      "unsupported-style",
    );
    expectRuntimeError(
      () =>
        motionNativeStylesToTracks([
          {
            ...style,
            props: { ...style.props, pathStartStartFrame: 101 },
          },
        ]),
      "invalid-style-props",
    );
  });

  it("lowers all enabled TextStagger properties with shared grouping and timing", () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const style = {
      ...base,
      duration: 0.5,
      timelineOffset: 0.2,
      props: {
        ...base.props,
        animationDirection: "out",
        textDelayGrouping: "WORD",
        textDelayOrder: "RIGHT_LEFT",
        presetStaggerOverlap: 20,
        delay: 0.125,
        direction: "left",
        positionEnabled: true,
        rotationEnabled: true,
        scaleEnabled: true,
        opacityEnabled: true,
        blurEnabled: true,
      },
    };

    expect(motionNativeStylesToTextAnimations([style])).toEqual([
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        delayMs: 325,
        property: "filter",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "blur(0px)", ease: "ease-out" },
          { t: 1, value: "blur(20px)" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        delayMs: 325,
        property: "translate",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "0px 0px", ease: "ease-out" },
          { t: 1, value: "-40px 0px" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        delayMs: 325,
        property: "rotate",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "0deg", ease: "ease-out" },
          { t: 1, value: "180deg" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        delayMs: 325,
        property: "scale",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "1", ease: "ease-out" },
          { t: 1, value: "1.2" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        delayMs: 325,
        property: "opacity",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "1", ease: "ease-out" },
          { t: 1, value: "0" },
        ],
      },
    ]);
  });

  it("keeps derived TextStagger separate from authored text tracks in metadata", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const authored: MotionTextDocument = {
      version: 1,
      animations: [
        {
          targetNodeId: "subtitle",
          unit: "word",
          direction: "forward",
          staggerMs: 20,
          property: "opacity",
          durationMs: 250,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };
    const combined = motionTextDocumentWithNativeStyles(authored, [style]);

    expect(combined?.animations).toHaveLength(2);
    expect(motionTextDocumentWithoutNativeStyles(combined, [style])).toEqual(
      authored,
    );
    const css = compileMotionCode({
      id: "timeline",
      designId: "design",
      sourceRef: null,
      filePath: null,
      tracks: [],
      durationMs: 1000,
      defaultEase: "ease",
      compiledHash: null,
      nativeStyles: [style],
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    }).css;
    const metadata = decodeMotionCodeMetadata(css);
    expect(metadata.status).toBe("valid");
    if (metadata.status === "valid") {
      expect(metadata.document.nativeStyles).toEqual([style]);
      expect(metadata.document.tracks).toEqual([]);
    }
  });

  it.each([
    ["CENTER_OUT", "textDelayOrder"],
    ["OUTSIDE_IN", "textDelayOrder"],
  ])("reports unsupported TextStagger order %s explicitly", (order, prop) => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const style = {
      ...base,
      props: { ...base.props, textDelayOrder: order },
    };
    expectRuntimeError(
      () => motionNativeStylesToTextAnimations([style]),
      "unsupported-style",
    );
    try {
      motionNativeStylesToTextAnimations([style]);
    } catch (error) {
      expect(error).toMatchObject({ message: expect.stringContaining(prop) });
    }
  });

  it.each([
    ["clipContent", true],
    ["elementTransformOriginMode", "CUSTOM"],
    ["futureTextProperty", "preserve-me"],
  ])("reports unsupported TextStagger prop %s explicitly", (key, value) => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const style = {
      ...base,
      props: { ...base.props, [key]: value },
    };
    let error: unknown;
    try {
      motionNativeStylesToTextAnimations([style]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MotionNativeStyleRuntimeError);
    expect(error).toMatchObject({
      code: "unsupported-style",
      message: expect.stringContaining(key),
    });
  });

  it("creates the same default Position instance shape as Figma", () => {
    expect(
      createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "hero",
      }),
    ).toEqual({
      type: "FIGMA",
      styleKey: "Position",
      nameKey: "motion.preset_name.position",
      duration: 1,
      timelineOffset: 0,
      targetNodeId: "hero",
      enabled: true,
      props: {
        type: "slide_in",
        direction: "left",
        distance: 200,
        axis: "xy",
        startX: 200,
        startY: 200,
        endX: 0,
        endY: 0,
        delay: 0,
        easing: { type: "EASE_OUT" },
      },
    });
  });

  it("switches style keys while preserving shared timing and unknown source props", () => {
    const position = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "hero",
    });
    const source = {
      ...position,
      sourceStyleId: "source-style",
      sourceInstanceId: "source-instance",
      duration: 0.901,
      timelineOffset: 0.2,
      enabled: false,
      props: {
        ...position.props,
        delay: 0.1,
        easing: { type: "EASE_OUT", customCurve: [0.2, 0.8] },
        futureProperty: { keep: true },
      },
    };

    expect(switchMotionNativeStyleKey(source, "Scale")).toEqual({
      ...createMotionNativeStyleInstance({
        styleKey: "Scale",
        targetNodeId: "hero",
      }),
      sourceStyleId: "source-style",
      sourceInstanceId: "source-instance",
      duration: 0.901,
      timelineOffset: 0.2,
      enabled: false,
      props: {
        ...createMotionNativeStyleInstance({
          styleKey: "Scale",
          targetNodeId: "hero",
        }).props,
        delay: 0.1,
        easing: { type: "EASE_OUT", customCurve: [0.2, 0.8] },
        futureProperty: { keep: true },
      },
    });
  });

  it("lowers Position to the same offset, direction, and timing in CSS tracks", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "hero",
    });
    expect(motionNativeStylesToTracks([style])).toEqual([
      {
        targetNodeId: "hero",
        property: "translate",
        keyframes: [
          { t: 0, value: "-200px 0px", ease: "ease-out" },
          { t: 1, value: "0px 0px" },
        ],
        delayMs: 0,
        durationMs: 1000,
      },
    ]);
  });

  it("round-trips edited native Position paths through source metadata", () => {
    const sourceStyle = {
      ...createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "hero",
      }),
      sourceStyleId: "figma-position-style",
      sourceInstanceId: "figma-position-instance",
      duration: 0.75,
      timelineOffset: 0.25,
      props: {
        ...createMotionNativeStyleInstance({
          styleKey: "Position",
          targetNodeId: "hero",
        }).props,
        futureProperty: { keep: true },
      },
    };
    const sourceTrack = motionNativeStylesToTracks([sourceStyle])[0]!;
    const motionPath: MotionPathSegmentV1 = {
      version: 1,
      type: "cubic",
      control1: { x: 0, y: 40 },
      control2: { x: 30, y: -10 },
    };
    const editedTrack = {
      ...sourceTrack,
      keyframes: [
        { ...sourceTrack.keyframes[0]!, value: "30px 40px", motionPath },
        { ...sourceTrack.keyframes[1]!, value: "15px -5px" },
      ],
    };
    const editedStyle = motionNativeStyleWithPositionTrack(
      sourceStyle,
      editedTrack,
    );
    const compiled = compileMotionCode({
      id: "timeline",
      designId: "design",
      sourceRef: null,
      filePath: null,
      tracks: [],
      nativeStyles: [editedStyle],
      durationMs: 1000,
      defaultEase: "ease",
      compiledHash: null,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    });
    const metadata = decodeMotionCodeMetadata(compiled.css);

    expect(metadata.status).toBe("valid");
    if (metadata.status !== "valid") return;
    const [restoredStyle] = metadata.document.nativeStyles ?? [];

    expect(restoredStyle).toEqual(editedStyle);
    expect(restoredStyle?.props).toMatchObject({
      type: "custom",
      axis: "xy",
      startX: 30,
      startY: 40,
      endX: 15,
      endY: -5,
      motionPath,
      futureProperty: { keep: true },
    });
    expect(restoredStyle).toMatchObject({
      sourceStyleId: "figma-position-style",
      sourceInstanceId: "figma-position-instance",
      duration: 0.75,
      timelineOffset: 0.25,
    });
    expect(metadata.document.tracks).toEqual([]);
    expect(motionNativeStylesToTracks([restoredStyle!])[0]).toEqual(
      editedTrack,
    );
    expect(compiled.css).toContain("offset-path: path(");
  });

  it("keeps hidden native styles in source but omits them from runtime tracks", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "hero",
    });
    expect(motionNativeStylesToTracks([{ ...style, enabled: false }])).toEqual(
      [],
    );
  });

  it("lowers Scale, Rotation, Opacity, and Size preset defaults", () => {
    expect(
      motionNativeStylesToTracks(
        (["Scale", "Rotation", "Opacity", "Size"] as const).map((styleKey) =>
          createMotionNativeStyleInstance({ styleKey, targetNodeId: "hero" }),
        ),
      ),
    ).toEqual([
      {
        targetNodeId: "hero",
        property: "scale",
        keyframes: [
          { t: 0, value: "1.2 1.2", ease: "ease-out" },
          { t: 1, value: "1 1" },
        ],
        delayMs: 0,
        durationMs: 1000,
      },
      {
        targetNodeId: "hero",
        property: "rotate",
        keyframes: [
          { t: 0, value: "-180deg", ease: "ease-out" },
          { t: 1, value: "0deg" },
        ],
        delayMs: 0,
        durationMs: 1000,
      },
      {
        targetNodeId: "hero",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1" },
        ],
        delayMs: 0,
        durationMs: 1000,
      },
      {
        targetNodeId: "hero",
        property: "width",
        keyframes: [
          { t: 0, value: "calc(100% + 0px)", ease: "ease-out" },
          { t: 1, value: "calc(100% + -50px)" },
        ],
        delayMs: 0,
        durationMs: 1000,
      },
      {
        targetNodeId: "hero",
        property: "height",
        keyframes: [
          { t: 0, value: "calc(100% + 0px)", ease: "ease-out" },
          { t: 1, value: "calc(100% + -50px)" },
        ],
        delayMs: 0,
        durationMs: 1000,
      },
    ]);
  });

  it("includes style offset and delay in the generated timeline end", () => {
    const style = {
      ...createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "hero",
      }),
      duration: 0.901,
      timelineOffset: 0.2,
      props: {
        ...createMotionNativeStyleInstance({
          styleKey: "Position",
          targetNodeId: "hero",
        }).props,
        delay: 0.1,
      },
    };
    expect(motionNativeStyleEndTimeMs(style)).toBe(1201);
  });

  it.each(["cubic-bezier(0.2, 0, 0.8, 1)", "steps(4, end)"])(
    "preserves and compiles CSS easing token %s",
    (easing) => {
      const style = withEasing(
        createMotionNativeStyleInstance({
          styleKey: "Position",
          targetNodeId: "hero",
        }),
        easing,
      );
      const [track] = motionNativeStylesToTracks([style]);

      expect(track?.keyframes[0]?.ease).toBe(easing);
      expect(compileTracks([track!])).toContain(
        `animation-timing-function: ${easing};`,
      );
    },
  );

  it("preserves spring tokens in runtime tracks and compiles them to CSS linear()", () => {
    const spring = "spring(0.69, 0.8)";
    const style = withEasing(
      createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "hero",
      }),
      spring,
    );
    const [track] = motionNativeStylesToTracks([style]);

    expect(track?.keyframes[0]?.ease).toBe(spring);
    const css = compileTracks([track!]);
    expect(css).toContain("animation-timing-function: linear(");
    expect(css).not.toContain("spring(");
  });

  it("preserves a source-backed easing variable reference on native tracks", () => {
    const reference = "var(--an-motion-ease-motion-out)";
    const style = withEasing(
      createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "hero",
      }),
      reference,
    );

    expect(motionNativeStylesToTracks([style])[0]?.keyframes[0]?.ease).toBe(
      reference,
    );
  });

  it.each([
    "cubic-bezier(2, 0, 0.8, 1)",
    "spring(1.01)",
    "spring(0.5, 0.01)",
    "spring(oops)",
  ])("rejects invalid native easing value %s", (easing) => {
    const style = withEasing(
      createMotionNativeStyleInstance({
        styleKey: "Position",
        targetNodeId: "hero",
      }),
      easing,
    );

    expectRuntimeError(
      () => motionNativeStylesToTracks([style]),
      "invalid-style-props",
    );
  });
});
