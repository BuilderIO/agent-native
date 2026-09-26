import { isAgentActionStopError } from "@agent-native/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { formatSlideHtml } from "../server/lib/slide-content-patch.js";
import { buildSourceImportMetadata } from "../server/lib/source-import.js";
import { hashSlideContent } from "../shared/slide-fit";
import {
  applyOperation,
  assertPatchedSlideAnimationsResolve,
  assertSourceImportSlidesCovered,
  clearOmittedAnimationsForAgentContentPatches,
  isAgentPatchCaller,
  OperationSchema,
  resolveDeckColumnUpdates,
  withDeckLock,
  type Operation,
} from "./patch-deck";
import patchDeckAction from "./patch-deck";

vi.mock("../app/lib/normalize-slide-padding.js", () => ({
  normalizeSlidePadding: (html: string) => html,
  normalizeSlidePaddingForWrite: (_previous: string, html: string) => html,
}));

const mockAssertAccess = vi.fn();
const mockNotifyClients = vi.fn();

let mockDeckRow: Record<string, unknown> | undefined;
let lastUpdatedDeckData: string | undefined;
const mockGetGenerationCreativeContext = vi.fn(async () => null);
const mockRecordGenerationCreativeContext = vi.fn(async () => undefined);
const mockValidateGenerationCreativeContext = vi.fn(
  async (input: {
    contextPackId?: string;
    contextModeOverride?: "off";
    reuseLabels?: Array<Record<string, unknown>>;
  }) => ({
    contextMode: input.contextModeOverride === "off" ? "off" : "auto",
    contextPackId:
      input.contextModeOverride === "off"
        ? null
        : (input.contextPackId ?? null),
    reuseLabels: input.reuseLabels ?? [],
    results: [],
  }),
);

const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (mockDeckRow ? [mockDeckRow] : []),
      }),
    }),
  }),
  update: () => ({
    set: (fields: { data?: string }) => ({
      where: async () => {
        lastUpdatedDeckData = fields.data;
        return { rowsAffected: 1 };
      },
    }),
  }),
  transaction: async (callback: (tx: any) => Promise<unknown>) =>
    callback(mockDb),
};

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: {
      id: "decks.id",
      title: "decks.title",
      data: "decks.data",
      designSystemId: "decks.designSystemId",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: (...args: unknown[]) =>
    mockGetGenerationCreativeContext(...args),
  recordGenerationCreativeContext: (...args: unknown[]) =>
    mockRecordGenerationCreativeContext(...args),
  validateGenerationCreativeContext: (...args: unknown[]) =>
    mockValidateGenerationCreativeContext(...args),
  mergeCreativeContextReuseLabels: (
    previous: Array<Record<string, unknown>>,
    next: Array<Record<string, unknown>>,
  ) => [...previous, ...next],
  replaceCreativeContextElementProvenance: (
    previous: Array<{ elementId: string }>,
    next: Array<{ elementId: string }>,
  ) => {
    const replaced = new Set(next.map((entry) => entry.elementId));
    return [
      ...previous.filter((entry) => !replaced.has(entry.elementId)),
      ...next,
    ];
  },
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mockNotifyClients(...args),
}));

