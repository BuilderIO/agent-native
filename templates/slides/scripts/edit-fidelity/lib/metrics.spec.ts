import { describe, expect, it } from "vitest";

import type { SnapRecord, Snapshot } from "./in-page.ts";
import {
  ceilingFor,
  diffSnapshots,
  followsCenteredFlexReflow,
  findBaselineProblems,
  hardFailures,
  isDraftRevert,
  isSplicedOnce,
  keepaliveMismatches,
  lineDiff,
  orphanedBaselineKeys,
  outsideChangesFor,
  p95IndexFromThresholdedSamples,
  ratchetBaselineEntry,
  resized,
  restyledAddedText,
  toBaselineEntry,
  type BaselineEntry,
  type ScenarioMetrics,
} from "./metrics.ts";

const rect = { x: 0, y: 0, width: 100, height: 20 };
const rec = (
  key: string,
  props: Record<string, string>,
  inside = false,
): SnapRecord => ({
  key,
  kind: key.startsWith("text:") ? "text" : "box",
  inside,
  props,
  rect,
});
const snap = (records: SnapRecord[]): Snapshot => ({
  records,
  inventory: { elements: 0, visible: 0, hidden: 0, svg: 0, img: 0, style: 0 },
  text: "",
  editedRect: null,
  editedBoxRect: null,
  editedText: null,
});

const metrics = (over: Partial<ScenarioMetrics> = {}): ScenarioMetrics => ({
  status: "pass",
  editingPct: 0,
  afterPct: 0,
  reloadPct: 0,
  typedPct: 0,
  outsideEditingPct: 0,
  outsideAfterPct: 0,
  styleDeltasEditing: 0,
  styleDeltasAfter: 0,
  missingAfter: 0,
  htmlDiffLines: 0,
  hardFailures: 0,
  violations: 0,
  ...over,
});

describe("resized", () => {
  it("ignores subpixel noise but recognizes a one-pixel size change", () => {
    const before = { ...rect, height: 138 };
    expect(resized(before, before)).toBe(false);
    expect(resized(before, { ...before, height: 138.5 })).toBe(false);
    expect(resized(before, { ...before, height: 139 })).toBe(true);
    expect(resized(before, { ...before, height: 139.01 })).toBe(true);
    expect(resized(before, { ...before, width: 101.01 })).toBe(true);
    expect(resized(null, rect)).toBe(false);
  });
});

describe("p95IndexFromThresholdedSamples", () => {
  it("remaps the percentile to include unobserved sub-threshold events", () => {
    expect(p95IndexFromThresholdedSamples(64, 20, 16)).toEqual({
      kind: "observed",
      index: 16,
    });
    expect(p95IndexFromThresholdedSamples(64, 4, 16)).toEqual({
      kind: "observed",
      index: 0,
    });
  });

  it("reports a threshold bound when the p95 event was not observed", () => {
    expect(p95IndexFromThresholdedSamples(64, 3, 16)).toEqual({
      kind: "below-threshold",
      bound: 16,
    });
  });

  it("rejects counts that cannot describe a thresholded sample", () => {
    expect(() => p95IndexFromThresholdedSamples(64, 65, 16)).toThrow(
      RangeError,
    );
  });
});

