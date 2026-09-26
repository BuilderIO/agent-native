import { describe, expect, it } from "vitest";

import type { SnapRecord, Snapshot } from "./in-page.ts";
import {
  ceilingFor,
  diffSnapshots,
  findBaselineProblems,
  hardFailures,
  isSplicedOnce,
  lineDiff,
  orphanedBaselineKeys,
  ratchetBaselineEntry,
  restyledAddedText,
  toBaselineEntry,
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
  editedText: null,
});

const metrics = (over: Partial<ScenarioMetrics> = {}): ScenarioMetrics => ({
  status: "pass",
  editingPct: 0,
  afterPct: 0,
  reloadPct: 0,
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

describe("diffSnapshots", () => {
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
});

describe("ratchetBaselineEntry", () => {
  const measured = (over: Partial<ScenarioMetrics>): ScenarioMetrics => ({
    status: "pass",
    editingPct: 0,
    afterPct: 0,
    reloadPct: 0,
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
});