describe("applyOperation — patch-slide", () => {
  it("updates only the specified fields of a slide", () => {
    const deck = {
      slides: [
        { id: "s1", content: "<p>Old</p>", notes: "note", layout: "content" },
        { id: "s2", content: "<p>Two</p>", notes: "", layout: "content" },
      ],
    };
    const op: Operation = {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: "<p>New</p>" },
    };
    applyOperation(deck, op);
    expect(deck.slides[0].content).toBe("<p>New</p>");
    expect(deck.slides[0].notes).toBe("note");
    expect(deck.slides[1].content).toBe("<p>Two</p>");
  });

  it("refuses content that adds editor-rendered markup", () => {
    const deck = {
      slides: [
        { id: "s1", content: '<div class="fmd-slide"><p>Old</p></div>' },
      ],
    };
    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: {
          content:
            '<div class="fmd-slide"><style>[data-slide-content-scope="slide-r1"] p { color: red; }</style><p contenteditable="true">New</p></div>',
        },
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "render_artifact_in_slide_content",
        details: {
          slideId: "s1",
          markers: ["scoped-style-selector", "contenteditable"],
        },
      }),
    );
    expect(deck.slides[0].content).toBe(
      '<div class="fmd-slide"><p>Old</p></div>',
    );
  });

  it("refuses an added slide carrying editor markup but keeps older scoped styles", () => {
    const deck = {
      slides: [
        {
          id: "s1",
          content:
            '<div class="fmd-slide"><p data-builder-id="b-4">Old</p></div>',
        },
      ],
    };
    expect(() =>
      applyOperation(deck, {
        op: "add-slide",
        slideId: "s2",
        fields: {
          content:
            '<div class="fmd-slide"><p data-builder-id="b-4">New</p></div>',
        },
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "render_artifact_in_slide_content",
      }),
    );
    expect(deck.slides).toHaveLength(1);
    const restored =
      '<div class="fmd-slide"><style>[data-slide-content-scope="slide-r1"] p{color:red}</style><p>R</p></div>';
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s3",
      fields: { content: restored },
    });
    expect(deck.slides[1].content).toBe(restored);
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s4",
      fields: { content: deck.slides[0].content },
    });
    expect(deck.slides).toHaveLength(3);
  });

  it("still saves content that already carried rendered markup", () => {
    const flattened =
      '<div class="fmd-slide"><p data-builder-id="b-4">Old</p></div>';
    const deck = { slides: [{ id: "s1", content: flattened }] };
    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: flattened.replace("Old", "New") },
    });
    expect(deck.slides[0].content).toBe(flattened.replace("Old", "New"));
  });

  it("rejects a stale per-slide hash without mutating the slide", () => {
    const source = "<p>Current</p>";
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(
        deck,
        {
          op: "patch-slide",
          slideId: "s1",
          fields: { content: "<p>Overwrite</p>" },
          baseContentHash: "stale-hash",
        },
        { sourceContentHashes: new Map([["s1", hashSlideContent(source)]]) },
      ),
    ).toThrow(/changed since it was read/);
    expect(deck.slides[0].content).toBe(source);
  });

  it("accepts CSS-only edits through styleOnly and preserves markup", () => {
    const deck = {
      slides: [
        {
          id: "s1",
          content:
            '<div class="fmd-slide" style="background:#000;padding:80px"><p>Keep this</p></div>',
        },
      ],
    };
    const nextContent =
      '<div class="fmd-slide" style="background:#fff;padding:80px"><p>Keep this</p></div>';

    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: nextContent },
      baseContentHash: hashSlideContent(deck.slides[0].content),
      styleOnly: true,
    });

    expect(deck.slides[0].content).toBe(nextContent);
  });

  it("rejects styleOnly edits that change protected layout CSS", () => {
    const source =
      '<div class="fmd-slide" style="background:#000;padding:80px"><p>Keep this</p></div>';
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: {
          content:
            '<div class="fmd-slide" style="background:#fff;padding:40px"><p>Keep this</p></div>',
        },
        baseContentHash: hashSlideContent(source),
        styleOnly: true,
      }),
    ).toThrow(/protected layout CSS/);
    expect(deck.slides[0].content).toBe(source);
  });

  it.each([
    ["order", "0", "1"],
    ["flex-flow", "row", "column"],
    ["grid-auto-flow", "row", "column"],
    ["all", "initial", "unset"],
    ["inset-block-start", "0", "1px"],
    ["inset-block-end", "0", "1px"],
    ["inset-inline-start", "0", "1px"],
    ["inset-inline-end", "0", "1px"],
    ["border", "1px solid black", "4px solid black"],
    ["border-width", "1px", "4px"],
    ["border-style", "solid", "none"],
    ["border-block-style", "solid", "none"],
    ["border-block-start-style", "solid", "none"],
    ["border-block-end-style", "solid", "none"],
    ["border-inline-style", "solid", "none"],
    ["border-inline-start-style", "solid", "none"],
    ["border-inline-end-style", "solid", "none"],
    ["border-top-style", "solid", "none"],
    ["border-right-style", "solid", "none"],
    ["border-bottom-style", "solid", "none"],
    ["border-left-style", "solid", "none"],
    ["border-left", "1px solid black", "4px solid black"],
    ["border-block-start-width", "1px", "4px"],
    ["font", "16px Arial", "20px Arial"],
    ["text-wrap", "wrap", "nowrap"],
    ["text-wrap-mode", "wrap", "nowrap"],
    ["text-wrap-style", "auto", "pretty"],
    ["line-break", "auto", "loose"],
    ["line-clamp", "2", "3"],
    ["hyphens", "none", "manual"],
    ["word-spacing", "0", "4px"],
    ["float", "none", "left"],
    ["clear", "none", "both"],
    ["text-overflow", "clip", "ellipsis"],
    ["text-transform", "none", "uppercase"],
    ["inline-size", "100px", "200px"],
    ["min-inline-size", "100px", "200px"],
    ["max-inline-size", "100px", "200px"],
    ["block-size", "100px", "200px"],
    ["min-block-size", "100px", "200px"],
    ["max-block-size", "100px", "200px"],
    ["grid-area", "title", "body"],
    ["grid-template-areas", `\"title body\"`, `\"body title\"`],
    ["place-items", "start", "center"],
    ["place-self", "start", "center"],
    ["translate", "none", "10px"],
    ["transform-origin", "50% 50%", "0 0"],
    ["rotate", "0deg", "45deg"],
    ["scale", "1", "2"],
    ["zoom", "1", "1.2"],
    ["table-layout", "auto", "fixed"],
    ["border-spacing", "0", "4px"],
    ["border-collapse", "separate", "collapse"],
    ["columns", "1", "2"],
    ["column-count", "1", "2"],
    ["contain", "none", "layout"],
    ["contain-intrinsic-size", "none", "100px"],
    ["animation", "none", "move 1s"],
  ])("rejects styleOnly edits that change %s", (property, before, after) => {
    const source = `<div class="fmd-slide" style='${property}:${before}'><p>Keep this</p></div>`;
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: {
          content: `<div class="fmd-slide" style='${property}:${after}'><p>Keep this</p></div>`,
        },
        baseContentHash: hashSlideContent(source),
        styleOnly: true,
      }),
    ).toThrow(/protected layout CSS/);
    expect(deck.slides[0].content).toBe(source);
  });

  it.each(["inline", "stylesheet"] as const)(
    "rejects escaped %s properties that alias protected layout properties",
    (scope) => {
      const source =
        scope === "inline"
          ? '<div class="fmd-slide" style="padding:10px"><p>Keep this</p></div>'
          : '<style>.fmd-slide{padding:10px}</style><div class="fmd-slide"><p>Keep this</p></div>';
      const nextContent =
        scope === "inline"
          ? '<div class="fmd-slide" style="p\\61 dding:20px"><p>Keep this</p></div>'
          : '<style>.fmd-slide{p\\61 dding:20px}</style><div class="fmd-slide"><p>Keep this</p></div>';
      const deck = { slides: [{ id: "s1", content: source }] };

      expect(() =>
        applyOperation(deck, {
          op: "patch-slide",
          slideId: "s1",
          fields: { content: nextContent },
          baseContentHash: hashSlideContent(source),
          styleOnly: true,
        }),
      ).toThrow(/protected layout CSS/);
      expect(deck.slides[0].content).toBe(source);
    },
  );

  it.each([
    [
      "reorders conflicting inline declarations",
      '<div class="fmd-slide" style="padding:10px;padding-left:20px"></div>',
      '<div class="fmd-slide" style="padding-left:20px;padding:10px"></div>',
    ],
    [
      "reorders conflicting stylesheet declarations",
      '<style>.fmd-slide{padding:10px;padding-left:20px}</style><div class="fmd-slide"></div>',
      '<style>.fmd-slide{padding-left:20px;padding:10px}</style><div class="fmd-slide"></div>',
    ],
    [
      "reorders duplicate stylesheet rules",
      '<style>.fmd-slide{padding:10px}.fmd-slide{padding:20px}</style><div class="fmd-slide"></div>',
      '<style>.fmd-slide{padding:20px}.fmd-slide{padding:10px}</style><div class="fmd-slide"></div>',
    ],
    [
      "changes a media condition",
      '<style>@media (min-width: 600px){.fmd-slide{padding:10px}}</style><div class="fmd-slide"></div>',
      '<style>@media (min-width: 800px){.fmd-slide{padding:10px}}</style><div class="fmd-slide"></div>',
    ],
    [
      "changes a supports condition",
      '<style>@supports (display: grid){.fmd-slide{display:grid}}</style><div class="fmd-slide"></div>',
      '<style>@supports (display: flex){.fmd-slide{display:grid}}</style><div class="fmd-slide"></div>',
    ],
    [
      "changes declaration-free cascade layer order",
      '<style>@layer base, theme; @layer base { .fmd-slide { padding: 10px; } } @layer theme { .fmd-slide { padding: 20px; } }</style><div class="fmd-slide"></div>',
      '<style>@layer theme, base; @layer base { .fmd-slide { padding: 10px; } } @layer theme { .fmd-slide { padding: 20px; } }</style><div class="fmd-slide"></div>',
    ],
    [
      "changes an imported stylesheet",
      '<style>@import url("layout-a.css");</style><div class="fmd-slide"></div>',
      '<style>@import url("layout-b.css");</style><div class="fmd-slide"></div>',
    ],
    [
      "changes escaped cascade layer order",
      '<style>@l\\61 yer base, theme; @layer base { .fmd-slide { padding: 10px; } } @layer theme { .fmd-slide { padding: 20px; } }</style><div class="fmd-slide"></div>',
      '<style>@l\\61 yer theme, base; @layer base { .fmd-slide { padding: 10px; } } @layer theme { .fmd-slide { padding: 20px; } }</style><div class="fmd-slide"></div>',
    ],
    [
      "changes a registered custom property's initial value",
      '<style>@property --space { syntax: "<length>"; inherits: false; initial-value: 10px; } .fmd-slide { padding: var(--space); }</style><div class="fmd-slide"></div>',
      '<style>@property --space { syntax: "<length>"; inherits: false; initial-value: 100px; } .fmd-slide { padding: var(--space); }</style><div class="fmd-slide"></div>',
    ],
    [
      "changes a font face source",
      '<style>@font-face { font-family: Deck; src: url("a.woff2"); } .fmd-slide { font-family: Deck; }</style><div class="fmd-slide"></div>',
      '<style>@font-face { font-family: Deck; src: url("b.woff2"); } .fmd-slide { font-family: Deck; }</style><div class="fmd-slide"></div>',
    ],
  ])("rejects styleOnly CSS that %s", (_name, source, nextContent) => {
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: nextContent },
        baseContentHash: hashSlideContent(source),
        styleOnly: true,
      }),
    ).toThrow(/protected layout CSS/);
    expect(deck.slides[0].content).toBe(source);
  });

  it("allows a media-query change around an unprotected color restyle", () => {
    const source =
      '<style>@media (min-width:600px){.fmd-slide{background:red}}</style><div class="fmd-slide"></div>';
    const nextContent = source.replace("min-width:600px", "min-width:800px");
    const deck = { slides: [{ id: "s1", content: source }] };

    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: nextContent },
      baseContentHash: hashSlideContent(source),
      styleOnly: true,
    });

    expect(deck.slides[0].content).toBe(nextContent);
  });

  it.each([
    ["font", "16px Arial", "20px Arial"],
    ["border-width", "1px", "4px"],
    ["border-style", "solid", "none"],
    ["text-wrap", "wrap", "nowrap"],
    ["line-clamp", "2", "3"],
    ["text-overflow", "clip", "ellipsis"],
    ["text-transform", "none", "uppercase"],
    ["transform-origin", "50% 50%", "0 0"],
    ["zoom", "1", "1.2"],
    ["table-layout", "auto", "fixed"],
    ["border-spacing", "0", "4px"],
    ["border-collapse", "separate", "collapse"],
    ["line-break", "auto", "loose"],
    ["translate", "none", "10px"],
    ["rotate", "0deg", "45deg"],
    ["scale", "1", "2"],
    ["columns", "1", "2"],
    ["contain", "none", "layout"],
  ])(
    "rejects stylesheet %s changes in styleOnly edits",
    (property, before, after) => {
      const source = `<style>.fmd-slide { ${property}: ${before}; }</style><div class="fmd-slide"><p>Keep this</p></div>`;
      const nextContent = `<style>.fmd-slide { ${property}: ${after}; }</style><div class="fmd-slide"><p>Keep this</p></div>`;
      const deck = { slides: [{ id: "s1", content: source }] };

      expect(() =>
        applyOperation(deck, {
          op: "patch-slide",
          slideId: "s1",
          fields: { content: nextContent },
          baseContentHash: hashSlideContent(source),
          styleOnly: true,
        }),
      ).toThrow(/protected layout CSS/);
      expect(deck.slides[0].content).toBe(source);
    },
  );

  it("rejects activating a stylesheet animation that moves slide content", () => {
    const source =
      '<style>@keyframes move { from { top: 0; } to { top: 100px; } } .fmd-slide { position: relative; animation-name: none; }</style><div class="fmd-slide"><p>Keep this</p></div>';
    const nextContent = source.replace(
      "animation-name: none",
      "animation-name: move",
    );
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: nextContent },
        baseContentHash: hashSlideContent(source),
        styleOnly: true,
      }),
    ).toThrow(/protected layout CSS/);
    expect(deck.slides[0].content).toBe(source);
  });

  it.each([
    [
      "changes preformatted whitespace",
      "<pre>Keep  this</pre>",
      "<pre>Keep this</pre>",
    ],
    [
      "removes literal style text",
      '<pre>Visible style="color:red"</pre>',
      "<pre>Visible</pre>",
    ],
  ])("rejects styleOnly edits that %s", (_name, source, nextContent) => {
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: nextContent },
        baseContentHash: hashSlideContent(source),
        styleOnly: true,
      }),
    ).toThrow(/preserve text, markup, element order, and layout structure/);
    expect(deck.slides[0].content).toBe(source);
  });

  it("does not move protected CSS between elements in a styleOnly patch", () => {
    const source =
      '<div class="fmd-slide"><p style="padding:1px">Keep this</p><p style="color:red">Also keep this</p></div>';
    const deck = { slides: [{ id: "s1", content: source }] };

    expect(() =>
      applyOperation(deck, {
        op: "patch-slide",
        slideId: "s1",
        fields: {
          content:
            '<div class="fmd-slide"><p>Keep this</p><p style="padding:1px;color:red">Also keep this</p></div>',
        },
        baseContentHash: hashSlideContent(source),
        styleOnly: true,
      }),
    ).toThrow(/protected layout CSS/);
    expect(deck.slides[0].content).toBe(source);
  });

  it("ignores the op when the slide has been concurrently deleted", () => {
    const deck = { slides: [{ id: "s2", content: "<p>Two</p>" }] };
    const op: Operation = {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: "<p>New</p>" },
    };
    applyOperation(deck, op);
    expect(deck.slides).toHaveLength(1);
  });

  it("concurrent patches to different slides both survive", () => {
    const deck = {
      slides: [
        { id: "s1", content: "<p>Slide1</p>" },
        { id: "s2", content: "<p>Slide2</p>" },
      ],
    };
    const op1: Operation = {
      op: "patch-slide",
      slideId: "s1",
      fields: { content: "<p>Updated1</p>" },
    };
    const op2: Operation = {
      op: "patch-slide",
      slideId: "s2",
      fields: { content: "<p>Updated2</p>" },
    };
    applyOperation(deck, op1);
    applyOperation(deck, op2);
    expect(deck.slides[0].content).toBe("<p>Updated1</p>");
    expect(deck.slides[1].content).toBe("<p>Updated2</p>");
  });

  it("invalidates fit for layout and Excalidraw changes, not notes", () => {
    const deck = {
      slides: [
        {
          id: "s1",
          content: "<p>Slide</p>",
          layout: "content",
          notes: "old",
          layoutFitRevision: "old-revision",
        },
      ],
    };

    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { notes: "new" },
    });
    expect(deck.slides[0].layoutFitRevision).toBe("old-revision");

    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { layout: "statement" },
    });
    const layoutRevision = deck.slides[0].layoutFitRevision;
    expect(layoutRevision).toEqual(expect.any(String));
    expect(layoutRevision).not.toBe("old-revision");

    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { excalidrawData: '{"elements":[]}' },
    });
    expect(deck.slides[0].layoutFitRevision).toEqual(expect.any(String));
    expect(deck.slides[0].layoutFitRevision).not.toBe(layoutRevision);
  });

  it("persists dismissal for human patches and clears it for changed agent layout", () => {
    const deck = {
      slides: [
        {
          id: "s1",
          content: "old",
          layout: "content",
          layoutWarningDismissed: true,
        },
      ],
    };

    applyOperation(deck, {
      op: "patch-slide",
      slideId: "s1",
      fields: { layoutWarningDismissed: true },
    });
    expect(deck.slides[0].layoutWarningDismissed).toBe(true);

    applyOperation(
      deck,
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { notes: "human note" },
      },
      { clearLayoutWarningDismissal: true },
    );
    expect(deck.slides[0].layoutWarningDismissed).toBe(true);

    applyOperation(
      deck,
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: "new layout" },
      },
      { clearLayoutWarningDismissal: true },
    );
    expect(deck.slides[0].layoutWarningDismissed).toBeUndefined();
  });
});