describe("diffSnapshots", () => {
  it("matches live nodes by identity when same-class blocks are inserted", () => {
    const before = {
      ...rec("box:div.card#0", { color: "red" }),
      stableKey: "node-1:box",
    };
    const inserted = {
      ...rec("box:div.card#0", { color: "blue" }, true),
      stableKey: "node-2:box",
    };
    const after = {
      ...rec("box:div.card#1", { color: "red" }),
      stableKey: "node-1:box",
    };

    expect(
      diffSnapshots(snap([before]), snap([inserted, after])),
    ).toMatchObject({
      deltas: [],
      geometry: [],
      missing: [],
      added: [{ key: "box:div.card#0", inside: true }],
    });
  });

  it("matches re-rendered imported paragraphs by their logical object and paragraph", () => {
    const targetBefore = {
      ...rec("text:•#0", {}, true),
      stableKey: "old-target-marker",
      pptxRecordKey: "object-5:1:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "1",
    };
    const siblingBefore = {
      ...rec("text:•#1", {}),
      stableKey: "old-sibling-marker",
      pptxRecordKey: "object-5:2:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "2",
      rect: { ...rect, y: 20 },
    };
    const siblingAfter = {
      ...rec("text:•#0", {}),
      stableKey: "new-sibling-marker",
      pptxRecordKey: "object-5:2:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "2",
      rect: { ...rect, y: 40 },
    };
    const targetAfter = {
      ...rec("text:•#1", {}, true),
      stableKey: "new-target-marker",
      pptxRecordKey: "object-5:1:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "1",
    };

    expect(
      diffSnapshots(
        snap([targetBefore, siblingBefore]),
        snap([siblingAfter, targetAfter]),
      ),
    ).toMatchObject({
      geometry: [
        {
          key: siblingBefore.key,
          prop: "y",
          a: "20",
          b: "40",
          inside: false,
        },
      ],
      missing: [],
      added: [],
    });
  });

  it("prefers imported paragraph identity when a live node moves to another row", () => {
    const beforeTarget = {
      ...rec("text:•#0", {}, true),
      stableKey: "reused-marker",
      pptxRecordKey: "object-5:1:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "1",
    };
    const beforeSibling = {
      ...rec("text:•#1", {}),
      stableKey: "sibling-marker",
      pptxRecordKey: "object-5:2:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "2",
      rect: { ...rect, y: 20 },
    };
    const afterTarget = {
      ...rec("text:•#0", {}, true),
      stableKey: "new-target-marker",
      pptxRecordKey: "object-5:1:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "1",
    };
    const afterSibling = {
      ...rec("text:•#1", {}),
      stableKey: "reused-marker",
      pptxRecordKey: "object-5:2:span:0:text",
      slideObjectId: "object-5",
      pptxParagraph: "2",
      rect: { ...rect, y: 20 },
    };

    expect(
      diffSnapshots(
        snap([beforeTarget, beforeSibling]),
        snap([afterTarget, afterSibling]),
      ),
    ).toMatchObject({
      deltas: [],
      geometry: [],
      missing: [],
      added: [],
    });
  });

  it("reports authored attribute changes on identity-matched nodes", () => {
    const before = {
      ...rec("box:div.card#0", {}),
      stableKey: "node-1:box",
      className: "card",
      inlineStyle: "color: red",
    };
    const after = {
      ...rec("box:div.card.active#0", {}),
      stableKey: "node-1:box",
      className: "card active",
      inlineStyle: "color: blue",
    };

    expect(diffSnapshots(snap([before]), snap([after])).deltas).toEqual([
      {
        key: before.key,
        prop: "class",
        a: "changed",
        b: "changed",
        inside: false,
      },
      {
        key: before.key,
        prop: "style",
        a: "changed",
        b: "changed",
        inside: false,
      },
    ]);
  });

  it.each(["before", "after"] as const)(
    "classifies protected marker geometry changes outside when marked on %s",
    (protectedSide) => {
      const before = {
        ...rec("box:li.marker#0", {}, true),
        stableKey: "marker-node",
        ...(protectedSide === "before" ? { protectedStyle: true } : {}),
      };
      const after = {
        ...rec("box:li.marker#0", {}, true),
        stableKey: "marker-node",
        rect: { ...rect, x: 3 },
        ...(protectedSide === "after" ? { protectedStyle: true } : {}),
      };

      expect(diffSnapshots(snap([before]), snap([after])).geometry).toEqual([
        {
          key: before.key,
          prop: "x",
          a: "0",
          b: "3",
          inside: false,
        },
      ]);
    },
  );

  it("allows a protected marker to move with its edited row", () => {
    const before = {
      ...rec("box:li.marker#0", {}, true),
      protectedStyle: true,
      protectedRect: { ...rect, x: 4, y: 3 },
      stableKey: "marker-node",
    };
    const after = {
      ...rec("box:li.marker#0", {}, true),
      protectedStyle: true,
      protectedRect: { ...rect, x: 4, y: 3 },
      rect: { ...rect, x: 12, y: 20 },
      stableKey: "marker-node",
    };

    expect(diffSnapshots(snap([before]), snap([after])).geometry).toEqual([
      {
        key: before.key,
        prop: "x",
        a: "0",
        b: "12",
        inside: true,
      },
      {
        key: before.key,
        prop: "y",
        a: "0",
        b: "20",
        inside: true,
      },
    ]);
  });

  it("flags a protected marker that moves relative to its edited row", () => {
    const before = {
      ...rec("box:li.marker#0", {}, true),
      protectedStyle: true,
      protectedRect: { ...rect, x: 4, y: 3 },
      stableKey: "marker-node",
    };
    const after = {
      ...rec("box:li.marker#0", {}, true),
      protectedStyle: true,
      protectedRect: { ...rect, x: 6, y: 3 },
      rect: { ...rect, x: 2 },
      stableKey: "marker-node",
    };

    expect(diffSnapshots(snap([before]), snap([after])).geometry).toEqual([
      {
        key: before.key,
        prop: "x",
        a: "0",
        b: "2",
        inside: false,
      },
    ]);
  });

  it("keeps unprotected in-block geometry changes inside", () => {
    const before = rec("box:li.marker#0", {}, true);
    const after = {
      ...rec("box:li.marker#0", {}, true),
      rect: { ...rect, x: 3 },
    };

    expect(diffSnapshots(snap([before]), snap([after])).geometry).toEqual([
      {
        key: before.key,
        prop: "x",
        a: "0",
        b: "3",
        inside: true,
      },
    ]);
  });

  it("reports a class style dying on an unchanged run", () => {
    const d = diffSnapshots(
      snap([rec("text:Q3 review#0", { "text-transform": "uppercase" })]),
      snap([rec("text:Q3 review#0", { "text-transform": "none" })]),
    );
    expect(d.deltas).toEqual([
      {
        key: "text:Q3 review#0",
        prop: "text-transform",
        a: "uppercase",
        b: "none",
        inside: false,
      },
    ]);
  });

  it("treats an unobserved custom property as empty until it gains a value", () => {
    const d = diffSnapshots(
      snap([rec("box:div.card#0", {}), rec("box:div.card#1", {})]),
      snap([
        rec("box:div.card#0", { "--layout-token": "10px" }),
        rec("box:div.card#1", { "--layout-token": "" }),
      ]),
    );

    expect(d.deltas).toEqual([
      {
        key: "box:div.card#0",
        prop: "--layout-token",
        a: "",
        b: "10px",
        inside: false,
      },
    ]);
  });

  it("pairs a run whose text only grew, and flags a vanished box", () => {
    const d = diffSnapshots(
      snap([
        rec("text:Hello#0", { color: "red" }, true),
        rec("box:div.card#0", {}),
      ]),
      snap([rec("text:Hello ok#0", { color: "red" }, true)]),
    );
    expect(d.deltas).toEqual([]);
    expect(d.missing).toEqual([{ key: "box:div.card#0", inside: false }]);
    expect(d.added).toEqual([]);
  });

  it("keeps untouched copies of a repeated text paired when the edited copy is renamed", () => {
    const d = diffSnapshots(
      snap([
        rec("text:Q1#0", { color: "a" }, true),
        rec("text:Q1#1", { color: "b" }),
        rec("text:Q1#2", { color: "c" }),
      ]),
      snap([
        rec("text:Q1 ok#0", { color: "a" }, true),
        rec("text:Q1#0", { color: "b" }),
        rec("text:Q1#1", { color: "c" }),
      ]),
    );
    expect(d.deltas).toEqual([]);
    expect(d.missing).toEqual([]);
    expect(d.added).toEqual([]);
  });

  it("does not pair on the inside flag, which each snapshot locates differently", () => {
    const records = (wrapperInside: boolean) => [
      rec("box:div#0", { bg: "red" }),
      rec("box:div#1", { bg: "pill" }, wrapperInside),
      rec("text:Title#0", {}, true),
      rec("box:div#2", { bg: "blue" }),
      rec("box:div#3", { bg: "green" }),
    ];
    const d = diffSnapshots(snap(records(false)), snap(records(true)));
    expect(d.deltas).toEqual([]);
    expect(d.missing).toEqual([]);
    expect(d.added).toEqual([]);
  });
});

