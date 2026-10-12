import { describe, expect, it } from "vitest";

import { compileMotionCode, decodeMotionCodeMetadata } from "./motion-code";
import { compile } from "./motion-compiler";
import type { MotionNativeStyleInstance } from "./motion-native-style";
import {
  MotionNativeStyleRuntimeError,
  createMotionNativeStyleInstance,
  motionNativeStyleEndTimeMs,
  motionNativeStyleWithPositionTrack,
  motionNativeStylesToTracks,
  switchMotionNativeStyleKey,
} from "./motion-native-style-runtime";
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
      duration: 0.5,
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
        durationMs: 500,
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
        durationMs: 500,
      },
      {
        targetNodeId: "hero",
        property: "rotate",
        keyframes: [
          { t: 0, value: "-180deg", ease: "ease-out" },
          { t: 1, value: "0deg" },
        ],
        delayMs: 0,
        durationMs: 500,
      },
      {
        targetNodeId: "hero",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1" },
        ],
        delayMs: 0,
        durationMs: 500,
      },
      {
        targetNodeId: "hero",
        property: "width",
        keyframes: [
          { t: 0, value: "calc(100% + 0px)", ease: "ease-out" },
          { t: 1, value: "calc(100% + -50px)" },
        ],
        delayMs: 0,
        durationMs: 500,
      },
      {
        targetNodeId: "hero",
        property: "height",
        keyframes: [
          { t: 0, value: "calc(100% + 0px)", ease: "ease-out" },
          { t: 1, value: "calc(100% + -50px)" },
        ],
        delayMs: 0,
        durationMs: 500,
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