describe("applyOperation — delete-slide", () => {
  it("removes the targeted slide", () => {
    const deck = {
      slides: [
        { id: "s1", content: "<p>One</p>" },
        { id: "s2", content: "<p>Two</p>" },
      ],
    };
    applyOperation(deck, { op: "delete-slide", slideId: "s1" });
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].id).toBe("s2");
  });

  it("inserts a blank fallback slide when the last slide is deleted", () => {
    const deck = { slides: [{ id: "s1", content: "<p>Only</p>" }] };
    applyOperation(deck, { op: "delete-slide", slideId: "s1" });
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].layout).toBe("blank");
  });

  it("can preserve an empty deck when undoing an add-slide", () => {
    const deck = { slides: [{ id: "s1", content: "<p>Only</p>" }] };
    applyOperation(deck, {
      op: "delete-slide",
      slideId: "s1",
      allowEmpty: true,
    });
    expect(deck.slides).toEqual([]);
  });

  it("is a no-op when the slide was already deleted (idempotent)", () => {
    const deck = { slides: [{ id: "s2", content: "<p>Two</p>" }] };
    expect(applyOperation(deck, { op: "delete-slide", slideId: "s1" })).toBe(
      false,
    );
    expect(deck.slides).toHaveLength(1);
  });
});

describe("applyOperation — reorder-slides", () => {
  it("reorders slides to match orderedIds", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
        { id: "s3", content: "3" },
      ],
    };
    applyOperation(deck, {
      op: "reorder-slides",
      orderedIds: ["s3", "s1", "s2"],
    });
    expect(deck.slides.map((s: { id: string }) => s.id)).toEqual([
      "s3",
      "s1",
      "s2",
    ]);
  });

  it("keeps slides not in orderedIds at the end (concurrent add safety)", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
        { id: "s3-new", content: "3" }, // added concurrently, not in client list
      ],
    };
    applyOperation(deck, {
      op: "reorder-slides",
      orderedIds: ["s2", "s1"],
    });
    expect(deck.slides.map((s: { id: string }) => s.id)).toEqual([
      "s2",
      "s1",
      "s3-new",
    ]);
  });

  it("reorder during concurrent add does not drop the new slide", () => {
    const deckAfterAdd = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
        { id: "s3", content: "3" }, // added by writer B
      ],
    };
    applyOperation(deckAfterAdd, {
      op: "reorder-slides",
      orderedIds: ["s2", "s1"],
    });
    const ids = deckAfterAdd.slides.map((s: { id: string }) => s.id);
    expect(ids).toContain("s3");
    expect(ids).toEqual(["s2", "s1", "s3"]);
  });

  it("rejects duplicate slide IDs instead of persisting duplicate slides", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
      ],
    };

    expect(() =>
      applyOperation(deck, {
        op: "reorder-slides",
        orderedIds: ["s2", "s1", "s2"],
      }),
    ).toThrow(/duplicate ID s2/);
    expect(deck.slides.map((slide: { id: string }) => slide.id)).toEqual([
      "s1",
      "s2",
    ]);
  });
});

describe("applyOperation — add-slide", () => {
  it("appends the slide when no afterSlideId is given", () => {
    const deck = { slides: [{ id: "s1", content: "1" }] };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      fields: {
        content: "<p>New</p>",
        layout: "content",
        background: "bg-black",
      },
    });
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].id).toBe("s2");
  });

  it("inserts after the referenced slide", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s3", content: "3" },
      ],
    };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      afterSlideId: "s1",
      fields: { content: "<p>Two</p>" },
    });
    expect(deck.slides.map((s: { id: string }) => s.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("keeps transition, animations, and image data on a duplicated slide", () => {
    const deck = { slides: [{ id: "s1", content: "1" }] };
    applyOperation(deck, {
      op: "add-slide",
      slideId: "s2",
      afterSlideId: "s1",
      fields: {
        content: "<p>Copy</p>",
        transition: "fade",
        animations: [{ id: "a1", elementIndex: 0, type: "fade" }],
        imageUrl: "https://example.com/slide.png",
        imageLoading: true,
      },
    });
    const copy = deck.slides[1];
    expect(copy.transition).toBe("fade");
    expect(copy.animations).toHaveLength(1);
    expect(copy.imageUrl).toBe("https://example.com/slide.png");
    expect(copy.imageLoading).toBeUndefined();
  });

  it("is idempotent — duplicate delivery is silently ignored", () => {
    const deck = {
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "existing" },
      ],
    };
    expect(
      applyOperation(deck, {
        op: "add-slide",
        slideId: "s2",
        fields: { content: "<p>New</p>" },
      }),
    ).toBe(false);
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].content).toBe("existing");
  });

  it("keeps source provenance for idempotent structural operations", () => {
    const sourceImport = { mode: "source-preserving" };
    const deck = {
      sourceImport,
      slides: [
        { id: "s1", content: "1" },
        { id: "s2", content: "2" },
      ],
    };

    expect(
      applyOperation(deck, { op: "delete-slide", slideId: "missing" }),
    ).toBe(false);
    expect(
      applyOperation(deck, {
        op: "reorder-slides",
        orderedIds: ["s1", "s2"],
      }),
    ).toBe(false);
    expect(
      applyOperation(deck, {
        op: "add-slide",
        slideId: "s2",
        fields: { content: "duplicate" },
      }),
    ).toBe(false);
    expect(deck.sourceImport).toBe(sourceImport);
  });
});

