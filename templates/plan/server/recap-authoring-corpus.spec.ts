import { describe, expect, it } from "vitest";

import { describePlanBlocksForAgent } from "../shared/plan-block-registry.js";
import { planBlockSchema, type PlanContent } from "../shared/plan-content.js";
import { normalizePlanContent } from "./plan-content.js";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The salvage placeholder marker. When a block fails schema validation under
 * `salvageInvalidBlocks: true`, the bad block is replaced with a `callout`
 * whose `data.body` begins with a zero-width space + `__unknown_block__:`
 * (see `parsePlanContentWithSalvage` in plan-content.ts). Tests assert on the
 * stable `__unknown_block__:` substring rather than the invisible prefix.
 */
const UNKNOWN_MARKER = "__unknown_block__:";

/** A valid leading rich-text block used to prove valid siblings survive. */
const LEADING_RICH_TEXT = {
  id: "intro",
  type: "rich-text" as const,
  data: { markdown: "# Recap\n\nThis recap survives." },
};

/** True when a parsed block is the unsupported-block salvage placeholder. */
function isUnknownPlaceholder(block: PlanContent["blocks"][number]): boolean {
  return (
    block.type === "callout" &&
    typeof block.data.body === "string" &&
    block.data.body.includes(UNKNOWN_MARKER)
  );
}

/** Count salvage placeholders in a parsed document. */
function countPlaceholders(content: PlanContent): number {
  return content.blocks.filter(isUnknownPlaceholder).length;
}

/* -------------------------------------------------------------------------- */
/* 1. Golden degradation corpus — reproduces real prod 422 failures.          */
/*                                                                            */
/* Each input reproduces a real recap-import schema failure observed in       */
/* production. Recaps must SALVAGE: keep the valid sibling block, replace the */
/* malformed block with an "Unsupported block" callout placeholder, and never */
/* throw. Plans (strict default) must still REJECT the same input, proving    */
/* recaps degrade gracefully while plans stay strict.                         */
/* -------------------------------------------------------------------------- */

