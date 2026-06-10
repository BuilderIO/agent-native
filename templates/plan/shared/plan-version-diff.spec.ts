import { describe, expect, it } from "vitest";
import {
  diffPlanVersions,
  formatVersionDiffSummary,
  type PlanVersionDiff,
} from "./plan-version-diff.js";
import type { PlanContent } from "./plan-content.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function makeContent(blocks: PlanContent["blocks"]): PlanContent {
  return { version: 2, blocks };
}

function richText(id: string, markdown: string) {
  return {
    id,
    type: "rich-text" as const,
    data: { markdown },
  };
}

function callout(id: string, body: string) {
  return {
    id,
    type: "callout" as const,
    data: { body },
  };
}

function diagram(id: string, caption: string) {
  return {
    id,
    type: "diagram" as const,
    data: { caption, nodes: [{ id: "n1", label: "A" }], edges: [] },
  };
}

/* -------------------------------------------------------------------------- */
/* Core block-level diffs                                                     */
/* -------------------------------------------------------------------------- */

describe("diffPlanVersions — block diffs", () => {
  it("detects added blocks", () => {
    const older = makeContent([richText("a", "Hello")]);
    const newer = makeContent([
      richText("a", "Hello"),
      callout("b", "New callout"),
    ]);

    const result = diffPlanVersions({ content: newer }, { content: older });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    expect(result.diff.addedBlocks).toHaveLength(1);
    expect(result.diff.addedBlocks[0].id).toBe("b");
    expect(result.diff.addedBlocks[0].label).toBe("New callout");
    expect(result.diff.removedBlocks).toHaveLength(0);
    expect(result.diff.changedBlocks).toHaveLength(0);
  });

  it("detects removed blocks", () => {
    const older = makeContent([
      richText("a", "Hello"),
      callout("b", "Old callout"),
    ]);
    const newer = makeContent([richText("a", "Hello")]);

    const result = diffPlanVersions({ content: newer }, { content: older });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    expect(result.diff.removedBlocks).toHaveLength(1);
    expect(result.diff.removedBlocks[0].id).toBe("b");
    expect(result.diff.addedBlocks).toHaveLength(0);
    expect(result.diff.changedBlocks).toHaveLength(0);
  });

  it("detects changed blocks", () => {
    const older = makeContent([richText("a", "Hello")]);
    const newer = makeContent([richText("a", "Hello updated")]);

    const result = diffPlanVersions({ content: newer }, { content: older });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    expect(result.diff.changedBlocks).toHaveLength(1);
    expect(result.diff.changedBlocks[0].id).toBe("a");
    expect(result.diff.addedBlocks).toHaveLength(0);
    expect(result.diff.removedBlocks).toHaveLength(0);
  });

  it("returns no-diff for identical snapshots", () => {
    const blocks = [richText("a", "Hello"), callout("b", "World")];
    const content = makeContent(blocks);

    const result = diffPlanVersions({ content }, { content });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    const { diff } = result;
    expect(diff.addedBlocks).toHaveLength(0);
    expect(diff.removedBlocks).toHaveLength(0);
    expect(diff.changedBlocks).toHaveLength(0);
  });

  it("returns initial for oldest version (older = null)", () => {
    const content = makeContent([richText("a", "Hello")]);
    const result = diffPlanVersions({ content }, null);
    expect(result.kind).toBe("initial");
  });
});

/* -------------------------------------------------------------------------- */
/* Nested container blocks (tabs/columns)                                     */
/* -------------------------------------------------------------------------- */