describe("applyOperation — patch-deck-fields", () => {
  it("updates only the provided top-level fields", () => {
    const deck = {
      title: "Old",
      designSystemId: "ds1",
      tweaks: { accent: "#f00" },
      slides: [],
    };
    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { title: "New" },
    });
    expect(deck.title).toBe("New");
    expect(deck.designSystemId).toBe("ds1");
  });

  it("allows clearing designSystemId to null", () => {
    const deck = { title: "T", designSystemId: "ds1", slides: [] };
    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { designSystemId: null },
    });
    expect(deck.designSystemId).toBeNull();
  });

  it("persists generation context without changing slide content", () => {
    const generationContext = {
      originalPrompt: "Create a dark 6-slide deck",
      targetSlideCount: 6,
      files: [
        { path: "/uploads/reference.png", originalName: "reference.png" },
      ],
    };
    const deck = { title: "T", slides: [{ id: "s1", content: "source" }] };

    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { generationContext },
    });

    expect(deck.generationContext).toEqual(generationContext);
    expect(deck.slides[0].content).toBe("source");
  });

  it("recovers an opaque title from the first slide", () => {
    const deck = {
      title: "Untitled Deck",
      slides: [
        {
          content:
            '<div class="fmd-slide"><div style="font-size: 54px;">Agent-Native Strategy</div></div>',
        },
      ],
    };

    applyOperation(deck, {
      op: "patch-deck-fields",
      fields: { title: "H3sVsnns-TEVUOpz9w" },
    });

    expect(deck.title).toBe("Agent-Native Strategy");
  });

  it("rejects an opaque title when no slide title is available", () => {
    expect(() =>
      applyOperation(
        { title: "Untitled Deck", slides: [] },
        {
          op: "patch-deck-fields",
          fields: { title: "H3sVsnns-TEVUOpz9w" },
        },
      ),
    ).toThrow(/human-readable title/);
  });
});

describe("source-imported deck structure", () => {
  it.each([
    {
      name: "adding",
      operation: {
        op: "add-slide" as const,
        slideId: "s3",
        fields: { content: "New" },
      },
    },
    {
      name: "deleting",
      operation: { op: "delete-slide" as const, slideId: "s1" },
    },
    {
      name: "reordering",
      operation: {
        op: "reorder-slides" as const,
        orderedIds: ["s2", "s1"],
      },
    },
  ])(
    "clears source provenance when $name an imported deck",
    ({ operation }) => {
      const deck = {
        sourceImport: buildSourceImportMetadata({
          format: "pdf",
          slides: [
            {
              id: "s1",
              text: "one",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
            {
              id: "s2",
              text: "two",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
          ],
        }),
        slides: [
          { id: "s1", content: "One" },
          { id: "s2", content: "Two" },
        ],
      };

      applyOperation(deck, operation);

      expect(deck.sourceImport).toBeUndefined();
    },
  );

  it("rejects a partial deck-wide source restyle before writing", () => {
    const metadata = buildSourceImportMetadata({
      format: "pdf",
      slides: [
        { id: "s1", text: "one", notes: "", imageUrls: [], editableText: true },
        { id: "s2", text: "two", notes: "", imageUrls: [], editableText: true },
        {
          id: "s3",
          text: "three",
          notes: "",
          imageUrls: [],
          editableText: true,
        },
      ],
    });

    expect(() =>
      assertSourceImportSlidesCovered(
        metadata,
        [{ op: "patch-slide", slideId: "s1", fields: { content: "styled" } }],
        true,
      ),
    ).toThrow("Missing 2 slide(s): s2, s3");
  });

  it("accepts complete content coverage for a deck-wide source restyle", () => {
    const metadata = buildSourceImportMetadata({
      format: "pdf",
      slides: [
        { id: "s1", text: "one", notes: "", imageUrls: [], editableText: true },
        { id: "s2", text: "two", notes: "", imageUrls: [], editableText: true },
      ],
    });

    expect(() =>
      assertSourceImportSlidesCovered(
        metadata,
        [
          { op: "patch-slide", slideId: "s1", fields: { content: "one" } },
          { op: "patch-slide", slideId: "s2", fields: { content: "two" } },
        ],
        true,
      ),
    ).not.toThrow();
  });

  it("rejects rewriteSource for a regular deck before changing it", async () => {
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        slides: [
          {
            id: "slide-1",
            content: "<div>One</div>",
            animations: [{ id: "a1", elementIndex: 0, type: "fade" }],
          },
        ],
      }),
    };

    await expect(
      patchDeckAction.run(
        {
          deckId: "deck-1",
          rewriteSource: true,
          operations: [
            {
              op: "patch-slide",
              slideId: "slide-1",
              fields: { content: "<div>Updated</div>" },
            },
          ],
        },
        { caller: "tool" },
      ),
    ).rejects.toThrow("only applies to a source-preserving deck");
    expect(lastUpdatedDeckData).toBeUndefined();
  });
});

describe("animation target validation", () => {
  const content = `<div class="fmd-slide">
    <div><h2>Title</h2></div>
    <div><p>Body</p></div>
  </div>`;

  const animation = (overrides: Record<string, unknown> = {}) => ({
    id: "reveal-title",
    elementIndex: 0,
    elementPath: [0, 0],
    type: "fade" as const,
    ...overrides,
  });

  const applyAndValidate = (deck: any, operations: Operation[]) => {
    for (const operation of operations) {
      applyOperation(deck, operation);
    }
    assertPatchedSlideAnimationsResolve(deck, operations);
  };

  it("accepts paths that resolve in the final slide HTML", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [{ id: "s1", content, animations: [animation()] }],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: { content, animations: [animation()] },
          },
        ],
      ),
    ).not.toThrow();
  });

  it("rejects a stale path before persistence can accept it", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [animation({ elementPath: [9, 9] })],
            },
          ],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: {
              content,
              animations: [animation({ elementPath: [9, 9] })],
            },
          },
        ],
      ),
    ).toThrow(/reveal-title.*does not resolve/);
  });

  it("validates animation paths on newly added slides", () => {
    expect(() =>
      applyAndValidate({ slides: [] }, [
        {
          op: "add-slide",
          slideId: "s2",
          fields: {
            content,
            animations: [animation({ elementPath: [9, 9] })],
          },
        },
      ]),
    ).toThrow(/reveal-title.*does not resolve/);
  });

  it("rejects duplicate reveal targets instead of creating a phantom step", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [
                animation(),
                animation({ id: "reveal-title-again" }),
              ],
            },
          ],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: {
              animations: [
                animation(),
                animation({ id: "reveal-title-again" }),
              ],
            },
          },
        ],
      ),
    ).toThrow(/reveal-title-again.*duplicates target path 0.0/);
  });

  it("rejects elementIndex-only targets when an agent revises animations", () => {
    expect(() =>
      assertPatchedSlideAnimationsResolve(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [
                {
                  id: "legacy-target",
                  elementIndex: 0,
                  type: "fade" as const,
                },
              ],
            },
          ],
        },
        [
          {
            op: "patch-slide",
            slideId: "s1",
            fields: {
              animations: [
                {
                  id: "legacy-target",
                  elementIndex: 0,
                  type: "fade",
                },
              ],
            },
          },
        ],
        { requireElementPaths: true },
      ),
    ).toThrow(/legacy-target.*missing elementPath/);
  });

  it("does not validate stale animation metadata for unrelated writes", () => {
    expect(() =>
      applyAndValidate(
        {
          slides: [
            {
              id: "s1",
              content,
              animations: [animation({ elementPath: [99] })],
            },
          ],
        },
        [{ op: "patch-slide", slideId: "s1", fields: { notes: "Updated" } }],
      ),
    ).not.toThrow();
  });

  it("clears omitted animations when an agent revises slide content", () => {
    const deck = {
      slides: [{ id: "s1", content, animations: [animation()] }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: '<div class="fmd-slide"><div>New</div></div>' },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations);

    expect(deck.slides[0].animations).toBeUndefined();
  });

  it("preserves imported animations for source-preserving content patches", () => {
    const sourceImport = buildSourceImportMetadata({
      format: "pptx",
      slides: [
        {
          id: "s1",
          text: "Imported slide text",
          notes: "",
          imageUrls: [],
          editableText: true,
        },
      ],
    });
    const animations = [animation()];
    const deck = {
      sourceImport,
      slides: [{ id: "s1", content, animations }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations, {
      sourceImport,
    });

    expect(deck.slides[0].animations).toEqual(animations);
  });

  it("does not clear a separate explicit animation patch", () => {
    const animations = [animation()];
    const deck = {
      slides: [{ id: "s1", content, animations }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: '<div class="fmd-slide"><div>New</div></div>' },
      },
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { animations },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations);

    expect(deck.slides[0].animations).toEqual(animations);
  });

  it("keeps an explicit complete animation list with revised content", () => {
    const nextContent =
      '<div class="fmd-slide"><div><h2>New title</h2></div></div>';
    const nextAnimations = [animation({ elementPath: [0, 0] })];
    const deck = {
      slides: [{ id: "s1", content, animations: [animation()] }],
    };
    const operations: Operation[] = [
      {
        op: "patch-slide",
        slideId: "s1",
        fields: { content: nextContent, animations: nextAnimations },
      },
    ];

    for (const operation of operations) applyOperation(deck, operation);
    clearOmittedAnimationsForAgentContentPatches(deck, operations);

    expect(deck.slides[0].animations).toEqual(nextAnimations);
  });
});