describe("followsCenteredFlexReflow", () => {
  const centered = (
    context: string,
    containerPosition: number,
    containerSize: number,
    itemSize = 20,
    editedItemSize = 20,
    axis: "x" | "y" = "y",
  ) => ({
    ...rec("box:div#0", {}),
    flexCrossAlignment: {
      context,
      axis,
      containerPosition,
      containerSize,
      itemSize,
      editedItemSize,
    },
  });

  it("allows a centered sibling to follow a flex line's cross-axis growth", () => {
    expect(
      followsCenteredFlexReflow(
        centered("1.2", 0, 20),
        centered("1.2", 0, 60, 20, 60),
        "y",
        20,
      ),
    ).toBe(true);
  });

  it("rejects unrelated shifts, moved parents or a different flex parent", () => {
    expect(
      followsCenteredFlexReflow(
        centered("1.2", 0, 20),
        centered("1.2", 0, 60, 20, 60),
        "y",
        5,
      ),
    ).toBe(false);
    expect(
      followsCenteredFlexReflow(
        centered("1.2", 0, 20),
        centered("1.2", 5, 60, 20, 60),
        "y",
        25,
      ),
    ).toBe(false);
    expect(
      followsCenteredFlexReflow(
        centered("1.2", 0, 20),
        centered("1.3", 0, 60, 20, 60),
        "y",
        20,
      ),
    ).toBe(false);
    expect(
      followsCenteredFlexReflow(
        centered("1.2", 0, 20),
        centered("1.2", 0, 60, 20, 60),
        "x",
        20,
      ),
    ).toBe(false);
    expect(
      followsCenteredFlexReflow(
        centered("1.2", 0, 20),
        centered("1.2", 0, 60, 20, 20),
        "y",
        20,
      ),
    ).toBe(false);
  });
});

