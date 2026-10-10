import { describe, expect, it } from "vitest";

import { summarizeNativeCompositionBudget } from "./native-composition-budget";

describe("native composition budget diagnostics", () => {
  it("charges each texture once, in the same family order as the budget", () => {
    const graph = {};
    const feedback = {};
    const source = {};
    const asset = {};
    const isolation = {};
    const bytes = new Map([
      [graph, 17],
      [feedback, 19],
      [source, 23],
      [asset, 29],
      [isolation, 31],
    ]);
    const summary = summarizeNativeCompositionBudget(
      {
        resource: [graph],
        feedback: [graph, feedback],
        source: [feedback, source],
        asset: [source, asset],
        isolation: [asset, isolation],
      },
      bytes,
      7,
      125,
    );
    expect(summary).toMatchObject({
      status: "complete",
      currentBytes: 119,
      knownBytes: 119,
      missingTextures: 0,
      exceeds: true,
    });
    expect(summary.familyKnownBytes).toEqual({
      resource: 17,
      feedback: 19,
      source: 23,
      asset: 29,
      isolation: 31,
      compute: 0,
    });
    expect(summary.familyTextures).toEqual({
      resource: 1,
      feedback: 1,
      source: 1,
      asset: 1,
      isolation: 1,
      compute: 0,
    });
  });

  it("preserves the exact cap boundary for known zero-byte textures", () => {
    const tracked = {};
    const zero = {};
    const families = {
      resource: [tracked, zero],
      feedback: [],
      source: [],
      asset: [],
      isolation: [],
    };
    const sizes = new Map([
      [tracked, 17],
      [zero, 0],
    ]);
    expect(
      summarizeNativeCompositionBudget(families, sizes, 8, 25),
    ).toMatchObject({
      status: "complete",
      currentBytes: 17,
      missingTextures: 0,
      exceeds: false,
      familyTextures: { resource: 2 },
    });
    expect(
      summarizeNativeCompositionBudget(families, sizes, 9, 25),
    ).toMatchObject({
      status: "complete",
      currentBytes: 17,
      exceeds: true,
    });
  });

  it("distinguishes absent bytes from a known zero without returning a cap decision", () => {
    const tracked = {};
    const missing = {};
    const missingAsset = {};
    const summary = summarizeNativeCompositionBudget(
      {
        resource: [tracked, missing],
        feedback: [missing],
        source: [missing],
        asset: [missingAsset],
        isolation: [missingAsset],
      },
      new Map([[tracked, 17]]),
      1,
      100,
    );
    expect(summary).toMatchObject({
      status: "incomplete",
      currentBytes: null,
      exceeds: null,
      knownBytes: 17,
      missingTextures: 2,
    });
    expect(summary.familyMissingTextures).toEqual({
      resource: 1,
      feedback: 0,
      source: 0,
      asset: 1,
      isolation: 0,
      compute: 0,
    });
    expect(summary.familyTextures).toEqual({
      resource: 2,
      feedback: 0,
      source: 0,
      asset: 1,
      isolation: 0,
      compute: 0,
    });
  });

  it("never replaces missing bytes with an over-cap decision from partial known bytes", () => {
    const known = {};
    const missing = {};
    expect(
      summarizeNativeCompositionBudget(
        {
          resource: [known],
          feedback: [],
          source: [missing],
          asset: [],
          isolation: [],
        },
        new Map([[known, 50]]),
        1,
        25,
      ),
    ).toMatchObject({
      status: "incomplete",
      currentBytes: null,
      exceeds: null,
      knownBytes: 50,
      familyMissingTextures: { source: 1 },
    });
  });
});

// Test-only budgets independently fix the real float source/output sizes at the published cap.
describe("stateless buffer accounting", () => {
  it("charges packed storage and uniforms with textures and refuses maximum float area", () => {
    const source = {},
      output = {},
      storage = {},
      uniform = {};
    const summary = summarizeNativeCompositionBudget(
      {
        resource: [source, output],
        feedback: [],
        source: [],
        asset: [],
        isolation: [],
        compute: [storage, uniform],
      },
      new Map([
        [source, 67108864],
        [output, 67108864],
        [storage, 8388608],
        [uniform, 544],
      ]),
      0,
      134217728,
    );
    expect(summary).toMatchObject({
      status: "complete",
      currentBytes: 142606880,
      exceeds: true,
      familyKnownBytes: { compute: 8389152 },
    });
  });
  it("distinguishes missing storage accounting from a known zero without a successful cap decision", () => {
    const known = {},
      missing = {};
    const summary = summarizeNativeCompositionBudget(
      {
        resource: [],
        feedback: [],
        source: [],
        asset: [],
        isolation: [],
        compute: [known, missing],
      },
      new Map([[known, 0]]),
      0,
      134217728,
    );
    expect(summary).toMatchObject({
      status: "incomplete",
      currentBytes: null,
      exceeds: null,
      familyMissingTextures: { compute: 1 },
      familyTextures: { compute: 2 },
    });
  });
});

describe("required family accounting", () => {
  it("allows absence of the additive compute family but rejects a missing required family", () => {
    const valid = {
      resource: [],
      feedback: [],
      source: [],
      asset: [],
      isolation: [],
    };
    expect(
      summarizeNativeCompositionBudget(valid, new Map(), 0, 134217728).status,
    ).toBe("complete");
    const malformed = { ...valid };
    Reflect.deleteProperty(malformed, "source");
    expect(() =>
      summarizeNativeCompositionBudget(malformed, new Map(), 0, 134217728),
    ).toThrow(TypeError);
  });
  it("rejects an explicitly null or noniterable compute family", () => {
    const families = {
      resource: [],
      feedback: [],
      source: [],
      asset: [],
      isolation: [],
    };
    for (const compute of [null, 0, false, {}]) {
      expect(() =>
        summarizeNativeCompositionBudget(
          { ...families, compute } as any,
          new Map(),
          0,
          128,
        ),
      ).toThrow(TypeError);
    }
  });
});