describe("isAgentPatchCaller", () => {
  it("treats tool, mcp, a2a, and webmcp callers as agent callers", () => {
    expect(isAgentPatchCaller("tool")).toBe(true);
    expect(isAgentPatchCaller("mcp")).toBe(true);
    expect(isAgentPatchCaller("a2a")).toBe(true);
    expect(isAgentPatchCaller("webmcp")).toBe(true);
  });

  it("treats the browser editor and unset callers as non-agent", () => {
    expect(isAgentPatchCaller("frontend")).toBe(false);
    expect(isAgentPatchCaller("http")).toBe(false);
    expect(isAgentPatchCaller(undefined)).toBe(false);
  });
});

describe("patch-deck agent schema", () => {
  it("advertises bounded deck, slide, and structural operations", () => {
    const parameters = patchDeckAction.tool.parameters as any;
    const operations = parameters.properties.operations.items.anyOf;
    const deckFields = operations.find(
      (operation: any) =>
        operation.properties?.op?.const === "patch-deck-fields",
    );
    const slidePatch = operations.find(
      (operation: any) => operation.properties?.op?.const === "patch-slide",
    );
    const slideDelete = operations.find(
      (operation: any) => operation.properties?.op?.const === "delete-slide",
    );
    const slideReorder = operations.find(
      (operation: any) => operation.properties?.op?.const === "reorder-slides",
    );

    expect(operations).toHaveLength(5);
    expect(deckFields.properties.fields.properties.title).toMatchObject({
      type: "string",
    });
    expect(deckFields.properties.fields.properties).not.toHaveProperty(
      "aspectRatio",
    );
    expect(deckFields.properties.fields.properties).not.toHaveProperty(
      "visibility",
    );
    expect(slidePatch.properties.slideId).toMatchObject({ type: "string" });
    expect(slidePatch.properties.fields.properties.content).toMatchObject({
      type: "string",
    });
    expect(slidePatch.properties.baseContentHash).toMatchObject({
      type: "string",
    });
    expect(slidePatch.properties.styleOnly).toMatchObject({ type: "boolean" });
    expect(slideDelete.properties.slideId).toMatchObject({ type: "string" });
    expect(slideDelete.properties.allowEmpty).toMatchObject({
      type: "boolean",
    });
    expect(slideReorder.properties.orderedIds).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(parameters.properties.rewriteSource).toMatchObject({
      type: "boolean",
    });
    expect(parameters.properties.requireAllSourceSlides).toMatchObject({
      type: "boolean",
    });
  });

  it("requires a content hash and content-only fields for styleOnly patches", () => {
    const base = {
      op: "patch-slide",
      slideId: "slide-1",
      fields: { content: "<div style='color:red'>Slide</div>" },
      styleOnly: true,
    };
    expect(OperationSchema.safeParse(base).success).toBe(false);
    expect(
      OperationSchema.safeParse({ ...base, baseContentHash: "abc123" }).success,
    ).toBe(true);
    expect(
      OperationSchema.safeParse({
        ...base,
        baseContentHash: "abc123",
        fields: { ...base.fields, notes: "notes" },
      }).success,
    ).toBe(false);
  });

  it("spells out the animation entry shape and its replace semantics", () => {
    const parameters = patchDeckAction.tool.parameters as any;
    const slidePatch = parameters.properties.operations.items.anyOf.find(
      (operation: any) => operation.properties?.op?.const === "patch-slide",
    );
    const animations = slidePatch.properties.fields.properties.animations;

    expect(animations.description).toMatch(/complete ordered/i);
    expect(animations.items.properties.type.enum).toEqual([
      "appear",
      "fade",
      "slide-up",
      "zoom",
    ]);
    expect(animations.items.properties).toHaveProperty("id");
    expect(animations.items.properties).toHaveProperty("elementIndex");
    expect(animations.items.properties).toHaveProperty("elementPath");
  });

  it("rejects stored entries that predate the required id/elementIndex/type", () => {
    const pathOnlyEntry = OperationSchema.safeParse({
      op: "patch-slide",
      slideId: "s1",
      fields: { animations: [{ elementPath: [0, 2], type: "fade" }] },
    });
    const fullyFormedEntry = OperationSchema.safeParse({
      op: "patch-slide",
      slideId: "s1",
      fields: {
        animations: [
          { id: "a1", elementIndex: 2, elementPath: [0, 2], type: "fade" },
        ],
      },
    });

    expect(pathOnlyEntry.success).toBe(false);
    expect(fullyFormedEntry.success).toBe(true);
  });
});

describe("withDeckLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serialises concurrent writes for the same deck", async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const first = withDeckLock("deck-x", async () => {
      order.push("first-start");
      await firstDone;
      order.push("first-end");
    });

    const second = withDeckLock("deck-x", async () => {
      order.push("second-start");
    });

    resolveFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("allows concurrent writes for DIFFERENT decks", async () => {
    const order: string[] = [];
    let resolveA!: () => void;
    const aDone = new Promise<void>((res) => {
      resolveA = res;
    });

    const a = withDeckLock("deck-a", async () => {
      order.push("a-start");
      await aDone;
      order.push("a-end");
    });

    const b = withDeckLock("deck-b", async () => {
      order.push("b-start");
    });

    await b;
    expect(order).toContain("b-start");
    expect(order).not.toContain("a-end");

    resolveA();
    await a;
    expect(order).toContain("a-end");
  });
});

describe("resolveDeckColumnUpdates", () => {
  const current = { title: "Old", designSystemId: null };

  const renameOp = (title: string): Operation => ({
    op: "patch-deck-fields",
    fields: { title },
  });

  it("takes the last title in a debounced rename burst", () => {
    const burst = ["N", "Ne", "New", "New ", "New Name"].map(renameOp);
    expect(resolveDeckColumnUpdates(current, burst).title).toBe("New Name");
  });

  it("uses the title recovered while applying the operations", () => {
    const operations: Operation[] = [
      {
        op: "patch-deck-fields",
        fields: { title: "H3sVsnns-TEVUOpz9w" },
      },
    ];
    expect(
      resolveDeckColumnUpdates(current, operations, "Recovered").title,
    ).toBe("Recovered");
  });

  it("takes the last designSystemId in a batch", () => {
    const ops: Operation[] = [
      { op: "patch-deck-fields", fields: { designSystemId: "ds-1" } },
      { op: "patch-deck-fields", fields: { designSystemId: "ds-2" } },
    ];
    expect(resolveDeckColumnUpdates(current, ops).designSystemId).toBe("ds-2");
  });

  it("keeps current values when no field op touches them", () => {
    const ops: Operation[] = [
      { op: "delete-slide", slideId: "s1" },
      { op: "patch-deck-fields", fields: { visibility: "org" } },
    ];
    expect(
      resolveDeckColumnUpdates({ title: "Keep", designSystemId: "ds-9" }, ops),
    ).toEqual({ title: "Keep", designSystemId: "ds-9" });
  });

  it("treats an explicit null designSystemId as a clear", () => {
    const ops: Operation[] = [
      { op: "patch-deck-fields", fields: { designSystemId: null } },
    ];
    expect(
      resolveDeckColumnUpdates({ title: "T", designSystemId: "ds-1" }, ops)
        .designSystemId,
    ).toBeNull();
  });
});

