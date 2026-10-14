import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  MOTION_SOURCE_MARKER_NAME,
  compileMotionCode,
  decodeMotionCodeMetadata,
  encodeMotionCodeMetadata,
  motionCodeDocumentFromTimeline,
  withMotionCodeMetadata,
} from "./motion-code";
import { motionEaseVariableToken } from "./motion-easing";
import { createMotionNativeStyleInstance } from "./motion-native-style-runtime";
import type { MotionTimeline } from "./motion-timeline";

const timeline: MotionTimeline = {
  id: "timeline-01",
  designId: "design-01",
  sourceRef: "src/App.tsx",
  filePath: null,
  tracks: [
    {
      targetNodeId: 'hero*/\\"雪',
      property: "transform",
      keyframes: [
        { t: 0, value: "translateX(0px)", ease: "cubic-bezier(0.2, 0, 0, 1)" },
        { t: 0.35, value: "translateX(22px)", ease: "spring(0.25)" },
        { t: 1, value: "translateX(0px)" },
      ],
      delayMs: 12,
      durationMs: 740,
      timelinePlaybackMode: "ping-pong",
    },
  ],
  durationMs: 920,
  playbackMode: "ping-pong",
  defaultEase: "steps(3, end)",
  compiledHash: "hash-a",
  createdAt: "2026-10-10T12:00:00.000Z",
  updatedAt: "2026-10-10T12:01:00.000Z",
};

const audioClips = [
  {
    id: "audio-clip-01",
    name: "demo.mp3",
    sourceUrl: "/_agent-native/file-upload/audio/demo.mp3",
    timelineStartMs: 800,
    sourceTrimStartMs: 1250.5,
    durationMs: 300,
    volume: 0.75,
    muted: false,
  },
];

