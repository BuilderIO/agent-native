/**
 * Regression coverage for designs.data read/modify/write races.
 *
 * The tweak and token actions used to read the entire JSON blob, merge their
 * own keys in memory, then unconditionally replace the column. Two requests
 * that read the same base therefore dropped whichever sibling write landed
 * first. The fake database below deliberately lets non-transactional reads
 * interleave while serializing transaction callbacks, matching the guarantee
 * the production mutation helper now relies on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DesignRow = { id: string; data: string; updatedAt: string };
type DesignFileRow = { designId: string; filename: string; content: string };

const state = vi.hoisted(() => ({
  design: {
    id: "design_1",
    data: "{}",
    updatedAt: "2026-07-09T00:00:00.000Z",
  } as DesignRow,
  designFiles: [] as DesignFileRow[],
  interleaveNonTransactionalDesignReads: false,
  nonTransactionalReadCount: 0,
  readGate: null as Promise<void> | null,
  releaseReadGate: null as (() => void) | null,
  txTail: Promise.resolve() as Promise<unknown>,
  loseNextCas: false,
}));

function enableReadInterleave(): void {
  state.interleaveNonTransactionalDesignReads = true;
  state.nonTransactionalReadCount = 0;
  state.readGate = new Promise<void>((resolve) => {
    state.releaseReadGate = resolve;
  });
}

function columnName(column: unknown): string | null {
  if (!column || typeof column !== "object") return null;
  return (column as { name?: string }).name ?? null;
}

function matchesDesign(predicate: unknown, row: DesignRow): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const p = predicate as {
    kind?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };
  if (p.kind === "and") {
    return (p.conditions ?? []).every((condition) =>
      matchesDesign(condition, row),
    );
  }
  if (p.kind === "isNull") {
    return columnName(p.column) === "data" ? row.data === null : true;
  }
  if (p.kind !== "eq") return true;
  switch (columnName(p.column)) {
    case "id":
      return row.id === p.value;
    case "data":
      return row.data === p.value;
    case "updatedAt":
      return row.updatedAt === p.value;
    default:
      return true;
  }
}

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "agent-native://design/editor?designId=design_1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn().mockResolvedValue({ role: "editor" }),
  resolveAccess: async () => {
    const resource = { ...state.design };
    if (state.interleaveNonTransactionalDesignReads) {
      state.nonTransactionalReadCount += 1;
      if (state.nonTransactionalReadCount === 2) state.releaseReadGate?.();
      await state.readGate;
    }
    return { role: "editor", resource };
  },
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designs: {
      id: { name: "id" },
      data: { name: "data" },
      updatedAt: { name: "updatedAt" },
    },
    designFiles: {
      designId: { name: "designId" },
      filename: { name: "filename" },
      content: { name: "content" },
    },
  };

  function makeDb(transactional: boolean) {
    const db = {
      select: (_projection: unknown) => ({
        from: (table: unknown) => ({
          where: async (predicate: unknown) => {
            if (table === schema.designFiles) {
              return state.designFiles.map((file) => ({ ...file }));
            }
            const snapshot = { ...state.design };
            if (!transactional && state.interleaveNonTransactionalDesignReads) {
              state.nonTransactionalReadCount += 1;
              if (state.nonTransactionalReadCount === 2) {
                state.releaseReadGate?.();
              }
              await state.readGate;
            }
            return matchesDesign(predicate, snapshot) ? [snapshot] : [];
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Partial<DesignRow>) => ({
          where: async (predicate: unknown) => {
            if (table !== schema.designs) return { rowsAffected: 0 };
            if (state.loseNextCas) {
              state.loseNextCas = false;
              const concurrentData = JSON.parse(state.design.data) as Record<
                string,
                unknown
              >;
              state.design = {
                ...state.design,
                data: JSON.stringify({
                  ...concurrentData,
                  concurrentDuringCas: "preserve-me",
                }),
                updatedAt: "2026-07-09T00:00:00.001Z",
              };
              return { rowsAffected: 0 };
            }
            if (!matchesDesign(predicate, state.design)) {
              return { rowsAffected: 0 };
            }
            state.design = { ...state.design, ...values };
            return { rowsAffected: 1 };
          },
        }),
      }),
    };
    return db;
  }

  const topLevelDb = makeDb(false);
  const txDb = makeDb(true);
  return {
    schema,
    getDb: () => ({
      ...topLevelDb,
      transaction: <T>(callback: (tx: typeof txDb) => Promise<T>) => {
        // Reaching the transaction path identifies the fixed implementation.
        // The pre-fix actions never call transaction, so their two initial
        // reads remain gated above and still reproduce the lost update.
        state.interleaveNonTransactionalDesignReads = false;
        const run = () => callback(txDb);
        const result = state.txTail.then(run, run);
        state.txTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    }),
  };
});

import { tweakSelectionsHash } from "../shared/resolve-tweaks.js";
import applyDesignTokenEdit from "./apply-design-token-edit.js";
import applyTweaks from "./apply-tweaks.js";
import importDesignTokens from "./import-design-tokens.js";

function readData(): Record<string, unknown> {
  return JSON.parse(state.design.data) as Record<string, unknown>;
}

beforeEach(() => {
  state.design = {
    id: "design_1",
    data: JSON.stringify({
      tweaks: [
        {
          id: "accent",
          label: "Accent",
          type: "color-swatch",
          defaultValue: "#0ea5e9",
          cssVar: "--color-accent",
        },
      ],
      tweakSelections: {},
      preservedSiblingKey: { keep: true },
      tokenImports: [],
    }),
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
  state.designFiles = [];
  state.interleaveNonTransactionalDesignReads = false;
  state.nonTransactionalReadCount = 0;
  state.readGate = null;
  state.releaseReadGate = null;
  state.txTail = Promise.resolve();
  state.loseNextCas = false;
});

describe("design data mutation interleaving", () => {
  it("keeps a knob write and a token write that start from the same data revision", async () => {
    enableReadInterleave();

    await Promise.all([
      applyTweaks.run({
        designId: "design_1",
        selections: { density: "compact" },
      }),
      applyDesignTokenEdit.run({
        designId: "design_1",
        edits: [{ cssVar: "--shadow-glow", value: "0 0 12px #38bdf8" }],
      }),
    ]);

    const data = readData();
    expect(data.tweakSelections).toMatchObject({
      density: "compact",
      "--shadow-glow": "0 0 12px #38bdf8",
    });
    expect(data.preservedSiblingKey).toEqual({ keep: true });
  });

  it("appends both concurrent token import events and keeps both token values", async () => {
    enableReadInterleave();

    await Promise.all([
      importDesignTokens.run({
        designId: "design_1",
        source: "paste",
        text: ":root { --color-brand-a: #112233; }",
      }),
      importDesignTokens.run({
        designId: "design_1",
        source: "paste",
        text: ":root { --radius-card-b: 18px; }",
      }),
    ]);

    const data = readData();
    expect(data.tweakSelections).toMatchObject({
      "--color-brand-a": "#112233",
      "--radius-card-b": "18px",
    });
    expect(data.tokenImports).toEqual([
      expect.objectContaining({ tokenCount: 1 }),
      expect.objectContaining({ tokenCount: 1 }),
    ]);
    expect(data.preservedSiblingKey).toEqual({ keep: true });
  });

  it("retains both new import events while enforcing the ten-entry history cap", async () => {
    const initial = readData();
    state.design.data = JSON.stringify({
      ...initial,
      tokenImports: Array.from({ length: 9 }, (_, index) => ({
        id: `old-${index}`,
        source: "paste",
        tokenCount: 1,
      })),
    });

    await Promise.all([
      importDesignTokens.run({
        designId: "design_1",
        source: "paste",
        text: ":root { --spacing-concurrent-a: 12px; }",
      }),
      importDesignTokens.run({
        designId: "design_1",
        source: "paste",
        text: ":root { --spacing-concurrent-b: 20px; }",
      }),
    ]);

    const imports = readData().tokenImports as Array<{ id: string }>;
    expect(imports).toHaveLength(10);
    expect(imports.some((entry) => entry.id === "old-0")).toBe(false);
    expect(imports.some((entry) => entry.id === "old-1")).toBe(true);
    expect(
      imports.filter((entry) => !entry.id.startsWith("old-")),
    ).toHaveLength(2);
  });

  it("retries a lost CAS against the new revision instead of overwriting its sibling key", async () => {
    state.loseNextCas = true;

    await applyTweaks.run({
      designId: "design_1",
      selections: { density: "comfortable" },
    });

    const data = readData();
    expect(data.tweakSelections).toMatchObject({ density: "comfortable" });
    expect(data.concurrentDuringCas).toBe("preserve-me");
  });

  it("rejects a retained full snapshot after a newer tweak value wins", async () => {
    const emptyBaseHash = tweakSelectionsHash({});
    await applyTweaks.run({
      designId: "design_1",
      selections: { density: "compact" },
      expectedSelectionsHash: emptyBaseHash,
    });

    await expect(
      applyTweaks.run({
        designId: "design_1",
        selections: { density: "comfortable" },
        expectedSelectionsHash: emptyBaseHash,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(readData().tweakSelections).toMatchObject({ density: "compact" });
  });

  it("accepts an exact retry after the requested selections already landed", async () => {
    const emptyBaseHash = tweakSelectionsHash({});
    const params = {
      designId: "design_1",
      selections: { density: "compact" },
      expectedSelectionsHash: emptyBaseHash,
    };
    const first = await applyTweaks.run(params);
    const retry = await applyTweaks.run(params);

    expect(retry.appliedTweaks).toMatchObject({ density: "compact" });
    expect(retry.selectionsHash).toBe(first.selectionsHash);
  });

  it("lets only one of two full snapshots from the same base win", async () => {
    const emptyBaseHash = tweakSelectionsHash({});
    const results = await Promise.allSettled([
      applyTweaks.run({
        designId: "design_1",
        selections: { density: "compact" },
        expectedSelectionsHash: emptyBaseHash,
      }),
      applyTweaks.run({
        designId: "design_1",
        selections: { density: "comfortable" },
        expectedSelectionsHash: emptyBaseHash,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(["compact", "comfortable"]).toContain(
      (readData().tweakSelections as Record<string, unknown>).density,
    );
  });
});
