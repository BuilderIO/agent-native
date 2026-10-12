import { createHash } from "node:crypto";

import { generatedMotionNodeId } from "@agent-native/core/shared/motion-source-node-id";
import { describe, expect, it } from "vitest";

import {
  compileMotionCode,
  decodeMotionCodeMetadata,
  motionCodeDocumentFromTimeline,
  MOTION_CODE_METADATA_VERSION,
  withMotionCodeMetadata,
} from "./motion-code";
import { createMotionNativeStyleInstance } from "./motion-native-style-runtime";
import {
  applyMotionReactSourceEdit,
  inspectMotionReactSourceWriteCapability,
  MotionReactSourceError,
  readMotionReactSource,
  removeMotionReactSource,
} from "./motion-react-source";
import type { MotionTextDocument } from "./motion-text-code";
import type { MotionTimeline } from "./motion-timeline";

const source = `import React from "react";

function Card() {
  return (
    <main className="card">
      <h1 data-agent-native-node-id="hero-title">Hello</h1>
    </main>
  );
}
`;

function makeTimeline(targetNodeId = "hero-title", to = "1"): MotionTimeline {
  return {
    id: "timeline-1",
    designId: "design-1",
    sourceRef: "Card.tsx",
    filePath: "Card.tsx",
    tracks: [
      {
        targetNodeId,
        property: "opacity",
        keyframes: [
          { t: 0, value: "0", ease: "linear" },
          { t: 1, value: to, ease: "ease-out" },
        ],
      },
    ],
    durationMs: 800,
    defaultEase: "ease",
    compiledHash: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  };
}

const textDocument: MotionTextDocument = {
  version: 1,
  animations: [
    {
      targetNodeId: "hero-title",
      unit: "word",
      direction: "forward",
      staggerMs: 40,
      property: "opacity",
      durationMs: 320,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1" },
      ],
    },
  ],
};

const animationStyles = [
  {
    id: "fade-in",
    name: "Fade In",
    category: "enter" as const,
    tracks: [
      {
        property: "opacity",
        keyframes: [
          { t: 0, value: "0", ease: "ease-out" },
          { t: 1, value: "1" },
        ],
      },
    ],
  },
];

function previewFor(sourceText: string) {
  return {
    sourceHash: createHash("sha256").update(sourceText).digest("hex"),
  };
}

function apply(
  sourceText: string,
  overrides: Partial<Parameters<typeof applyMotionReactSourceEdit>[0]> = {},
) {
  return applyMotionReactSourceEdit({
    currentSource: sourceText,
    expectedSource: sourceText,
    preview: previewFor(sourceText),
    timeline: makeTimeline(),
    ...overrides,
  });
}

