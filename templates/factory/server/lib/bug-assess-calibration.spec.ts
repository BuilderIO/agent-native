import { describe, expect, it } from "vitest";
import { z } from "zod";

import { triageGuardCodeSchema } from "../triage/contracts.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import calibrationFile from "../workflow/stories/01-bug-report-to-builder/fixtures/assess-calibration.json";
import { STORY_GRAPHS } from "../workflow/story-graphs.fixture.js";
import { assessBuilderDispatch } from "./builder-dispatch-gate.js";

const CATEGORIES = [
  "ui-bug-evident-state",
  "copy-flip",
  "change-request",
  "feature-request",
  "vague-complaint",
  "bug-needs-product-choice",
  "typo",
  "touches-auth",
  "duplicate-of-open-report",
  "already-claimed",
] as const;

const calibrationCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.enum(CATEGORIES),
  report: z.string().min(1).max(600),
  situation: z.string().min(1).max(300).optional(),
  expected: z.strictObject({
    clearBug: z.boolean(),
    productUxImplications: z.boolean(),
    alreadyClaimed: z.boolean().optional(),
    categoriesInclude: z.array(triageGuardCodeSchema).min(1).optional(),
  }),
  note: z.string().min(1).max(300),
});
const calibrationSchema = z.strictObject({
  cases: z.array(calibrationCaseSchema).length(CATEGORIES.length),
});

const { cases } = calibrationSchema.parse(calibrationFile);
const caseOf = (category: (typeof CATEGORIES)[number]) => {
  const found = cases.find((entry) => entry.category === category);
  if (!found) throw new Error(`no case for ${category}`);
  return found;
};

describe("the assess step's calibration set", () => {
  it("is 10 labelled reports that fit the schema, one per kind, each labelled with booleans", () => {
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(10);
    expect(cases.map((entry) => entry.category).sort()).toEqual(
      [...CATEGORIES].sort(),
    );
    for (const entry of cases) {
      expect(typeof entry.expected.clearBug, entry.id).toBe("boolean");
      expect(typeof entry.expected.productUxImplications, entry.id).toBe(
        "boolean",
      );
    }
  });

  it("rejects a label that is not a boolean, a category the gate does not know, or a field it does not know", () => {
    const first = caseOf("typo");
    const label = (expected: Record<string, unknown>) => ({
      ...first,
      expected: { ...first.expected, ...expected },
    });

    expect(
      calibrationCaseSchema.safeParse(label({ clearBug: "true" })).success,
    ).toBe(false);
    expect(
      calibrationCaseSchema.safeParse(label({ productUxImplications: null }))
        .success,
    ).toBe(false);
    expect(
      calibrationCaseSchema.safeParse(label({ categoriesInclude: ["ui"] }))
        .success,
    ).toBe(false);
    expect(
      calibrationCaseSchema.safeParse(label({ risk: "low" })).success,
    ).toBe(false);
    expect(
      calibrationCaseSchema.safeParse({ ...first, verdict: "bug" }).success,
    ).toBe(false);
    const withoutNote: Record<string, unknown> = { ...first };
    delete withoutNote.note;
    expect(calibrationCaseSchema.safeParse(withoutNote).success).toBe(false);
  });

  it("labels a UI or copy bug with an evident correct state as a plain bug, which is the mistake the first live run made", () => {
    for (const category of [
      "ui-bug-evident-state",
      "copy-flip",
      "typo",
    ] as const) {
      expect(caseOf(category).expected, category).toMatchObject({
        clearBug: true,
        productUxImplications: false,
      });
    }
  });

  it("labels a request for new or changed behavior as a product question, and a bug with two possible fixes the same way", () => {
    for (const category of ["change-request", "feature-request"] as const) {
      expect(caseOf(category).expected, category).toMatchObject({
        clearBug: false,
        productUxImplications: true,
      });
    }
    expect(caseOf("bug-needs-product-choice").expected).toMatchObject({
      clearBug: true,
      productUxImplications: true,
    });
    expect(caseOf("vague-complaint").expected.clearBug).toBe(false);
  });

  it("names auth for the sign-in bug and a claim for the claimed report, and for no other", () => {
    expect(caseOf("touches-auth").expected.categoriesInclude).toContain("auth");
    expect(caseOf("already-claimed").expected.alreadyClaimed).toBe(true);
    for (const entry of cases) {
      if (entry.category !== "touches-auth") {
        expect(entry.expected.categoriesInclude, entry.id).toBeUndefined();
      }
      if (entry.category !== "already-claimed") {
        expect(entry.expected.alreadyClaimed, entry.id).toBeUndefined();
      }
    }
  });

  it("agrees with the real dispatch gate: given low risk and high confidence, only the plain bugs get through", () => {
    const allowed = cases
      .filter(
        (entry) =>
          assessBuilderDispatch({
            clearBug: entry.expected.clearBug,
            productUxImplications: entry.expected.productUxImplications,
            risk: "low",
            confidence: "high",
            alreadyClaimed: entry.expected.alreadyClaimed ?? false,
            categories: entry.expected.categoriesInclude ?? [],
          }).allowed,
      )
      .map((entry) => entry.category);

    expect(allowed.sort()).toEqual(
      [
        "copy-flip",
        "duplicate-of-open-report",
        "typo",
        "ui-bug-evident-state",
      ].sort(),
    );
  });
});

describe("what the assess step and the Builder gate say their fields mean", () => {
  const assess = STORY_GRAPHS["bug-report-to-builder"].nodes.find(
    (node) => node.name === "assess",
  );
  const GATE_FIELDS = [
    "clearBug",
    "productUxImplications",
    "risk",
    "confidence",
    "alreadyClaimed",
    "categories",
  ] as const;

  it("describes every gate answer the assess step gives", () => {
    expect(assess?.kind).toBe("ai");
    const result =
      assess?.kind === "ai"
        ? (assess.settings.result as Record<string, { description?: string }>)
        : {};

    for (const field of [...GATE_FIELDS, "enoughContext"]) {
      expect(result[field]?.description?.trim(), field).toBeTruthy();
    }
  });

  it("describes every gate field of builder.start, so any workflow that starts Builder carries the meanings", () => {
    const start = OPERATION_CATALOG.get("builder.start");

    for (const name of GATE_FIELDS) {
      const field = start?.fields.find((entry) => entry.name === name);
      expect(field, name).toBeDefined();
      expect(field?.description?.trim(), name).toBeTruthy();
    }
  });
});
