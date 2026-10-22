import { describe, expect, it } from "vitest";

import { triageGuardCodeSchema } from "../triage/contracts.js";
import {
  BUILDER_DISPATCH_REASON_CODES,
  HARD_NEVER_AUTOMATE_GUARD_CODES,
  assessBuilderDispatch,
  builderDispatchChecks,
  coreDispatchChecks,
  readBuilderDispatchFields,
  type BuilderDispatchInput,
} from "./builder-dispatch-gate.js";

const clean: BuilderDispatchInput = {
  clearBug: true,
  productUxImplications: false,
  risk: "low",
  confidence: "high",
  alreadyClaimed: false,
  categories: [],
};

function refusal(overrides: Partial<BuilderDispatchInput>) {
  const result = assessBuilderDispatch({ ...clean, ...overrides });
  if (result.allowed) throw new Error("Expected the gate to refuse.");
  return result;
}

describe("assessBuilderDispatch", () => {
  it("allows a clear, low-risk, high-confidence bug nobody claimed that touches nothing sensitive", () => {
    expect(assessBuilderDispatch(clean)).toEqual({ allowed: true });
  });

  it.each<[string, Partial<BuilderDispatchInput>, string]>([
    ["is not a clear bug", { clearBug: false }, "not_clear_bug"],
    [
      "has a product or design question",
      { productUxImplications: true },
      "product_ux_implications",
    ],
    ["has unknown risk", { risk: "unknown" }, "risk_not_low"],
    ["has negligible risk", { risk: "negligible" }, "risk_not_low"],
    ["has medium risk", { risk: "medium" }, "risk_not_low"],
    ["has high risk", { risk: "high" }, "risk_not_low"],
    ["has critical risk", { risk: "critical" }, "risk_not_low"],
    ["has a made-up risk", { risk: "lowish" }, "risk_not_low"],
    [
      "has unknown confidence",
      { confidence: "unknown" },
      "confidence_not_high",
    ],
    ["has low confidence", { confidence: "low" }, "confidence_not_high"],
    ["has medium confidence", { confidence: "medium" }, "confidence_not_high"],
    ["was claimed by a person", { alreadyClaimed: true }, "already_claimed"],
    [
      "touches a category nobody has heard of",
      { categories: ["styling"] },
      "category_unrecognized",
    ],
  ])("refuses a report that %s", (_name, overrides, code) => {
    const result = refusal(overrides);

    expect(result.reasonCodes).toEqual([code]);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it.each(HARD_NEVER_AUTOMATE_GUARD_CODES)(
    "refuses a change that touches %s, and names it",
    (category) => {
      const result = refusal({ categories: [category] });

      expect(result.reasonCodes).toEqual(["never_automate_category"]);
      expect(result.message).toContain(category);
    },
  );

  it("is only the hard categories that stop a change: the rest of the guard codes are not categories of change", () => {
    const hard = new Set<string>(HARD_NEVER_AUTOMATE_GUARD_CODES);
    // Every hard category is a real guard code, so a rename cannot leave one behind.
    for (const code of hard) {
      expect(triageGuardCodeSchema.options).toContain(code);
    }
    // owner_owned was dropped from dispatch on purpose and stays dropped.
    expect(hard.has("owner_owned")).toBe(false);
    expect(
      assessBuilderDispatch({ ...clean, categories: ["owner_owned"] }),
    ).toEqual({ allowed: true });
  });

  it("names every reason at once, in a fixed order", () => {
    const result = refusal({
      clearBug: false,
      productUxImplications: true,
      risk: "critical",
      confidence: "low",
      alreadyClaimed: true,
      categories: ["auth", "styling"],
    });

    expect(result.reasonCodes).toEqual([
      "not_clear_bug",
      "product_ux_implications",
      "risk_not_low",
      "confidence_not_high",
      "already_claimed",
      "category_unrecognized",
      "never_automate_category",
    ]);
  });

  it("only ever returns codes it declares", () => {
    const result = refusal({
      clearBug: false,
      risk: "high",
      categories: ["vault", "x"],
    });

    for (const code of result.reasonCodes) {
      expect(BUILDER_DISPATCH_REASON_CODES).toContain(code);
    }
  });

  it("does not change what it was given", () => {
    const input: BuilderDispatchInput = {
      ...clean,
      categories: ["auth"],
    };
    const before = structuredClone(input);

    assessBuilderDispatch(input);

    expect(input).toEqual(before);
  });
});

describe("the checks behind a refusal", () => {
  it("holds every dispatch to the same four judgements, in order, in these words", () => {
    expect(
      coreDispatchChecks({ ...clean, risk: "high", confidence: "low" }),
    ).toEqual([
      {
        reasonCode: "not_clear_bug",
        passed: true,
        reason:
          "The automation classified a concrete, reproducible bug or error report.",
      },
      {
        reasonCode: "product_ux_implications",
        passed: true,
        reason: "No product or UX decision was detected.",
      },
      {
        reasonCode: "risk_not_low",
        passed: false,
        reason:
          "Risk high is above the auto-dispatch bar and requires manual review.",
      },
      {
        reasonCode: "confidence_not_high",
        passed: false,
        reason:
          "Confidence low is below the auto-dispatch bar and requires manual review.",
      },
    ]);
  });

  it("runs every check on every call, so a refusal can name them all", () => {
    expect(
      builderDispatchChecks(clean).map((check) => check.reasonCode),
    ).toEqual([
      "not_clear_bug",
      "product_ux_implications",
      "risk_not_low",
      "confidence_not_high",
      "already_claimed",
      "category_unrecognized",
      "never_automate_category",
    ]);
  });
});

describe("readBuilderDispatchFields", () => {
  const fields = {
    clearBug: true,
    productUxImplications: false,
    risk: "low",
    confidence: "high",
    alreadyClaimed: false,
    categories: ["auth"],
  };

  it("reads the six inputs an operation carries", () => {
    expect(readBuilderDispatchFields(fields)).toEqual({
      ok: true,
      input: { ...fields, categories: ["auth"] },
    });
  });

  it.each(Object.keys(fields))("refuses when %s is not there", (name) => {
    const copy: Record<string, unknown> = { ...fields };
    delete copy[name];

    const result = readBuilderDispatchFields(copy);

    expect(result).toMatchObject({
      ok: false,
      refusal: { allowed: false, reasonCodes: ["gate_input_invalid"] },
    });
    expect(result.ok ? "" : result.refusal.message).toContain(name);
  });

  it("names every input that is wrong, not only the first", () => {
    const result = readBuilderDispatchFields({
      ...fields,
      clearBug: "yes",
      categories: "auth",
      risk: 3,
    });

    const message = result.ok ? "" : result.refusal.message;
    expect(message).toContain("clearBug");
    expect(message).toContain("risk");
    expect(message).toContain("categories");
    expect(message).not.toContain("confidence");
  });

  it("trims what it reads, so a stray space is not a different risk", () => {
    const result = readBuilderDispatchFields({
      ...fields,
      risk: " low ",
      categories: [" auth "],
    });

    expect(result).toMatchObject({
      ok: true,
      input: { risk: "low", categories: ["auth"] },
    });
  });

  it("never turns a missing input into a passing one", () => {
    const result = readBuilderDispatchFields({});

    expect(result.ok).toBe(false);
  });
});