describe("run() — asynchronous layout fit metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it.each(["tool", "webmcp"] as const)(
    "rejects an agent add that would exceed the persisted target for %s callers",
    async (caller) => {
      const slides = Array.from({ length: 8 }, (_, index) => ({
        id: `slide-${index + 1}`,
        content: `<div>${index + 1}</div>`,
      }));
      mockDeckRow!.data = JSON.stringify({
        title: "Deck",
        generationContext: { targetSlideCount: 8 },
        slides,
      });

      const error = await patchDeckAction
        .run(
          {
            deckId: "deck-1",
            requireAllSourceSlides: false,
            operations: [
              {
                op: "add-slide",
                slideId: "slide-9",
                fields: { content: "<div>9</div>" },
              },
            ],
          },
          { caller },
        )
        .catch((caught: unknown) => caught);

      expect(isAgentActionStopError(error)).toBe(true);
      expect(error).toMatchObject({
        name: "AgentActionStopError",
        errorCode: "target_slide_count_reached",
        details: {
          deckId: "deck-1",
          currentSlideCount: 8,
          projectedSlideCount: 9,
          targetSlideCount: 8,
        },
      });
      expect(lastUpdatedDeckData).toBeUndefined();
    },
  );

  it("requires a source hash for every slide in an agent content batch", async () => {
    const error = await patchDeckAction
      .run(
        {
          deckId: "deck-1",
          operations: [
            {
              op: "patch-slide",
              slideId: "slide-1",
              fields: { content: "<div>Updated one</div>" },
            },
            {
              op: "patch-slide",
              slideId: "slide-2",
              fields: { content: "<div>Updated two</div>" },
            },
          ],
        },
        { caller: "tool" },
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: expect.stringContaining("requires the contentHash read"),
    });
    expect(lastUpdatedDeckData).toBeUndefined();
  });

  it("rejects a stale single-slide hash before writing", async () => {
    const error = await patchDeckAction
      .run(
        {
          deckId: "deck-1",
          operations: [
            {
              op: "patch-slide",
              slideId: "slide-1",
              fields: { content: "<div>Overwritten</div>" },
              baseContentHash: "stale-hash",
            },
          ],
        },
        { caller: "tool" },
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: expect.stringContaining("changed since it was read"),
      statusCode: 409,
    });
    expect(lastUpdatedDeckData).toBeUndefined();
  });

  it("keeps reveal metadata when patch-deck applies a styleOnly batch", async () => {
    const source =
      '<div class="fmd-slide" style="background:#000;padding:80px"><p>One</p></div>';
    const nextContent =
      '<div class="fmd-slide" style="background:#fff;padding:80px"><p>One</p></div>';
    const animations = [
      { id: "reveal-1", elementIndex: 0, elementPath: [0], type: "fade" },
    ];
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: source, animations }],
    });

    await patchDeckAction.run(
      {
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: nextContent },
            baseContentHash: hashSlideContent(source),
            styleOnly: true,
          },
        ],
      },
      { caller: "tool" },
    );

    expect(JSON.parse(lastUpdatedDeckData!).slides[0]).toMatchObject({
      content: nextContent,
      animations,
    });
  });

  it("accepts formatted styleOnly batch input while hashing the raw source", async () => {
    const source =
      '<style>@media (min-width:600px){.fmd-slide{padding:10px;background:red;}}</style><div class="fmd-slide"><p>One</p></div>';
    const formattedSource = await formatSlideHtml(source);
    const nextContent = formattedSource.replace(
      /background:\s*red/,
      "background: blue",
    );
    expect(nextContent).not.toBe(formattedSource);
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: source }],
    });

    await patchDeckAction.run(
      {
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: nextContent },
            baseContentHash: hashSlideContent(source),
            styleOnly: true,
          },
        ],
      },
      { caller: "tool" },
    );

    expect(JSON.parse(lastUpdatedDeckData!).slides[0].content).toBe(
      nextContent,
    );
  });

  it("formats surrounding HTML without changing preformatted blocks", async () => {
    const pre = '<pre class="code">  alpha\n    beta   \ngamma  </pre>';
    const source = `<div class="fmd-slide"><p>Before</p>${pre}<p>After</p></div>`;

    const formatted = await formatSlideHtml(source);

    expect(formatted).not.toBe(source);
    expect(formatted).toContain(pre);
  });

  it.each(["pre", "pre-wrap", "break-spaces"])(
    "preserves text in elements with white-space: %s",
    async (whiteSpace) => {
      const text = "  alpha\n    beta   \ngamma  ";
      const whitespaceOnly = "  \n    ";
      const element = `<div style="white-space: ${whiteSpace}">${text}<span>${whitespaceOnly}</span>${whitespaceOnly}</div>`;
      const formatted = await formatSlideHtml(
        `<section><h1>Title</h1>${element}<p>After</p></section>`,
      );

      expect(formatted).toContain(element);
    },
  );

  it("accepts formatted styleOnly batch CSS after formatter spacing changes", async () => {
    const pre = "<pre>  alpha\n    beta   \ngamma  </pre>";
    const whiteSpaceText =
      '<div style="white-space: pre">  keep  these\n    spaces   </div>';
    const source =
      `<style>@media (min-width:600px){.fmd-slide{padding:10px;background:red;}}</style>` +
      `<div class="fmd-slide">${pre}${whiteSpaceText}</div>`;
    const formattedSource = await formatSlideHtml(source);
    const nextContent = formattedSource.replace(
      /background:\s*red/,
      "background: blue",
    );
    const rawValidationError = (() => {
      try {
        applyOperation(
          { slides: [{ id: "slide-1", content: source }] },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: nextContent },
            baseContentHash: hashSlideContent(source),
            styleOnly: true,
          },
        );
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(rawValidationError).toMatchObject({
      errorCode: "style_only_slide_structure_changed",
    });
    mockDeckRow!.data = JSON.stringify({
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [{ id: "slide-1", content: source }],
    });

    await patchDeckAction.run(
      {
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: nextContent },
            baseContentHash: hashSlideContent(source),
            styleOnly: true,
          },
        ],
      },
      { caller: "tool" },
    );

    expect(JSON.parse(lastUpdatedDeckData!).slides[0].content).toBe(
      nextContent,
    );
    expect(JSON.parse(lastUpdatedDeckData!).slides[0].content).toContain(pre);
    expect(JSON.parse(lastUpdatedDeckData!).slides[0].content).toContain(
      whiteSpaceText,
    );
  });

  it("returns pending hashes for every content-changed slide", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Updated one</div>" },
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Updated two</div>" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      deckId: "deck-1",
      updatedSlideIds: ["slide-1", "slide-2"],
      layoutFit: {
        status: "pending",
        slides: [
          {
            slideId: "slide-1",
            contentHash: hashSlideContent("<div>Updated one</div>"),
            layoutFitRevision: expect.any(String),
          },
          {
            slideId: "slide-2",
            contentHash: hashSlideContent("<div>Updated two</div>"),
            layoutFitRevision: expect.any(String),
          },
        ],
      },
    });
    expect(result.layoutOverflow).toBeUndefined();
  });

  it.each(["frontend", "tool"] as const)(
    "does not persist an unchanged patch for %s callers",
    async (caller) => {
      const result = await patchDeckAction
        .run(
          {
            deckId: "deck-1",
            requireAllSourceSlides: false,
            operations: [
              {
                op: "patch-slide",
                slideId: "slide-1",
                fields: { content: "<div>One</div>" },
              },
            ],
          },
          { caller },
        )
        .catch((error: unknown) => error);

      if (caller === "tool") {
        expect(result).toMatchObject({
          message: expect.stringContaining("Nothing was written"),
        });
      } else {
        expect(result).toMatchObject({
          ok: true,
          applied: false,
          updatedAt: mockDeckRow!.updatedAt,
        });
      }
      expect(lastUpdatedDeckData).toBeUndefined();
      expect(mockNotifyClients).not.toHaveBeenCalled();
    },
  );

  it("broadcasts the changed slide for a single-slide agent patch", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Updated</div>" },
          },
        ],
      },
      { caller: "tool", runId: "run-1", turnId: "turn-1" },
    );

    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1", {
      slideId: "slide-1",
      actor: "agent",
      agentChangeId: "turn-1",
    });
  });

  it("returns pending fit metadata for layout-only and Excalidraw patches", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { layout: "statement" },
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { excalidrawData: '{"elements":[]}' },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result.layoutFit).toMatchObject({
      status: "pending",
      slides: [
        {
          slideId: "slide-1",
          contentHash: hashSlideContent("<div>One</div>"),
          layoutFitRevision: expect.any(String),
        },
        {
          slideId: "slide-2",
          contentHash: hashSlideContent("<div>Two</div>"),
          layoutFitRevision: expect.any(String),
        },
      ],
    });
  });

  it("returns pending fit metadata for deck-wide geometry changes", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-deck-fields",
            fields: { aspectRatio: "4:3", designSystemId: "ds-1" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result.layoutFit).toMatchObject({
      status: "pending",
      slides: [
        {
          slideId: "slide-1",
          contentHash: hashSlideContent("<div>One</div>"),
          layoutFitRevision: expect.any(String),
        },
        {
          slideId: "slide-2",
          contentHash: hashSlideContent("<div>Two</div>"),
          layoutFitRevision: expect.any(String),
        },
      ],
    });
  });

  it("clears dismissed overflow warnings for every slide on an agent deck change", async () => {
    const persistedDeck = {
      title: "Deck",
      aspectRatio: "16:9",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>One</div>",
          layoutWarningDismissed: true,
        },
        {
          id: "slide-2",
          content: "<div>Two</div>",
          layoutWarningDismissed: true,
        },
      ],
    };
    mockDeckRow!.data = JSON.stringify(persistedDeck);

    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-deck-fields",
            fields: { aspectRatio: "4:3" },
          },
        ],
      },
      { caller: "tool" },
    );

    expect(
      JSON.parse(lastUpdatedDeckData!).slides.map(
        (slide: { layoutWarningDismissed?: boolean }) =>
          slide.layoutWarningDismissed,
      ),
    ).toEqual([undefined, undefined]);
  });

  it("does not target a mixed structural batch at one slide", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Updated</div>" },
          },
          { op: "delete-slide", slideId: "slide-2" },
        ],
      },
      { caller: "tool" },
    );

    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
  });

  it("does not target a slide when deck fields are also patched", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Updated</div>" },
          },
          { op: "patch-deck-fields", fields: { title: "Updated deck" } },
        ],
      },
      { caller: "tool" },
    );

    expect(mockNotifyClients).toHaveBeenCalledWith("deck-1");
  });

  it("reports slide ids that were actually deleted", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [{ op: "delete-slide", slideId: "slide-1" }],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      updatedSlideIds: [],
      deletedSlideIds: ["slide-1"],
    });
    expect(JSON.parse(lastUpdatedDeckData!).slides).toEqual([
      expect.objectContaining({ id: "slide-2" }),
    ]);
  });

  it("omits layout fit metadata when content was not patched", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { notes: "Updated notes" },
          },
        ],
      },
      {},
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.layoutFit).toBeUndefined();
  });

  it("clears dismissed overflow warnings only for changed agent layout", async () => {
    const persistedDeck = {
      title: "Deck",
      updatedAt: "2026-01-01T00:00:00.000Z",
      slides: [
        {
          id: "slide-1",
          content: "<div>One</div>",
          layoutWarningDismissed: true,
        },
      ],
    };
    mockDeckRow!.data = JSON.stringify(persistedDeck);

    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Agent update</div>" },
          },
        ],
      },
      { caller: "tool" },
    );
    expect(
      JSON.parse(lastUpdatedDeckData!).slides[0].layoutWarningDismissed,
    ).toBeUndefined();

    mockDeckRow!.data = JSON.stringify(persistedDeck);
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Human update</div>" },
          },
        ],
      },
      {},
    );
    expect(
      JSON.parse(lastUpdatedDeckData!).slides[0].layoutWarningDismissed,
    ).toBe(true);
  });

  it("allows a structural agent edit without a source rewrite flag", async () => {
    mockDeckRow = {
      ...mockDeckRow,
      data: JSON.stringify({
        title: "Imported deck",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
        sourceImport: {
          mode: "source-preserving",
          format: "pdf",
          fidelity: "source-faithful",
          slideCount: 2,
          slideIds: ["slide-1", "slide-2"],
          slides: [
            {
              id: "slide-1",
              text: "One",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
            {
              id: "slide-2",
              text: "Two",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
          ],
        },
      }),
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        operations: [{ op: "delete-slide", slideId: "slide-1" }],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      sourceImportCleared: true,
      updatedSlideIds: [],
      deletedSlideIds: ["slide-1"],
    });
    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(persisted.sourceImport).toBeUndefined();
    expect(persisted.slides.map((slide: { id: string }) => slide.id)).toEqual([
      "slide-2",
    ]);
  });

  it("allows imported content and structural edits in one agent patch", async () => {
    mockDeckRow = {
      ...mockDeckRow,
      data: JSON.stringify({
        title: "Imported deck",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
        sourceImport: {
          mode: "source-preserving",
          format: "pdf",
          fidelity: "source-faithful",
          slideCount: 2,
          slideIds: ["slide-1", "slide-2"],
          slides: [
            {
              id: "slide-1",
              text: "One",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
            {
              id: "slide-2",
              text: "Two",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
          ],
        },
      }),
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Updated</div>" },
          },
          { op: "delete-slide", slideId: "slide-2" },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      sourceImportCleared: true,
      updatedSlideIds: ["slide-1"],
      deletedSlideIds: ["slide-2"],
    });
    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(persisted.sourceImport).toBeUndefined();
  });

  it("keeps source provenance for an idempotent structural agent request", async () => {
    const sourceImport = {
      mode: "source-preserving",
      format: "pdf",
      fidelity: "source-faithful",
      slideCount: 2,
      slideIds: ["slide-1", "slide-2"],
      slides: [
        {
          id: "slide-1",
          text: "One",
          notes: "",
          imageUrls: [],
          editableText: true,
        },
        {
          id: "slide-2",
          text: "Two",
          notes: "",
          imageUrls: [],
          editableText: true,
        },
      ],
    };
    mockDeckRow = {
      ...mockDeckRow,
      data: JSON.stringify({
        title: "Imported deck",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
        sourceImport,
      }),
    };

    const result = (await patchDeckAction
      .run(
        {
          deckId: "deck-1",
          operations: [{ op: "delete-slide", slideId: "missing" }],
        },
        { caller: "tool" },
      )
      .catch((error: unknown) => error)) as Record<string, unknown>;

    expect(result.message).toContain("Nothing was written");
    expect(lastUpdatedDeckData).toBeUndefined();
    expect(JSON.parse(mockDeckRow!.data as string).sourceImport).toEqual(
      sourceImport,
    );
  });
});