describe("outsideChangesFor", () => {
  const edited = (
    records: SnapRecord[],
    editedRect: NonNullable<Snapshot["editedRect"]>,
    editedInFlow = true,
  ): Snapshot => ({
    ...snap(records),
    editedRect,
    editedInFlow,
  });
  const sibling = (x: number, y: number, width = 100): SnapRecord => ({
    ...rec("box:div#0", {}),
    downstreamFlow: true,
    rect: { x, y, width, height: 20 },
  });

  it("allows measured movement that follows an in-flow edit's new edge", () => {
    const before = edited([sibling(0, 20)], {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    });
    const after = edited([sibling(0, 40)], {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    });

    expect(outsideChangesFor(before, after).changes).toEqual([]);
  });

  it("keeps independent and unverified geometry changes as failures", () => {
    const before = edited([sibling(0, 20)], {
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    });
    const moved = edited([sibling(30, 40)], {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    });
    const detached = edited(
      [sibling(0, 40)],
      { x: 0, y: 0, width: 100, height: 40 },
      false,
    );

    expect(
      outsideChangesFor(before, moved).changes.some(
        (change) => "prop" in change && change.prop === "x",
      ),
    ).toBe(true);
    expect(
      outsideChangesFor(before, detached).changes.some(
        (change) => "prop" in change && change.prop === "y",
      ),
    ).toBe(true);
  });

  it("allows only paragraph movement that matches growth inside the same fixed imported text object", () => {
    const object = { x: 10, y: 20, width: 200, height: 180 };
    const imported = (
      records: SnapRecord[],
      targetHeight: number,
      targetY = 20,
    ) => ({
      ...edited(
        records,
        { x: 20, y: targetY, width: 100, height: targetHeight },
        false,
      ),
      editedObjectId: "5",
      editedParagraphId: "1",
      editedObjectRect: object,
      editedTargetRect: {
        x: 20,
        y: targetY,
        width: 100,
        height: targetHeight,
      },
      editedObjectPosition: "absolute",
    });
    const paragraph = (y: number): SnapRecord => ({
      ...rec("text:Sibling row#0", { color: "rgb(20, 20, 20)" }),
      stableKey: "paragraph-2",
      slideObjectId: "5",
      pptxParagraph: "2",
      rect: { ...rect, y },
    });

    expect(
      outsideChangesFor(
        imported([paragraph(40)], 20),
        imported([paragraph(60)], 40),
      ).changes,
    ).toEqual([]);
    expect(
      outsideChangesFor(
        imported([paragraph(40)], 20),
        imported([{ ...paragraph(60), props: { color: "rgb(0, 0, 0)" } }], 40),
      ).changes,
    ).toHaveLength(1);
  });

  it("allows matching in-object flow around a multi-block paste", () => {
    const object = { x: 10, y: 20, width: 200, height: 180 };
    const pasted = (
      records: SnapRecord[],
      anchorY: number,
      fragments: Array<{
        x: number;
        y: number;
        width: number;
        height: number;
      }> = [],
      targetY = 20,
      targetHeight = 20,
    ) => ({
      ...edited(records, { x: 20, y: 20, width: 100, height: 20 }, false),
      editedObjectId: "5",
      editedParagraphId: "1",
      editedObjectRect: object,
      editedTargetRect: {
        x: 20,
        y: targetY,
        width: 100,
        height: targetHeight,
      },
      editedFlowAnchorRect: {
        x: 20,
        y: anchorY,
        width: 100,
        height: 20,
      },
      editedAuthoringFragmentRects: fragments,
      editedObjectPosition: "absolute",
    });
    const paragraph = (id: string, y: number): SnapRecord => ({
      ...rec(`text:paragraph-${id}#0`, {}),
      stableKey: `paragraph-${id}`,
      pptxRecordKey: `5:${id}:p:text`,
      slideObjectId: "5",
      pptxParagraph: id,
      rect: { ...rect, y },
    });
    const pastedParagraph = {
      ...rec("text:Docs paragraph#0", {}, true),
      stableKey: "pasted-paragraph",
    };

    expect(
      outsideChangesFor(
        pasted([paragraph("1", 20), paragraph("2", 40)], 20),
        pasted([pastedParagraph, paragraph("1", 80), paragraph("2", 100)], 80),
      ).changes,
    ).toEqual([]);

    const fragments = [
      { x: 20, y: 49, width: 100, height: 24 },
      { x: 20, y: 73, width: 100, height: 24 },
      { x: 20, y: 97, width: 100, height: 24 },
    ];
    const before = pasted(
      [paragraph("1", 20), paragraph("2", 44), paragraph("3", 60)],
      20,
    );
    const after = pasted(
      [
        pastedParagraph,
        paragraph("1", 20),
        paragraph("2", 145),
        paragraph("3", 161),
      ],
      20,
      fragments,
      49,
      24,
    );
    expect(outsideChangesFor(before, after).changes).toEqual([]);
    const mismatch = outsideChangesFor(
      before,
      pasted(
        [
          pastedParagraph,
          paragraph("1", 20),
          paragraph("2", 145),
          paragraph("3", 164),
        ],
        20,
        fragments,
        49,
        24,
      ),
    );
    expect(mismatch.changes).not.toEqual([]);

    for (const delta of [-1, 1]) {
      expect(
        outsideChangesFor(
          before,
          pasted(
            [
              pastedParagraph,
              paragraph("1", 20),
              paragraph("2", 145 + delta),
              paragraph("3", 161 + delta),
            ],
            20,
            fragments,
            49,
            24,
          ),
        ).changes,
      ).toEqual([]);
    }
    expect(
      outsideChangesFor(
        before,
        pasted(
          [
            pastedParagraph,
            paragraph("1", 20),
            paragraph("2", 147),
            paragraph("3", 163),
          ],
          20,
          fragments,
          49,
          24,
        ),
      ).changes,
    ).not.toEqual([]);

    const uniformlyShifted = outsideChangesFor(
      before,
      pasted(
        [
          pastedParagraph,
          paragraph("1", 20),
          paragraph("2", 160),
          paragraph("3", 176),
        ],
        20,
        fragments,
        49,
        24,
      ),
    );
    expect(uniformlyShifted.changes).toHaveLength(2);
  });

  it("allows an inserted paragraph to move only its downstream imported rows", () => {
    const object = { x: 10, y: 20, width: 200, height: 180 };
    const anchor = { x: 20, y: 20, width: 100, height: 20 };
    const inserted = { x: 20, y: 49, width: 100, height: 40 };
    const paragraph = (id: string, y: number): SnapRecord => ({
      ...rec(`text:paragraph-${id}#0`, {}),
      stableKey: `paragraph-${id}`,
      pptxRecordKey: `5:${id}:p:text`,
      slideObjectId: "5",
      pptxParagraph: id,
      rect: { ...rect, y },
    });
    const imported = (
      records: SnapRecord[],
      target: typeof anchor | typeof inserted,
      fragments: (typeof inserted)[] = [],
    ) => ({
      ...edited(records, target, false),
      editedObjectId: "5",
      editedParagraphId: "1",
      editedObjectRect: object,
      editedTargetRect: target,
      editedFlowAnchorRect: anchor,
      editedAuthoringFragmentRects: fragments,
      editedObjectPosition: "absolute",
    });

    const before = imported([paragraph("2", 40), paragraph("3", 60)], anchor);
    const after = imported(
      [paragraph("2", 89), paragraph("3", 109)],
      inserted,
      [inserted],
    );
    expect(outsideChangesFor(before, after).changes).toEqual([]);

    const wrongShift = imported(
      [paragraph("2", 91), paragraph("3", 111)],
      inserted,
      [inserted],
    );
    expect(outsideChangesFor(before, wrongShift).changes).toHaveLength(2);

    const restyled = imported(
      [
        {
          ...paragraph("2", 89),
          props: { color: "rgb(0, 0, 0)" },
        },
        paragraph("3", 109),
      ],
      inserted,
      [inserted],
    );
    expect(outsideChangesFor(before, restyled).changes).toHaveLength(1);
  });

  it("requires styled bullet markers to move with their downstream text", () => {
    const object = { x: 10, y: 20, width: 200, height: 300 };
    const anchor = { x: 20, y: 20, width: 100, height: 20 };
    const fragments = [
      { x: 20, y: 49, width: 100, height: 24 },
      { x: 20, y: 73, width: 100, height: 24 },
      { x: 20, y: 97, width: 100, height: 24 },
    ];
    const target = fragments[0]!;
    const rowMarker = (paragraph: string, y: number): SnapRecord => ({
      ...rec(`text:bullet#${paragraph}`, { color: "rgb(31, 78, 121)" }),
      stableKey: `marker-${paragraph}`,
      pptxRecordKey: `5:${paragraph}:span:0:text`,
      slideObjectId: "5",
      pptxParagraph: paragraph,
      tag: "span",
      className: "",
      inlineStyle: "display: inline-block; width: 13.5px",
      styledBulletMarker: true,
      styledBulletMarkerText: "•",
      rect: { x: 20, y, width: 6, height: 21 },
    });
    const paragraphText = (paragraph: string, y: number): SnapRecord => ({
      ...rec(`text:paragraph-${paragraph}#0`, {}),
      stableKey: `paragraph-${paragraph}`,
      pptxRecordKey: `5:${paragraph}:p:text`,
      slideObjectId: "5",
      pptxParagraph: paragraph,
      rect: { ...rect, x: 42, y },
    });
    const imported = (
      records: SnapRecord[],
      editedTargetRect: typeof target,
    ) => ({
      ...edited(records, editedTargetRect, false),
      editedObjectId: "5",
      editedParagraphId: "1",
      editedObjectRect: object,
      editedTargetRect,
      editedFlowAnchorRect: anchor,
      editedAuthoringFragmentRects: fragments,
      editedObjectPosition: "absolute",
    });
    const before = imported(
      [
        rowMarker("1", 20),
        rowMarker("2", 140),
        paragraphText("2", 140),
        rowMarker("3", 190),
        paragraphText("3", 190),
      ],
      anchor,
    );
    const after = imported(
      [
        rowMarker("1", 20),
        rowMarker("2", 140),
        paragraphText("2", 241),
        rowMarker("3", 190),
        paragraphText("3", 291),
      ],
      target,
    );

    expect(outsideChangesFor(before, after).changes).not.toEqual([]);
  });

  it("allows one unchanged styled marker copied onto an inserted imported row", () => {
    const object = { x: 84, y: 140, width: 360, height: 290 };
    const anchor = { x: 95, y: 176, width: 338, height: 20 };
    const fragment = { x: 95, y: 205, width: 338, height: 40 };
    const markerStyle =
      "display: inline-block; margin-left: -22.5px; width: 13.5px; color: #1F4E79";
    const marker = (
      key: string,
      paragraph: string,
      y: number,
      style = markerStyle,
      inside = false,
    ): SnapRecord => ({
      ...rec(`text:bullet#${key}`, { color: "rgb(31, 78, 121)" }, inside),
      stableKey: `node-${key}`,
      pptxRecordKey: `5:${paragraph}:span:0:text`,
      slideObjectId: "5",
      pptxParagraph: paragraph,
      tag: "span",
      className: "",
      inlineStyle: style,
      styledBulletMarker: true,
      styledBulletMarkerText: "•",
      rect: { x: 95, y, width: 6, height: 21 },
    });
    const imported = (
      records: SnapRecord[],
      target: typeof anchor | typeof fragment,
      fragments: (typeof fragment)[] = [],
    ) => ({
      ...edited(records, target, false),
      editedObjectId: "5",
      editedParagraphId: "1",
      editedObjectRect: object,
      editedTargetRect: target,
      editedFlowAnchorRect: anchor,
      editedAuthoringFragmentRects: fragments,
      editedObjectPosition: "absolute",
    });
    const before = imported(
      [
        marker("before-1", "1", 175),
        marker("before-2", "2", 204),
        marker("before-3", "3", 253),
      ],
      anchor,
    );
    const after = imported(
      [
        marker("after-1", "1", 175),
        marker("after-copy", "1", 204),
        marker("after-2", "2", 253),
        marker("after-3", "3", 301),
      ],
      fragment,
      [fragment],
    );

    expect(outsideChangesFor(before, after).changes).toEqual([]);

    const missingSibling = imported(
      [
        marker("after-1", "1", 175),
        marker("after-copy", "1", 204),
        marker("after-3", "3", 301),
      ],
      fragment,
      [fragment],
    );
    expect(outsideChangesFor(before, missingSibling).changes).not.toEqual([]);

    const extraInsideMarker = imported(
      [
        marker("after-1", "1", 175),
        marker("after-copy", "1", 204),
        marker("after-duplicate", "1", 205, markerStyle, true),
        marker("after-3", "3", 301),
      ],
      fragment,
      [fragment],
    );
    expect(outsideChangesFor(before, extraInsideMarker).changes).not.toEqual(
      [],
    );

    const restyledCopy = imported(
      [
        marker("after-1", "1", 175),
        marker("after-copy", "1", 204, `${markerStyle}; color: red`),
        marker("after-2", "2", 253),
        marker("after-3", "3", 301),
      ],
      fragment,
      [fragment],
    );
    expect(outsideChangesFor(before, restyledCopy).changes).not.toEqual([]);
  });

  it("still flags a sibling object or an unrelated in-object shift", () => {
    const object = { x: 10, y: 20, width: 200, height: 180 };
    const imported = (record: SnapRecord, targetHeight: number) => ({
      ...edited(
        [record],
        { x: 20, y: 20, width: 100, height: targetHeight },
        false,
      ),
      editedObjectId: "5",
      editedParagraphId: "1",
      editedObjectRect: object,
      editedTargetRect: {
        x: 20,
        y: 20,
        width: 100,
        height: targetHeight,
      },
      editedObjectPosition: "absolute",
    });
    const sibling = (y: number, slideObjectId: string): SnapRecord => ({
      ...rec("text:Sibling row#0", {}),
      stableKey: "paragraph-2",
      slideObjectId,
      pptxParagraph: "2",
      rect: { ...rect, y },
    });

    for (const [beforeRecord, afterRecord] of [
      [sibling(40, "6"), sibling(60, "6")],
      [sibling(40, "5"), sibling(62, "5")],
    ]) {
      expect(
        outsideChangesFor(
          imported(beforeRecord!, 20),
          imported(afterRecord!, 40),
        ).changes,
      ).toHaveLength(1);
    }
  });
});