describe("diffPlanVersions — nested containers", () => {
  it("finds added leaf blocks inside a tabs container", () => {
    const tabsBlock = {
      id: "tabs1",
      type: "tabs" as const,
      data: {
        tabs: [
          {
            id: "t1",
            label: "Overview",
            blocks: [richText("inner-a", "Overview text")],
          },
        ],
      },
    };

    const newerTabsBlock = {
      id: "tabs1",
      type: "tabs" as const,
      data: {
        tabs: [
          {
            id: "t1",
            label: "Overview",
            blocks: [
              richText("inner-a", "Overview text"),
              callout("inner-b", "New inner callout"),
            ],
          },
        ],
      },
    };

    const older = makeContent([tabsBlock]);
    const newer = makeContent([newerTabsBlock]);

    const result = diffPlanVersions({ content: newer }, { content: older });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    expect(result.diff.addedBlocks.map((b) => b.id)).toContain("inner-b");
    // The outer tabs block changed (its children changed), so it shows up as changed
    expect(result.diff.changedBlocks.map((b) => b.id)).toContain("tabs1");
  });

  it("finds added leaf blocks inside a columns container", () => {
    const columnsBlock = {
      id: "cols1",
      type: "columns" as const,
      data: {
        columns: [
          {
            id: "c1",
            label: "Left",
            blocks: [richText("left-a", "Left text")],
          },
          { id: "c2", label: "Right", blocks: [] },
        ],
      },
    };

    const newerColumnsBlock = {
      id: "cols1",
      type: "columns" as const,
      data: {
        columns: [
          {
            id: "c1",
            label: "Left",
            blocks: [richText("left-a", "Left text")],
          },
          {
            id: "c2",
            label: "Right",
            blocks: [diagram("right-d", "New diagram")],
          },
        ],
      },
    };

    const older = makeContent([columnsBlock]);
    const newer = makeContent([newerColumnsBlock]);

    const result = diffPlanVersions({ content: newer }, { content: older });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    expect(result.diff.addedBlocks.map((b) => b.id)).toContain("right-d");
  });
});

/* -------------------------------------------------------------------------- */
/* Legacy section plans                                                       */
/* -------------------------------------------------------------------------- */