describe("run() — partial no-op deck restyle", () => {
  const beautifyDeck = () => ({
    title: "Deck",
    updatedAt: "2026-01-01T00:00:00.000Z",
    slides: [
      { id: "slide-1", content: "<div>One</div>" },
      { id: "slide-2", content: "<div>Two</div>" },
      { id: "slide-3", content: "<div>Three</div>" },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify(beautifyDeck()),
    };
  });

  it("reports only the slides whose content actually changed", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One restyled</div>" },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Two</div>" },
            baseContentHash: hashSlideContent("<div>Two</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-3",
            fields: { content: "<div>Three</div>" },
            baseContentHash: hashSlideContent("<div>Three</div>"),
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-1"]);
    expect(result.unchangedSlideIds).toEqual(["slide-2", "slide-3"]);
    expect(result.partial).toBe(true);
    expect(result.message).toContain("slide-2");
    expect(result.message).toContain("do not report");
  });
});

describe("run() — all-no-op deck restyle masked by animation clearing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<div>One</div>",
            animations: [{ id: "a1", elementIndex: 0, type: "fade" }],
          },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("fails loudly when no slide content changed", async () => {
    const error = await patchDeckAction
      .run(
        {
          deckId: "deck-1",
          requireAllSourceSlides: false,
          operations: [
            {
              op: "patch-slide",
              slideId: "slide-1",
              fields: { content: "<div>One</div>" },
              baseContentHash: hashSlideContent("<div>One</div>"),
            },
            {
              op: "patch-slide",
              slideId: "slide-2",
              fields: { content: "<div>Two</div>" },
              baseContentHash: hashSlideContent("<div>Two</div>"),
            },
          ],
        },
        { caller: "tool" },
      )
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: expect.stringContaining("Nothing was written"),
    });
    expect(lastUpdatedDeckData).toBeUndefined();
  });
});

describe("run() — no-op content patches leave the slide alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<div>One</div>",
            animations: [
              { id: "a1", elementIndex: 0, elementPath: [0], type: "fade" },
            ],
          },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("keeps reveals on a slide whose content was re-sent unchanged", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Two restyled</div>" },
            baseContentHash: hashSlideContent("<div>Two</div>"),
          },
        ],
      },
      { caller: "tool" },
    );

    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(persisted.slides[0].animations).toHaveLength(1);
    expect(persisted.slides[0].content).toBe("<div>One</div>");
  });

  it("drops reveals on a slide whose content really changed", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One restyled</div>" },
          },
        ],
      },
      { caller: "tool" },
    );

    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(persisted.slides[0].animations).toBeUndefined();
  });
});