describe("React Motion source adapter", () => {
  it("inserts versioned compiled CSS into JSX while preserving surrounding source", () => {
    const edit = apply(source);

    expect(edit.source).toContain(
      '<main className="card">\n      <style data-agent-native-motion>{',
    );
    expect(edit.source).toContain(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    );
    expect(edit.source).toContain('import React from "react";');
    expect(edit.targetNodeIds).toEqual(["hero-title"]);

    const metadata = decodeMotionCodeMetadata(edit.css);
    expect(metadata.status).toBe("valid");
    if (metadata.status === "valid") {
      expect(metadata.document.version).toBe(MOTION_CODE_METADATA_VERSION);
      expect(metadata.document.tracks).toEqual(makeTimeline().tracks);
    }
    expect(edit.css).toBe(compileMotionCode(makeTimeline()).css);
  });

  it("updates a saved style library after clearing all applied tracks", () => {
    const authored = apply(source, {
      timeline: { ...makeTimeline(), animationStyles },
    }).source;
    const styleOnly = applyMotionReactSourceEdit({
      currentSource: authored,
      expectedSource: authored,
      preview: previewFor(authored),
      timeline: {
        ...makeTimeline(),
        tracks: [],
        animationStyles,
      },
    });

    expect(styleOnly.targetNodeIds).toEqual([]);
    expect(readMotionReactSource(styleOnly.source)).toMatchObject({
      status: "valid",
      targetNodeIds: [],
      document: { tracks: [], animationStyles },
    });
  });

  it("rejects React metadata-only writes without an existing style library anchor", () => {
    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: source,
        expectedSource: source,
        preview: previewFor(source),
        timeline: {
          ...makeTimeline(),
          tracks: [],
          animationStyles,
        },
      }),
    ).toThrow(/requires an existing managed Motion style element/);
  });

  it("does not allow an empty-target write that only clears tracks and Text", () => {
    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: source,
        expectedSource: source,
        preview: previewFor(source),
        timeline: { ...makeTimeline(), tracks: [] },
      }),
    ).toThrow(
      /require a CSS track, Text animation, or saved animation style library/,
    );
  });

  it("does not let easing variables bypass native-style target validation", () => {
    const authored = apply(source).source;
    const missingTargetStyle = createMotionNativeStyleInstance({
      styleKey: "Opacity",
      targetNodeId: "missing-native-target",
    });

    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: authored,
        expectedSource: authored,
        preview: previewFor(authored),
        timeline: {
          ...makeTimeline(),
          tracks: [],
          nativeStyles: [missingTargetStyle],
        },
        easingVariables: [],
      }),
    ).toThrow(
      /does not contain a static data-agent-native-node-id="missing-native-target" target/,
    );
  });

  it("includes native-style targets in React Motion write and read identity", () => {
    const nativeStyle = createMotionNativeStyleInstance({
      styleKey: "Opacity",
      targetNodeId: "hero-title",
    });
    const edit = apply(source, {
      timeline: {
        ...makeTimeline(),
        tracks: [],
        nativeStyles: [nativeStyle],
      },
    });

    expect(edit.targetNodeIds).toEqual(["hero-title"]);
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
      document: { tracks: [], nativeStyles: [nativeStyle] },
    });
    expect(
      inspectMotionReactSourceWriteCapability({
        source: edit.source,
        targetNodeIds: [],
        modulePath: "src/components/Card.tsx",
        moduleVersionHash: "a".repeat(64),
      }),
    ).toMatchObject({
      status: "supported",
      targetNodeIds: ["hero-title"],
    });
  });

  it("reads and writes spatial Position paths in managed React CSS metadata", () => {
    const pathTimeline: MotionTimeline = {
      ...makeTimeline(),
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
                control1: { x: 30, y: 90 },
                control2: { x: -25, y: 10 },
              },
            },
            { t: 1, value: "120px 40px", ease: "ease-out" },
          ],
        },
      ],
    };
    const edit = applyMotionReactSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      timeline: pathTimeline,
    });

    expect(edit.css).toContain("offset-path: path(");
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      document: { tracks: pathTimeline.tracks },
    });
  });

  it("writes motion in a parenthesized expression-bodied React component", () => {
    const expressionSource = `const Card = () => (
  <main className="card">
    <h1 data-agent-native-node-id="hero-title">Hello</h1>
  </main>
);
`;
    const edit = apply(expressionSource, {
      currentSource: expressionSource,
      expectedSource: expressionSource,
      preview: previewFor(expressionSource),
    });

    expect(edit.source).toContain(
      '<main className="card">\n    <style data-agent-native-motion>{',
    );
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it("materializes a generated preview identity before saving the JSX target", () => {
    const modulePath = "src/components/Button.tsx";
    const generatedSource = `function Button() { return <main><button>Go</button><span /></main>; }`;
    const targetNodeId = generatedMotionNodeId(modulePath, 1);
    const edit = applyMotionReactSourceEdit({
      currentSource: generatedSource,
      expectedSource: generatedSource,
      modulePath,
      preview: previewFor(generatedSource),
      timeline: makeTimeline(targetNodeId),
    });

    expect(edit.source).toContain(
      `<button data-agent-native-node-id="${targetNodeId}">Go</button>`,
    );
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: [targetNodeId],
    });
  });

  it("reads and updates one managed style without reformatting other JSX", () => {
    const first = apply(source);
    const read = readMotionReactSource(first.source);
    expect(read.status).toBe("valid");
    if (read.status !== "valid") return;

    expect(read.document?.durationMs).toBe(800);
    expect(read.targetNodeIds).toEqual(["hero-title"]);

    const next = applyMotionReactSourceEdit({
      currentSource: first.source,
      expectedSource: first.source,
      preview: previewFor(first.source),
      timeline: makeTimeline("hero-title", "0.75"),
    });
    expect(next.source.match(/data-agent-native-motion/g)).toHaveLength(1);
    expect(next.source).toContain(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    );
    expect(readMotionReactSource(next.source)).toMatchObject({
      status: "valid",
      document: {
        tracks: [{ keyframes: [{ value: "0" }, { value: "0.75" }] }],
      },
    });
  });

  it("preserves audio clips in managed source when React motion is edited", () => {
    const initial = apply(source);
    const audioClips = [
      {
        id: "audio-clip-01",
        name: "demo.mp3",
        sourceUrl: "/_agent-native/file-upload/audio/demo.mp3",
        timelineStartMs: 120,
        sourceTrimStartMs: 450,
        durationMs: 500,
        volume: 0.6,
        muted: false,
      },
    ];
    const cssWithAudio = withMotionCodeMetadata(
      initial.css,
      motionCodeDocumentFromTimeline(makeTimeline(), { audioClips }),
    );
    const authoredSource = initial.source.replace(
      JSON.stringify(initial.css),
      JSON.stringify(cssWithAudio),
    );
    expect(readMotionReactSource(authoredSource)).toMatchObject({
      status: "valid",
      document: { audioClips },
    });

    const updated = applyMotionReactSourceEdit({
      currentSource: authoredSource,
      expectedSource: authoredSource,
      preview: previewFor(authoredSource),
      timeline: makeTimeline("hero-title", "0.5"),
    });

    expect(readMotionReactSource(updated.source)).toMatchObject({
      status: "valid",
      document: {
        tracks: [{ keyframes: [{ value: "0" }, { value: "0.5" }] }],
        audioClips,
      },
    });

    const replacement = [
      {
        ...audioClips[0],
        id: "audio-clip-02",
        name: "replacement.wav",
        sourceUrl: "/_agent-native/file-upload/audio/replacement.wav",
      },
    ];
    const replaced = applyMotionReactSourceEdit({
      currentSource: updated.source,
      expectedSource: updated.source,
      preview: previewFor(updated.source),
      timeline: makeTimeline("hero-title", "0.25"),
      audioClips: replacement,
    });
    expect(readMotionReactSource(replaced.source)).toMatchObject({
      status: "valid",
      document: { audioClips: replacement },
    });

    const cleared = applyMotionReactSourceEdit({
      currentSource: replaced.source,
      expectedSource: replaced.source,
      preview: previewFor(replaced.source),
      timeline: makeTimeline("hero-title", "0.1"),
      audioClips: [],
    });
    expect(readMotionReactSource(cleared.source)).toMatchObject({
      status: "valid",
      document: { audioClips: [] },
    });
  });

  it("anchors an audio-only timeline in the unambiguous default component", () => {
    const audioOnlySource = `export default function Page() {
  return (
    <main>
      <h1>Audio page</h1>
    </main>
  );
}
`;
    const audioClips = [
      {
        id: "voiceover",
        name: "voiceover.wav",
        sourceUrl: "/_agent-native/file-upload/audio/voiceover.wav",
        timelineStartMs: 0,
        sourceTrimStartMs: 0,
        durationMs: 900,
        volume: 1,
        muted: false,
      },
    ];
    const edit = applyMotionReactSourceEdit({
      currentSource: audioOnlySource,
      expectedSource: audioOnlySource,
      preview: previewFor(audioOnlySource),
      timeline: { ...makeTimeline(), tracks: [] },
      audioClips,
    });

    expect(edit.source).toContain(
      "<main>\n      <style data-agent-native-motion>{",
    );
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      document: { tracks: [], audioClips, durationMs: 900 },
    });
    expect(
      inspectMotionReactSourceWriteCapability({
        source: edit.source,
        targetNodeIds: [],
        modulePath: "Page.tsx",
        moduleVersionHash: previewFor(edit.source).sourceHash,
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: [] });
  });

  it("round-trips React Text animation as a static component prop beside CSS", () => {
    const edit = applyMotionReactSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      timeline: makeTimeline(),
      textDocument,
    });

    expect(edit.source).toContain(
      'import { AgentNativeMotionText as AgentNativeMotionTextForMotion } from "@agent-native/core/client/motion-text";',
    );
    expect(edit.source).toContain(
      '<AgentNativeMotionTextForMotion playbackMode="once" animation={{"targetNodeId":"hero-title"',
    );
    expect(edit.source).toContain(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    );
    expect(edit.source).toContain("data-agent-native-motion");
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      textDocument: {
        animations: [{ targetNodeId: "hero-title", unit: "word" }],
      },
      document: { tracks: makeTimeline().tracks },
    });

    const updated = applyMotionReactSourceEdit({
      currentSource: edit.source,
      expectedSource: edit.source,
      preview: previewFor(edit.source),
      timeline: {
        ...makeTimeline("hero-title", "0.75"),
        playbackMode: "ping-pong",
      },
      textDocument: {
        ...textDocument,
        animations: [
          { ...textDocument.animations[0], durationMs: 640, staggerMs: 80 },
        ],
      },
    });
    expect(
      updated.source.match(/AgentNativeMotionTextForMotion playbackMode=/g),
    ).toHaveLength(1);
    expect(updated.source).toContain('playbackMode="ping-pong"');
    expect(readMotionReactSource(updated.source)).toMatchObject({
      status: "valid",
      playbackMode: "ping-pong",
      textDocument: {
        animations: [{ durationMs: 640, staggerMs: 80 }],
      },
      document: {
        tracks: [{ keyframes: [{ value: "0" }, { value: "0.75" }] }],
      },
    });
  });

  it("round-trips multiple compatible Text properties through one React wrapper", () => {
    const composite: MotionTextDocument = {
      ...textDocument,
      animations: [
        textDocument.animations[0]!,
        {
          ...textDocument.animations[0]!,
          property: "translate",
          delayMs: 25,
          durationMs: 160,
          keyframes: [
            { t: 0, value: "0px", ease: "ease-out" },
            { t: 1, value: "12px" },
          ],
        },
      ],
    };
    const edit = applyMotionReactSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      timeline: makeTimeline(),
      textDocument: composite,
    });

    expect(edit.source).toContain(
      '<AgentNativeMotionTextForMotion playbackMode="once" animations={[{"targetNodeId":"hero-title"',
    );
    expect(
      edit.source.match(/AgentNativeMotionTextForMotion playbackMode=/g),
    ).toHaveLength(1);
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      textDocument: composite,
    });

    const reduced = applyMotionReactSourceEdit({
      currentSource: edit.source,
      expectedSource: edit.source,
      preview: previewFor(edit.source),
      timeline: makeTimeline(),
      textDocument: { ...composite, animations: [composite.animations[0]!] },
    });
    expect(reduced.source).toContain(" animations={[{");
    expect(readMotionReactSource(reduced.source)).toMatchObject({
      status: "valid",
      textDocument: { animations: [composite.animations[0]] },
    });
  });

  it.each(["loop", "once", "ping-pong"] as const)(
    "round-trips %s playback mode for a text-only React timeline",
    (playbackMode) => {
      const edit = applyMotionReactSourceEdit({
        currentSource: source,
        expectedSource: source,
        preview: previewFor(source),
        timeline: {
          ...makeTimeline(),
          tracks: [],
          playbackMode,
        },
        textDocument,
      });

      expect(edit.source).toContain(
        `<AgentNativeMotionTextForMotion playbackMode="${playbackMode}" animation={{`,
      );
      expect(readMotionReactSource(edit.source)).toMatchObject({
        status: "valid",
        playbackMode,
        document: { playbackMode, tracks: [] },
        textDocument,
      });
    },
  );

  it("adds the runtime component to an existing import with a trailing comma", () => {
    const imported = source.replace(
      'import React from "react";',
      'import React from "react";\nimport { type MotionTextAnimation, } from "@agent-native/core/client/motion-text";',
    );
    const edit = applyMotionReactSourceEdit({
      currentSource: imported,
      expectedSource: imported,
      preview: previewFor(imported),
      timeline: { ...makeTimeline(), tracks: [] },
      textDocument,
    });

    expect(edit.source).toContain(
      'import { type MotionTextAnimation, AgentNativeMotionText as AgentNativeMotionTextForMotion } from "@agent-native/core/client/motion-text";',
    );
    expect(readMotionReactSource(edit.source)).toMatchObject({
      status: "valid",
      textDocument,
    });
  });

  it("supports text-only React timelines and removes wrappers without losing text", () => {
    const textOnly = applyMotionReactSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      timeline: { ...makeTimeline(), tracks: [] },
      textDocument,
    });
    expect(readMotionReactSource(textOnly.source)).toMatchObject({
      status: "valid",
      document: { tracks: [] },
      textDocument,
    });

    const removed = removeMotionReactSource(textOnly.source);
    expect(removed.changed).toBe(true);
    expect(removed.source).toContain(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    );
    expect(removed.source).not.toContain("AgentNativeMotionText");
    expect(removed.source).not.toContain("data-agent-native-motion");
    expect(readMotionReactSource(removed.source)).toEqual({ status: "absent" });
  });

  it("clears Text source while preserving CSS tracks", () => {
    const authored = applyMotionReactSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      timeline: makeTimeline(),
      textDocument,
    }).source;
    const cleared = applyMotionReactSourceEdit({
      currentSource: authored,
      expectedSource: authored,
      preview: previewFor(authored),
      timeline: makeTimeline(),
      textDocument: null,
    });

    expect(cleared.source).not.toContain("AgentNativeMotionText");
    expect(cleared.source).not.toContain("client/motion-text");
    expect(readMotionReactSource(cleared.source)).toMatchObject({
      status: "valid",
      textDocument: null,
      document: { tracks: makeTimeline().tracks },
    });
  });

  it("refuses dynamic JSX text and dynamic React Text animation expressions", () => {
    const dynamicText = source.replace(">Hello</h1>", ">{props.title}</h1>");
    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: dynamicText,
        expectedSource: dynamicText,
        preview: previewFor(dynamicText),
        timeline: { ...makeTimeline(), tracks: [] },
        textDocument,
      }),
    ).toThrow(/dynamic or nested JSX children/);

    const dynamicAnimation = `import { AgentNativeMotionText } from "@agent-native/core/client/motion-text";
function Card() {
  return <main><AgentNativeMotionText animation={props.animation}><h1 data-agent-native-node-id="hero-title">Hello</h1></AgentNativeMotionText></main>;
}`;
    expect(readMotionReactSource(dynamicAnimation)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-motion-text" },
    });

    const prototypeProperty = `import { AgentNativeMotionText } from "@agent-native/core/client/motion-text";
function Card() {
  return <main><AgentNativeMotionText animation={{ "__proto__": "ignored", targetNodeId: "hero-title", unit: "word", direction: "forward", staggerMs: 0, property: "opacity", durationMs: 320, keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }}><h1 data-agent-native-node-id="hero-title">Hello</h1></AgentNativeMotionText></main>;
}`;
    expect(readMotionReactSource(prototypeProperty)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-motion-text" },
    });

    const dynamicPlaybackMode = `import { AgentNativeMotionText } from "@agent-native/core/client/motion-text";
function Card() {
  return <main><AgentNativeMotionText playbackMode={props.mode} animation={{ targetNodeId: "hero-title", unit: "word", direction: "forward", staggerMs: 0, property: "opacity", durationMs: 320, keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }}><h1 data-agent-native-node-id="hero-title">Hello</h1></AgentNativeMotionText></main>;
}`;
    expect(readMotionReactSource(dynamicPlaybackMode)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-motion-text" },
    });
  });

  it("preserves CRLF source formatting outside the inserted managed element", () => {
    const crlf = source.replace(/\n/g, "\r\n");
    const edit = apply(crlf, {
      currentSource: crlf,
      expectedSource: crlf,
      preview: previewFor(crlf),
    });

    expect(edit.source).toContain("\r\n      <style data-agent-native-motion>");
    expect(edit.source.replace(/\r\n/g, "")).not.toContain("\n");
    expect(edit.source).toContain(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    );
  });

  it("rejects an edit whose source changed after it was prepared", () => {
    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: source,
        expectedSource: `${source}\n`,
        preview: previewFor(source),
        timeline: makeTimeline(),
      }),
    ).toThrowError(MotionReactSourceError);
    expect(() =>
      apply(source, {
        preview: { ...previewFor(source), sourceHash: "stale" },
      }),
    ).toThrow(/preview identity snapshot does not match/);
  });

  it("rejects absent or ambiguous targets without blocking unrelated spread JSX", () => {
    expect(() =>
      apply(source.replace(' data-agent-native-node-id="hero-title"', "")),
    ).toThrow(/does not contain a static/);

    const duplicate = source.replace(
      "    </main>",
      '      <p data-agent-native-node-id="hero-title">Another</p>\n    </main>',
    );
    expect(() => apply(duplicate)).toThrow(/contains 2 elements/);

    const dynamic = source.replace(
      "    </main>",
      "      <p data-agent-native-node-id={props.id}>Dynamic</p>\n    </main>",
    );
    expect(apply(dynamic).source).toContain(
      'data-agent-native-node-id="hero-title"',
    );

    const spread = source.replace(
      "    </main>",
      "      <p {...props}>Spread</p>\n    </main>",
    );
    expect(apply(spread).source).toContain(
      'data-agent-native-node-id="hero-title"',
    );

    const spreadTarget = source.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 {...props} data-agent-native-node-id="hero-title">Hello</h1>',
    );
    expect(() => apply(spreadTarget)).toThrow(/does not contain a static/);
  });

  it("resolves targets from unique static JSX and requires a supported component root", () => {
    const duplicate = source.replace(
      "    </main>",
      '      <p data-agent-native-node-id="hero-title">Another</p>\n    </main>',
    );
    expect(() => apply(duplicate)).toThrow(/contains 2 elements/);

    const customRoot = source
      .replace("<main className=", "<CardFrame className=")
      .replace("</main>", "</CardFrame>");
    expect(() => apply(customRoot)).toThrow(
      /supported intrinsic HTML container/,
    );

    const managedCustomRoot = apply(source)
      .source.replace("<main className=", "<CardFrame className=")
      .replace("</main>", "</CardFrame>");
    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: managedCustomRoot,
        expectedSource: managedCustomRoot,
        preview: previewFor(managedCustomRoot),
        timeline: makeTimeline("hero-title", "0.9"),
      }),
    ).toThrow(/supported intrinsic HTML container/);

    const branches = source.replace(
      `  return (\n    <main className="card">\n      <h1 data-agent-native-node-id="hero-title">Hello</h1>\n    </main>\n  );`,
      `  if (ready) return <main><h1 data-agent-native-node-id="hero-title">Hello</h1></main>;\n  return <main />;`,
    );
    expect(() => apply(branches)).toThrow(/one unconditional JSX return/);
  });

  it("reports write capability for supported and rejected React return shapes", () => {
    const modulePath = "src/components/Card.tsx";
    const moduleVersionHash = "a".repeat(64);
    expect(
      inspectMotionReactSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
        modulePath,
        moduleVersionHash,
      }),
    ).toEqual({
      status: "supported",
      modulePath,
      moduleVersionHash,
      targetNodeIds: ["hero-title"],
    });

    const conditional = `function Card() {
  if (ready) {
    return <main><h1 data-agent-native-node-id="hero-title">Hello</h1></main>;
  }
  return null;
}`;
    const multipleReturns = `function Card() {
  if (ready) return <main><h1 data-agent-native-node-id="hero-title">Hello</h1></main>;
  return <main />;
}`;

    for (const unsupportedSource of [conditional, multipleReturns]) {
      expect(
        inspectMotionReactSourceWriteCapability({
          source: unsupportedSource,
          targetNodeIds: ["hero-title"],
          modulePath,
          moduleVersionHash,
        }),
      ).toMatchObject({
        status: "unsupported",
        modulePath,
        moduleVersionHash,
        targetNodeIds: ["hero-title"],
        code: "unsupported-root",
        reason: expect.stringMatching(/one unconditional JSX return/),
      });
    }
  });

  it("allows metadata-only React capability only for an existing source style library", () => {
    const modulePath = "src/components/Card.tsx";
    const moduleVersionHash = "a".repeat(64);
    const authored = apply(source, {
      timeline: { ...makeTimeline(), animationStyles },
    }).source;
    const styleOnly = applyMotionReactSourceEdit({
      currentSource: authored,
      expectedSource: authored,
      preview: previewFor(authored),
      timeline: { ...makeTimeline(), tracks: [], animationStyles },
    }).source;

    expect(
      inspectMotionReactSourceWriteCapability({
        source: styleOnly,
        targetNodeIds: [],
        modulePath,
        moduleVersionHash,
      }),
    ).toEqual({
      status: "supported",
      modulePath,
      moduleVersionHash,
      targetNodeIds: [],
    });
    expect(
      inspectMotionReactSourceWriteCapability({
        source,
        targetNodeIds: [],
        modulePath,
        moduleVersionHash,
      }),
    ).toMatchObject({ status: "unsupported", code: "missing-node" });
  });

  it("rejects malformed managed styles and stale or missing metadata", () => {
    const malformed = source.replace(
      '    <main className="card">',
      '    <main className="card"><style data-agent-native-motion>{getCss()}</style>',
    );
    expect(readMotionReactSource(malformed)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-managed-style" },
    });

    const noMetadata = source.replace(
      '    <main className="card">',
      '    <main className="card"><style data-agent-native-motion>{".title { opacity: 1; }"}</style>',
    );
    expect(readMotionReactSource(noMetadata)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-managed-style" },
    });

    const duplicateStyles = apply(source).source.replace(
      "    </main>",
      '      <style data-agent-native-motion>{"duplicate"}</style>\n    </main>',
    );
    expect(() =>
      applyMotionReactSourceEdit({
        currentSource: duplicateStyles,
        expectedSource: duplicateStyles,
        preview: previewFor(duplicateStyles),
        timeline: makeTimeline(),
      }),
    ).toThrow(/more than one managed Motion style/);
  });

  it("reports malformed JSX instead of editing it", () => {
    expect(
      readMotionReactSource("function Card() { return <main>; }"),
    ).toMatchObject({
      status: "invalid",
      error: { code: "invalid-jsx" },
    });
  });

  it("removes one valid managed JSX style while preserving surrounding source", () => {
    const authored = apply(source).source;
    const removed = removeMotionReactSource(authored);

    expect(removed.changed).toBe(true);
    expect(removed.source).not.toContain("data-agent-native-motion");
    expect(removed.source).toContain(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    );
    expect(removeMotionReactSource(removed.source)).toEqual({
      source: removed.source,
      changed: false,
    });
  });

  it("does not remove malformed React Motion source", () => {
    const malformed = apply(source).source.replace(
      "data-agent-native-motion>{",
      "data-agent-native-motion>{getCss()}",
    );
    expect(() => removeMotionReactSource(malformed)).toThrow(
      /React source has a JSX parse error|malformed managed Motion style/,
    );
  });
});