describe("Motion source document CSS codec", () => {
  it("compiles a portable document beside runnable managed CSS", () => {
    const compiled = compileMotionCode(timeline);
    const result = decodeMotionCodeMetadata(compiled.css);

    expect(result).toEqual({
      status: "valid",
      document: motionCodeDocumentFromTimeline(timeline),
    });
    expect(compiled.css).toContain("@keyframes an-motion-");
  });

  it("keeps disabled tracks in source metadata while omitting them from CSS", () => {
    const disabledTimeline = {
      ...timeline,
      tracks: [{ ...timeline.tracks[0]!, enabled: false }],
    };
    const compiled = compileMotionCode(disabledTimeline);
    const result = decodeMotionCodeMetadata(compiled.css);

    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.document.tracks[0]?.enabled).toBe(false);
    }
    expect(compiled.css).not.toContain("@keyframes an-motion-");
    expect(compiled.css).toContain("/* no animations */");
  });

  it("stores a text-only timeline with an empty CSS track list", () => {
    const textOnlyTimeline = { ...timeline, tracks: [] };
    const compiled = compileMotionCode(textOnlyTimeline);

    expect(decodeMotionCodeMetadata(compiled.css)).toEqual({
      status: "valid",
      document: {
        version: 3,
        durationMs: timeline.durationMs,
        defaultEase: timeline.defaultEase,
        playbackMode: timeline.playbackMode,
        tracks: [],
      },
    });
    expect(compiled.css).toContain("/* no animations */");
  });

  it("round-trips the versioned authoring timeline losslessly", () => {
    const document = motionCodeDocumentFromTimeline(timeline);
    const marker = encodeMotionCodeMetadata(document);
    const result = decodeMotionCodeMetadata(marker);

    expect(document).not.toHaveProperty("animationStyles");
    expect(result).toEqual({
      status: "valid",
      document,
    });
  });

  it("round-trips reusable animation styles in version 2 metadata", () => {
    const animationStyles = [
      {
        id: "enter.fade-up",
        name: "Fade up",
        category: "enter" as const,
        description: "Reveal while moving into place.",
        tracks: [
          {
            property: "opacity",
            keyframes: [
              { t: 0, value: "0", ease: "ease-out" },
              { t: 1, value: "1" },
            ],
            delayMs: 40,
            durationMs: 420,
          },
          {
            property: "translate",
            keyframes: [
              { t: 0, value: "0px 12px" },
              { t: 1, value: "0px 0px" },
            ],
            durationMs: 420,
          },
        ],
      },
    ];
    const document = motionCodeDocumentFromTimeline({
      ...timeline,
      animationStyles,
    });
    const marker = encodeMotionCodeMetadata(document);

    expect(decodeMotionCodeMetadata(marker)).toEqual({
      status: "valid",
      document,
    });
  });

  it("round-trips named easing variables and compiles their references", () => {
    const easingVariables = [
      {
        id: "ease-out",
        name: "Ease out",
        value: "spring(0.3, 0.8)",
        collection: "Motion",
      },
    ];
    const ease = motionEaseVariableToken("ease-out");
    const variableTimeline: MotionTimeline = {
      ...timeline,
      defaultEase: ease,
      tracks: [
        {
          ...timeline.tracks[0]!,
          keyframes: [
            { t: 0, value: "translateX(0px)", ease },
            { t: 1, value: "translateX(22px)" },
          ],
        },
      ],
    };
    const compiled = compileMotionCode(variableTimeline, { easingVariables });
    const result = decodeMotionCodeMetadata(compiled.css);

    expect(compiled.css).toMatch(
      /:root\s*\{\s*--an-motion-ease-ease-out:\s*linear\(/,
    );
    expect(compiled.css).toContain(`animation-timing-function: ${ease};`);
    expect(result).toEqual({
      status: "valid",
      document: motionCodeDocumentFromTimeline(variableTimeline, {
        easingVariables,
      }),
    });
    expect(compiled.css).toContain(
      encodeMotionCodeMetadata(
        motionCodeDocumentFromTimeline(variableTimeline, { easingVariables }),
      ),
    );
  });

  it("preserves an explicit empty variable list as a metadata clear", () => {
    const document = motionCodeDocumentFromTimeline(timeline, {
      easingVariables: [],
    });
    expect(document.easingVariables).toEqual([]);
    expect(
      decodeMotionCodeMetadata(encodeMotionCodeMetadata(document)),
    ).toEqual({ status: "valid", document });
  });

  it("round-trips versioned audio clip metadata without embedding file bytes", () => {
    const document = motionCodeDocumentFromTimeline(timeline, { audioClips });
    const marker = encodeMotionCodeMetadata(document);

    expect(document.version).toBe(3);
    expect(document.durationMs).toBe(1100);
    expect(document.audioClips).toEqual(audioClips);
    expect(marker).not.toContain("ID3");
    expect(decodeMotionCodeMetadata(marker)).toEqual({
      status: "valid",
      document,
    });
  });

  it("keeps older audio clip metadata valid when the optional name is absent", () => {
    const { name: _name, ...legacyClip } = audioClips[0];
    const document = motionCodeDocumentFromTimeline(timeline, {
      audioClips: [legacyClip],
    });

    expect(
      decodeMotionCodeMetadata(encodeMotionCodeMetadata(document)),
    ).toEqual({ status: "valid", document });
  });

  it("rejects malformed audio clip fields on both write and read", () => {
    const document = motionCodeDocumentFromTimeline(timeline, { audioClips });
    const invalidClips = [
      [{ ...audioClips[0], sourceUrl: "data:audio/mpeg;base64,AAAA" }],
      [{ ...audioClips[0], sourceUrl: "javascript:alert(1)" }],
      [{ ...audioClips[0], timelineStartMs: -1 }],
      [{ ...audioClips[0], sourceTrimStartMs: Number.NaN }],
      [{ ...audioClips[0], durationMs: 0 }],
      [{ ...audioClips[0], volume: 1.01 }],
      [{ ...audioClips[0], muted: "false" }],
      [{ ...audioClips[0], name: "x".repeat(241) }],
      [{ ...audioClips[0], extra: "unexpected" }],
      [audioClips[0], { ...audioClips[0] }],
    ];

    for (const clips of invalidClips) {
      expect(() =>
        encodeMotionCodeMetadata({
          ...document,
          audioClips: clips as never,
        }),
      ).toThrow(/Invalid Motion code metadata/);
    }

    const malformedDocument = {
      ...document,
      audioClips: [{ ...audioClips[0], muted: "false" }],
    };
    const payload = encodeURIComponent(
      JSON.stringify(malformedDocument),
    ).replace(/\*/g, "%2A");
    const decoded = decodeMotionCodeMetadata(
      `/* ${MOTION_SOURCE_MARKER_NAME}:v3:${payload} */`,
    );
    expect(decoded.status).toBe("invalid");
    if (decoded.status === "invalid") {
      expect(decoded.error.code).toBe("invalid-document");
      expect(decoded.error.message).toMatch(/audioClips\[0\]\.muted/);
    }
  });

  it("compiles and validates easing variable references in native style props", () => {
    const easingVariables = [
      {
        id: "motion-out",
        name: "Motion out",
        value: "cubic-bezier(0.2, 0, 0.8, 1)",
      },
    ];
    const ease = motionEaseVariableToken("motion-out");
    const nativeStyle = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "hero",
    });
    const timelineWithNativeStyle = {
      ...timeline,
      tracks: [],
      nativeStyles: [
        {
          ...nativeStyle,
          props: { ...nativeStyle.props, easing: ease },
        },
      ],
    };
    const compiled = compileMotionCode(timelineWithNativeStyle, {
      easingVariables,
    });

    expect(compiled.css).toContain(`animation-timing-function: ${ease};`);
    expect(decodeMotionCodeMetadata(compiled.css)).toMatchObject({
      status: "valid",
      document: {
        easingVariables,
        nativeStyles: timelineWithNativeStyle.nativeStyles,
      },
    });
    expect(() =>
      compileMotionCode(timelineWithNativeStyle, { easingVariables: [] }),
    ).toThrow(/not defined/);
    expect(() =>
      motionCodeDocumentFromTimeline({
        ...timelineWithNativeStyle,
        nativeStyles: [
          {
            ...nativeStyle,
            props: {
              ...nativeStyle.props,
              easing: "var( --an-motion-ease-motion-out )",
            },
          },
        ],
      }),
    ).toThrow(/not a supported motion easing value/);
  });

  it("rejects malformed reusable animation styles before encoding or after reading", () => {
    const document = motionCodeDocumentFromTimeline(timeline);
    const validStyle = {
      id: "basic.fade",
      name: "Fade",
      category: "basic",
      tracks: [
        {
          property: "opacity",
          keyframes: [
            { t: 0, value: "0" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };

    expect(() =>
      encodeMotionCodeMetadata({
        ...document,
        animationStyles: [{ ...validStyle, category: "reveal" } as never],
      }),
    ).toThrow(/category is invalid/);
    expect(() =>
      encodeMotionCodeMetadata({
        ...document,
        animationStyles: [
          {
            ...validStyle,
            tracks: [
              {
                property: "opacity",
                keyframes: [{ t: Number.NaN, value: "0" }],
              },
            ],
          },
        ] as never,
      }),
    ).toThrow(/must be a finite number/);

    const invalidDocument = {
      ...document,
      animationStyles: [
        {
          ...validStyle,
          tracks: [
            {
              property: "opacity",
              keyframes: [
                { t: 0, value: "0; color: red" },
                { t: 1, value: "1" },
              ],
            },
          ],
        },
      ],
    };
    const payload = encodeURIComponent(JSON.stringify(invalidDocument)).replace(
      /\*/g,
      "%2A",
    );
    const invalidMarker = `/* ${MOTION_SOURCE_MARKER_NAME}:v3:${payload} */`;
    const decoded = decodeMotionCodeMetadata(invalidMarker);
    expect(decoded.status).toBe("invalid");
    if (decoded.status === "invalid") {
      expect(decoded.error.code).toBe("invalid-document");
      expect(decoded.error.message).toMatch(/safe CSS token/);
    }
  });

  it("keeps versioned spatial cubic controls separate from temporal easing", () => {
    const pathTimeline: MotionTimeline = {
      ...timeline,
      tracks: [
        {
          targetNodeId: "hero-title",
          property: "translate",
          keyframes: [
            {
              t: 0,
              value: "0px 0px",
              ease: "ease-in",
              motionPath: {
                version: 1,
                type: "cubic",
                control1: { x: 14.5, y: 80 },
                control2: { x: -24, y: 12 },
              },
            },
            { t: 1, value: "160px 40px", ease: "linear" },
          ],
        },
      ],
    };

    const compiled = compileMotionCode(pathTimeline);
    const result = decodeMotionCodeMetadata(compiled.css);

    expect(result).toEqual({
      status: "valid",
      document: motionCodeDocumentFromTimeline(pathTimeline),
    });
    expect(compiled.css).toContain("offset-path: path(");
    expect(compiled.css).toContain("animation-timing-function: ease-in;");
  });

  it("round-trips native Figma style instances without projecting their props", () => {
    const nativeStyles = [
      {
        type: "FIGMA" as const,
        styleKey: "Position" as const,
        sourceStyleId: "CodeComponentId:91:218",
        sourceInstanceId: "92:648",
        nameKey: "position.slide-out",
        duration: 0.9014443159103394,
        timelineOffset: 0,
        targetNodeId: "motion-object",
        props: {
          type: "slide_out",
          direction: "right",
          distance: 500,
          axis: "xy",
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          delay: 0,
          easing: "EASE_OUT",
        },
      },
    ];
    const document = motionCodeDocumentFromTimeline({
      ...timeline,
      tracks: [],
      nativeStyles,
    });
    const compiled = compileMotionCode({
      ...timeline,
      tracks: [],
      nativeStyles,
    });

    expect(decodeMotionCodeMetadata(compiled.css)).toEqual({
      status: "valid",
      document,
    });
    expect(compiled.css).toContain("translate: 0px 0px;");
    expect(compiled.css).toContain("500px 0px");
  });

  it("upgrades valid version 1 source documents while preserving authoring data", () => {
    const legacyDocument = {
      ...motionCodeDocumentFromTimeline(timeline),
      version: 1,
    };
    const legacyJson = JSON.stringify(legacyDocument);
    const payload = encodeURIComponent(legacyJson).replace(/\*/g, "%2A");
    const marker = `/* ${MOTION_SOURCE_MARKER_NAME}:v1:${payload} */`;

    expect(decodeMotionCodeMetadata(marker)).toEqual({
      status: "valid",
      document: { ...legacyDocument, version: 3 },
    });
  });

  it("upgrades valid version 2 source documents without inventing audio clips", () => {
    const nativeStyle = createMotionNativeStyleInstance({
      styleKey: "Opacity",
      targetNodeId: "hero",
    });
    const animationStyles = [
      {
        id: "enter.fade",
        name: "Fade",
        category: "enter" as const,
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
    ];
    const legacyDocument = {
      ...motionCodeDocumentFromTimeline(
        {
          ...timeline,
          animationStyles,
          nativeStyles: [nativeStyle],
        },
        { easingVariables: [] },
      ),
      version: 2,
    };
    const payload = encodeURIComponent(JSON.stringify(legacyDocument)).replace(
      /\*/g,
      "%2A",
    );
    const decoded = decodeMotionCodeMetadata(
      `/* ${MOTION_SOURCE_MARKER_NAME}:v2:${payload} */`,
    );

    expect(decoded).toEqual({
      status: "valid",
      document: { ...legacyDocument, version: 3 },
    });
    if (decoded.status === "valid") {
      expect(decoded.document).not.toHaveProperty("audioClips");
    }
  });

  it("preserves unrelated CSS exactly when inserting and replacing metadata", () => {
    const css =
      ".card { color: rebeccapurple; }\n@media (min-width: 1px) { .x { opacity: 1 } }";
    const document = motionCodeDocumentFromTimeline(timeline);
    const first = withMotionCodeMetadata(css, document);
    const marker = encodeMotionCodeMetadata(document);

    expect(first.startsWith(`${css}\n`)).toBe(true);
    expect(decodeMotionCodeMetadata(first).status).toBe("valid");

    const updatedDocument = { ...document, durationMs: 1200 };
    const updated = withMotionCodeMetadata(first, updatedDocument);
    expect(updated).toBe(
      first.replace(marker, encodeMotionCodeMetadata(updatedDocument)),
    );
    expect(updated.replace(encodeMotionCodeMetadata(updatedDocument), "")).toBe(
      first.replace(marker, ""),
    );
  });

  it("distinguishes absent metadata from malformed and unsupported documents", () => {
    expect(decodeMotionCodeMetadata(".card { color: red; }")).toEqual({
      status: "absent",
    });

    const validMarker = encodeMotionCodeMetadata(
      motionCodeDocumentFromTimeline(timeline),
    );
    const unknownVersion = validMarker.replace(":v3:", ":v99:");
    const unknownResult = decodeMotionCodeMetadata(unknownVersion);
    expect(unknownResult.status).toBe("invalid");
    if (unknownResult.status === "invalid") {
      expect(unknownResult.error.code).toBe("unsupported-version");
    }

    const malformed = `/* ${MOTION_SOURCE_MARKER_NAME}:v1:%7B */`;
    const malformedResult = decodeMotionCodeMetadata(malformed);
    expect(malformedResult.status).toBe("invalid");
    if (malformedResult.status === "invalid") {
      expect(malformedResult.error.code).toBe("malformed-payload");
    }
  });

  it("uses a CSS-safe payload and remains parseable as ordinary CSS", () => {
    const marker = encodeMotionCodeMetadata(
      motionCodeDocumentFromTimeline(timeline),
    );

    expect(marker.match(/\*\//g)).toHaveLength(1);
    expect(marker).toContain("%2A%2F");
    expect(() =>
      postcss.parse(`.card { opacity: 1; }\n${marker}`),
    ).not.toThrow();

    const stringLiteral = `:root { --example: "/* ${MOTION_SOURCE_MARKER_NAME}:v1:ignored */"; }`;
    expect(decodeMotionCodeMetadata(stringLiteral)).toEqual({
      status: "absent",
    });
  });

  it("rejects duplicate and unclosed marker comments instead of silently overwriting them", () => {
    const document = motionCodeDocumentFromTimeline(timeline);
    const marker = encodeMotionCodeMetadata(document);
    const duplicate = `${marker}\n${marker}`;
    const duplicateResult = decodeMotionCodeMetadata(duplicate);
    expect(duplicateResult.status).toBe("invalid");
    if (duplicateResult.status === "invalid") {
      expect(duplicateResult.error.code).toBe("duplicate-marker");
    }

    const unclosed = `/* ${MOTION_SOURCE_MARKER_NAME}:v1:%7B`;
    const unclosedResult = decodeMotionCodeMetadata(unclosed);
    expect(unclosedResult.status).toBe("invalid");
    if (unclosedResult.status === "invalid") {
      expect(unclosedResult.error.code).toBe("malformed-marker");
    }
    expect(() => withMotionCodeMetadata(unclosed, document)).toThrow();
  });

  it("rejects documents that violate the authoring model invariants", () => {
    const document = motionCodeDocumentFromTimeline(timeline);
    expect(() =>
      encodeMotionCodeMetadata({
        ...document,
        tracks: [
          {
            ...document.tracks[0],
            keyframes: [{ t: 1.1, value: "1" }],
          },
        ],
      }),
    ).toThrow(/must be in \[0, 1\]/);
    expect(() =>
      encodeMotionCodeMetadata({ ...document, version: 2 } as never),
    ).toThrow(/version must be 3/);
  });
});