describe("run() — deck-wide fit bump does not fake a slide edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        aspectRatio: "16:9",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("keeps an unchanged slide unchanged when the aspect ratio changes", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          { op: "patch-deck-fields", fields: { aspectRatio: "4:3" } },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual([]);
    expect(result.unchangedSlideIds).toEqual(["slide-1"]);
  });
});

describe("run() — slides absent from the final deck are only reported deleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("does not report a patched-then-deleted slide as updated", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One restyled</div>" },
          },
          { op: "delete-slide", slideId: "slide-1" },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual([]);
    expect(result.unchangedSlideIds).toBeUndefined();
    expect(result.deletedSlideIds).toEqual(["slide-1"]);
  });

  it("does not report an added-then-deleted slide as unchanged", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "add-slide",
            slideId: "slide-3",
            fields: { content: "<div>Three</div>" },
          },
          { op: "delete-slide", slideId: "slide-3" },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One restyled</div>" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-1"]);
    expect(result.unchangedSlideIds).toBeUndefined();
    expect(result.deletedSlideIds).toEqual([]);
  });
});

describe("run() — reveals survive a non-content field change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: '<div class="fmd-slide"><h1>One</h1></div>',
            notes: "old",
            animations: [
              { id: "a1", elementIndex: 0, elementPath: [0], type: "fade" },
            ],
          },
        ],
      }),
    };
  });

  it("keeps reveals when identical content ships alongside new notes", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: {
              content: '<div class="fmd-slide"><h1>One</h1></div>',
              notes: "new",
            },
          },
        ],
      },
      { caller: "tool" },
    );

    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(persisted.slides[0].animations).toHaveLength(1);
    expect(persisted.slides[0].notes).toBe("new");
  });
});

describe("run() — the no-op gate spares real deck-level mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
  });

  it("allows a rewriteSource conversion when slide HTML is unchanged", async () => {
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [{ id: "slide-1", content: "<div>One</div>" }],
        sourceImport: buildSourceImportMetadata({
          format: "pptx",
          slides: [
            {
              id: "slide-1",
              text: "One",
              notes: "",
              imageUrls: [],
              editableText: true,
            },
          ],
        }),
      }),
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        rewriteSource: true,
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.sourceRewritten).toBe(true);
    expect(result.updatedSlideIds).toEqual([]);
    expect(JSON.parse(lastUpdatedDeckData!).sourceImport).toBeUndefined();
  });

  it("allows a creative-context provenance write when slide HTML is unchanged", async () => {
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [{ id: "slide-1", content: "<div>One</div>" }],
      }),
    };

    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
          },
        ],
        creativeContext: {
          contextPackId: "pack-1",
          reuseLabels: [
            {
              kind: "slide",
              label: "Reused source slide",
              dataRole: "untrusted-reference",
              itemId: "item-1",
              itemVersionId: "version-1",
            },
          ],
        },
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.updatedSlideIds).toEqual([]);
    expect(mockRecordGenerationCreativeContext).toHaveBeenCalled();
  });
});

describe("run() — a deleted-then-readded slide is not reported deleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("reports a replaced slide as updated only", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          { op: "delete-slide", slideId: "slide-1" },
          {
            op: "add-slide",
            slideId: "slide-1",
            fields: { content: "<div>One replaced</div>" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-1"]);
    expect(result.deletedSlideIds).toEqual([]);
    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(
      persisted.slides.find((s: { id: string }) => s.id === "slide-1").content,
    ).toBe("<div>One replaced</div>");
  });
});

describe("run() — a content round-trip is not an edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          { id: "slide-1", content: "<div>One</div>" },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("does not report a slide patched away and back as updated", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Interim</div>" },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Two restyled</div>" },
            baseContentHash: hashSlideContent("<div>Two</div>"),
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-2"]);
    expect(result.unchangedSlideIds).toEqual(["slide-1"]);
  });
});

describe("run() — derived state and lifecycle around net-zero edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<div>One</div>",
            layoutFitRevision: "rev-1",
            layoutWarningDismissed: true,
          },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("keeps derived fit and warning state across a content round-trip", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Interim</div>" },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Two restyled</div>" },
            baseContentHash: hashSlideContent("<div>Two</div>"),
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-2"]);
    const persisted = JSON.parse(lastUpdatedDeckData!);
    const slide1 = persisted.slides.find(
      (slide: { id: string }) => slide.id === "slide-1",
    );
    expect(slide1.layoutFitRevision).toBe("rev-1");
    expect(slide1.layoutWarningDismissed).toBe(true);
    const fitSlideIds = (
      (result.layoutFit as { slides: Array<{ slideId: string }> }).slides ?? []
    ).map((entry) => entry.slideId);
    expect(fitSlideIds).toEqual(["slide-2"]);
  });

  it("still honours an explicit warning dismissal on an unchanged slide", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: {
              content: "<div>One</div>",
              layoutWarningDismissed: false,
            },
            baseContentHash: hashSlideContent("<div>One</div>"),
          },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Two restyled</div>" },
            baseContentHash: hashSlideContent("<div>Two</div>"),
          },
        ],
      },
      { caller: "tool" },
    );

    const persisted = JSON.parse(lastUpdatedDeckData!);
    const slide1 = persisted.slides.find(
      (slide: { id: string }) => slide.id === "slide-1",
    );
    expect(slide1.layoutWarningDismissed).toBe(false);
  });

  it("reports an identical delete-and-readd as a replacement", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          { op: "delete-slide", slideId: "slide-1" },
          {
            op: "add-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-1"]);
    expect(result.deletedSlideIds).toEqual([]);
  });

  it("schedules no layout-fit work for an added-then-deleted slide", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "add-slide",
            slideId: "slide-3",
            fields: { content: "<div>Three</div>" },
          },
          { op: "delete-slide", slideId: "slide-3" },
          {
            op: "patch-slide",
            slideId: "slide-2",
            fields: { content: "<div>Two restyled</div>" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    const fitSlideIds = (
      (result.layoutFit as { slides: Array<{ slideId: string }> }).slides ?? []
    ).map((entry) => entry.slideId);
    expect(fitSlideIds).toEqual(["slide-2"]);
  });
});

describe("run() — fit state follows the net change, not the replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<div>One</div>",
            notes: "old",
            layoutFitRevision: "rev-1",
            layoutWarningDismissed: true,
          },
          { id: "slide-2", content: "<div>Two</div>" },
        ],
      }),
    };
  });

  it("persists a warning-dismissal-only patch instead of rejecting it", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { layoutWarningDismissed: false },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-1"]);
    const persisted = JSON.parse(lastUpdatedDeckData!);
    expect(
      persisted.slides.find((slide: { id: string }) => slide.id === "slide-1")
        .layoutWarningDismissed,
    ).toBe(false);
  });

  it("does not re-measure a slide whose rendered fields net out unchanged", async () => {
    const result = (await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>Interim</div>" },
          },
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One</div>", notes: "new" },
          },
        ],
      },
      { caller: "tool" },
    )) as Record<string, unknown>;

    expect(result.updatedSlideIds).toEqual(["slide-1"]);
    expect(result.layoutFit).toBeUndefined();
    const slide1 = JSON.parse(lastUpdatedDeckData!).slides.find(
      (slide: { id: string }) => slide.id === "slide-1",
    );
    expect(slide1.notes).toBe("new");
    expect(slide1.layoutFitRevision).toBe("rev-1");
    expect(slide1.layoutWarningDismissed).toBe(true);
  });
});

describe("run() — explicit dismissal survives a content change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastUpdatedDeckData = undefined;
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [{ id: "slide-1", content: "<div>One</div>" }],
      }),
    };
  });

  it("keeps a dismissal requested in the same patch as new content", async () => {
    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: {
              content: "<div>One restyled</div>",
              layoutWarningDismissed: true,
            },
          },
        ],
      },
      { caller: "tool" },
    );

    const slide1 = JSON.parse(lastUpdatedDeckData!).slides[0];
    expect(slide1.layoutWarningDismissed).toBe(true);
    expect(slide1.content).toBe("<div>One restyled</div>");
  });

  it("still re-arms a stale dismissal when the agent only changes content", async () => {
    mockDeckRow = {
      id: "deck-1",
      title: "Deck",
      designSystemId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: JSON.stringify({
        title: "Deck",
        updatedAt: "2026-01-01T00:00:00.000Z",
        slides: [
          {
            id: "slide-1",
            content: "<div>One</div>",
            layoutWarningDismissed: true,
          },
        ],
      }),
    };

    await patchDeckAction.run(
      {
        deckId: "deck-1",
        requireAllSourceSlides: false,
        operations: [
          {
            op: "patch-slide",
            slideId: "slide-1",
            fields: { content: "<div>One restyled</div>" },
          },
        ],
      },
      { caller: "tool" },
    );

    expect(
      JSON.parse(lastUpdatedDeckData!).slides[0].layoutWarningDismissed,
    ).toBeUndefined();
  });
});