describe("hardFailures", () => {
  it("flags leaked renderer state, a rewritten <style> and a dropped svg", () => {
    const stored = "<div><style>.k{color:red}</style><svg></svg><p>x</p></div>";
    const saved =
      '<div><style>[data-slide-content-scope="s"] .k{color:red}</style><p style="visibility: hidden">x</p></div>';
    expect(hardFailures(stored, saved)).toEqual([
      "data-slide-content-scope 0->1",
      "visibility:hidden 0->1",
      "<style> text changed",
      "<svg> 1->0",
    ]);
  });

  it("does not flag markers the stored source already had", () => {
    const html = '<p style="visibility:hidden">x</p>';
    expect(hardFailures(html, html)).toEqual([]);
  });
});

describe("lineDiff", () => {
  it("shows removals before additions and nothing for equal input", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "B", "c"])).toEqual(["- b", "+ B"]);
    expect(lineDiff(["a"], ["a"])).toEqual([]);
  });
});

describe("baseline ratchet", () => {
  it("uses the design harness slack", () => {
    expect(ceilingFor(0)).toBe(0.1);
    expect(ceilingFor(10)).toBe(11.5);
  });

  it("flags regressions, missing entries and baselined scenarios that did not run", () => {
    const baseline = {
      "c/s01/t00/noop": toBaselineEntry(
        metrics({ status: "fail", afterPct: 1, styleDeltasAfter: 3 }),
      ),
      "c/s01/t01/noop": toBaselineEntry(metrics()),
    };
    const results = new Map([
      [
        "c/s01/t00/noop",
        metrics({ status: "fail", afterPct: 1.1, styleDeltasAfter: 4 }),
      ],
      ["c/s02/t00/noop", metrics()],
    ]);
    expect(findBaselineProblems(results, baseline, () => true)).toEqual([
      "c/s01/t00/noop: styleDeltasAfter 4 exceeds baseline 3",
      "c/s02/t00/noop: no baseline entry (status pass) - run with --update to record one",
      "c/s01/t01/noop: baselined scenario did not run",
    ]);
    expect(findBaselineProblems(results, baseline, () => false)).toHaveLength(
      2,
    );
  });

  it("treats a worse status as a regression", () => {
    const baseline = { k: toBaselineEntry(metrics()) };
    expect(
      findBaselineProblems(
        new Map([["k", metrics({ status: "no-edit" })]]),
        baseline,
        () => true,
      ),
    ).toEqual(["k: status pass -> no-edit"]);
  });

  it("holds a field an older entry lacks to the zero ceiling, and ratchets it", () => {
    const { typedPct: _typedPct, ...old } = toBaselineEntry(metrics());
    const baseline = { k: old as BaselineEntry };
    expect(
      findBaselineProblems(
        new Map([["k", metrics({ typedPct: 0.05 })]]),
        baseline,
        () => true,
      ),
    ).toEqual([]);
    expect(
      findBaselineProblems(
        new Map([["k", metrics({ typedPct: 3 })]]),
        baseline,
        () => true,
      ),
    ).toEqual(["k: typedPct 3% exceeds ceiling 0.1%"]);
    expect(
      ratchetBaselineEntry(baseline.k, metrics({ typedPct: 3 })).typedPct,
    ).toBe(0.1);
  });
});