describe("recap golden degradation corpus", () => {
  it("ai-services#5448: tabs block missing tabs[0].id and tabs[0].blocks[0].data salvages, plans still reject", () => {
    // A `tabs` block whose first tab has no `id` and whose first child block is
    // missing its `data` payload. Both are required by planBlockSchema, so the
    // whole tabs block fails to validate.
    const malformedTabs = {
      id: "tabs-5448",
      type: "tabs",
      data: {
        tabs: [
          {
            // id intentionally omitted (required by the tab schema)
            label: "Before",
            blocks: [
              {
                id: "child-5448",
                type: "rich-text",
                // data intentionally omitted (required by rich-text schema)
              },
            ],
          },
        ],
      },
    };
    const input = {
      version: 2,
      title: "Recap 5448",
      blocks: [LEADING_RICH_TEXT, malformedTabs],
    } as unknown as PlanContent;

    // Salvage: does not throw, returns content, keeps the valid sibling, and
    // replaces the malformed tabs block with the unsupported-block placeholder.
    const salvaged = normalizePlanContent(input, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged).not.toBeNull();
    expect(salvaged?.blocks).toHaveLength(2);
    expect(salvaged?.blocks[0]?.type).toBe("rich-text");
    expect(salvaged?.blocks[0]?.id).toBe("intro");
    const placeholder = salvaged?.blocks[1];
    expect(placeholder?.type).toBe("callout");
    expect(isUnknownPlaceholder(placeholder!)).toBe(true);
    // The placeholder records the original block type for the reader card.
    if (placeholder?.type === "callout") {
      expect(placeholder.data.body).toContain("tabs");
    }

    // Strict (plan) default still rejects the same malformed input.
    expect(() => normalizePlanContent(input)).toThrow();
  });

  it("ai-services#5449: api-endpoint block missing responses[*].status salvages, plans still reject", () => {
    // An `api-endpoint` block whose responses entries are missing the required
    // `status` field. The whole block fails validation.
    const malformedEndpoint = {
      id: "endpoint-5449",
      type: "api-endpoint",
      data: {
        method: "POST",
        path: "/v1/messages",
        responses: [
          { description: "OK" }, // status missing
          { description: "Rate limited" }, // status missing
        ],
      },
    };
    const input = {
      version: 2,
      title: "Recap 5449",
      blocks: [LEADING_RICH_TEXT, malformedEndpoint],
    } as unknown as PlanContent;

    const salvaged = normalizePlanContent(input, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged).not.toBeNull();
    expect(salvaged?.blocks).toHaveLength(2);
    expect(salvaged?.blocks[0]?.type).toBe("rich-text");
    expect(salvaged?.blocks[0]?.id).toBe("intro");
    const placeholder = salvaged?.blocks[1];
    expect(placeholder?.type).toBe("callout");
    expect(isUnknownPlaceholder(placeholder!)).toBe(true);
    if (placeholder?.type === "callout") {
      expect(placeholder.data.body).toContain("api-endpoint");
    }

    expect(() => normalizePlanContent(input)).toThrow();
  });

  it("ai-services#5450: empty callout body + tabs missing id/child-data salvages per-block, plans still reject", () => {
    // Two separate malformed blocks plus a valid sibling. The recap must keep
    // the valid block and replace EACH bad block with its own placeholder.
    const emptyBodyCallout = {
      id: "callout-5450",
      type: "callout",
      // body is "" — fails the min(1) too_small check.
      data: { body: "" },
    };
    const malformedTabs = {
      id: "tabs-5450",
      type: "tabs",
      data: {
        tabs: [
          {
            // id missing
            label: "Detail",
            blocks: [
              {
                id: "child-5450",
                type: "callout",
                // data missing
              },
            ],
          },
        ],
      },
    };
    const input = {
      version: 2,
      title: "Recap 5450",
      blocks: [LEADING_RICH_TEXT, emptyBodyCallout, malformedTabs],
    } as unknown as PlanContent;

    const salvaged = normalizePlanContent(input, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged).not.toBeNull();
    expect(salvaged?.blocks).toHaveLength(3);
    // Valid leading block survives untouched.
    expect(salvaged?.blocks[0]?.type).toBe("rich-text");
    expect(salvaged?.blocks[0]?.id).toBe("intro");
    // Both malformed blocks become placeholders (two, not one for the document).
    expect(countPlaceholders(salvaged!)).toBe(2);
    expect(isUnknownPlaceholder(salvaged!.blocks[1]!)).toBe(true);
    expect(isUnknownPlaceholder(salvaged!.blocks[2]!)).toBe(true);

    expect(() => normalizePlanContent(input)).toThrow();
  });

  it("tabs with nested diff annotations using line instead of lines salvages with an actionable warning", () => {
    const malformedTabs = {
      id: "key-evidence-tabs",
      type: "tabs",
      data: {
        tabs: [
          {
            id: "settings-tab",
            label: "Settings UX",
            blocks: [
              {
                id: "settings-diff",
                type: "diff",
                data: {
                  filename:
                    "templates/clips/app/routes/_app.settings._index.tsx",
                  before: "const title = 'Settings';\n",
                  after: "const title = t('settings.title');\n",
                  annotations: [
                    {
                      line: 1,
                      label: "Translator hook",
                      note: "This should use the plural `lines` field.",
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const input = {
      version: 2,
      title: "Recap line-vs-lines",
      blocks: [LEADING_RICH_TEXT, malformedTabs],
    } as unknown as PlanContent;

    const salvaged = normalizePlanContent(input, {
      salvageInvalidBlocks: true,
    });
    expect(salvaged).not.toBeNull();
    const placeholder = salvaged?.blocks[1];
    expect(placeholder?.type).toBe("callout");
    expect(isUnknownPlaceholder(placeholder!)).toBe(true);
    if (placeholder?.type === "callout") {
      expect(placeholder.data.body).toContain("tabs");
      expect(placeholder.data.body).toContain("data.tabs.0.blocks.0");
      expect(placeholder.data.body).toContain("annotations.0.lines");
      expect(placeholder.data.body).toContain("use `lines`");
    }

    expect(() => normalizePlanContent(input)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Good corpus — representative VALID recap contents.                      */
/*                                                                            */
/* A clean parse must salvage NOTHING: no `__unknown_block__` placeholders.   */
/* -------------------------------------------------------------------------- */

describe("recap good corpus (no salvage on valid content)", () => {
  it("columns before/after with proper nested blocks parses with no placeholders", () => {
    const input = {
      version: 2,
      title: "Schema change recap",
      brief: "Before/after of the plans table.",
      blocks: [
        LEADING_RICH_TEXT,
        {
          id: "schema-compare",
          type: "columns",
          data: {
            columns: [
              {
                id: "col-before",
                label: "Before",
                blocks: [
                  {
                    id: "before-note",
                    type: "rich-text",
                    data: { markdown: "`content` was stored as text." },
                  },
                ],
              },
              {
                id: "col-after",
                label: "After",
                blocks: [
                  {
                    id: "after-note",
                    type: "rich-text",
                    data: { markdown: "`content` is now normalized JSON." },
                  },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as PlanContent;

    const result = normalizePlanContent(input, { salvageInvalidBlocks: true });
    expect(result).not.toBeNull();
    expect(countPlaceholders(result!)).toBe(0);
    expect(result?.blocks[1]?.type).toBe("columns");
  });

  it("tabs of rich-text parses with no placeholders", () => {
    const input = {
      version: 2,
      title: "Files touched",
      blocks: [
        {
          id: "files",
          type: "tabs",
          data: {
            tabs: [
              {
                id: "tab-content",
                label: "plan-content.ts",
                blocks: [
                  {
                    id: "content-note",
                    type: "rich-text",
                    data: { markdown: "Added per-block salvage." },
                  },
                ],
              },
              {
                id: "tab-mdx",
                label: "plan-mdx.ts",
                blocks: [
                  {
                    id: "mdx-note",
                    type: "rich-text",
                    data: { markdown: "Threads the salvage flag." },
                  },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as PlanContent;

    const result = normalizePlanContent(input, { salvageInvalidBlocks: true });
    expect(result).not.toBeNull();
    expect(countPlaceholders(result!)).toBe(0);
    expect(result?.blocks[0]?.type).toBe("tabs");
  });

  it("api-endpoint with full responses parses with no placeholders", () => {
    const input = {
      version: 2,
      title: "API recap",
      blocks: [
        LEADING_RICH_TEXT,
        {
          id: "endpoint-ok",
          type: "api-endpoint",
          data: {
            method: "POST",
            path: "/v1/messages",
            summary: "Create a message",
            responses: [
              { status: "200", description: "OK" },
              { status: "429", description: "Rate limited" },
            ],
          },
        },
      ],
    } as unknown as PlanContent;

    const result = normalizePlanContent(input, { salvageInvalidBlocks: true });
    expect(result).not.toBeNull();
    expect(countPlaceholders(result!)).toBe(0);
    expect(result?.blocks[1]?.type).toBe("api-endpoint");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Reference-consistency — the vocabulary the agent reads must validate.   */
/*                                                                            */
/* For every block the registry documents to the agent via                   */
/* describePlanBlocksForAgent(), build a MINIMAL valid block of that type and */
/* assert planBlockSchema accepts it. This catches the class of bug where the */
/* taught/example form of a block does NOT validate (e.g. the columns         */
/* attribute-array form). A documented type whose minimal form is rejected is */
/* a real reference bug and fails loudly here.                               */
/* -------------------------------------------------------------------------- */

/**
 * Minimal valid `data` payload for each documented block type. Built from the
 * schema's required fields (see plan-content.ts planBlockSchema). When the
 * registry exposes a concrete `example` (`spec.empty?.()`), the test prefers
 * that; this map is the fallback for types whose server spec has no `empty`
 * factory (currently all of them, since the React-free server specs omit it).
 */
const MINIMAL_BLOCK_DATA: Record<string, unknown> = {
  "annotated-code": { code: "const x = 1;\n" },
  "api-endpoint": { method: "GET", path: "/v1/ping" },
  callout: { body: "Heads up." },
  checklist: { items: [{ id: "i1", label: "Do the thing" }] },
  code: { code: "const x = 1;\n" },
  "code-tabs": {
    tabs: [{ id: "t1", label: "file.ts", code: "const x = 1;\n" }],
  },
  columns: {
    columns: [
      {
        id: "c1",
        label: "Before",
        blocks: [{ id: "c1-note", type: "rich-text", data: { markdown: "x" } }],
      },
    ],
  },
  "custom-html": { html: "<p>hello</p>" },
  "data-model": {
    entities: [
      { id: "e1", name: "plans", fields: [{ name: "id", type: "uuid" }] },
    ],
  },
  diagram: { nodes: [{ id: "n1", label: "Start" }] },
  diff: { before: "a\n", after: "b\n" },
  "file-tree": { entries: [{ path: "server/plan-content.ts" }] },
  "json-explorer": { json: '{"ok":true}' },
  mermaid: { source: "graph TD; A-->B" },
  "openapi-spec": { spec: '{"openapi":"3.0.0","info":{}}' },
  "question-form": {
    questions: [{ id: "q1", title: "Which approach?", mode: "freeform" }],
  },
  table: { columns: ["Field"], rows: [["id"]] },
  tabs: {
    tabs: [
      {
        id: "t1",
        label: "Tab",
        blocks: [{ id: "t1-note", type: "rich-text", data: { markdown: "x" } }],
      },
    ],
  },
  "visual-questions": {
    questions: [{ id: "q1", title: "Which layout?", mode: "single" }],
  },
  wireframe: { surface: "desktop" },
};

describe("plan block reference-consistency", () => {
  const docs = describePlanBlocksForAgent();

  it("documents at least the full standard library", () => {
    // Guard against a registry regression silently dropping the catalog.
    expect(docs.length).toBeGreaterThanOrEqual(20);
  });

  it("every documented type has a minimal-block recipe (no untested types)", () => {
    // If this fails, a new block type was added to the registry; add a minimal
    // valid `data` shape to MINIMAL_BLOCK_DATA so its taught form is verified.
    const documented = docs.map((doc) => doc.type).sort();
    const recipes = Object.keys(MINIMAL_BLOCK_DATA).sort();
    expect(recipes).toEqual(documented);
  });

  // One assertion per documented block type: the form the agent is taught
  // (registry example when present, else the minimal recipe) must validate
  // under planBlockSchema. A failure here is a real reference bug — the agent
  // would be taught a block shape the schema rejects.
  for (const doc of docs) {
    it(`taught form of \`${doc.type}\` validates under planBlockSchema`, () => {
      const data =
        doc.example !== undefined ? doc.example : MINIMAL_BLOCK_DATA[doc.type];
      expect(
        data,
        `No example or minimal recipe for documented block type "${doc.type}"`,
      ).toBeDefined();
      const block = {
        id: `ref-${doc.type}`,
        type: doc.type,
        data,
      };
      const result = planBlockSchema.safeParse(block);
      if (!result.success) {
        throw new Error(
          `Reference bug: documented block "${doc.type}" does not validate under planBlockSchema. ` +
            `Issues: ${JSON.stringify(result.error.issues.slice(0, 4))}`,
        );
      }
      expect(result.success).toBe(true);
    });
  }
});
