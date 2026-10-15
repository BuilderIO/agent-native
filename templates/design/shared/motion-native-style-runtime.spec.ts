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
  motionNativeStyleWithTextAnimationSettings,
  motionNativeTextAnimationSettings,
  motionNativeStylesToTracks,
  motionNativeStylesToTextAnimations,
  motionTextDocumentWithNativeStyles,
  motionTextDocumentWithNativeStyleSettings,
  motionTextDocumentWithoutNativeStyles,
  switchMotionNativeStyleKey,
} from "./motion-native-style-runtime";
import { decodeMotionTextDocument } from "./motion-text-code";
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
    expect(motionNativeStylesToTextAnimations([style])).toMatchObject([
      {
        targetNodeId: "hero",
        unit: "character",
        direction: "forward",
        staggerMs: 250,
        animationDirection: "in",
        order: "left-to-right",
        overlapPercent: 50,
        ignoreSpaces: false,
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

  it("keeps legacy TextStagger styles from counting whitespace as units", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const legacyStyle = {
      ...style,
      props: Object.fromEntries(
        Object.entries(style.props).filter(
          ([key]) => key !== "ignoreSpaces" && key !== "textDelayTimingMode",
        ),
      ),
    };

    expect(style.props.ignoreSpaces).toBe(false);
    expect(motionNativeStylesToTextAnimations([legacyStyle])).toMatchObject([
      { ignoreSpaces: true, staggerMs: 250, durationMs: 500 },
    ]);
    expect(
      motionNativeStylesToTextAnimations([legacyStyle])[0],
    ).not.toHaveProperty("overlapPercent");

    for (const ignoreSpaces of [false, true]) {
      const editedLegacyStyle = {
        ...legacyStyle,
        props: {
          ...legacyStyle.props,
          ignoreSpaces,
          textDelayTimingMode: "fixed-stagger",
        },
      };
      expect(
        motionNativeStylesToTextAnimations([editedLegacyStyle])[0],
      ).toMatchObject({
        ignoreSpaces,
        staggerMs: 250,
        durationMs: 500,
      });
      expect(
        motionNativeStylesToTextAnimations([editedLegacyStyle])[0],
      ).not.toHaveProperty("overlapPercent");
    }
  });

  it("uses duration-fitted TextStagger timing only when explicitly selected", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const fixedStyle = {
      ...style,
      props: {
        ...style.props,
        textDelayTimingMode: "fixed-stagger",
        ignoreSpaces: true,
      },
    };

    expect(motionNativeStylesToTextAnimations([fixedStyle])[0]).toMatchObject({
      ignoreSpaces: true,
      staggerMs: 250,
      durationMs: 500,
    });
    expect(
      motionNativeStylesToTextAnimations([fixedStyle])[0],
    ).not.toHaveProperty("overlapPercent");
  });

  it("preserves the previous overlap encoding for marker-less TextStagger styles", () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const { textDelayTimingMode: _timingMode, ...markerlessProps } = base.props;
    const style = {
      ...base,
      props: {
        ...markerlessProps,
        ignoreSpaces: false,
      },
    };

    expect(motionNativeStylesToTextAnimations([style])[0]).toMatchObject({
      ignoreSpaces: false,
      staggerMs: 250,
      durationMs: 500,
      overlapPercent: 50,
    });
  });

  it("fails explicitly for an unknown TextStagger timing mode", () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const style = {
      ...base,
      props: { ...base.props, textDelayTimingMode: "springy" },
    };

    expectRuntimeError(
      () => motionNativeStylesToTextAnimations([style]),
      "invalid-style-props",
    );
  });

  it("removes a normalized v1 TextStagger projection from authored text tracks", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const legacyStyle = {
      ...style,
      props: Object.fromEntries(
        Object.entries(style.props).filter(
          ([key]) => key !== "ignoreSpaces" && key !== "textDelayTimingMode",
        ),
      ),
    };
    const legacyDocument = decodeMotionTextDocument(
      JSON.stringify({
        version: 1,
        animations: [
          {
            targetNodeId: "hero",
            unit: "character",
            direction: "forward",
            staggerMs: 250,
            property: "translate",
            durationMs: 500,
            keyframes: [
              { t: 0, value: "0px -40px", ease: "ease-out" },
              { t: 1, value: "0px 0px" },
            ],
          },
        ],
      }),
    );

    expect(legacyDocument.status).toBe("valid");
    if (legacyDocument.status !== "valid") return;
    expect(
      motionTextDocumentWithoutNativeStyles(legacyDocument.document, [
        legacyStyle,
      ]),
    ).toBeNull();
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

    expect(motionNativeStylesToTextAnimations([style])).toMatchObject([
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        animationDirection: "out",
        order: "right-to-left",
        overlapPercent: 20,
        ignoreSpaces: true,
        delayMs: 325,
        property: "filter",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "blur(20px)", ease: "ease-out" },
          { t: 1, value: "blur(0px)" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        animationDirection: "out",
        order: "right-to-left",
        overlapPercent: 20,
        ignoreSpaces: true,
        delayMs: 325,
        property: "translate",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "-40px 0px", ease: "ease-out" },
          { t: 1, value: "0px 0px" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        animationDirection: "out",
        order: "right-to-left",
        overlapPercent: 20,
        ignoreSpaces: true,
        delayMs: 325,
        property: "rotate",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "-180deg", ease: "ease-out" },
          { t: 1, value: "0deg" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        animationDirection: "out",
        order: "right-to-left",
        overlapPercent: 20,
        ignoreSpaces: true,
        delayMs: 325,
        property: "scale",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "1.2", ease: "ease-out" },
          { t: 1, value: "1" },
        ],
      },
      {
        targetNodeId: "hero",
        unit: "word",
        direction: "reverse",
        staggerMs: 400,
        animationDirection: "out",
        order: "right-to-left",
        overlapPercent: 20,
        ignoreSpaces: true,
        delayMs: 325,
        property: "opacity",
        durationMs: 500,
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1" },
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
    expect(
      motionTextDocumentWithoutNativeStyles(combined, [style]),
    ).toMatchObject({ version: 2, animations: authored.animations });
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

  it("rejects a native text preset when same-target authored timing differs", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const authored: MotionTextDocument = {
      version: 1,
      animations: [
        {
          targetNodeId: "hero",
          unit: "character",
          direction: "forward",
          staggerMs: 30,
          property: "opacity",
          durationMs: 250,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };

    expect(() => motionTextDocumentWithNativeStyles(authored, [style])).toThrow(
      "The native Text animation cannot be combined with authored text animations on this element because their grouping or timing settings differ.",
    );
  });

  it("seeds native TextStagger from authored text settings and keeps its effect settings", () => {
    const authored: MotionTextDocument["animations"][number] = {
      targetNodeId: "hero",
      unit: "word",
      direction: "forward",
      staggerMs: 30,
      animationDirection: "out",
      order: "center-out",
      ignoreSpaces: false,
      property: "opacity",
      durationMs: 250,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1" },
      ],
    };
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    base.props.opacityEnabled = true;
    const style = motionNativeStyleWithTextAnimationSettings(base, authored);

    expect(style.props).toMatchObject({
      textDelayGrouping: "WORD",
      textDelayOrder: "CENTER_OUT",
      animationDirection: "out",
      ignoreSpaces: true,
      textDelayTimingMode: "fixed-stagger",
      opacityEnabled: true,
    });
    expect(motionNativeTextAnimationSettings(style)).toMatchObject({
      unit: "word",
      direction: "forward",
      staggerMs: 30,
      animationDirection: "out",
      order: "center-out",
      ignoreSpaces: true,
    });
    const syncedDocument = motionTextDocumentWithNativeStyleSettings(
      { version: 2, animations: [authored] },
      style,
    );
    expect(
      motionTextDocumentWithNativeStyles(syncedDocument, [style])?.animations,
    ).toHaveLength(2);
  });

  it("reads the shared TextStagger profile when all effects are disabled", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    style.props = {
      ...style.props,
      positionEnabled: false,
      rotationEnabled: false,
      scaleEnabled: false,
      opacityEnabled: false,
      blurEnabled: false,
      textDelayGrouping: "PARAGRAPH",
      textDelayOrder: "RIGHT_LEFT",
    };

    expect(motionNativeTextAnimationSettings(style)).toMatchObject({
      unit: "paragraph",
      direction: "reverse",
      order: "right-to-left",
      staggerMs: 250,
      overlapPercent: 50,
    });
  });

  it("preserves fractional fixed stagger values when projecting to TextStagger", () => {
    const authored: MotionTextDocument["animations"][number] = {
      targetNodeId: "hero",
      unit: "character",
      direction: "forward",
      staggerMs: 12.5,
      property: "opacity",
      durationMs: 250,
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    };
    const style = motionNativeStyleWithTextAnimationSettings(
      createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "hero",
      }),
      authored,
    );

    expect(style.props.presetStaggerOverlap).toBe(95);
    expect(motionNativeTextAnimationSettings(style).staggerMs).toBe(12.5);

    style.duration = 0.01;
    const shortDurationStyle = motionNativeStyleWithTextAnimationSettings(
      style,
      { ...authored, durationMs: 1 },
    );
    expect(shortDurationStyle.duration).toBe(0.013);
    expect(
      motionNativeTextAnimationSettings(shortDurationStyle).staggerMs,
    ).toBeCloseTo(12.5);

    const filterAnimation = { ...authored, property: "filter" as const };
    const filterBase = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    filterBase.props.blurEnabled = true;
    const filterStyle = motionNativeStyleWithTextAnimationSettings(
      filterBase,
      filterAnimation,
    );
    expect(filterStyle.props.blurEnabled).toBe(true);
  });

  it("syncs native shared text settings without changing authored property timing", () => {
    const document: MotionTextDocument = {
      version: 2,
      animations: [
        {
          targetNodeId: "hero",
          unit: "character",
          direction: "forward",
          staggerMs: 20,
          delayMs: 100,
          property: "opacity",
          durationMs: 220,
          keyframes: [
            { t: 0, value: "0", ease: "ease-in" },
            { t: 1, value: "1" },
          ],
        },
        {
          targetNodeId: "hero",
          unit: "character",
          direction: "forward",
          staggerMs: 20,
          delayMs: 240,
          property: "translate",
          durationMs: 370,
          keyframes: [
            { t: 0, value: "0px 20px" },
            { t: 1, value: "0px 0px" },
          ],
        },
      ],
    };
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    style.props = {
      ...style.props,
      positionEnabled: false,
      textDelayGrouping: "WORD",
      textDelayOrder: "RIGHT_LEFT",
      animationDirection: "out",
      ignoreSpaces: false,
      textDelayTimingMode: "fixed-stagger",
      presetStaggerOverlap: 94,
    };

    const next = motionTextDocumentWithNativeStyleSettings(document, style);

    expect(next?.animations).toEqual([
      {
        ...document.animations[0],
        unit: "word",
        direction: "reverse",
        staggerMs: 30,
        animationDirection: "out",
        order: "right-to-left",
        ignoreSpaces: true,
      },
      {
        ...document.animations[1],
        unit: "word",
        direction: "reverse",
        staggerMs: 30,
        animationDirection: "out",
        order: "right-to-left",
        ignoreSpaces: true,
      },
    ]);
    expect(next?.animations[0]?.delayMs).toBe(100);
    expect(next?.animations[0]?.durationMs).toBe(220);
    expect(next?.animations[0]?.keyframes[0]?.ease).toBe("ease-in");
    expect(next?.animations[1]?.delayMs).toBe(240);
    expect(next?.animations[1]?.durationMs).toBe(370);
  });

  it("seeds native timing from code and writes representable native timing edits back", () => {
    const authored: MotionTextDocument["animations"][number] = {
      targetNodeId: "hero",
      unit: "character",
      direction: "forward",
      staggerMs: 40,
      delayMs: 125,
      property: "opacity",
      durationMs: 360,
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    };
    const document: MotionTextDocument = { version: 2, animations: [authored] };
    const style = motionNativeStyleWithTextAnimationSettings(
      createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "hero",
      }),
      authored,
    );

    expect(style.duration).toBe(0.36);
    expect(style.timelineOffset).toBe(0);
    expect(style.props.delay).toBe(0.125);

    const edited = {
      ...style,
      duration: 0.8,
      timelineOffset: 0.2,
      props: { ...style.props, delay: 0.1 },
    };
    const synced = motionTextDocumentWithNativeStyleSettings(
      document,
      edited,
      style,
    );
    expect(synced?.animations).toHaveLength(1);
    expect(synced?.animations[0]).toMatchObject({
      delayMs: 300,
      durationMs: 800,
    });
    expect(synced?.animations[0]?.staggerMs).toBeCloseTo(88.8888889);
  });

  it.each([
    ["grouping", { unit: "word" as const }],
    ["direction", { direction: "reverse" as const }],
    ["animation direction", { animationDirection: "out" as const }],
    ["order", { order: "center-out" as const }],
    ["space handling", { ignoreSpaces: false }],
    ["fixed stagger", { staggerMs: 21 }],
    ["timing mode", { overlapPercent: 50 }],
    ["duration-fitted overlap", { overlapPercent: 45 }],
  ])(
    "refuses native TextStagger creation when authored tracks disagree on %s",
    (_label, mismatch) => {
      const first: MotionTextDocument["animations"][number] = {
        targetNodeId: "hero",
        unit: "character",
        direction: "forward",
        staggerMs: 20,
        animationDirection: "in",
        order: "left-to-right",
        ignoreSpaces: true,
        property: "opacity",
        durationMs: 220,
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      };
      const second: MotionTextDocument["animations"][number] = {
        ...first,
        ...mismatch,
        property: "translate",
        keyframes: [
          { t: 0, value: "0px 20px" },
          { t: 1, value: "0px 0px" },
        ],
      };
      const document: MotionTextDocument = {
        version: 2,
        animations: [first, second],
      };
      const seeded = motionNativeStyleWithTextAnimationSettings(
        createMotionNativeStyleInstance({
          styleKey: "TextStagger",
          targetNodeId: "hero",
        }),
        first,
      );

      expect(() =>
        motionTextDocumentWithNativeStyleSettings(document, seeded),
      ).toThrow(
        "Text animations with different shared settings cannot be represented by one TextStagger style.",
      );
      expect(document.animations).toEqual([first, second]);
    },
  );

  it("keeps divergent authored text profiles intact when a native effect-only setting changes", () => {
    const first: MotionTextDocument["animations"][number] = {
      targetNodeId: "hero",
      unit: "character",
      direction: "forward",
      staggerMs: 20,
      overlapPercent: 50,
      property: "opacity",
      durationMs: 220,
      keyframes: [
        { t: 0, value: "0" },
        { t: 1, value: "1" },
      ],
    };
    const second: MotionTextDocument["animations"][number] = {
      ...first,
      overlapPercent: 35,
      property: "translate",
      keyframes: [
        { t: 0, value: "0px 20px" },
        { t: 1, value: "0px 0px" },
      ],
    };
    const document: MotionTextDocument = {
      version: 2,
      animations: [first, second],
    };
    const previousStyle = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const nextStyle = {
      ...previousStyle,
      props: { ...previousStyle.props, opacityEnabled: true },
    };

    expect(
      motionTextDocumentWithNativeStyleSettings(
        document,
        nextStyle,
        previousStyle,
      ),
    ).toBe(document);
    expect(
      document.animations.map(({ overlapPercent }) => overlapPercent),
    ).toEqual([50, 35]);
  });

  it.each(["delay", "duration"] as const)(
    "rejects a shared native %s edit when authored tracks have different timing",
    (field) => {
      const document: MotionTextDocument = {
        version: 2,
        animations: [
          {
            targetNodeId: "hero",
            unit: "character",
            direction: "forward",
            staggerMs: 40,
            delayMs: 100,
            property: "opacity",
            durationMs: 360,
            keyframes: [
              { t: 0, value: "0" },
              { t: 1, value: "1" },
            ],
          },
          {
            targetNodeId: "hero",
            unit: "character",
            direction: "forward",
            staggerMs: 40,
            delayMs: 200,
            property: "translate",
            durationMs: 500,
            keyframes: [
              { t: 0, value: "0px 20px" },
              { t: 1, value: "0px 0px" },
            ],
          },
        ],
      };
      const previous = createMotionNativeStyleInstance({
        styleKey: "TextStagger",
        targetNodeId: "hero",
      });
      const next =
        field === "delay"
          ? {
              ...previous,
              props: { ...previous.props, delay: 0.05 },
            }
          : { ...previous, duration: 0.75 };

      expectRuntimeError(
        () =>
          motionTextDocumentWithNativeStyleSettings(document, next, previous),
        "unsupported-style",
      );
    },
  );

  it("combines same-target authored and native text tracks with matching settings", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const nativeTrack = motionNativeStylesToTextAnimations([style])[0]!;
    const authored: MotionTextDocument = {
      version: 2,
      animations: [
        {
          ...nativeTrack,
          property: "opacity",
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };

    expect(
      motionTextDocumentWithNativeStyles(authored, [style])?.animations,
    ).toHaveLength(2);
  });

  it("keeps an authored property authoritative and lets native effects resume when it is removed", () => {
    const style = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    style.props.opacityEnabled = true;
    const authored: MotionTextDocument = {
      version: 2,
      animations: [
        {
          ...motionNativeStylesToTextAnimations([style])[1]!,
          property: "opacity",
          keyframes: [
            { t: 0, value: "0.2", ease: "linear" },
            { t: 1, value: "0.9" },
          ],
        },
      ],
    };

    expect(
      motionTextDocumentWithNativeStyles(authored, [style])?.animations.map(
        ({ property }) => property,
      ),
    ).toEqual(["opacity", "translate"]);
    expect(
      motionTextDocumentWithNativeStyles(null, [style])?.animations.map(
        ({ property }) => property,
      ),
    ).toEqual(["translate", "opacity"]);
    expect(style.props.opacityEnabled).toBe(true);
  });

  it("keeps center-out and random order in the editable text source", () => {
    const base = createMotionNativeStyleInstance({
      styleKey: "TextStagger",
      targetNodeId: "hero",
    });
    const center = motionNativeStylesToTextAnimations([
      { ...base, props: { ...base.props, textDelayOrder: "CENTER_OUT" } },
    ]);
    const random = motionNativeStylesToTextAnimations([
      { ...base, props: { ...base.props, textDelayOrder: "RANDOM" } },
    ]);

    expect(center[0]?.order).toBe("center-out");
    expect(random[0]?.order).toBe("random");
  });

  it.each([["OUTSIDE_IN", "textDelayOrder"]])(
    "reports unsupported TextStagger order %s explicitly",
    (order, prop) => {
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
    },
  );

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

  it("creates the default Position instance shape", () => {
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