describe("ratchetBaselineEntry", () => {
  const measured = (over: Partial<ScenarioMetrics>): ScenarioMetrics => ({
    status: "pass",
    editingPct: 0,
    afterPct: 0,
    reloadPct: 0,
    typedPct: 0,
    outsideEditingPct: 0,
    outsideAfterPct: 0,
    styleDeltasEditing: 0,
    styleDeltasAfter: 0,
    missingAfter: 0,
    htmlDiffLines: 0,
    hardFailures: 0,
    violations: 0,
    ...over,
  });

  it("never loosens an existing entry", () => {
    const existing = ratchetBaselineEntry(
      undefined,
      measured({ afterPct: 0.2 }),
    );
    const next = ratchetBaselineEntry(
      existing,
      measured({ afterPct: 0.9, styleDeltasAfter: 3 }),
    );
    expect(next.afterPct).toBe(existing.afterPct);
    expect(next.styleDeltasAfter).toBe(0);
  });

  it("tightens an existing entry when the run improved", () => {
    const existing = ratchetBaselineEntry(undefined, measured({ afterPct: 2 }));
    const next = ratchetBaselineEntry(existing, measured({ afterPct: 0 }));
    expect(next.afterPct).toBeLessThan(existing.afterPct);
  });
});

describe("findBaselineProblems and errors", () => {
  it("fails an errored result even against an errored baseline entry", () => {
    const errored = {
      status: "error" as const,
      editingPct: 0,
      afterPct: 0,
      reloadPct: 0,
      typedPct: 0,
      outsideEditingPct: 0,
      outsideAfterPct: 0,
      styleDeltasEditing: 0,
      styleDeltasAfter: 0,
      missingAfter: 0,
      htmlDiffLines: 0,
      hardFailures: 0,
      violations: 0,
    };
    expect(
      findBaselineProblems(
        new Map([["c/s01/t00/noop", errored]]),
        { "c/s01/t00/noop": errored },
        () => true,
      ),
    ).toEqual(["c/s01/t00/noop: errored"]);
  });
});

