import { createHash } from "node:crypto";

import { generatedMotionNodeId } from "@agent-native/core/shared/motion-source-node-id";
import { describe, expect, it } from "vitest";

import {
  decodeMotionCodeMetadata,
  MOTION_CODE_METADATA_VERSION,
} from "./motion-code";
import {
  applyMotionHtmlSourceEdit,
  assertMotionHtmlSourceTargets,
  inspectMotionHtmlSourceWriteCapability,
  instrumentMotionHtmlPreviewSource,
  MotionHtmlSourceError,
  readMotionHtmlSource,
  removeMotionHtmlSource,
} from "./motion-html-source";
import { createMotionNativeStyleInstance } from "./motion-native-style-runtime";
import type { MotionTextDocument } from "./motion-text-code";
import motionTextRuntimeV1Template from "./motion-text-runtime-v1.fixture.txt?raw";
import type { MotionTimeline } from "./motion-timeline";

const html = `<!doctype html>
<html>
<head>
  <link rel="preload" as="style" href="./site.css">
  <script type="application/json" data-page-config>{"entry":"head"}</script>
</head>
<body>
  <main class="card">
    <h1 data-agent-native-node-id="hero-title">Hello</h1>
  </main>
  <script type="application/json" data-page-config>{"entry":"page"}</script>
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

function makePropertyTimeline(
  property: string,
  from: string,
  to: string,
): MotionTimeline {
  const timeline = makeTimeline();
  const track = timeline.tracks[0]!;
  return {
    ...timeline,
    tracks: [
      {
        ...track,
        property,
        keyframes: [
          { t: 0, value: from, ease: "linear" },
          { t: 1, value: to, ease: "ease-out" },
        ],
      },
    ],
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
  it("writes versioned CSS while preserving external assets and inert scripts", () => {
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
    expect(edit.source).toContain(
      '<script type="application/json" data-page-config>{"entry":"head"}</script>',
    );
    expect(edit.source).toContain(
      '<script type="application/json" data-page-config>{"entry":"page"}</script>',
    );
    expect(edit.source).toContain("agent-native-motion-source:v6:");
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

  it("fails closed when a Motion target has dynamic runtime-bound styles", () => {
    for (const attribute of [
      'x-transition.opacity=""',
      'x-bind="attrs"',
      ':style="style"',
      'x-bind:style="style"',
      'v-bind:style="style"',
      ':class="{ active: visible }"',
      'x-bind:class="classes"',
      'v-bind:class="classes"',
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

  it.each([
    ["Alpine HTML binding", 'x-html="runtimeCss"'],
    ["bound innerHTML", ':innerHTML="runtimeCss"'],
    ["Alpine bound innerHTML", 'x-bind:innerHTML="runtimeCss"'],
  ])("rejects a sibling %s inside a static Alpine scope", (_label, binding) => {
    const generated = apply(html).source;
    const source = generated
      .replace('<main class="card">', '<main class="card" x-data="{}">')
      .replace("  </main>", `    <div ${binding}></div>\n  </main>`);

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it("round-trips an Alpine visibility state through static HTML Motion source", () => {
    const source = html
      .replace(
        '<main class="card">',
        '<main x-data="{ open: true }" @click="open = !open">',
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        '<h1 data-agent-native-node-id="hero-title" x-show="open">Hello</h1>',
      )
      .replace(
        "</body>",
        '<script type="module">import Alpine from "alpinejs"; window.Alpine = Alpine; Alpine.start();</script>\n</body>',
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });

    const edit = apply(source);
    expect(edit.source).toContain('@click="open = !open"');
    expect(edit.source).toContain('x-show="open"');
    expect(readMotionHtmlSource(edit.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it("fails closed when an import map can redirect the managed Alpine runtime", () => {
    const source = html
      .replace(
        '<main class="card">',
        '<main x-data="{ open: true }" @click="open = !open">',
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        '<h1 data-agent-native-node-id="hero-title" x-show="open">Hello</h1>',
      )
      .replace(
        "</body>",
        '<script type="importmap">{"imports":{"alpinejs":"/custom-alpine.js"}}</script>\n<script type="module">import Alpine from "alpinejs"; Alpine.start();</script>\n</body>',
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
    });

    let writeError: unknown;
    try {
      apply(source);
    } catch (error) {
      writeError = error;
    }
    expect(writeError).toMatchObject({ code: "unsupported-target" });
  });

  it.each([
    ['x-show="visible"', '<main class="card">'],
    ['x-show="open || visible"', '<main x-data="{ open: true }">'],
    ['x-show="toggle()"', '<main x-data="{ open: true }">'],
    [
      'x-show="document.body.style.opacity = 0"',
      '<main x-data="{ open: true }">',
    ],
  ])(
    "fails closed for unproven Alpine visibility expression %s",
    (show, scope) => {
      const source = html
        .replace('<main class="card">', scope)
        .replace(
          '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
          `<h1 data-agent-native-node-id="hero-title" ${show}>Hello</h1>`,
        );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrow(
        /cannot be proven free of style mutations/,
      );
    },
  );

  it.each(["toggle()", "open = document.body.style.opacity = 0"])(
    "fails closed for Alpine visibility scopes with executable handlers %s",
    (handler) => {
      const source = html
        .replace(
          '<main class="card">',
          `<main x-data="{ open: true }" @click="${handler}">`,
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
          '<h1 data-agent-native-node-id="hero-title" x-show="open">Hello</h1>',
        );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrow(
        /cannot be proven free of style mutations/,
      );
    },
  );

  it.each([
    ["Vue v-show", 'v-show="visible"'],
    ["Vue class binding", 'v-bind:class="classes"'],
    ["Vue style binding", 'v-bind:style="style"'],
  ])(
    "fails closed when a Motion target has an ancestor with %s",
    (_label, attribute) => {
      const source = html.replace(
        '<main class="card">',
        `<main class="card" ${attribute}>`,
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
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it("rejects Vue style bindings found in a Motion target's runtime scope", () => {
    const source = html
      .replace('<main class="card">', '<main class="card" v-scope="{}">')
      .replace(
        "</main>",
        '<aside v-bind:style="runtimeStyles"></aside>\n  </main>',
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("v-bind:style"),
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it.each([
    ["Alpine initialization", "x-init=\"$el.style.transition = 'opacity 1s'\""],
    ["Alpine effect", "x-effect=\"$el.style.animation = 'pulse 1s'\""],
    [
      "Alpine shorthand event",
      "@click=\"$el.style.transitionDuration = '1s'\"",
    ],
    [
      "Alpine event directive",
      "x-on:click=\"$el.style.setProperty('transition', 'opacity 1s')\"",
    ],
    ["Vue event directive", "v-on:click=\"$el.style.animationName = 'pulse'\""],
    [
      "native click handler",
      "onclick=\"this.style.transition = 'opacity 1s'\"",
    ],
    ["native load handler", "onload=\"this.style.animation = 'pulse 1s'\""],
  ])(
    "rejects %s on a Motion target and preserves the HTML source",
    (_label, attribute) => {
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
      expect(source).toContain(attribute);
    },
  );

  it("rejects scoped sibling event handlers that can mutate a Motion target ref", () => {
    const scopeAttrs = 'x-data="{ open: true }"';
    const targetMarkup =
      '<h1 x-ref="hero" data-agent-native-node-id="hero-title">Hello</h1>';
    const siblingMarkup =
      "<button @click=\"$refs.hero.style.setProperty('transition', 'opacity 1s')\">Toggle</button>";
    const source = html
      .replace('<main class="card">', `<main class="card" ${scopeAttrs}>`)
      .replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        targetMarkup,
      )
      .replace("</main>", `${siblingMarkup}\n  </main>`);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("@click"),
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );

    const generated = apply(html)
      .source.replace(
        '<main class="card">',
        `<main class="card" ${scopeAttrs}>`,
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        targetMarkup,
      )
      .replace("</main>", `${siblingMarkup}\n  </main>`);
    expect(readMotionHtmlSource(generated, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it("does not reject runtime handlers outside the target's owning scope", () => {
    const source = html
      .replace(
        '<main class="card">',
        '<main class="card" x-data="{ open: true }">',
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        '<h1 x-ref="hero" data-agent-native-node-id="hero-title">Hello</h1>',
      )
      .replace(
        '<script type="application/json" data-page-config>{"entry":"page"}</script>',
        '<aside @click="$refs.hero.style.setProperty(\'transition\', \'opacity 1s\')"></aside>\n  <script type="application/json" data-page-config>{"entry":"page"}</script>',
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });

    const written = apply(source);
    expect(readMotionHtmlSource(written.source, "index.html")).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it("rejects native inline handlers on siblings that can mutate Motion targets", () => {
    const siblingHandler = `<button onclick="document.querySelector('[data-agent-native-node-id=hero-title]').style.setProperty('transition', 'opacity 1s')">Toggle</button>`;
    const source = html.replace("</main>", `${siblingHandler}\n  </main>`);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("onclick"),
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );

    const generated = apply(html).source.replace(
      "</main>",
      `${siblingHandler}\n  </main>`,
    );
    expect(readMotionHtmlSource(generated, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    [
      "an unrelated important property",
      `v-bind="{ style: 'color: red !important' }"`,
    ],
    ["a null style value", `v-bind="{ style: null }"`],
  ])("allows %s on a Motion target", (_label, binding) => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">',
      `<h1 ${binding} data-agent-native-node-id="hero-title">`,
    );

    expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
      status: "valid",
    });
  });

  it.each([
    ["Alpine initialization", "x-init"],
    ["Alpine effect", "x-effect"],
  ])(
    "rejects sibling %s directives that can mutate a document-selected Motion target",
    (_label, directive) => {
      const sourceWithTargetId = html.replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1>',
      );
      const mutatingDirective = `${directive}="document.querySelector('#hero-title').style.opacity = '0'"`;
      const source = sourceWithTargetId.replace(
        "</main>",
        `<button ${mutatingDirective}>Toggle</button>\n  </main>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({
        status: "unsupported",
        code: "unsupported-target",
        reason: expect.stringContaining(directive),
      });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );

      const generated = apply(sourceWithTargetId).source.replace(
        "</main>",
        `<button ${mutatingDirective}>Toggle</button>\n  </main>`,
      );
      expect(readMotionHtmlSource(generated, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
    },
  );

  it("allows native handlers that are static or select only unrelated markup", () => {
    const safeTargetHandler = html.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 onclick="console.log(\'clicked\')" data-agent-native-node-id="hero-title">Hello</h1>',
    );
    const unrelatedSelectorHandler = html.replace(
      "</main>",
      "<aside id=\"footer\">Footer</aside>\n    <button onclick=\"document.querySelector('#footer').style.opacity = '0'\">Toggle</button>\n  </main>",
    );

    for (const source of [safeTargetHandler, unrelatedSelectorHandler]) {
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
      expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
        status: "valid",
        targetNodeIds: ["hero-title"],
      });
    }
  });

  it.each([
    ["event.target", "onclick=\"event.target.style.opacity = '0'\"", "target"],
    ["e.target", "onclick=\"e.target.classList.add('hidden')\"", "target"],
    [
      "$event.target",
      "@click=\"$event.target.setAttribute('data-state', 'hidden')\"",
      "target",
    ],
    [
      "an ancestor event.target",
      "onclick=\"event.target.style.opacity = '0'\"",
      "ancestor",
    ],
  ])(
    "rejects direct %s mutations that may target a Motion node",
    (_label, attribute, location) => {
      const source =
        location === "ancestor"
          ? html.replace(
              '<main class="card">',
              `<main class="card" ${attribute}>`,
            )
          : html.replace(
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
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it("allows static sibling markup without executable inline handlers", () => {
    const source = html.replace(
      "</main>",
      '<button type="button">Toggle</button>\n  </main>',
    );

    const unrelatedResult = inspectMotionHtmlSourceWriteCapability({
      source,
      targetNodeIds: ["hero-title"],
    });
    expect(unrelatedResult).toMatchObject({
      status: "supported",
      targetNodeIds: ["hero-title"],
    });
    expect(
      readMotionHtmlSource(apply(source).source, "index.html"),
    ).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it.each([
    [
      "Alpine",
      `@click="document.querySelector('#hero-title').style.opacity = '0'"`,
    ],
    [
      "Vue",
      `v-on:click="window.document.getElementById('hero-title').style.setProperty('transition', 'opacity 1s')"`,
    ],
  ])(
    "rejects sibling %s handlers that select and mutate a Motion target",
    (_label, attribute) => {
      const source = html
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        )
        .replace("</main>", `<button ${attribute}>Toggle</button>\n  </main>`);

      const result = inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      });
      expect(result).toMatchObject({
        status: "unsupported",
        code: "unsupported-target",
        reason: expect.stringContaining(attribute.split("=")[0]!),
      });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it("allows read-only classList checks alongside unrelated document updates", () => {
    const handlers = [
      `onclick="const active = this.classList.contains('active'); this.ownerDocument.title = active ? 'Active' : 'Idle'"`,
      `onclick="const active = this.ownerDocument.querySelector('[data-agent-native-node-id=hero-title]').classList.contains('hidden'); this.ownerDocument.title = active ? 'Hidden' : 'Visible'"`,
    ];

    for (const handler of handlers) {
      const source = html.replace(
        "</main>",
        `<button ${handler}>Toggle</button>\n  </main>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
      expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
        status: "valid",
        targetNodeIds: ["hero-title"],
      });
    }
  });

  it.each([
    [
      "Alpine class selector",
      `@click="document.querySelector('.hero').style.opacity = '0'"`,
    ],
    [
      "Vue ID selector",
      `v-on:click="window.document.querySelector('#hero').classList.add('hidden')"`,
    ],
  ])(
    "rejects sibling %s handlers that select a Motion target by authored class or ID",
    (_label, attribute) => {
      const source = html
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero" class="hero" data-agent-native-node-id="hero-title">',
        )
        .replace("</main>", `<button ${attribute}>Toggle</button>\n  </main>`);

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
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it("rejects Array.from selector callbacks that mutate a Motion target", () => {
    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      )
      .replace(
        "</main>",
        `<button onclick="Array.from(document.querySelectorAll('#hero-title')).forEach(el => el.style.opacity = '0')">Toggle</button>\n  </main>`,
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
    const generated = apply(
      html.replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      ),
    ).source.replace(
      "</main>",
      `<button onclick="Array.from(document.querySelectorAll('#hero-title')).forEach(el => el.style.opacity = '0')">Toggle</button>\n  </main>`,
    );
    expect(readMotionHtmlSource(generated)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    [
      "Array.from map callbacks",
      `onclick="Array.from(document.querySelectorAll('#hero-title'), el => { el.style.opacity = '0' })"`,
    ],
    [
      "for-of loops",
      `onclick="for (const el of document.querySelectorAll('#hero-title')) { el.style.opacity = '0' }"`,
    ],
  ])(
    "rejects querySelectorAll %s that mutate a Motion target",
    (_label, handler) => {
      const source = html
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        )
        .replace("</main>", `<button ${handler}>Toggle</button>\n  </main>`);

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );

      const generated = apply(
        html.replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        ),
      ).source.replace(
        "</main>",
        `<button ${handler}>Toggle</button>\n  </main>`,
      );
      expect(readMotionHtmlSource(generated)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
    },
  );

  it("allows a sibling selector that resolves to a different stable HTML target", () => {
    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero" class="hero" data-agent-native-node-id="hero-title">',
      )
      .replace(
        "</main>",
        "<aside id=\"footer\">Footer</aside>\n    <button @click=\"document.querySelector('#footer').style.opacity = '0'\">Toggle</button>\n  </main>",
      );

    const unrelatedResult = inspectMotionHtmlSourceWriteCapability({
      source,
      targetNodeIds: ["hero-title"],
    });
    expect(unrelatedResult).toMatchObject({
      status: "supported",
      targetNodeIds: ["hero-title"],
    });
    expect(
      readMotionHtmlSource(apply(source).source, "index.html"),
    ).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it("does not associate a selector read with a separate mutation sink", () => {
    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero" data-agent-native-node-id="hero-title">',
      )
      .replace(
        "</main>",
        `<aside id="footer">Footer</aside>
    <button onclick="document.querySelector('#hero'); document.querySelector('#footer').style.opacity = '0'">Toggle</button>
  </main>`,
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    expect(
      readMotionHtmlSource(apply(source).source, "index.html"),
    ).toMatchObject({ status: "valid", targetNodeIds: ["hero-title"] });
  });

  it("matches selectors against path-generated Motion targets while reading source", () => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">',
      '<h1 id="hero" class="hero">',
    );
    const preview = instrumentMotionHtmlPreviewSource({
      source,
      sourceFilePath: "index.html",
    });
    const targetNodeId = /<h1\b[^>]*\bdata-agent-native-node-id="([^"]+)"/.exec(
      preview.source,
    )?.[1];
    expect(targetNodeId).toBeTruthy();
    if (!targetNodeId)
      throw new Error("The preview did not assign an H1 target ID.");

    const written = apply(source, {
      sourceFilePath: "index.html",
      timeline: makeTimeline(targetNodeId),
    });
    const sourceWithoutInsertedId = written.source.replace(
      ` data-agent-native-node-id="${targetNodeId}"`,
      "",
    );
    const sourceWithHandler = sourceWithoutInsertedId.replace(
      "</main>",
      "<button @click=\"document.querySelector('.hero').style.opacity = '0'\">Toggle</button>\n  </main>",
    );

    expect(readMotionHtmlSource(sourceWithHandler, "index.html")).toMatchObject(
      {
        status: "invalid",
        error: { code: "unsupported-target" },
      },
    );
  });

  it.each([
    ["dynamic", `document.querySelector(selector)`],
    ["unsupported", `document.querySelector('.hero > span')`],
  ])(
    "fails closed for %s document selectors in a mutating event handler",
    (_label, call) => {
      const source = html
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 class="hero" data-agent-native-node-id="hero-title">',
        )
        .replace(
          "</main>",
          `<button @click="${call}.style.opacity = '0'">Toggle</button>\n  </main>`,
        );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it("allows read-only destructured selector results and iterations", () => {
    const handlers = [
      `onclick="const { style } = document.querySelector('#hero-title'); document.title = style.opacity"`,
      `onclick="const { style } = document.querySelector('#hero-title'); const styleAlias = style; document.title = styleAlias.opacity"`,
      `onclick="document.querySelectorAll('#hero-title').forEach(({ style }) => { const opacity = style.opacity })"`,
      `onclick="[...this.ownerDocument.querySelectorAll('#hero-title')].forEach(target => { const opacity = target.style.opacity })"`,
      `onclick="for (const target of [...this.ownerDocument.querySelectorAll('#hero-title')]) { const opacity = target.style.opacity }"`,
    ];

    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      )
      .replace(
        "</main>",
        `${handlers.map((handler) => `<button ${handler}>Read</button>`).join("\n")}\n  </main>`,
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
  });

  it.each([
    [
      "an event target alias traversing to a sibling with bracket access",
      `onclick="const origin = event['target']; const sibling = origin['previousElementSibling']; sibling['classList'].add('hidden')"`,
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
    ],
    [
      "a selected ancestor traversing to a Motion target",
      `onclick="const lead = document.querySelector('#lead'); const hero = lead['parentElement'].querySelector('[data-agent-native-node-id=hero-title]'); hero['style']['opacity'] = '0'"`,
      '<span id="lead"></span><h1 data-agent-native-node-id="hero-title">Hello</h1>',
    ],
  ])(
    "rejects handlers that reach Motion targets through %s",
    (_label, handler, markup) => {
      const source = html
        .replace(
          '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
          markup,
        )
        .replace("</main>", `<button ${handler}>Toggle</button>\n  </main>`);

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it.each([
    [
      "this.querySelector on an ancestor",
      `onclick="this.querySelector('h1').style.opacity = '0'"`,
    ],
    [
      "querySelectorAll through an event-currentTarget alias",
      `onclick="const scope = event.currentTarget; const headings = scope.querySelectorAll('h1'); headings[0].style.opacity = '0'"`,
    ],
    [
      "querySelectorAll on an Alpine ancestor",
      `@click="this.querySelectorAll('h1')[0].classList.add('hidden')"`,
    ],
    [
      "getElementsByTagName on an ancestor",
      `onclick="this.getElementsByTagName('h1')[0].style.opacity = '0'"`,
    ],
  ])(
    "rejects element-scoped selector mutations that can reach a Motion target through %s",
    (_label, handler) => {
      const source = html.replace(
        '<main class="card">',
        `<main class="card" ${handler}>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      const generated = apply(html).source.replace(
        '<main class="card">',
        `<main class="card" ${handler}>`,
      );
      expect(readMotionHtmlSource(generated)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
    },
  );

  it.each([
    ["a `this` alias", `onclick="var el = this; el.style.opacity = '0'"`],
    ["bracket access on `this`", `onclick="this['style']['opacity'] = '0'"`],
    ["toggleAttribute", `onclick="this.toggleAttribute('style')"`],
    [
      "toggleAttribute through an alias",
      `onclick="const target = this; target.toggleAttribute('style')"`,
    ],
    [
      "setAttributeNS",
      `onclick="this.setAttributeNS(null, 'style', 'opacity: 0')"`,
    ],
    [
      "setAttributeNS through bracket access and an alias",
      `onclick="const target = this; target['setAttributeNS'](null, 'style', 'opacity: 0')"`,
    ],
  ])("rejects direct Motion target mutation through %s", (_label, handler) => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      `<h1 data-agent-native-node-id="hero-title" ${handler}>Hello</h1>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it.each([
    [
      "ownerDocument selectors",
      `onclick="this.ownerDocument.querySelector('[data-agent-native-node-id=hero-title]').style.opacity = '0'"`,
    ],
    [
      "getRootNode selectors",
      `onclick="this.getRootNode().querySelector('[data-agent-native-node-id=hero-title]').style.opacity = '0'"`,
    ],
    [
      "Object.assign on a selected style",
      `onclick="const target = this.getRootNode().querySelector('[data-agent-native-node-id=hero-title]'); Object.assign(target.style, { opacity: '0' })"`,
    ],
    [
      "a destructured classList alias",
      `onclick="const { classList: classes } = this.ownerDocument.querySelector('[data-agent-native-node-id=hero-title]'); classes.toggle('hidden')"`,
    ],
  ])(
    "fails closed for alternate DOM mutation through %s",
    (_label, handler) => {
      const source = html.replace(
        "</main>",
        `<button ${handler}>Toggle</button>\n  </main>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );

      const generated = apply(html).source.replace(
        "</main>",
        `<button ${handler}>Toggle</button>\n  </main>`,
      );
      expect(readMotionHtmlSource(generated)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
    },
  );

  it.each([
    [
      "$el alternate root",
      `@click="$el.ownerDocument.querySelector('#hero-title').style.opacity = '0'"`,
    ],
    [
      "a destructured style binding",
      `onclick="const { style } = this.ownerDocument.querySelector('#hero-title'); style.opacity = '0'"`,
    ],
    [
      "a directly selected destructured style binding",
      `onclick="const { style } = document.querySelector('#hero-title'); style.color = 'red'"`,
    ],
    [
      "an aliased destructured style binding",
      `onclick="const { style: targetStyle } = this.ownerDocument.querySelector('#hero-title'); targetStyle.setProperty('opacity', '0')"`,
    ],
    [
      "an aliased destructured style binding from a document selector",
      `onclick="const { style: targetStyle } = document.querySelector('#hero-title'); targetStyle.removeProperty('opacity')"`,
    ],
    [
      "a chained destructured style alias",
      `onclick="const { style: targetStyle } = this.ownerDocument.querySelector('#hero-title'); const s = targetStyle; s.opacity = '0'"`,
    ],
    [
      "a chained destructured style alias passed to Object.assign",
      `onclick="const { style: targetStyle } = this.ownerDocument.querySelector('#hero-title'); const s = targetStyle; Object.assign(s, { opacity: '0' })"`,
    ],
    [
      "a destructured querySelectorAll callback",
      `onclick="document.querySelectorAll('#hero-title').forEach(({ style }) => { style.opacity = '0' })"`,
    ],
    [
      "a spread querySelectorAll result",
      `onclick="[...this.ownerDocument.querySelectorAll('#hero-title')].forEach(target => { target.style.opacity = '0' })"`,
    ],
    [
      "a querySelectorAll for-of loop",
      `onclick="for (const target of this.ownerDocument.querySelectorAll('#hero-title')) { target.style.opacity = '0' }"`,
    ],
    [
      "a spread querySelectorAll for-of loop",
      `onclick="for (const target of [...this.ownerDocument.querySelectorAll('#hero-title')]) { target.style.opacity = '0' }"`,
    ],
  ])(
    "rejects sibling handlers that mutate a Motion target through %s",
    (_label, handler) => {
      const source = html
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        )
        .replace("</main>", `<button ${handler}>Toggle</button>\n  </main>`);

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it.each([
    [
      "toggleAttribute",
      `onclick="document.querySelector('[data-agent-native-node-id=hero-title]').toggleAttribute('hidden')"`,
    ],
    [
      "setAttributeNS",
      `onclick="document.querySelector('[data-agent-native-node-id=hero-title]').setAttributeNS(null, 'style', 'opacity: 0')"`,
    ],
  ])("rejects selector-based %s mutations", (_label, handler) => {
    const source = html.replace(
      "</main>",
      `<button ${handler}>Toggle</button>\n  </main>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it("fails closed for handlers that create or mutate runtime stylesheets", () => {
    for (const handler of [
      `const sheet = new CSSStyleSheet(); sheet.addRule('[data-agent-native-node-id=hero-title]', 'opacity: 0')`,
      `const style = document.createElement('style'); style.textContent = '[data-agent-native-node-id=hero-title] { opacity: 0 }'; document.head.appendChild(style)`,
    ]) {
      const source = html.replace(
        "</main>",
        `<button onclick="${handler}">Toggle</button>\n  </main>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    }
  });

  it.each([
    [
      "inline script",
      `<script>document.querySelector('[data-agent-native-node-id="hero-title"]').classList.add('fade');document.querySelector('[data-agent-native-node-id="hero-title"]').style.opacity='0';</script>`,
    ],
    [
      "module script",
      `<script type="module">document.querySelector('[data-agent-native-node-id="hero-title"]').classList.add('fade');</script>`,
    ],
    ["external script", '<script src="./motion.js"></script>'],
    [
      "inert script with modified Alpine HTML binding",
      '<script type="text/plain" x-html.foo="markup"></script>',
    ],
  ])(
    "rejects %s when HTML Motion targets cannot be proven safe",
    (_label, script) => {
      const source = html.replace("</body>", `${script}\n</body>`);
      const generated = apply(html).source.replace(
        "</body>",
        `${script}\n</body>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
      expect(readMotionHtmlSource(generated, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(() => apply(generated)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  const TAILWIND_CDN =
    '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>';
  const ALPINE_CDN =
    '<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>';

  it("accepts the Tailwind and Alpine scripts every generated design loads", () => {
    const source = html.replace(
      "</body>",
      `${TAILWIND_CDN}\n${ALPINE_CDN}\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
    expect(() => apply(source)).not.toThrow();
  });

  it.each([
    [
      "a different package on jsDelivr",
      '<script src="https://cdn.jsdelivr.net/npm/alpinejs-lookalike@3.15.11/dist/cdn.min.js"></script>',
    ],
    [
      "the Alpine path on another host",
      '<script src="https://cdn.example.com/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>',
    ],
    [
      "a query string on the Alpine URL",
      '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js?payload=1"></script>',
    ],
    [
      "inline code alongside the Alpine src",
      '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js">document.body.className = "x"</script>',
    ],
    [
      "an onload handler on the Tailwind script",
      '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" onload="document.body.className = \'x\'"></script>',
    ],
  ])("still rejects %s", (_label, script) => {
    const source = html.replace("</body>", `${script}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    [
      "an x-text expression",
      `<p x-data x-text="document.querySelector('[data-agent-native-node-id=hero-title]').classList.add('fade') || 'x'"></p>`,
    ],
    [
      "a :class expression",
      `<p x-data :class="document.querySelector('[data-agent-native-node-id=hero-title]').style.opacity = '0'"></p>`,
    ],
    [
      "an x-bind expression",
      `<p x-data x-bind:title="document.querySelector('[data-agent-native-node-id=hero-title]').classList.add('fade')"></p>`,
    ],
  ])(
    "rejects %s on a sibling that changes a Motion target when Alpine loads from the CDN",
    (_label, sibling) => {
      const source = html.replace(
        "</body>",
        `${sibling}\n${ALPINE_CDN}\n</body>`,
      );
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it("rejects a sibling class binding that can activate a relational CSS rule for a target", () => {
    const source = html
      .replace(
        "<head>",
        `<head><style>.active + .card #hero-title { opacity: 0 !important; }</style>`,
      )
      .replace(
        '<main class="card">',
        '<nav x-data="{ active: false }" :class="{ active }"></nav>\n  <main class="card">',
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("runtime HTML state can change CSS"),
    });
    const existingMotion = apply(html)
      .source.replace(
        "<head>",
        `<head><style>.active + .card #hero-title { opacity: 0 !important; }</style>`,
      )
      .replace(
        '<main class="card">',
        '<nav x-data="{ active: false }" :class="{ active }"></nav>\n  <main class="card">',
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(readMotionHtmlSource(existingMotion)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it.each([
    ["an escaped animated CSS property", "op\\61 city"],
    ["a class binding modifier", "opacity"],
  ])("rejects relational CSS with %s", (_label, property) => {
    const binding =
      property === "opacity"
        ? 'x-bind:class.attr="{ active }"'
        : ':class="{ active }"';
    const source = `<!doctype html><html><head><style>.active + #hero-title { ${property}: 0 !important; }</style></head><body><nav x-data="{ active: false }" ${binding}></nav><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1>${ALPINE_CDN}</body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    ["an explicit binding", ':data-active="active"'],
    ["a generic object binding", `x-bind="{ 'data-active': active }"`],
    ["a static generic object binding", `x-bind="{ 'data-active': 'yes' }"`],
  ])(
    "rejects %s that can activate a relational CSS rule",
    (_label, binding) => {
      const withBinding = (source: string) =>
        source
          .replace(
            "<head>",
            `<head><style>[data-active] + .card #hero-title { opacity: 0 !important; }</style>`,
          )
          .replace(
            '<main class="card">',
            `<nav x-data="{ active: false }" ${binding}></nav>\n  <main class="card">`,
          )
          .replace(
            '<h1 data-agent-native-node-id="hero-title">',
            '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
          )
          .replace("</body>", `${ALPINE_CDN}\n</body>`);
      const source = withBinding(html);
      const existingMotion = withBinding(apply(html).source);

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(readMotionHtmlSource(existingMotion)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it.each([
    ["a static class assignment", `x-bind="{ class: 'active' }"`],
    ["a static data attribute assignment", `x-bind="{ 'data-active': 'yes' }"`],
  ])(
    "rejects %s that can activate a relational CSS rule",
    (_label, binding) => {
      const source = `<!doctype html><html><head><style>.active + #hero-title, [data-active] + #hero-title { opacity: 0 !important; }</style></head><body><nav ${binding}></nav><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1>${ALPINE_CDN}</body></html>`;

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it("fails closed when an escaped Alpine object key can write a Motion target class", () => {
    const source = `<!doctype html><html><head><style>.active + #hero-title { opacity: 0 !important; }</style></head><body><nav x-bind="{ 'cl\\u0061ss': 'active' }"></nav><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it("rejects stylesheet !important rules that match a Motion target", () => {
    const withRule = (source: string) =>
      source
        .replace(
          "<head>",
          "<head><style>#hero-title { opacity: 0 !important; }</style>",
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        );
    const source = withRule(html);
    const existingMotion = withRule(apply(html).source);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(readMotionHtmlSource(existingMotion)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it.each([
    ":nth-child(1)",
    ":nth-child(2n + 1)",
    ":nth-last-child(1)",
    ":nth-last-child(2)",
    ":first-of-type",
    ":nth-of-type(1)",
    ":nth-last-of-type(1)",
    ":nth-child(-n + 3 of p)",
    ":only-of-type",
  ])(
    "allows a structural !important rule that does not match: %s",
    (pseudo) => {
      const source = `<!doctype html><html><head><style>.card > h1${pseudo} { opacity: 0 !important; }</style></head><body><main class="card"><h1>Intro</h1><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1><p>Details</p><h1>Outro</h1></main></body></html>`;

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
      expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
        status: "valid",
      });
    },
  );

  it.each([
    ":nth-child(2)",
    ":nth-child(2n)",
    ":nth-last-child(3)",
    ":nth-of-type(2)",
    ":nth-of-type(2n)",
    ":nth-child(2 of h1)",
    ":nth-child(2n of h1)",
  ])("rejects a structural !important rule that matches: %s", (pseudo) => {
    const source = `<!doctype html><html><head><style>.card > h1${pseudo} { opacity: 0 !important; }</style></head><body><main class="card"><h1>Intro</h1><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1><p>Details</p><h1>Outro</h1></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects nth-child rules filtered by the target node ID", () => {
    const source = `<!doctype html><html><head><style>.card > h1:nth-child(1 of [data-agent-native-node-id="hero-title"]) { opacity: 0 !important; }</style></head><body><main class="card"><h1>Intro</h1><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1><p>Details</p><h1>Outro</h1></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects positional selectors when a sibling can mutate at runtime", () => {
    const source = `<!doctype html><html><head><style>.card > h1:nth-child(1) { opacity: 0 !important; }</style></head><body><main class="card"><h1 onclick="this.remove()">Intro</h1><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    ["Alpine initialization", 'x-init="$el.remove()"'],
    ["Alpine effect", 'x-effect="$el.remove()"'],
  ])(
    "rejects positional selectors when %s can remove a sibling",
    (_label, directive) => {
      const source = `<!doctype html><html><head><style>.card > h1:nth-child(1) { opacity: 0 !important; }</style></head><body><main class="card"><h1 ${directive}>Intro</h1><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1></main></body></html>`;

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it("allows positional selectors when a sibling only changes its class", () => {
    const source = `<!doctype html><html><head><style>.card > h1:nth-child(1) { opacity: 0 !important; }</style></head><body><main class="card"><h1 x-bind:class="active ? 'active' : ''">Intro</h1><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
  });

  it("rejects filtered positional selectors with unsupported pseudo semantics", () => {
    const source = `<!doctype html><html><head><style>.card > h1:nth-child(1 of :lang(en)) { opacity: 0 !important; }</style></head><body><main class="card"><h1 lang="fr">Intro</h1><h1 lang="en" id="hero-title" data-agent-native-node-id="hero-title">Hello</h1></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects relational :has() selectors in filtered positional selectors", () => {
    const source = `<!doctype html><html><head><style>.card > section:nth-child(1 of :has(> p)) { opacity: 0 !important; }</style></head><body><main class="card"><section>Intro</section><section id="hero-title" data-agent-native-node-id="hero-title"><p>Hello</p></section></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects unknown pseudos nested in :not() selectors", () => {
    const source = `<!doctype html><html><head><style>.card > h1:not(:lang(fr)) { opacity: 0 !important; }</style></head><body><main class="card"><h1 lang="en" id="hero-title" data-agent-native-node-id="hero-title">Hello</h1></main></body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each(["is", "where"])(
    "fails closed for relational selectors inside :%s()",
    (pseudo) => {
      const source = html
        .replace(
          "<head>",
          "<head><style>:" +
            pseudo +
            "(main #hero-title) { opacity: 0 !important; }</style>",
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it.each([
    ["animation", "pulse 1s"],
    ["animation-name", "pulse"],
    ["animation-duration", "2s"],
  ])("rejects stylesheet !important %s conflicts", (property, value) => {
    const source = html
      .replace(
        "<head>",
        `<head><style>#hero-title { ${property}: ${value} !important; }</style>`,
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      );

    expect(() =>
      assertMotionHtmlSourceTargets({ source, targetNodeIds: ["hero-title"] }),
    ).toThrowError(expect.objectContaining({ code: "unsupported-target" }));
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported" });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it("rejects an important mask shorthand that resets an animated mask property", () => {
    const authored = apply(
      html.replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      ),
      {
        timeline: makePropertyTimeline("mask-position", "0% 0%", "100% 100%"),
      },
    ).source;
    expect(readMotionHtmlSource(authored)).toMatchObject({
      status: "valid",
      document: {
        tracks: [expect.objectContaining({ property: "mask-position" })],
      },
    });
    const source = authored.replace(
      "<head>",
      '<head><style>#hero-title { mask: url("mask.svg") center / cover !important; }</style>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it("rejects vendor-prefixed important declarations for Motion properties", () => {
    const authored = apply(html, {
      timeline: makePropertyTimeline("transform", "none", "translateX(10px)"),
    })
      .source.replace(
        "<head>",
        "<head><style>#hero-title { -webkit-transform: none !important; }</style>",
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      );

    expect(readMotionHtmlSource(authored)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source: authored,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("inspects stylesheet rules inside Alpine structural templates", () => {
    const withTemplateStyle = (source: string) =>
      source
        .replace(
          '<main class="card">',
          '<main class="card" x-data="{ active: false }"><template x-if="active"><style>#hero-title { opacity: 0 !important; }</style></template>',
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        )
        .replace("</body>", `${ALPINE_CDN}\n</body>`);
    const source = withTemplateStyle(html);
    const existingMotion = withTemplateStyle(apply(html).source);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(readMotionHtmlSource(existingMotion)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
  });

  it("fails closed when an authored stylesheet cannot be parsed", () => {
    const source = html.replace(
      "<head>",
      "<head><style>#hero-title { opacity: 0 !important;</style>",
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported" });
  });

  it("rejects x-text that changes a relational :empty selector when Alpine loads", () => {
    const source = `<!doctype html><html><head><style>.card:empty + #hero-title { opacity: 0 !important; }</style></head><body x-data="{ label: 'Ready' }"><div class="card" x-text="label"></div><h1 id="hero-title" data-agent-native-node-id="hero-title">Hello</h1>${ALPINE_CDN}</body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects x-text that can make a nonempty Motion target match :empty", () => {
    const withConflict = (source: string) =>
      source
        .replace(
          "<head>",
          "<head><style>#hero-title:empty { opacity: 0 !important; }</style>",
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title" x-data="{ label: \'\' }" x-text="label">Hello</h1>',
        )
        .replace("</body>", `${ALPINE_CDN}\n</body>`);
    const source = withConflict(html);
    const existingMotion = withConflict(apply(html).source);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(readMotionHtmlSource(existingMotion)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it("allows a structural sibling that cannot change the target's :empty state", () => {
    const source = `<!doctype html><html><head><style>#hero-title:not(:empty) { opacity: 0 !important; }</style></head><body x-data="{ active: false }"><h1 id="hero-title" data-agent-native-node-id="hero-title"></h1><template x-if="active"><i></i></template>${ALPINE_CDN}</body></html>`;

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
  });

  it.each([
    [
      "a title-only descendant binding",
      '<span x-bind="{ title: title }">Hello</span>',
      "supported",
    ],
    [
      "a class binding on a descendant",
      "<span :class=\"active ? 'active' : ''\">Hello</span>",
      "unsupported",
    ],
  ])(
    "classifies :has() based on relevant descendant changes: %s",
    (_label, child, status) => {
      const source = `<!doctype html><html><head><style>#hero-title:has(.active) { opacity: 0 !important; }</style></head><body x-data="{ title: 'tip', active: false }"><h1 id="hero-title" data-agent-native-node-id="hero-title">${child}</h1>${ALPINE_CDN}</body></html>`;

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({
        status,
        ...(status === "unsupported" ? { code: "unsupported-target" } : {}),
      });
    },
  );

  it("allows unrelated relational CSS when a runtime class binding cannot reach the Motion target", () => {
    const source = html
      .replace(
        "<head>",
        `<head><style>.sidebar a { opacity: 0 !important; }</style>`,
      )
      .replace(
        '<main class="card">',
        '<nav x-data="{ active: false }" :class="{ active }"></nav>\n  <main class="card">',
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    const edit = apply(source);
    expect(readMotionHtmlSource(edit.source)).toMatchObject({
      status: "valid",
    });
  });

  it.each([
    ["x-if", 'x-if="open"', "<i></i>"],
    ["x-for", 'x-for="item in [1, 2]"', "<i></i>"],
  ])(
    "rejects %s insertion that can change a Motion target's relational selector",
    (_label, directive, content) => {
      const withStructuralTemplate = (source: string) =>
        source
          .replace(
            "<head>",
            `<head><style>.card > :nth-child(2) { opacity: 0 !important; }</style>`,
          )
          .replace(
            '<main class="card">',
            `<main class="card" x-data="{ open: false }"><template ${directive}>${content}</template>`,
          )
          .replace(
            '<h1 data-agent-native-node-id="hero-title">',
            '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
          )
          .replace(
            "</main>",
            '<button @click="open = !open">Toggle</button></main>',
          )
          .replace("</body>", `${ALPINE_CDN}\n</body>`);
      const source = withStructuralTemplate(html);
      const existingMotion = withStructuralTemplate(apply(html).source);

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(readMotionHtmlSource(existingMotion)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it("allows a literal attributes-only Alpine object binding on an ancestor", () => {
    const source = html
      .replace(
        '<main class="card">',
        '<main class="card" x-bind="{ title: \'label\' }">',
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
      status: "valid",
    });
  });

  it("allows a normal hover declaration on an animated property", () => {
    const source = html
      .replace(
        "<head>",
        "<head><style>#hero-title:hover { opacity: 0.8; transition: color 1s; }</style>",
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
      status: "valid",
    });
  });

  it.each([
    ["a plain object key", `x-bind="{ style: 'opacity: 0 !important' }"`],
    [
      "an escaped object key",
      `v-bind="{ 'st\\u0079le': 'opacity: 0 !important' }"`,
    ],
  ])("rejects %s with an important Motion override", (_label, binding) => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">',
      `<h1 ${binding} data-agent-native-node-id="hero-title">`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
    const existingMotion = apply(html).source.replace(
      '<h1 data-agent-native-node-id="hero-title">',
      `<h1 ${binding} data-agent-native-node-id="hero-title">`,
    );
    expect(readMotionHtmlSource(existingMotion)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    [
      "a nested selector",
      `:is([data-active]) + .card #hero-title`,
      '<nav x-data="{ active: false }" :data-active="active"></nav>\n  <main class="card">',
    ],
    [
      "a browser interaction state",
      `#hero-title:hover`,
      '<nav></nav>\n  <main class="card">',
    ],
  ])(
    "rejects %s CSS that can change an animated property at runtime",
    (_label, selector, nav) => {
      const withRule = (source: string) =>
        source
          .replace(
            "<head>",
            `<head><style>${selector} { opacity: 0 !important; }</style>`,
          )
          .replace('<main class="card">', nav)
          .replace(
            '<h1 data-agent-native-node-id="hero-title">',
            '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
          )
          .replace("</body>", `${ALPINE_CDN}\n</body>`);
      const source = withRule(html);
      const existingMotion = withRule(apply(html).source);

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(readMotionHtmlSource(existingMotion)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );
    },
  );

  it.each([
    ["an ancestor's x-text", '<main class="card" x-data x-text="label">'],
    ["an ancestor's x-html", '<main class="card" x-data x-html="markup">'],
    [
      "an ancestor's modified x-html",
      '<main class="card" x-data x-html.foo="markup">',
    ],
  ])(
    "rejects %s, which replaces the Motion target when Alpine runs",
    (_label, main) => {
      const source = html
        .replace('<main class="card">', main)
        .replace("</body>", `${ALPINE_CDN}\n</body>`);
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it.each([
    [
      "an x-html sibling that can inject a stylesheet",
      `<div x-data x-html="'<style>[data-agent-native-node-id=hero-title]{color:red}</style>'"></div>`,
    ],
    [
      "a modified x-html sibling that can inject a stylesheet",
      `<div x-data x-html.foo="'<style>[data-agent-native-node-id=hero-title]{color:red}</style>'"></div>`,
    ],
    [
      "an x-if template whose content changes a Motion target",
      `<div x-data><template x-if="true"><p x-init="document.querySelector('[data-agent-native-node-id=hero-title]').style.color = 'red'"></p></template></div>`,
    ],
    [
      "an x-for template whose content changes a Motion target",
      `<div x-data="{ items: [1] }"><template x-for="item in items"><p @click="document.querySelector('[data-agent-native-node-id=hero-title]').classList.add('fade')"></p></template></div>`,
    ],
  ])("rejects %s when Alpine loads from the CDN", (_label, sibling) => {
    const source = html.replace(
      "</body>",
      `${sibling}\n${ALPINE_CDN}\n</body>`,
    );
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    ["dot access", `$refs.hero.style.color = 'red'`],
    ["bracket access", `$refs['hero'].classList.add('fade')`],
    ["a computed ref name", `$refs[name].classList.add('fade')`],
  ])(
    "rejects a sibling that changes an x-ref Motion target through $refs with %s",
    (_label, expression) => {
      const source = html
        .replace('<main class="card">', '<main class="card" x-data>')
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 data-agent-native-node-id="hero-title" x-ref="hero">',
        )
        .replace(
          "</main>",
          `  <p x-data x-text="(${expression}) && ''"></p>\n  </main>`,
        )
        .replace("</body>", `${ALPINE_CDN}\n</body>`);
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it("allows $refs that only change an element other than the Motion target", () => {
    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 data-agent-native-node-id="hero-title" x-ref="hero">',
      )
      .replace('<main class="card">', '<main class="card" x-data>')
      .replace(
        "</main>",
        `  <p x-ref="note" x-text="($refs.note.classList.add('seen')) && ''"></p>\n  </main>`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
  });

  it("rejects a binding that selects a Motion target inside its $root", () => {
    const source = html
      .replace('<main class="card">', '<main class="card" x-data>')
      .replace(
        "</main>",
        `  <p x-text="($root.querySelector('[data-agent-native-node-id=hero-title]').style.color = 'red') && ''"></p>\n  </main>`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects a binding that reaches a Motion target through its $root's owner document", () => {
    const source = html.replace(
      "</body>",
      `<p x-data x-text="($root.ownerDocument.querySelector('[data-agent-native-node-id=hero-title]').classList.add('fade')) && ''"></p>\n${ALPINE_CDN}\n</body>`,
    );
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects an x-teleport template whose content changes a Motion target", () => {
    const source = html.replace(
      "</body>",
      `<div x-data><template x-teleport="body"><p x-init="document.querySelector('[data-agent-native-node-id=hero-title]').style.color = 'red'"></p></template></div>\n${ALPINE_CDN}\n</body>`,
    );
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("resolves $root to the closest x-data, not an x-init between them", () => {
    const source = html
      .replace('<main class="card">', '<main class="card" x-data>')
      .replace(
        "</main>",
        `  <template x-if="true"><div x-init="ready = true"><p x-text="($root.querySelector('[data-agent-native-node-id=hero-title]').style.color = 'red') && ''"></p></div></template>\n  </main>`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    ["$refs", `$refs.card.innerHTML = ''`, 'x-ref="card"'],
    ["$root", `$root.replaceChildren()`, ""],
  ])(
    "rejects %s replacing the content around a Motion target",
    (_label, expression, ref) => {
      const source = html
        .replace('<main class="card">', `<main class="card" x-data ${ref}>`)
        .replace(
          "</main>",
          `  <p x-text="(${expression}) || ''"></p>\n  </main>`,
        )
        .replace("</body>", `${ALPINE_CDN}\n</body>`);
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it.each([
    [
      "Object.assign on a ref",
      `Object.assign($refs.hero, { style: 'color: red' })`,
    ],
    ["Reflect.set on the root", `Reflect.set($root, 'innerHTML', '')`],
    [
      "Object.defineProperty on a ref",
      `Object.defineProperty($refs.hero, 'className', { value: 'fade' })`,
    ],
  ])("rejects %s that reaches a Motion target", (_label, expression) => {
    const source = html
      .replace('<main class="card">', '<main class="card" x-data>')
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 data-agent-native-node-id="hero-title" x-ref="hero">',
      )
      .replace("</main>", `  <p x-text="(${expression}) && ''"></p>\n  </main>`)
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    [
      "a sibling replacing its parent's content",
      (source: string) =>
        source.replace(
          "</main>",
          `  <p x-text="($el.parentElement.innerHTML = '') || ''"></p>\n  </main>`,
        ),
    ],
    [
      "an ancestor binding replacing its own content",
      (source: string) =>
        source.replace(
          '<main class="card">',
          `<main class="card" x-bind:title="($el.innerHTML = '') || ''">`,
        ),
    ],
  ])("rejects %s around a Motion target", (_label, edit) => {
    const source = edit(html).replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("allows a nested component's ref that shadows a Motion target's ref of the same name", () => {
    const source = html
      .replace('<main class="card">', '<main class="card" x-data>')
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 data-agent-native-node-id="hero-title" x-ref="hero">',
      )
      .replace(
        "</main>",
        `  <div x-data><span x-ref="hero"></span><p x-text="($refs.hero.classList.add('seen')) && ''"></p></div>\n  </main>`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
  });

  it("still rejects an outer component's Motion target ref that no nested ref shadows", () => {
    const source = html
      .replace('<main class="card">', '<main class="card" x-data>')
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 data-agent-native-node-id="hero-title" x-ref="hero">',
      )
      .replace(
        "</main>",
        `  <div x-data><span x-ref="note"></span><p x-text="($refs.hero.classList.add('seen')) && ''"></p></div>\n  </main>`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    [
      "a selected target's remove()",
      `<p x-data x-text="document.querySelector('[data-agent-native-node-id=hero-title]').remove() || ''"></p>`,
    ],
    [
      "Object.assign on a selected target",
      `<p x-data x-text="Object.assign(document.querySelector('[data-agent-native-node-id=hero-title]'), { className: 'fade' }) && ''"></p>`,
    ],
  ])("rejects %s from a sibling", (_label, sibling) => {
    const source = html.replace(
      "</body>",
      `${sibling}\n${ALPINE_CDN}\n</body>`,
    );
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    [
      "Object.assign on $el",
      "<h1 data-agent-native-node-id=\"hero-title\" x-bind:title=\"Object.assign($el, { className: 'fade' }) && ''\">",
      '<main class="card">',
    ],
    [
      "a handler removing itself",
      '<h1 data-agent-native-node-id="hero-title" onclick="this.remove()">',
      '<main class="card">',
    ],
    [
      "an ancestor removing the clicked element",
      '<h1 data-agent-native-node-id="hero-title">',
      '<main class="card" onclick="event.target.remove()">',
    ],
  ])("rejects %s on a Motion target", (_label, h1, main) => {
    const source = html
      .replace('<h1 data-agent-native-node-id="hero-title">', h1)
      .replace('<main class="card">', main)
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("allows x-text on the Motion target itself, which only replaces its text", () => {
    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        `<h1 data-agent-native-node-id="hero-title" x-data x-text="'Hello'">`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
  });

  it("rejects a dynamic Tailwind arbitrary variant, which the browser runtime compiles into a rule that can reach a Motion target", () => {
    const source = html
      .replace(
        '<main class="card">',
        `<nav x-data="{ on: false }" :class="on ? '[&~main_h1]:opacity-0' : ''"></nav>\n  <main class="card">`,
      )
      .replace("</body>", `${TAILWIND_CDN}\n${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects a class joined from component state that may spell a Tailwind arbitrary variant", () => {
    const source = html
      .replace(
        '<main class="card">',
        `<nav x-data="{ b: ']:opacity-0', a: '[&~main_h1' }" :class="a + b"></nav>\n  <main class="card">`,
      )
      .replace("</body>", `${TAILWIND_CDN}\n${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("allows a sibling's dynamic Tailwind utilities that cannot reach another element", () => {
    const source = html
      .replace(
        '<main class="card">',
        `<nav x-data="{ on: false }" :class="on ? 'shadow-md' : ''"></nav>\n  <main class="card">`,
      )
      .replace("</body>", `${TAILWIND_CDN}\n${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
  });

  it("rejects an ancestor binding that removes a Motion target it selects", () => {
    const source = html
      .replace(
        '<main class="card">',
        `<main class="card" x-data x-bind:title="$el.querySelector('[data-agent-native-node-id=hero-title]').remove() || ''">`,
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    ["remove()", "el.remove()"],
    ["Object.assign", "Object.assign(el, { className: 'fade' })"],
  ])(
    "rejects %s on a selected Motion target assigned to a variable",
    (_label, write) => {
      const source = html.replace(
        "</body>",
        `<p x-data x-init="const el = document.querySelector('[data-agent-native-node-id=hero-title]'); ${write}"></p>\n${ALPINE_CDN}\n</body>`,
      );
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it.each([
    [
      "an x-transition class list",
      `x-transition:enter="[&~main_h1]:opacity-0"`,
    ],
    [
      "a class built by concatenation",
      `:class="on ? '[' + '&~main_h1' + ']' + ':opacity-0' : ''"`,
    ],
    [
      "a class built by a template literal",
      ":class=\"on ? `${open}&~main_h1${close}:opacity-0` : ''\"",
    ],
  ])(
    "rejects %s that may add a Tailwind arbitrary variant",
    (_label, attribute) => {
      const source = html
        .replace(
          '<main class="card">',
          `<nav x-data="{ on: false, open: '[', close: ']' }" ${attribute}></nav>\n  <main class="card">`,
        )
        .replace("</body>", `${TAILWIND_CDN}\n${ALPINE_CDN}\n</body>`);
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    },
  );

  it("allows a $root selector whose root does not contain the Motion target", () => {
    const source = html.replace(
      "</body>",
      `<div x-data><p x-text="($root.querySelector('p').classList.add('seen')) && ''"></p></div>\n${ALPINE_CDN}\n</body>`,
    );
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
  });

  it("allows a sibling's Alpine bindings that only touch the sibling", () => {
    const source = html.replace(
      "</body>",
      `<p x-data="{ open: true }" :class="open ? 'is-open' : ''" x-text="open ? 'Open' : 'Closed'"></p>\n${ALPINE_CDN}\n</body>`,
    );
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
  });

  it("still rejects an Alpine binding that changes a Motion target when Alpine loads from the CDN", () => {
    const source = html
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 data-agent-native-node-id="hero-title" x-data="{ on: false }" :class="on ? \'fade\' : \'\'">',
      )
      .replace("</body>", `${ALPINE_CDN}\n</body>`);
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it("rejects executable scripts embedded in iframe srcdoc with Motion targets", () => {
    const iframe =
      "<iframe srcdoc=\"&lt;script&gt;document.body.classList.add('active')&lt;/script&gt;\"></iframe>";
    const source = html.replace("</body>", `${iframe}\n</body>`);
    const generated = apply(html).source.replace(
      "</body>",
      `${iframe}\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("executable script"),
    });
    expect(readMotionHtmlSource(generated)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    [
      "anchor href",
      `<a href="javascript:document.body.classList.add('active')">Run</a>`,
    ],
    [
      "iframe src",
      `<iframe src="javascript:parent.document.body.classList.add('active')"></iframe>`,
    ],
  ])("rejects top-level javascript URL in %s", (_label, markup) => {
    const source = html.replace("</body>", `${markup}\n</body>`);
    const generated = apply(html).source.replace(
      "</body>",
      `${markup}\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
    expect(readMotionHtmlSource(generated)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    [
      "native load handler",
      `<img onload="parent.document.body.classList.add('active')">`,
    ],
    [
      "native error handler",
      `<img onerror="parent.document.body.classList.add('active')">`,
    ],
    [
      "runtime event handler",
      `<button x-on:click="parent.document.body.classList.add('active')"></button>`,
    ],
    [
      "runtime lifecycle handler",
      `<div x-init="parent.document.body.classList.add('active')"></div>`,
    ],
    [
      "direct javascript URL",
      `<a href="javascript:parent.document.body.classList.add('active')">Run</a>`,
    ],
    [
      "HTML-encoded tab in javascript URL scheme",
      `<a href="java&#x09;script:parent.document.body.classList.add('active')">Run</a>`,
    ],
  ])("rejects %s in iframe srcdoc with Motion targets", (_label, markup) => {
    const escapeAttribute = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const iframe = `<iframe srcdoc="${escapeAttribute(markup)}"></iframe>`;
    const source = html.replace("</body>", `${iframe}\n</body>`);
    const generated = apply(html).source.replace(
      "</body>",
      `${iframe}\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
    expect(readMotionHtmlSource(generated)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it("rejects executable scripts in nested iframe srcdoc documents", () => {
    const escapeAttribute = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const script =
      "<script>parent.parent.document.body.classList.add('active')</script>";
    const nestedIframe = `<iframe srcdoc="${escapeAttribute(script)}"></iframe>`;
    const iframe = `<iframe srcdoc="${escapeAttribute(nestedIframe)}"></iframe>`;
    const source = html.replace("</body>", `${iframe}\n</body>`);
    const generated = apply(html).source.replace(
      "</body>",
      `${iframe}\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("nested frame"),
    });
    expect(() => apply(source)).toThrowError(
      expect.objectContaining({ code: "unsupported-target" }),
    );
    expect(readMotionHtmlSource(generated)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it("removes managed Motion source while preserving unrelated executable scripts", () => {
    const written = apply(html).source;
    const script = '<script src="./site-behavior.js"></script>';
    const source = written.replace("</body>", `${script}\n</body>`);

    expect(removeMotionHtmlSource(source)).toEqual({
      source: html.replace("</body>", `${script}\n</body>`),
      changed: true,
    });
  });

  it("removes managed Motion source when a target gains a runtime style binding", () => {
    const generated = apply(html).source;
    const source = generated.replace(
      '<h1 data-agent-native-node-id="hero-title">',
      '<h1 x-bind:style="{ opacity: open ? 0 : 1 }" data-agent-native-node-id="hero-title">',
    );

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(removeMotionHtmlSource(source)).toEqual({
      source: html.replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 x-bind:style="{ opacity: open ? 0 : 1 }" data-agent-native-node-id="hero-title">',
      ),
      changed: true,
    });
  });

  it("reads and removes Motion when a CSS content string contains template braces", () => {
    const source = html.replace(
      "</head>",
      `<style>.card::before { content: "{{ label }}"; }</style>\n</head>`,
    );
    const generated = apply(source).source;

    expect(readMotionHtmlSource(generated)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
    expect(removeMotionHtmlSource(generated)).toEqual({
      source,
      changed: true,
    });
  });

  it("still rejects actual CSS template interpolation for managed Motion", () => {
    const source = html.replace(
      "</head>",
      `<style>.card { opacity: {{ opacity }}; }</style>\n</head>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported" });
  });

  it("ignores executable scripts inside inert templates", () => {
    const source = html.replace(
      "</body>",
      `<template><script>document.querySelector('[data-agent-native-node-id="hero-title"]').style.opacity='0';</script></template>\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });
    expect(readMotionHtmlSource(apply(source).source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it("rejects sibling Vue markup injection while Motion targets exist", () => {
    const source = apply(html).source.replace(
      "</body>",
      '<aside v-html="content"></aside>\n</body>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("v-html may inject a stylesheet"),
    });
    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    ["Vue object v-bind innerHTML", 'v-bind="{ innerHTML: content }"'],
    ["Vue object v-bind outerHTML", 'v-bind="{ outerHTML: content }"'],
    ["unresolved Vue object v-bind", 'v-bind="attributes"'],
  ])("rejects %s while Motion targets exist", (_label, binding) => {
    const source = apply(html).source.replace(
      "</body>",
      `<aside ${binding}></aside>\n</body>`,
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({
      status: "unsupported",
      code: "unsupported-target",
      reason: expect.stringContaining("v-bind may inject a stylesheet"),
    });
    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it.each([
    [
      "native ancestor handler",
      `onclick="document.querySelector('[data-agent-native-node-id=hero-title]').style.transition = 'opacity 1s'"`,
      "onclick",
    ],
    [
      "Alpine ancestor handler",
      `@click="document.querySelector('[data-agent-native-node-id=hero-title]').style.setProperty('transition', 'opacity 1s')"`,
      "@click",
    ],
    ["Alpine ancestor show directive", `x-show="visible"`, "x-show"],
    [
      "Alpine ancestor generic binding",
      `x-bind="{ style: { transform: 'scale(0)' } }"`,
      "x-bind",
    ],
    [
      "Vue ancestor generic binding",
      `v-bind="{ style: { transform: 'scale(0)' } }"`,
      "v-bind",
    ],
    ["Alpine ancestor class shorthand binding", `:class="classes"`, ":class"],
    ["Alpine ancestor class binding", `x-bind:class="classes"`, "x-bind:class"],
  ])(
    "rejects Motion targets when an ordinary ancestor uses %s",
    (_label, attribute, expectedAttribute) => {
      const source = html.replace(
        '<main class="card">',
        `<main class="card" ${attribute}>`,
      );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({
        status: "unsupported",
        code: "unsupported-target",
        reason: expect.stringContaining(expectedAttribute),
      });
      expect(() => apply(source)).toThrowError(
        expect.objectContaining({ code: "unsupported-target" }),
      );

      const generated = apply(html).source.replace(
        '<main class="card">',
        `<main class="card" ${attribute}>`,
      );
      expect(readMotionHtmlSource(generated, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
    },
  );

  it("ignores handlers on inert template siblings in the target's owning scope", () => {
    const source = html
      .replace(
        '<main class="card">',
        '<main class="card" x-data="{ open: true }">',
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        '<h1 x-ref="hero" data-agent-native-node-id="hero-title">Hello</h1>',
      )
      .replace(
        "</main>",
        "<template @click=\"$refs.hero.style.setProperty('transition', 'opacity 1s')\"><span>Inert</span></template>\n  </main>",
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported" });

    const written = apply(source);
    expect(readMotionHtmlSource(written.source, "index.html")).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it.each([
    [
      "Alpine scope initializer",
      `x-data="{ init() { this.$refs.hero.style.transition = 'opacity 1s' } }"`,
      "x-data",
    ],
    [
      "Alpine ancestor event",
      `x-data="{ open: true }" @click="$refs.hero.style.setProperty('transition', 'opacity 1s')"`,
      "@click",
    ],
    [
      "Vue ancestor event",
      `v-scope="{ open: true }" v-on:click="$refs.hero.style.setProperty('transition', 'opacity 1s')"`,
      "v-on:click",
    ],
  ])(
    "rejects Motion targets in an unsafe %s scope for reads and writes",
    (_label, scopeAttrs, expectedAttribute) => {
      const source = html
        .replace('<main class="card">', `<main class="card" ${scopeAttrs}>`)
        .replace(
          '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
          '<h1 x-ref="hero" data-agent-native-node-id="hero-title">Hello</h1>',
        );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({
        status: "unsupported",
        code: "unsupported-target",
        reason: expect.stringContaining(expectedAttribute),
      });
      let writeError: unknown;
      try {
        apply(source);
      } catch (error) {
        writeError = error;
      }
      expect(writeError).toMatchObject({ code: "unsupported-target" });

      const generated = apply(html)
        .source.replace(
          '<main class="card">',
          `<main class="card" ${scopeAttrs}>`,
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
          '<h1 x-ref="hero" data-agent-native-node-id="hero-title">Hello</h1>',
        );
      expect(readMotionHtmlSource(generated, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
    },
  );

  it.each([
    ["Alpine initialization", "x-init=\"$el.style.transition = 'opacity 1s'\""],
    [
      "native click handler",
      "onclick=\"this.style.transition = 'opacity 1s'\"",
    ],
    ["native load handler", "onload=\"this.style.animation = 'pulse 1s'\""],
  ])(
    "rejects %s when reading an existing Motion target",
    (_label, attribute) => {
      const generated = apply(html).source;
      const source = generated.replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        `<h1 data-agent-native-node-id="hero-title" ${attribute}>Hello</h1>`,
      );

      expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(source).toContain(attribute);
    },
  );

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
      '    <aside style="animation: pulse 1s infinite" x-transition.opacity x-bind:style="style" @click="active = !active">Other animation</aside>\n  </main>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    const first = apply(source);
    expect(first.source).toContain("data-agent-native-motion");
    expect(first.source).toContain('@click="active = !active"');
    expect(readMotionHtmlSource(first.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });

    const rewritten = applyMotionHtmlSourceEdit({
      currentSource: first.source,
      expectedSource: first.source,
      preview: previewFor(first.source),
      timeline: makeTimeline("hero-title", "0.75"),
    });
    expect(rewritten.source).toContain(
      'x-bind:style="style" @click="active = !active"',
    );
    expect(readMotionHtmlSource(rewritten.source)).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-title"],
    });
  });

  it("allows unrelated static inline styles on a Motion target", () => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="color: rebeccapurple !important; background-color: white">Hello</h1>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
    expect(apply(source).source).toContain(
      'style="color: rebeccapurple !important; background-color: white"',
    );
  });

  it("rejects important inline styles that override an animated property", () => {
    const generated = apply(html).source;
    const source = generated.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="opacity: 0 !important">Hello</h1>',
    );

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it.each([
    ["inline-size", "width", "100px"],
    ["inline-size", "height", "100px"],
    ["background", "background-color", "red"],
    ["border-color", "border-top-color", "red"],
    ["border-block-color", "border-bottom-color", "red"],
    ["border-block-start", "border-left-width", "1px solid red"],
    ["border-image", "border-image-source", "url(border.svg)"],
    ["mask-border", "mask-border-source", "url(mask.svg)"],
    ["-webkit-mask-position", "mask-position", "left"],
    ["font-variant", "font-variant-caps", "small-caps"],
    ["margin", "margin-inline-start", "2px"],
  ])(
    "rejects important inline %s when it sets animated %s",
    (property, animatedProperty, value) => {
      const timeline = makePropertyTimeline(animatedProperty, "#000", "#fff");
      const generated = apply(html, { timeline }).source;
      const source = generated.replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        `<h1 data-agent-native-node-id="hero-title" style="${property}: ${value} !important">Hello</h1>`,
      );

      expect(readMotionHtmlSource(source)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source, { timeline })).toThrow(MotionHtmlSourceError);
    },
  );

  it("rejects an important inline border radius longhand for animated border radius", () => {
    const timeline = makePropertyTimeline("border-radius", "0px", "12px");
    const generated = apply(html, { timeline }).source;
    const source = generated.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="border-top-left-radius: 0 !important">Hello</h1>',
    );

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
  });

  it.each([
    ["inline-size", "width", "100px"],
    ["inline-size", "height", "100px"],
    ["background", "background-color", "red"],
    ["border-color", "border-top-color", "red"],
    ["border-block-color", "border-bottom-color", "red"],
    ["border-block-start", "border-left-width", "1px solid red"],
    ["border-image", "border-image-source", "url(border.svg)"],
    ["mask-border", "mask-border-source", "url(mask.svg)"],
    ["-webkit-mask-position", "mask-position", "left"],
    ["font-variant", "font-variant-caps", "small-caps"],
    ["margin", "margin-inline-start", "2px"],
  ])(
    "rejects important stylesheet %s when it sets animated %s",
    (property, animatedProperty, value) => {
      const timeline = makePropertyTimeline(animatedProperty, "#000", "#fff");
      const withRule = (source: string) =>
        source
          .replace(
            "<head>",
            `<head><style>#hero-title { ${property}: ${value} !important; }</style>`,
          )
          .replace(
            '<h1 data-agent-native-node-id="hero-title">',
            '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
          );
      const source = withRule(html);
      const existingMotion = withRule(apply(html, { timeline }).source);

      expect(readMotionHtmlSource(existingMotion)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source: existingMotion,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source, { timeline })).toThrow(MotionHtmlSourceError);
    },
  );

  it("allows an important background shorthand when Motion animates opacity", () => {
    const source = apply(html)
      .source.replace(
        "<head>",
        "<head><style>#hero-title { background: red !important; }</style>",
      )
      .replace(
        '<h1 data-agent-native-node-id="hero-title">',
        '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
      );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "supported", targetNodeIds: ["hero-title"] });
  });

  it.each([
    ["(prefers-reduced-motion: reduce)", "supported"],
    ["(prefers-reduced-motion: no-preference)", "unsupported"],
    ["screen and (prefers-reduced-motion: reduce)", "unsupported"],
  ] as const)(
    "only exempts the standalone reduced-motion media query: %s",
    (query, status) => {
      const source = html
        .replace(
          "<head>",
          `<head><style>@media ${query} { #hero-title { opacity: 0 !important; } }</style>`,
        )
        .replace(
          '<h1 data-agent-native-node-id="hero-title">',
          '<h1 id="hero-title" data-agent-native-node-id="hero-title">',
        );

      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }).status,
      ).toBe(status);
    },
  );

  it("rejects important all declarations when a target has Motion properties", () => {
    const generated = apply(html).source;
    const source = generated.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="all: initial !important">Hello</h1>',
    );

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
  });

  it("rejects important all declarations during capability preflight", () => {
    const source = html.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="all: initial !important">Hello</h1>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
  });

  it.each([
    ["offset-path", 'path("M0 0 L10 10")'],
    ["offset-anchor", "0px 0px"],
    ["offset-rotate", "0deg"],
    ["offset-distance", "25%"],
    ["offset", "none"],
    ["translate", "4px 8px"],
  ])(
    "rejects important inline %s overrides for path tracks",
    (property, value) => {
      const timeline = makeTimeline();
      timeline.tracks[0] = {
        ...timeline.tracks[0]!,
        property: "translate",
        keyframes: [
          {
            t: 0,
            value: "0px 0px",
            ease: "linear",
            motionPath: {
              version: 1,
              type: "cubic",
              control1: { x: 20, y: 0 },
              control2: { x: 80, y: 100 },
            },
          },
          { t: 1, value: "100px 100px", ease: "ease-out" },
        ],
      };
      const generated = apply(html, { timeline }).source;
      const source = generated.replace(
        '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
        `<h1 data-agent-native-node-id="hero-title" style='${property}: ${value} !important'>Hello</h1>`,
      );

      expect(readMotionHtmlSource(source)).toMatchObject({
        status: "invalid",
        error: { code: "unsupported-target" },
      });
      expect(
        inspectMotionHtmlSourceWriteCapability({
          source,
          targetNodeIds: ["hero-title"],
        }),
      ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
      expect(() => apply(source, { timeline })).toThrow(MotionHtmlSourceError);
    },
  );

  it("rejects important inline overrides for native-style tracks", () => {
    const timeline: MotionTimeline = {
      ...makeTimeline(),
      tracks: [],
      nativeStyles: [
        createMotionNativeStyleInstance({
          styleKey: "Opacity",
          targetNodeId: "hero-title",
        }),
      ],
    };
    const generated = apply(html, { timeline }).source;
    const source = generated.replace(
      '<h1 data-agent-native-node-id="hero-title">Hello</h1>',
      '<h1 data-agent-native-node-id="hero-title" style="opacity: 0 !important">Hello</h1>',
    );

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["hero-title"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
    expect(() => apply(source, { timeline })).toThrow(MotionHtmlSourceError);
  });

  it("checks stylesheet overrides for native Path style properties during preflight", () => {
    const svgSource = html.replace(
      "  </main>",
      '  </main>\n  <svg><path data-agent-native-node-id="shape-path" d="M0 0L10 10"></path></svg>',
    );
    const timeline: MotionTimeline = {
      ...makeTimeline("shape-path"),
      tracks: [],
      nativeStyles: [
        createMotionNativeStyleInstance({
          styleKey: "Path",
          targetNodeId: "shape-path",
        }),
      ],
    };
    const generated = apply(svgSource, { timeline }).source;
    const source = generated.replace(
      "<head>",
      '<head><style>[data-agent-native-node-id="shape-path"] { stroke-dashoffset: 0 !important; }</style>',
    );

    expect(
      inspectMotionHtmlSourceWriteCapability({
        source,
        targetNodeIds: ["shape-path"],
      }),
    ).toMatchObject({ status: "unsupported", code: "unsupported-target" });
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
    expect(next.source.match(/agent-native-motion-source:v6:/g)).toHaveLength(
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

  it("round-trips native Position and Scale edits through HTML source", () => {
    const position = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "hero-title",
    });
    const scale = createMotionNativeStyleInstance({
      styleKey: "Scale",
      targetNodeId: "hero-title",
    });
    const timeline: MotionTimeline = {
      ...makeTimeline(),
      tracks: [],
      nativeStyles: [position, scale],
    };
    const authored = apply(html, { timeline });
    const directEdit = authored.source
      .replace("translate: -200px 0px;", "translate: 0px 320px;")
      .replace("scale: 1.2 1.2;", "scale: 1.5;");
    const read = readMotionHtmlSource(directEdit);

    expect(read.status).toBe("valid");
    if (read.status !== "valid" || !read.document) {
      throw new Error("direct HTML native-style CSS edit was not readable");
    }
    expect(read.document.nativeStyles).toMatchObject([
      {
        styleKey: "Position",
        props: { type: "slide_in", direction: "bottom", distance: 320 },
      },
      { styleKey: "Scale", props: { type: "scaleIn", amount: 150 } },
    ]);

    const written = applyMotionHtmlSourceEdit({
      currentSource: directEdit,
      expectedSource: directEdit,
      preview: previewFor(directEdit),
      timeline: {
        ...timeline,
        nativeStyles: read.document.nativeStyles,
      },
    });
    expect(readMotionHtmlSource(written.source)).toMatchObject({
      status: "valid",
      document: { nativeStyles: read.document.nativeStyles },
    });
  });

  it("keeps successive native-style writes readable after a timeline resize", () => {
    const position = createMotionNativeStyleInstance({
      styleKey: "Position",
      targetNodeId: "hero-title",
    });
    let timeline: MotionTimeline = {
      ...makeTimeline(),
      tracks: [],
      durationMs: 500,
      nativeStyles: [position],
    };
    let source = apply(html, { timeline }).source;

    const resizedRead = readMotionHtmlSource(source);
    expect(resizedRead.status).toBe("valid");
    if (resizedRead.status !== "valid" || !resizedRead.document) return;

    timeline = {
      ...timeline,
      durationMs: 2000,
      nativeStyles: resizedRead.document.nativeStyles ?? [],
    };
    source = apply(source, { timeline }).source;

    const scale = createMotionNativeStyleInstance({
      styleKey: "Scale",
      targetNodeId: "hero-title",
    });
    const finalRead = readMotionHtmlSource(source);
    expect(finalRead.status).toBe("valid");
    if (finalRead.status !== "valid" || !finalRead.document) return;

    source = apply(source, {
      timeline: {
        ...timeline,
        nativeStyles: [...finalRead.document.nativeStyles!, scale],
      },
    }).source;

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "valid",
      document: {
        nativeStyles: [{ styleKey: "Position" }, { styleKey: "Scale" }],
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
        durationMs: 800,
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
        durationMs: 800,
        tracks: read.document.tracks,
      },
    });
    expect(
      written.source.match(/agent-native-motion-source:v6:/g),
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

  it("removes authored animation CSS despite an unresolved external stylesheet", () => {
    const source = `<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="./theme.css">
  <style>
.badge {
  color: rebeccapurple;
  animation-name: badge-fade;
  animation-duration: 900ms;
  animation-fill-mode: both;
}
@keyframes badge-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
  </style>
</head>
<body><h1 data-agent-native-node-id="hero-title">Hello</h1><aside class="badge" data-agent-native-node-id="badge">Status</aside></body>
</html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
    expect(removeMotionHtmlSource(source, "index.html")).toEqual({
      source: source
        .replace("  animation-name: badge-fade;\n", "")
        .replace("  animation-duration: 900ms;\n", "")
        .replace("  animation-fill-mode: both;\n", ""),
      changed: true,
    });
  });

  it("checks transitions across static HTML style blocks when importing animation", () => {
    const source = `<!doctype html>
<html>
<head>
  <style>
.hero {
  animation-name: hero-fade;
  animation-duration: 900ms;
  animation-fill-mode: both;
}
@keyframes hero-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
  </style>
  <style>
.hero { transition: opacity 1s; }
  </style>
</head>
<body><h1 class="hero" data-agent-native-node-id="hero-css">Hello</h1></body>
</html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-authored-motion" },
    });
  });

  it("checks transitions in CRLF HTML style blocks when importing animation", () => {
    const source = `<!doctype html>
<html>
<head>
  <style>
.hero {
  animation-name: hero-fade;
  animation-duration: 900ms;
  animation-fill-mode: both;
}
@keyframes hero-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
  </style>
  <style>\r\n.hero { transition: opacity 1s; }\r\n  </style>
</head>
<body><h1 class="hero" data-agent-native-node-id="hero-css">Hello</h1></body>
</html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: {
        code: "unsupported-authored-motion",
        message: expect.stringContaining("CSS transitions overlap"),
      },
    });
  });

  it.each([
    ["framework-bound", 'x-bind:media="query"'],
    ["handler-bearing", 'x-init="ready = true"'],
  ])(
    "checks opacity transitions in %s style blocks when importing animation",
    (_kind, styleAttribute) => {
      const source = `<!doctype html>
<html>
<head>
  <style>
.hero {
  animation-name: hero-fade;
  animation-duration: 900ms;
  animation-fill-mode: both;
}
@keyframes hero-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
  </style>
  <style ${styleAttribute}>
.hero { transition: opacity 1s; }
  </style>
</head>
<body><h1 class="hero" data-agent-native-node-id="hero-css">Hello</h1></body>
</html>`;

      expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
        status: "invalid",
        error: {
          code: "unsupported-authored-motion",
          message: expect.stringContaining("CSS transitions overlap"),
        },
      });
    },
  );

  it("keeps non-conflicting CSS transitions separate from imported Motion properties", () => {
    const source = `<!doctype html>
<html>
<head>
  <style>
.hero {
  animation-name: hero-fade;
  animation-duration: 900ms;
  animation-fill-mode: both;
}
@keyframes hero-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
  </style>
  <style>
.hero { transition: color 1s; }
  </style>
</head>
<body><h1 class="hero" data-agent-native-node-id="hero-css">Hello</h1></body>
</html>`;

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "valid",
      targetNodeIds: ["hero-css"],
      document: { tracks: [{ targetNodeId: "hero-css", property: "opacity" }] },
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

  it.each([
    ["Alpine text binding", 'x-text="runtimeCss"'],
    ["Alpine HTML binding", 'x-html="runtimeCss"'],
    ["modified Alpine HTML binding", 'x-html.foo="runtimeCss"'],
    ["bound innerHTML", ':innerHTML="runtimeCss"'],
    ["Alpine bound innerHTML", 'x-bind:innerHTML="runtimeCss"'],
  ])("rejects %s on a CSS style element", (_label, binding) => {
    const source = apply(html).source.replace(
      "</head>",
      `<style ${binding}></style>\n</head>`,
    );

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
    expect(source).toContain(`<style ${binding}></style>`);
  });

  it.each([
    ["Alpine initialization", 'x-init="$el.textContent = runtimeCss"'],
    ["Alpine effect", 'x-effect="$el.textContent = runtimeCss"'],
    ["Alpine event", '@click="$el.textContent = runtimeCss"'],
    ["Alpine event directive", 'x-on:click="$el.textContent = runtimeCss"'],
    ["Vue event", 'v-on:click="$el.textContent = runtimeCss"'],
    ["native load handler", 'onload="this.textContent = runtimeCss"'],
  ])("rejects %s on a CSS style element", (_label, directive) => {
    const source = apply(html).source.replace(
      "</head>",
      `<style ${directive}>.hero { color: red; }</style>\n</head>`,
    );

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
    expect(source).toContain(`<style ${directive}>`);
  });

  it.each([
    ["Mustache", "{{ runtimeCss }}"],
    ["template literal", "${runtimeCss}"],
    ["server template", "<%= runtimeCss %>"],
  ])("rejects dynamic %s content inside a style element", (_kind, value) => {
    const source = apply(html).source.replace(
      "</head>",
      `<style>/* ${value} */ .hero { color: red; }</style>\n</head>`,
    );

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
    expect(source).toContain(value);
  });

  it.each([
    ".hero { transition: transform 1s ease; }",
    ".hero { transition-delay: 1s; }",
    ".hero { transition-behavior: allow-discrete; }",
    ".hero { -webkit-transition: opacity 1s; }",
    ".hero { transitio\\6e: opacity 1s; }",
  ])(
    "preserves authored transitions when no animation is being imported",
    (transition) => {
      const source = apply(html).source.replace(
        "</head>",
        `<style>${transition}</style>\n</head>`,
      );

      expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
        status: "valid",
      });
      expect(apply(source).source).toContain(transition);
      expect(source).toContain(transition);
    },
  );

  it("rejects a stylesheet preload promoted on load", () => {
    const source = apply(html).source.replace(
      "</head>",
      '<link rel="preload" as="style" href="./theme.css" onload="this.rel=\'stylesheet\'">\n</head>',
    );

    expect(readMotionHtmlSource(source, "index.html")).toMatchObject({
      status: "invalid",
      error: { code: "unresolved-stylesheet" },
    });
    expect(() => apply(source)).toThrow(MotionHtmlSourceError);
    expect(source).toContain('rel="preload" as="style"');
  });

  it("does not treat an unpromoted style preload as a stylesheet", () => {
    const source = html.replace(
      "</head>",
      '<link rel="preload" as="style" href="./theme.css">\n</head>',
    );

    expect(readMotionHtmlSource(source, "index.html")).toEqual({
      status: "absent",
    });
  });

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
    expect(edit.source).toContain(
      '<script type="application/json" data-page-config>{"entry":"page"}</script>',
    );
    expect(edit.source).toContain('data-agent-native-motion-text-source="v2"');
    expect(edit.source).toContain('data-agent-native-motion-text-runtime="v2"');
    expect(removeMotionHtmlSource(edit.source)).toEqual({
      source: html,
      changed: true,
    });
  });

  it("accepts a previous compatible Motion Text runtime template", () => {
    const animation = {
      targetNodeId: "hero-title",
      unit: "word",
      direction: "forward",
      staggerMs: 40,
      delayMs: 0,
      property: "opacity",
      durationMs: 320,
      keyframes: [
        { t: 0, value: "0", ease: "ease-out" },
        { t: 1, value: "1" },
      ],
    };
    const legacyDocument = { version: 1, animations: [animation] };
    const legacyRuntime = motionTextRuntimeV1Template.replace(
      "__MOTION_TEXT_SOURCE__",
      JSON.stringify({ animations: [animation], playbackMode: "once" }),
    );
    const source = html.replace(
      "</body>",
      `<script type="application/json" data-agent-native-motion-text-source="v1">${JSON.stringify(legacyDocument)}</script>\n<script data-agent-native-motion-text-runtime="v1">${legacyRuntime}</script></body>`,
    );

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "valid",
      textDocument: { animations: [{ targetNodeId: "hero-title" }] },
    });
    expect(removeMotionHtmlSource(source)).toEqual({
      source: html,
      changed: true,
    });
  });

  it("rejects unrecognized code under the managed Motion Text runtime marker", () => {
    const source = apply(html, { textDocument }).source.replace(
      /(<script data-agent-native-motion-text-runtime="v2">)[\s\S]*?<\/script>/,
      "$1window.__unknownMotionRuntime = true;</script>",
    );

    expect(readMotionHtmlSource(source)).toMatchObject({
      status: "invalid",
      error: { code: "unsupported-target" },
    });
    expect(() => removeMotionHtmlSource(source)).toThrowError(
      expect.objectContaining({ code: "invalid-motion-text" }),
    );
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