describe("diffPlanVersions — legacy sections", () => {
  it("detects added and removed sections", () => {
    const olderSections = [
      { id: "s1", title: "Architecture" },
      { id: "s2", title: "Old wireframe" },
    ];
    const newerSections = [
      { id: "s1", title: "Architecture" },
      { id: "s3", title: "Implementation" },
    ];

    const result = diffPlanVersions(
      { content: null, sections: newerSections },
      { content: null, sections: olderSections },
    );
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");

    expect(result.diff.sectionChanges?.added).toEqual(["Implementation"]);
    expect(result.diff.sectionChanges?.removed).toEqual(["Old wireframe"]);
  });

  it("returns no section changes for identical sections", () => {
    const sections = [{ id: "s1", title: "Architecture" }];
    const result = diffPlanVersions(
      { content: null, sections },
      { content: null, sections },
    );
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");
    expect(result.diff.sectionChanges?.added).toEqual([]);
    expect(result.diff.sectionChanges?.removed).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* HTML-only legacy plans                                                     */
/* -------------------------------------------------------------------------- */

describe("diffPlanVersions — html-only plans", () => {
  it("returns html-only for plans with no content or sections", () => {
    const result = diffPlanVersions(
      { content: null, sections: [], html: "<h1>Plan</h1>" },
      { content: null, sections: [], html: "<h1>Old plan</h1>" },
    );
    expect(result.kind).toBe("html-only");
  });

  it("returns html-only when both have null content and no sections", () => {
    const result = diffPlanVersions(
      { content: null, sections: null },
      { content: null, sections: null },
    );
    expect(result.kind).toBe("html-only");
  });
});

/* -------------------------------------------------------------------------- */
/* formatVersionDiffSummary                                                   */
/* -------------------------------------------------------------------------- */

describe("formatVersionDiffSummary", () => {
  it("returns 'Initial version' for initial kind", () => {
    expect(formatVersionDiffSummary({ kind: "initial" })).toBe(
      "Initial version",
    );
  });

  it("returns null for html-only kind", () => {
    expect(formatVersionDiffSummary({ kind: "html-only" })).toBeNull();
  });

  it("returns 'No content changes' for empty diff", () => {
    const diff: PlanVersionDiff = {
      addedBlocks: [],
      removedBlocks: [],
      changedBlocks: [],
    };
    expect(formatVersionDiffSummary({ kind: "diff", diff })).toBe(
      "No content changes",
    );
  });

  it("formats added blocks", () => {
    const diff: PlanVersionDiff = {
      addedBlocks: [
        { id: "a", label: "Architecture" },
        { id: "b", label: "Wireframe" },
        { id: "c", label: "Data model" },
      ],
      removedBlocks: [],
      changedBlocks: [],
    };
    const summary = formatVersionDiffSummary({ kind: "diff", diff });
    expect(summary).toContain("+3 blocks");
    expect(summary).toContain("Architecture");
    expect(summary).toContain("Wireframe");
    // Third label should be truncated to "+1 more"
    expect(summary).toContain("+1 more");
    expect(summary).not.toContain("Data model");
  });

  it("formats a mixed add/change/remove summary", () => {
    const diff: PlanVersionDiff = {
      addedBlocks: [{ id: "a", label: "New section" }],
      removedBlocks: [{ id: "b", label: "Old wireframe" }],
      changedBlocks: [{ id: "c", label: "Architecture" }],
    };
    const summary = formatVersionDiffSummary({ kind: "diff", diff });
    expect(summary).toBe(
      "+1 block (New section) · 1 changed (Architecture) · −1 (Old wireframe)",
    );
  });

  it("formats section changes", () => {
    const diff: PlanVersionDiff = {
      addedBlocks: [],
      removedBlocks: [],
      changedBlocks: [],
      sectionChanges: { added: ["New feature"], removed: ["Old feature"] },
    };
    const summary = formatVersionDiffSummary({ kind: "diff", diff });
    expect(summary).toContain("+1 section");
    expect(summary).toContain("New feature");
    expect(summary).toContain("−1 section");
    expect(summary).toContain("Old feature");
  });

  it("truncates section change labels with overflow", () => {
    const diff: PlanVersionDiff = {
      addedBlocks: [],
      removedBlocks: [],
      changedBlocks: [],
      sectionChanges: {
        added: ["A", "B", "C", "D"],
        removed: [],
      },
    };
    const summary = formatVersionDiffSummary({ kind: "diff", diff });
    expect(summary).toContain("+4 sections");
    expect(summary).toContain("+2 more");
  });
});

/* -------------------------------------------------------------------------- */
/* Block label extraction                                                     */
/* -------------------------------------------------------------------------- */

describe("block label extraction", () => {
  it("uses block.title when present", () => {
    const content = makeContent([
      { ...richText("a", "Body"), title: "My Title" },
    ]);
    const result = diffPlanVersions({ content }, { content: makeContent([]) });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");
    expect(result.diff.addedBlocks[0].label).toBe("My Title");
  });

  it("extracts heading from rich-text markdown", () => {
    const content = makeContent([
      richText("a", "## Architecture\nBody text here"),
    ]);
    const result = diffPlanVersions({ content }, { content: makeContent([]) });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");
    expect(result.diff.addedBlocks[0].label).toBe("Architecture");
  });

  it("uses first markdown line when no heading", () => {
    const content = makeContent([richText("a", "Plain intro paragraph")]);
    const result = diffPlanVersions({ content }, { content: makeContent([]) });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");
    expect(result.diff.addedBlocks[0].label).toBe("Plain intro paragraph");
  });

  it("falls back to type label for unlabeled blocks", () => {
    const block = {
      id: "q1",
      type: "question-form" as const,
      data: {
        questions: [
          {
            id: "q1",
            title: "Which approach?",
            mode: "single" as const,
          },
        ],
      },
    };
    const content = makeContent([block]);
    const result = diffPlanVersions({ content }, { content: makeContent([]) });
    expect(result.kind).toBe("diff");
    if (result.kind !== "diff") throw new Error("unreachable");
    expect(result.diff.addedBlocks[0].label).toBe("Questions");
  });
});