describe("isSplicedOnce", () => {
  it("accepts the token inserted once anywhere, across breaks and ZWSP", () => {
    expect(isSplicedOnce("Hello world", " ok", "Hello world ok")).toBe(true);
    expect(isSplicedOnce("Hello world", " ok", "Hello ok world")).toBe(true);
    expect(isSplicedOnce("a b", "new line", "a b\n\u200b\nnew line")).toBe(
      true,
    );
    expect(isSplicedOnce("trust. The", " ok", "trust.  okThe")).toBe(true);
  });

  it("rejects a lost space", () => {
    expect(isSplicedOnce("Update", " ok", "Updateok")).toBe(false);
    expect(isSplicedOnce("a b", "new line", "a b\n\nnewline")).toBe(false);
  });

  it("rejects lost text, a missing token, or a doubled one", () => {
    expect(
      isSplicedOnce("trust. The hosted", "new line", "trust.new line"),
    ).toBe(false);
    expect(isSplicedOnce("Hello", " ok", "Hello")).toBe(false);
    expect(isSplicedOnce("Hello", " ok", "Hello ok ok")).toBe(false);
    expect(isSplicedOnce("Hello", " ok", "Hello okX")).toBe(false);
  });

  it("accepts marker glyphs a bullet split clones beside the token", () => {
    expect(
      isSplicedOnce("●Own it●Expand", "new line", "●Own it●●●new line●Expand"),
    ).toBe(true);
  });
});

describe("orphanedBaselineKeys", () => {
  it("names keys whose case or slide left the corpus", () => {
    const counts = new Map([["deck", 2]]);
    expect(
      orphanedBaselineKeys(
        ["deck/s01/t00/noop", "deck/s03/t00/noop", "gone/s01/t00/noop"],
        counts,
      ),
    ).toEqual(["deck/s03/t00/noop", "gone/s01/t00/noop"]);
  });
});

describe("restyledAddedText", () => {
  const white = { color: "rgb(255, 255, 255)", "font-weight": "700" };
  it("flags typed text in a new node with a style the element never had", () => {
    const view = snap([rec("text:Q3 Update#0", white, true)]);
    const reload = snap([
      rec("text:Q3 Update#0", white, true),
      rec("text:ok#0", { color: "rgb(0, 0, 0)", "font-weight": "400" }, true),
    ]);
    expect(restyledAddedText(view, reload)).toEqual(["text:ok#0"]);
  });

  it("accepts a new node styled like the element's text, e.g. a split row", () => {
    const view = snap([rec("text:Own it#0", white, true)]);
    const reload = snap([
      rec("text:Own it#0", white, true),
      rec("text:new line#0", white, true),
    ]);
    expect(restyledAddedText(view, reload)).toEqual([]);
  });

  it.each([
    ["heading", "h1"],
    ["list item", "li"],
  ])(
    "allows an unstyled paragraph after a %s while still flagging styled text",
    (_, tag) => {
      const view = snap([{ ...rec("text:Title#0", white, true), tag }]);
      const plainParagraph = {
        ...rec("text:new line#0", { color: "rgb(255, 255, 255)" }, true),
        tag: "p",
        inlineStyle: "",
      };
      const reload = snap([...view.records, plainParagraph]);
      expect(restyledAddedText(view, reload, tag)).toEqual([]);
      expect(restyledAddedText(view, reload)).toEqual(["text:new line#0"]);
      expect(
        restyledAddedText(
          view,
          snap([
            ...view.records,
            { ...plainParagraph, inlineStyle: "font-size: 48px" },
          ]),
          tag,
        ),
      ).toEqual(["text:new line#0"]);
    },
  );

  it("does not exempt a paragraph edit because a sibling is a list item", () => {
    const view = snap([
      { ...rec("text:List item#0", white, true), tag: "li" },
      {
        ...rec("text:Paragraph#0", { color: "rgb(0, 0, 255)" }, true),
        tag: "p",
      },
    ]);
    const plainParagraph = {
      ...rec("text:new line#0", { color: "rgb(0, 0, 0)" }, true),
      tag: "p",
      inlineStyle: "",
    };
    const after = snap([...view.records, plainParagraph]);

    expect(restyledAddedText(view, after, "p")).toEqual(["text:new line#0"]);
    expect(restyledAddedText(view, after, "li")).toEqual([]);
  });
});

