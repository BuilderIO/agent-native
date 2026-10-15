import { createHash } from "node:crypto";

import { generatedMotionNodeId } from "@agent-native/core/shared/motion-source-node-id";
import { describe, expect, it } from "vitest";

import {
  decodeMotionCodeMetadata,
  MOTION_CODE_METADATA_VERSION,
} from "./motion-code";
import {
  applyMotionHtmlSourceEdit,
  inspectMotionHtmlSourceWriteCapability,
  instrumentMotionHtmlPreviewSource,
  MotionHtmlSourceError,
  readMotionHtmlSource,
  removeMotionHtmlSource,
} from "./motion-html-source";
import { createMotionNativeStyleInstance } from "./motion-native-style-runtime";
import type { MotionTextDocument } from "./motion-text-code";
import type { MotionTimeline } from "./motion-timeline";

const html = `<!doctype html>
<html>
<head>
  <link rel="preload" as="style" href="./site.css">
  <script src="./head.js"></script>
</head>
<body>
  <main class="card">
    <h1 data-agent-native-node-id="hero-title">Hello</h1>
  </main>
  <script src="./page.js"></script>
</body>
</html>
`;

function makeTimeline(targetNodeId = "hero-title", to = "1"): MotionTimeline {
  return {
    id: "timeline-1",
    designId: "design-1",
    sourceRef: "index.html",
    filePath: "index.html",
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

function previewFor(source: string) {
  return {
    sourceHash: createHash("sha256").update(source).digest("hex"),
  };
}

function apply(
  source: string,
  overrides: Partial<Parameters<typeof applyMotionHtmlSourceEdit>[0]> = {},
) {
  return applyMotionHtmlSourceEdit({
    currentSource: source,
    expectedSource: source,
    preview: previewFor(source),
    timeline: makeTimeline(),
    ...overrides,
  });
}

describe("HTML Motion source adapter", () => {
  it("writes versioned CSS into the HTML entry while preserving external assets", () => {
    const edit = apply(html);

    expect(
      edit.source.replace(
        `<style data-agent-native-motion>${edit.css}</style>`,
        "",
      ),
    ).toBe(html);
    expect(edit.source).toContain(
      '<link rel="preload" as="style" href="./site.css">',
    );
    expect(edit.source).toContain('<script src="./head.js"></script>');
    expect(edit.source).toContain('<script src="./page.js"></script>');
    expect(edit.source).toContain("agent-native-motion-source:v5:");
    expect(edit.targetNodeIds).toEqual(["hero-title"]);

    const read = readMotionHtmlSource(edit.source);
    expect(read).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
      document: {
        version: MOTION_CODE_METADATA_VERSION,
        tracks: makeTimeline().tracks,
      },
    });
    if (read.status === "valid") {
      expect(decodeMotionCodeMetadata(read.css).status).toBe("valid");
    }
  });

  it("round-trips ordered additive Position tracks through HTML source", () => {
    const timeline: MotionTimeline = {
      ...makeTimeline(),
      tracks: [
        {
          id: "position-x",
          targetNodeId: "hero-title",
          property: "translate",
          composition: "add",
          keyframes: [
            { t: 0, value: "0px 0px" },
            { t: 1, value: "100px 0px" },
          ],
        },
        {
          id: "position-y",
          targetNodeId: "hero-title",
          property: "translate",
          composition: "add",
          keyframes: [
            { t: 0, value: "0px 0px" },
            { t: 1, value: "0px 60px" },
          ],
        },
      ],
    };
    const first = apply(html, { timeline });
    const read = readMotionHtmlSource(first.source, "index.html");

    expect(first.css).toContain("animation-composition: add, add;");
    expect(read).toMatchObject({
      status: "valid",
      document: {
        tracks: [
          { id: "position-x", composition: "add" },
          { id: "position-y", composition: "add" },
        ],
      },
    });
    if (read.status !== "valid" || !read.document) {
      throw new Error("repeated HTML Position tracks were not readable");
    }

    const rewritten = applyMotionHtmlSourceEdit({
      currentSource: first.source,
      expectedSource: first.source,
      preview: previewFor(first.source),
      sourceFilePath: "index.html",
      timeline: { ...timeline, tracks: read.document.tracks },
    });
    expect(readMotionHtmlSource(rewritten.source, "index.html")).toMatchObject({
      status: "valid",
      document: {
        tracks: [
          { id: "position-x", composition: "add" },
          { id: "position-y", composition: "add" },
        ],
      },
    });
  });

  it("fails closed when a Motion target has dynamic or Alpine motion styles", () => {
    for (const attribute of [
      'x-transition.opacity=""',
      'x-bind="attrs"',
      ':style="style"',
      'x-bind:style="style"',
      'v-bind:style="style"',
    ]) {
      const source = html.replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        `<h1 data-agent-native-node-id="hero-title" ${attribute}>Hello</h1>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({
        status: "unsupported",
        code: "unsupported-target",
        reason: expect.stringContaining(attribute.split("=")[0]!),
      });

      let writeError: unknown;
      try {
        apply(source);
      } catch (error) {
        writeError = error;
      }
      expect(writeError).toMatchObject({ code: "unsupported-target" });
    }
  });

  it("refuses authored inline animation and transition declarations on a target", () => {
    for (const style of [
      "animation: pulse 1s infinite",
      "transition: opacity 200ms ease",
      "-webkit-animation-name: pulse",
      "\\61 nimation: pulse 1s infinite",
      "\\74 ransition: opacity 200ms ease",
      "-\\77 ebkit-animation-name: pulse",
    ]) {
      const source = html.replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        `<h1 data-agent-native-node-id="hero-title" style="${style}">Hello</h1>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({
        status: "unsupported",
        code: "unsupported-target",
        reason: expect.stringContaining("uses style"),
      });

      let writeError: unknown;
      try {
        apply(source);
      } catch (error) {
        writeError = error;
      }
      expect(writeError).toMatchObject({ code: "unsupported-target" });
    }
  });

  it.each([
    ["x-transition.opacity"],
    ['x-bind="attrs"'],
    ['x-bind:style="style"'],
    ['style="animation: pulse 1s infinite"'],
  ])("validates generated Motion targets with %s during reads", (attribute) => {
    const generated = apply(html).source;
    const source = generated.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      `<h1 data-agent-native-node-id="hero-title" ${attribute}>Hello</h1>`,
    );

    expect(readMotionHtmlSource(source, "pages/home.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it("allows a target when dynamic style bindings belong to another element", () => {
    const source = html.replace(
      "  </main>",
      '    <aside style="animation: pulse 1s infinite" x-transition.opacity x-bind:style="style">Other animation</aside>\n  </main>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    expect(apply(source).source).toContain("data-agent-native-motion");
  });

  it("allows unrelated static inline styles on a Motion target", () => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="color: rebeccapurple; background-color: white">Hello</h1>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    expect(apply(source).source).toContain(
      'style="color: rebeccapurple; background-color: white"',
    );
  });

  it("updates only the managed CSS and keeps unrelated HTML byte-for-byte", () => {
    const first = apply(html);
    const next = applyMotionHtmlSourceEdit({
      currentSource: first.source,
      expectedSource: first.source,
      preview: previewFor(first.source),
      timeline: makeTimeline("hero-title", "0.75"),
    });
    const stripManagedStyle = (source: string) =>
      source.replace(/<style data-agent-native-motion>[\s\S]*?<\/style>/, "");

    expect(stripManagedStyle(next.source)).toBe(
      stripManagedStyle(first.source),
    );
    expect(next.source.match(/agent-native-motion-source:v5:/g)).toHaveLength(
      1,
    );
    expect(readMotionHtmlSource(next.source)).toMatchObject({
      status: "valid",
      document: {
        tracks: [
          {
            targetNodeId: "hero-title",
            property: "opacity",
            keyframes: [
              { t: 0, value: "0", ease: "linear" },
              { t: 1, value: "0.75", ease: "ease-out" },
            ],
          },
        ],
      },
    });
  });

  it("round-trips repeated property tracks through HTML source by id", () => {
    const timeline: MotionTimeline = {
      ...makeTimeline(),
      tracks: [
        {
          id: "opacity-first",
          targetNodeId: "hero-title",
          property: "opacity",
          keyframes: [
            { t: 0, value: "0" },
            { t: 1, value: "0.4" },
          ],
        },
        {
          id: "opacity-second",
          targetNodeId: "hero-title",
          property: "opacity",
          keyframes: [
            { t: 0, value: "0.4" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };
    const edit = apply(html, { timeline });
    const read = readMotionHtmlSource(edit.source);

    expect(read).toMatchObject({
      status: "valid",
      document: {
        tracks: [
          { id: "opacity-first", property: "opacity" },
          { id: "opacity-second", property: "opacity" },
        ],
      },
    });
    if (read.status === "valid" && read.document) {
      expect(
        read.document.tracks.map((track) =>
          track.keyframes.map((keyframe) => keyframe.value),
        ),
      ).toEqual([
        ["0", "0.4"],
        ["0.4", "1"],
      ]);
      const rewritten = apply(edit.source, {
        timeline: { ...timeline, tracks: read.document.tracks },
      });
      expect(readMotionHtmlSource(rewritten.source)).toMatchObject({
        status: "valid",
        document: {
          tracks: [
            { id: "opacity-first", property: "opacity" },
            { id: "opacity-second", property: "opacity" },
          ],
        },
      });
    }
  });

  it("reads source-authored CSS changes and preserves them on a later Motion write", () => {
    const authored = apply(html);
    const directEdit = authored.source
      .replace("opacity: 0;", "opacity: 0.35;")
      .replace(
        "animation-timing-function: linear;",
        "animation-timing-function: ease-in;",
      )
      .replace("animation-duration: 0.8s;", "animation-duration: 1.1s;");
    const read = readMotionHtmlSource(directEdit);

    expect(read).toMatchObject({
      status: "valid",
      document: {
        durationMs: 1100,
        tracks: [
          {
            targetNodeId: "hero-title",
            property: "opacity",
            keyframes: [
              { t: 0, value: "0.35", ease: "ease-in" },
              { t: 1, value: "1", ease: "ease-out" },
            ],
          },
        ],
      },
    });
    if (read.status !== "valid" || !read.document) {
      throw new Error("direct HTML Motion CSS edit was not readable");
    }

    const written = applyMotionHtmlSourceEdit({
      currentSource: directEdit,
      expectedSource: directEdit,
      preview: previewFor(directEdit),
      timeline: {
        ...makeTimeline(),
        tracks: read.document.tracks,
        durationMs: read.document.durationMs,
        playbackMode: read.document.playbackMode,
      },
    });

    expect(readMotionHtmlSource(written.source)).toMatchObject({
      status: "valid",
      document: {
        durationMs: 1100,
        tracks: read.document.tracks,
      },
    });
    expect(
      written.source.match(/agent-native-motion-source:v5:/g),
    ).toHaveLength(1);
  });

  it("adopts static inline CSS animations and keeps their global keyframes", () => {
    const source = `<!doctype html>
<html>
<head>
  <style>
.hero {
  color: rebeccapurple;
  /* Keep this authored note. */
  animation-name: hero-fade;
  animation-duration: 900ms;
  animation-timing-function: ease-in;
  animation-fill-mode: both;
}
@keyframes hero-fade {
  from { opacity: 0; }
  50% { opacity: 0.5; }
  to { opacity: 1; }
}
  </style>
</head>
<body><h1 class="hero" data-agent-native-node-id="hero-css">Hello</h1></body>
</html>`;
    const read = readMotionHtmlSource(source, "index.html");

    expect(read).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-css"],
      document: {
        durationMs: 900,
        tracks: [
          {
            targetNodeId: "hero-css",
            property: "opacity",
            durationMs: 900,
            keyframes: [
              { t: 0, value: "0", ease: "ease-in" },
              { t: 0.5, value: "0.5", ease: "ease-in" },
              { t: 1, value: "1", ease: "ease" },
            ],
          },
        ],
      },
    });
    if (read.status !== "valid" || !read.document) {
      throw new Error("authored HTML CSS Motion was not readable");
    }

    const written = applyMotionHtmlSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      sourceFilePath: "index.html",
      timeline: {
        ...makeTimeline("hero-css"),
        tracks: read.document.tracks,
        durationMs: read.document.durationMs,
        playbackMode: read.playbackMode,
      },
    });
    expect(written.source).not.toContain("animation-name: hero-fade;");
    expect(written.source).toContain("@keyframes hero-fade");
    expect(written.source).toContain("color: rebeccapurple;");
    expect(written.source).toContain("/* Keep this authored note. */");
    expect(readMotionHtmlSource(written.source, "index.html")).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-css"],
      document: { tracks: read.document.tracks },
    });

    const removed = removeMotionHtmlSource(written.source, "index.html");
    expect(removed.changed).toBe(true);
    expect(removed.source).toContain("color: rebeccapurple;");
    expect(removed.source).toContain("@keyframes hero-fade");
    expect(removed.source).toContain("/* Keep this authored note. */");
    expect(readMotionHtmlSource(removed.source, "index.html")).toEqual({
      status: "absent",
    });
  });

  it("fails closed when linked CSS can change an inline animation", () => {
    const source = `<!doctype html>
<html>
<head>
  <link rel="preload stylesheet" href="./theme.css">
  <style>
.hero { animation-name: hero-fade; animation-duration: 800ms; animation-fill-mode: both; }
@keyframes hero-fade { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body><h1 class="hero" data-agent-native-node-id="hero-css">Hello</h1></body>
</html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
  });

  it("fails closed instead of treating linked stylesheet-only HTML as absent", () => {
    const source = `<!doctype html>
<html>
<head><link rel="stylesheet" href="./site.css"></head>
<body><h1 data-agent-native-node-id="hero-title">Hello</h1></body>
</html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it.each([
    [
      "linked stylesheet",
      '<link rel="stylesheet" href="./theme.css">',
      "unresolved-stylesheet",
    ],
    [
      "Alpine-bound stylesheet",
      '<link rel="stylesheet" x-bind:href="themeUrl">',
      "unresolved-stylesheet",
    ],
    [
      "Alpine-bound relation",
      '<link href="./theme.css" :rel="themeRel">',
      "unresolved-stylesheet",
    ],
    [
      "CSS import",
      '<style>@IMPORT url("./theme.css");</style>',
      "unresolved-stylesheet",
    ],
    [
      "escaped CSS import",
      '<style>@\\69mport url("./theme.css");</style>',
      "unsupported-authored-motion",
    ],
  ])(
    "fails closed when a %s can add motion beside a managed timeline",
    (_sourceKind, externalStylesheet, errorCode) => {
      const managedSource = apply(html).source.replace(
        "</head>",
        `${externalStylesheet}\n</head>`,
      );

      expect(readMotionHtmlSource(managedSource, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: errorCode },
      });
      expect(() => apply(managedSource)).toThrow(MotionHtmlSourceError);
    },
  );

  it("fails closed when an imported stylesheet precedes malformed CSS", () => {
    const managedSource = apply(html).source.replace(
      "</head>",
      '<style>@import url("./theme.css"); .broken { color: red</style>\n</head>',
    );

    expect(readMotionHtmlSource(managedSource, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
    expect(() => apply(managedSource)).toThrow(MotionHtmlSourceError);
  });

  it("does not treat inert non-CSS style data as an imported stylesheet", () => {
    const managedSource = apply(html).source.replace(
      "</head>",
      '<style type="application/json">{"source":"@import url(./theme.css)"}</style>\n</head>',
    );

    expect(readMotionHtmlSource(managedSource, "index.html")).toMatchObject({
      status: "valid",
    });
    expect(() => apply(managedSource)).not.toThrow();
  });

  it("treats a dynamically typed style data block as potentially active CSS", () => {
    const managedSource = apply(html).source.replace(
      "</head>",
      '<style type="application/json" x-bind="styleAttrs">{"source":"@import url(./theme.css)"}</style>\n</head>',
    );

    expect(readMotionHtmlSource(managedSource, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
  });

  it("round-trips one authored CSS animation with multiple properties in Alpine HTML", () => {
    const source = `<!doctype html>
<html>
<head>
  <style>
.hero {
  animation-name: hero-enter;
  animation-duration: 900ms;
  animation-timing-function: ease-out;
  animation-fill-mode: both;
}
@keyframes hero-enter {
  from { opacity: 0; transform: translateY(12px); }
  50% { opacity: 0.5; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0px); }
}
  </style>
</head>
<body>
  <main x-data="{ open: true }">
    <h1 class="hero" data-agent-native-node-id="hero-alpine">Hello</h1>
  </main>
</body>
</html>`;
    const read = readMotionHtmlSource(source, "index.html");

    expect(read).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-alpine"],
      document: {
        durationMs: 900,
        tracks: [
          {
            targetNodeId: "hero-alpine",
            property: "opacity",
            keyframes: [
              { t: 0, value: "0", ease: "ease-out" },
              { t: 0.5, value: "0.5", ease: "ease-out" },
              { t: 1, value: "1" },
            ],
          },
          {
            targetNodeId: "hero-alpine",
            property: "transform",
            keyframes: [
              { t: 0, value: "translateY(12px)", ease: "ease-out" },
              { t: 0.5, value: "translateY(6px)", ease: "ease-out" },
              { t: 1, value: "translateY(0px)" },
            ],
          },
        ],
      },
    });
    if (read.status !== "valid" || !read.document) {
      throw new Error("multi-property Alpine HTML Motion was not readable");
    }

    const written = applyMotionHtmlSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: previewFor(source),
      sourceFilePath: "index.html",
      timeline: {
        ...makeTimeline("hero-alpine"),
        tracks: read.document.tracks,
        durationMs: read.document.durationMs,
      },
    });

    expect(written.source).toContain('<main x-data="{ open: true }">');
    expect(written.source).toContain("@keyframes hero-enter");
    expect(written.source).not.toContain("animation-name: hero-enter;");
    expect(readMotionHtmlSource(written.source, "index.html")).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-alpine"],
      document: { tracks: read.document.tracks },
    });
  });

  it("rejects animations for one HTML target across separate style blocks", () => {
    const source = `<!doctype html><html><head>
<style>#hero { animation-name: fade; animation-duration: 800ms; animation-fill-mode: both; } @keyframes fade { from { opacity: 0; } to { opacity: 1; } }</style>
<style>#hero { animation-name: tint; animation-duration: 800ms; animation-fill-mode: both; } @keyframes tint { from { color: red; } to { color: blue; } }</style>
</head><body><h1 id="hero">Hello</h1></body></html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
  });

  it("rejects global keyframe names shadowed by another inline style block", () => {
    const source = `<!doctype html><html><head>
<style>#hero { animation-name: pulse; animation-duration: 800ms; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }</style>
<style>@keyframes pulse { from { opacity: 1; } to { opacity: 0; } }</style>
</head><body><h1 id="hero">Hello</h1></body></html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
  });

  it("rejects conditional keyframes that redefine an imported animation name", () => {
    const source = `<!doctype html><html><head>
<style>#hero { animation-name: pulse; animation-duration: 800ms; animation-fill-mode: both; } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }</style>
<style>@media (min-width: 1px) { @keyframes pulse { from { opacity: 1; } to { opacity: 0; } } }</style>
</head><body><h1 id="hero">Hello</h1></body></html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
  });

  it("rejects authored CSS targets that also match HTML template content", () => {
    const source = `<!doctype html><html><head><style>
.hero { animation-name: fade; animation-duration: 800ms; animation-fill-mode: both; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
</style></head><body>
<h1 class="hero" data-agent-native-node-id="hero-title">Hello</h1>
<template x-for="item in items"><h1 class="hero">Template item</h1></template>
</body></html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
  });

  it("resolves inline CSS selectors to the same path-derived HTML target IDs as preview", () => {
    const source = `<!doctype html>
<html><head><style>
.hero { animation-name: hero-fade; animation-duration: 800ms; animation-fill-mode: both; }
@keyframes hero-fade { from { opacity: 0; } to { opacity: 1; } }
</style></head><body><main class="hero">Hello</main></body></html>`;
    const sourceFilePath = "pages/home.html";
    const generatedId = generatedMotionNodeId(sourceFilePath, 3);
    const preview = instrumentMotionHtmlPreviewSource({
      source,
      sourceFilePath,
    });
    const read = readMotionHtmlSource(source, sourceFilePath);

    expect(preview.targetNodeIds).toContain(generatedId);
    expect(read).toMatchObject({
      status: "valid",
      targetNodeIds: [generatedId],
      document: { tracks: [{ targetNodeId: generatedId }] },
    });
  });

  it.each([
    ["an Alpine-bound class", ':class="{ hero: active }"'],
    ["a generic Alpine binding", 'x-bind="attrs"'],
  ])(
    "fails closed when an inline CSS selector can match %s",
    (_label, binding) => {
      const source = `<!doctype html><html><head><style>
.hero { animation-name: hero-fade; animation-duration: 800ms; animation-fill-mode: both; }
@keyframes hero-fade { from { opacity: 0; } to { opacity: 1; } }
</style></head><body><main ${binding}>Hello</main></body></html>`;

      expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-authored-motion" },
      });
    },
  );

  it("uses stable generated preview IDs and persists selected IDs on write", () => {
    const sourcePath = "pages/index.html";
    const source = html.replace(' data-agent-native-node-id="hero-title"', "");
    const generatedId = generatedMotionNodeId(sourcePath, 5);
    const preview = instrumentMotionHtmlPreviewSource({
      source,
      sourceFilePath: sourcePath,
    });

    expect(preview.sourceHash).toBe(previewFor(source).sourceHash);
    expect(preview.targetNodeIds).toContain(generatedId);
    expect(preview.source).toContain(
      `<h1 data-agent-native-node-id="${generatedId}">Hello</h1>`,
    );

    const edit = applyMotionHtmlSourceEdit({
      currentSource: source,
      expectedSource: source,
      preview: { sourceHash: preview.sourceHash },
      sourceFilePath: sourcePath,
      timeline: makeTimeline(generatedId),
    });
    expect(edit.source).toContain(
      `<h1 data-agent-native-node-id="${generatedId}">Hello</h1>`,
    );
    expect(readMotionHtmlSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: [generatedId],
    });
  });

  it("keeps generated preview IDs aligned after inert template content", () => {
    const sourcePath = "pages/template.html";
    const source =
      "<!doctype html><html><body><template><section><em>Example</em></section></template><button>Go</button></body></html>";
    const preview = instrumentMotionHtmlPreviewSource({
      source,
      sourceFilePath: sourcePath,
    });

    expect(preview.targetNodeIds).toEqual([
      generatedMotionNodeId(sourcePath, 0),
      generatedMotionNodeId(sourcePath, 1),
      generatedMotionNodeId(sourcePath, 2),
      generatedMotionNodeId(sourcePath, 3),
    ]);
    expect(preview.source).toContain(
      `<button data-agent-native-node-id="${generatedMotionNodeId(sourcePath, 3)}">Go</button>`,
    );
  });

  it("writes and reads the current versioned Motion Text runtime", () => {
    const edit = apply(html, { textDocument });
    const read = readMotionHtmlSource(edit.source);

    expect(read).toMatchObject({
      status: "valid",
      textDocument: { ...textDocument, version: 2 },
      targetNodeIds: ["hero-title"],
    });
    expect(edit.source).toContain('<script src="./page.js"></script>');
    expect(edit.source).toContain('data-agent-native-motion-text-source="v2"');
    expect(edit.source).toContain('data-agent-native-motion-text-runtime="v2"');
    expect(removeMotionHtmlSource(edit.source)).toEqual({
      source: html,
      changed: true,
    });
  });

  it("composes the existing SVG path trim source helper", () => {
    const svgSource = html.replace(
      "  </main>",
      '  </main>\n  <svg><path data-agent-native-node-id="shape-path" d="M0 0L10 10"></path></svg>',
    );
    const timeline = makeTimeline("shape-path");
    timeline.tracks[0] = {
      ...timeline.tracks[0]!,
      property: "path-trim",
      keyframes: [
        { t: 0, value: "100% 0%", ease: "linear" },
        { t: 1, value: "0% 100%", ease: "ease-out" },
      ],
    };
    const edit = apply(svgSource, { timeline });

    expect(edit.source).toContain('pathLength="100"');
    expect(edit.source).toContain(
      'data-agent-native-motion-path-length="v1:html:absent"',
    );
    expect(readMotionHtmlSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["shape-path"],
    });
    expect(removeMotionHtmlSource(edit.source).source).toBe(svgSource);

    const invalidPathTarget = html.replace(
      'data-agent-native-node-id="hero-title"',
      'data-agent-native-node-id="shape-path"',
    );
    expect(() => apply(invalidPathTarget, { timeline })).toThrow(
      /must be an SVG path element/,
    );
  });

  it("persists pathLength for enabled native Path styles and restores it on removal", () => {
    const svgSource = html.replace(
      "  </main>",
      '  </main>\n  <svg><path data-agent-native-node-id="shape-path" d="M0 0L10 10"></path></svg>',
    );
    const timeline = makeTimeline("shape-path");
    timeline.nativeStyles = [
      createMotionNativeStyleInstance({
        styleKey: "Path",
        targetNodeId: "shape-path",
      }),
    ];
    const edit = apply(svgSource, { timeline });

    expect(edit.source).toContain('pathLength="100"');
    expect(readMotionHtmlSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["shape-path"],
    });
    expect(removeMotionHtmlSource(edit.source).source).toBe(svgSource);
  });

  it("rejects stale source and preview snapshots", () => {
    expect(() =>
      applyMotionHtmlSourceEdit({
        currentSource: `${html}<!-- newer -->`,
        expectedSource: html,
        preview: previewFor(html),
        timeline: makeTimeline(),
      }),
    ).toThrowError(expect.objectContaining({ code: "stale-source" }));

    expect(() =>
      applyMotionHtmlSourceEdit({
        currentSource: html,
        expectedSource: html,
        preview: { sourceHash: "0".repeat(64) },
        timeline: makeTimeline(),
      }),
    ).toThrowError(expect.objectContaining({ code: "stale-preview" }));
  });

  it("fails closed for missing, duplicate, or unsafe targets", () => {
    expect(() =>
      apply(html, { timeline: makeTimeline("missing-target") }),
    ).toThrow(MotionHtmlSourceError);
    expect(() =>
      apply(
        html.replace(
          "  </main>",
          '    <span data-agent-native-node-id="hero-title">Duplicate</span>\n  </main>',
        ),
      ),
    ).toThrow(/contains 2 elements/);
    expect(() =>
      apply(html, { timeline: makeTimeline('hero-title"] { color: red; }') }),
    ).toThrow(/not a safe static HTML node ID/);

    const templatedTarget = html.replace(
      `  <main class="card">\n    <h1 data-agent-native-node-id="hero-title">Hello</h1>\n  </main>`,
      '<template><h1 data-agent-native-node-id="hero-title">Hello</h1></template>',
    );
    expect(() => apply(templatedTarget)).toThrow(/inert HTML template/);
  });

  it("reports malformed and duplicate managed CSS instead of treating it as absent", () => {
    expect(
      readMotionHtmlSource(
        html.replace(
          "</head>",
          "<style data-agent-native-motion></style></head>",
        ),
      ),
    ).toMatchObject({
      status: "invalid",
      error: { code: "invalid-managed-style" },
    });

    const duplicate = html.replace(
      "</head>",
      "<style data-agent-native-motion></style><style data-agent-native-motion></style></head>",
    );
    expect(readMotionHtmlSource(duplicate)).toMatchObject({
      status: "invalid",
      error: { code: "ambiguous-managed-style" },
    });
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source: duplicate,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "ambiguous-managed-style",
    });

    const unclosedStyle = html.replace(
      "</head>",
      "<style data-agent-native-motion>body { color: red; </head>",
    );
    expect(readMotionHtmlSource(unclosedStyle)).toMatchObject({
      status: "invalid",
      error: { code: "malformed-source" },
    });
  });

  it("preserves authored rules and fails closed when managed CSS cannot be represented", () => {
    const authored = apply(html);
    const customRule =
      "@keyframes authored-pulse { from { opacity: 0; } to { opacity: 1; } }";
    const sourceWithCustomRule = authored.source.replace(
      authored.css,
      `${authored.css}\n${customRule}`,
    );

    expect(readMotionHtmlSource(sourceWithCustomRule)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-managed-style" },
    });
    expect(() =>
      applyMotionHtmlSourceEdit({
        currentSource: sourceWithCustomRule,
        expectedSource: sourceWithCustomRule,
        preview: previewFor(sourceWithCustomRule),
        timeline: makeTimeline(),
      }),
    ).toThrow(/authored rules the timeline cannot represent/);
    expect(sourceWithCustomRule).toContain(customRule);
  });

  it("reports malformed Motion Text source instead of treating it as absent", () => {
    const malformedText = html.replace(
      "</body>",
      '<script type="application/json" data-agent-native-motion-text-source="v1">{bad}</script></body>',
    );
    expect(readMotionHtmlSource(malformedText)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-motion-text" },
    });

    const templatedText = html.replace(
      "</body>",
      '<template><script type="application/json" data-agent-native-motion-text-source="v1">{bad}</script></template></body>',
    );
    expect(readMotionHtmlSource(templatedText)).toMatchObject({
      status: "invalid",
      error: { code: "invalid-motion-text" },
    });
  });

  it("rejects unsafe Motion CSS input", () => {
    const unsafe = makeTimeline();
    unsafe.tracks[0]!.keyframes[1]!.value = "url(https://example.com/a.png)";
    expect(() => apply(html, { timeline: unsafe })).toThrow(
      MotionHtmlSourceError,
    );
  });
});