describe("isDraftRevert", () => {
  const stored =
    '<div class="a" style="color: red"><p><span style="color: #1F4E79; font-weight: 700">Q3 &amp; Q4</span></p><p style="margin: 4px">Other</p><svg><text>x</text></svg></div>';
  const start = stored.indexOf("<span");
  const element = { start, end: stored.indexOf("</p>", start) };
  const patch = (content: string, fields: object = { content }) => ({
    action: "patch-deck",
    body: {
      deckId: "d",
      operations: [{ op: "patch-slide", slideId: "s1", fields }],
    },
  });
  const draft = stored.replace("Q4", "Qx4");
  const check = (writes: Array<{ action: string; body: any }>) =>
    isDraftRevert(stored, element, "x", writes, "s1");

  it("accepts the typed draft followed by a byte-exact revert", () => {
    expect(check([patch(draft), patch(stored)])).toBe(true);
  });

  it("rejects a style change alongside the typed token", () => {
    const restyledDraft = draft.replace(
      'style="color: #1F4E79; font-weight: 700"',
      'style="color: red; font-weight: 700"',
    );
    expect(check([patch(restyledDraft), patch(stored)])).toBe(false);
  });

  it("rejects a wrapper inserted around the typed token", () => {
    const wrappedDraft = draft.replace("Qx4", "Q<strong>x</strong>4");
    expect(check([patch(wrappedDraft), patch(stored)])).toBe(false);
  });

  it("rejects churn: a draft without the key, a loose revert, or extra writes", () => {
    const nbsp = stored.replace("Q3 ", "Q3&nbsp;");
    expect(check([patch(nbsp), patch(stored)])).toBe(false);
    expect(check([patch(draft), patch(nbsp)])).toBe(false);
    expect(check([patch(draft), patch(stored), patch(stored)])).toBe(false);
    expect(check([patch(stored)])).toBe(false);
  });

  it("rejects a draft that removes a visible space as well as the typed key", () => {
    const missingSpace = draft.replace("&amp; ", "&amp;");
    expect(check([patch(missingSpace), patch(stored)])).toBe(false);
  });

  it("rejects a draft that changed bytes outside the edited element or put the key elsewhere", () => {
    const flattened =
      '<div class="a"><p>Q3 &amp; Qx4</p><p>Other</p><svg><text>x</text></svg></div>';
    expect(check([patch(flattened), patch(stored)])).toBe(false);
    const elsewhere = stored.replace("Other", "Otxher");
    expect(check([patch(elsewhere), patch(stored)])).toBe(false);
  });

  it("rejects a write that sets more than the edited slide's content", () => {
    expect(
      check([patch(draft, { content: draft, notes: "n" }), patch(stored)]),
    ).toBe(false);
    const twoSlides = patch(draft);
    twoSlides.body.operations.push({
      op: "patch-slide",
      slideId: "s2",
      fields: { content: "<p>other</p>" },
    });
    expect(check([twoSlides, patch(stored)])).toBe(false);
    expect(
      check([
        {
          action: "save-deck",
          body: { deck: { slides: [{ id: "s1", content: draft }] } },
        },
        patch(stored),
      ]),
    ).toBe(false);
  });
});

describe("keepaliveMismatches", () => {
  const body = (content: string, slideId = "s1") =>
    JSON.stringify({
      deckId: "d",
      operations: [{ op: "patch-slide", slideId, fields: { content } }],
    });

  it("names a pagehide write whose slide content differs from the saved one", () => {
    expect(
      keepaliveMismatches(
        [
          { action: "patch-deck", body: body("<p>saved</p>") },
          { action: "patch-deck", body: body("<p>stale</p>") },
          { action: "patch-deck", body: body("<p>other</p>", "s2") },
        ],
        "s1",
        "<p>saved</p>",
      ),
    ).toEqual(["<p>stale</p>"]);
  });

  it("reports a write that deletes the slide or saves a deck without it", () => {
    expect(
      keepaliveMismatches(
        [
          {
            action: "patch-deck",
            body: JSON.stringify({
              operations: [{ op: "delete-slide", slideId: "s1" }],
            }),
          },
          {
            action: "save-deck",
            body: JSON.stringify({
              deck: { slides: [{ id: "s2", content: "<p>other</p>" }] },
            }),
          },
          { action: "patch-deck", body: body("<p>other</p>", "s2") },
        ],
        "s1",
        "<p>saved</p>",
      ),
    ).toEqual([null, null]);
  });

  it("ignores a patch that does not change slide content", () => {
    expect(
      keepaliveMismatches(
        [
          {
            action: "patch-deck",
            body: JSON.stringify({
              operations: [
                {
                  op: "patch-slide",
                  slideId: "s1",
                  fields: { notes: "updated" },
                },
              ],
            }),
          },
        ],
        "s1",
        "<p>saved</p>",
      ),
    ).toEqual([]);
  });

  it("reads save-deck and update-slide bodies, and reports an unreadable one", () => {
    const deck = JSON.stringify({
      deckId: "d",
      deck: { slides: [{ id: "s1", content: "<p>stale</p>" }] },
    });
    expect(
      keepaliveMismatches(
        [
          { action: "save-deck", body: deck },
          {
            action: "update-slide",
            body: JSON.stringify({ slideId: "s1", content: "<p>saved</p>" }),
          },
          { action: "patch-deck", body: null },
        ],
        "s1",
        "<p>saved</p>",
      ),
    ).toEqual(["<p>stale</p>", null]);
  });
});
