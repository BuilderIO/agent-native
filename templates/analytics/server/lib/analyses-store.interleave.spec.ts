/**
 * Regression coverage for the analyses read/modify/write race, mirroring
 * `dashboards-store.interleave.spec.ts`'s CAS-retry fixture for dashboards.
 *
 * `upsertAnalysis` used to write the whole record keyed only by `id`, with no
 * version/lock check (unlike `upsertDashboard`, which already had one). Two
 * concurrent writers that both read the same base — e.g. `rename-analysis`
 * renaming while `save-analysis` re-runs with fresh results — silently
 * clobbered each other, last writer wins. `upsertAnalysis` now accepts an
 * optional `expectedUpdatedAt` fence, and `upsertAnalysisWithRetry` re-reads +
 * re-applies a mutation when that fence loses a race.
 *
 * The fake database below deliberately loses the first fenced write once
 * (`state.loseNextCas`) to simulate a concurrent writer landing in between,
 * exactly like the dashboards fixture.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type AnalysisRow = {
  id: string;
  name: string;
  description: string;
  question: string;
  instructions: string;
  dataSources: string;
  resultMarkdown: string;
  resultData: string | null;
  author: string | null;
  ownerEmail: string;
  orgId: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  hiddenAt: string | null;
  hiddenBy: string | null;
};

function baseAnalysis(): AnalysisRow {
  return {
    id: "closed-lost-q1",
    name: "Closed Lost Q1",
    description: "Deal loss analysis",
    question: "Why did we lose Q1 deals?",
    instructions: "Query HubSpot for closed-lost deals in Q1.",
    dataSources: JSON.stringify(["hubspot"]),
    resultMarkdown: "# Findings v1",
    resultData: JSON.stringify({ rows: 3 }),
    author: "alice@example.com",
    ownerEmail: "alice@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    hiddenAt: null,
    hiddenBy: null,
  };
}

const state = vi.hoisted(() => ({
  analysis: {
    id: "closed-lost-q1",
    name: "Closed Lost Q1",
    description: "Deal loss analysis",
    question: "Why did we lose Q1 deals?",
    instructions: "Query HubSpot for closed-lost deals in Q1.",
    dataSources: JSON.stringify(["hubspot"]),
    resultMarkdown: "# Findings v1",
    resultData: JSON.stringify({ rows: 3 }) as string | null,
    author: "alice@example.com" as string | null,
    ownerEmail: "alice@example.com",
    orgId: null as string | null,
    visibility: "private",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    hiddenAt: null as string | null,
    hiddenBy: null as string | null,
  },
  revisions: [] as any[],
  // One-shot flag: the next fenced UPDATE attempt against `analyses`
  // simulates a concurrent writer (e.g. save-analysis re-running with fresh
  // results) landing in between the caller's read and write, then reports
  // zero affected rows — exactly what a real `WHERE id = ? AND updated_at = ?`
  // reports when someone else already moved `updated_at`.
  loseNextCas: false,
  // When true, every fenced UPDATE attempt loses the race forever, to prove
  // upsertAnalysisWithRetry gives up loud instead of looping forever.
  alwaysLoseCas: false,
  updateAttempts: 0,
}));

function columnName(column: unknown): string | null {
  if (!column || typeof column !== "object") return null;
  return (column as { name?: string }).name ?? null;
}

function matchesRow(predicate: unknown, row: Record<string, unknown>): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const p = predicate as {
    kind?: string;
    column?: unknown;
    value?: unknown;
    conditions?: unknown[];
  };
  if (p.kind === "and") {
    return (p.conditions ?? []).every((condition) =>
      matchesRow(condition, row),
    );
  }
  if (p.kind === "eq") {
    const name = columnName(p.column);
    return name ? row[name] === p.value : true;
  }
  return true;
}

function rowsResult(rows: unknown[]) {
  const result: any = Promise.resolve(rows);
  result.orderBy = () => rowsResult(rows);
  result.limit = () => rowsResult(rows);
  return result;
}

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  isNull: (column: unknown) => ({ kind: "isNull", column }),
  isNotNull: (column: unknown) => ({ kind: "isNotNull", column }),
}));

vi.mock("@agent-native/core/server", () => ({
  recordChange: () => undefined,
}));

vi.mock("@agent-native/core/settings", () => ({
  getAllSettings: async () => ({}),
  getOrgSetting: async () => null,
  getUserSetting: async () => null,
  deleteOrgSetting: async () => undefined,
  deleteUserSetting: async () => undefined,
}));

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    resolveAccess: async () => ({
      role: "editor",
      resource: { ...state.analysis },
    }),
    assertAccess: async () => ({ role: "editor" }),
  };
});

vi.mock("../db/index.js", () => {
  const schema = {
    analyses: {
      id: { name: "id" },
      name: { name: "name" },
      description: { name: "description" },
      question: { name: "question" },
      instructions: { name: "instructions" },
      dataSources: { name: "dataSources" },
      resultMarkdown: { name: "resultMarkdown" },
      resultData: { name: "resultData" },
      author: { name: "author" },
      ownerEmail: { name: "ownerEmail" },
      orgId: { name: "orgId" },
      visibility: { name: "visibility" },
      createdAt: { name: "createdAt" },
      updatedAt: { name: "updatedAt" },
      hiddenAt: { name: "hiddenAt" },
      hiddenBy: { name: "hiddenBy" },
    },
    analysisRevisions: {
      id: { name: "id" },
      analysisId: { name: "analysisId" },
      createdAt: { name: "createdAt" },
    },
  };

  const db = {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => {
          if (table === schema.analysisRevisions) {
            return rowsResult(
              state.revisions.filter((r) => matchesRow(predicate, r)),
            );
          }
          return rowsResult(
            matchesRow(predicate, state.analysis)
              ? [{ ...state.analysis }]
              : [],
          );
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: any) => {
        if (table === schema.analysisRevisions) {
          state.revisions.push({ ...row });
        }
        const p: any = Promise.resolve(undefined);
        p.onConflictDoNothing = async () => undefined;
        return p;
      },
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        if (table === schema.analysisRevisions) {
          state.revisions = state.revisions.filter(
            (r) => !matchesRow(predicate, r),
          );
        }
        return undefined;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Partial<AnalysisRow>) => ({
        where: async (predicate: unknown) => {
          if (table !== schema.analyses) return { rowsAffected: 0 };
          state.updateAttempts += 1;
          if (state.alwaysLoseCas) {
            // Every attempt loses: a different writer keeps landing first.
            state.analysis = {
              ...state.analysis,
              updatedAt: `2026-07-09T00:00:00.${String(state.updateAttempts).padStart(3, "0")}Z`,
            };
            return { rowsAffected: 0 };
          }
          if (state.loseNextCas) {
            state.loseNextCas = false;
            // Simulates a concurrent `save-analysis` re-run landing first
            // with fresh results.
            state.analysis = {
              ...state.analysis,
              resultMarkdown: "# Findings v2 (concurrent re-run)",
              resultData: JSON.stringify({ rows: 9 }),
              updatedAt: "2026-07-09T00:00:00.001Z",
            };
            return { rowsAffected: 0 };
          }
          if (!matchesRow(predicate, state.analysis)) {
            return { rowsAffected: 0 };
          }
          state.analysis = { ...state.analysis, ...values } as AnalysisRow;
          return { rowsAffected: 1 };
        },
      }),
    }),
  };

  return { schema, getDb: () => db };
});

const {
  getAnalysis,
  upsertAnalysis,
  upsertAnalysisWithRetry,
  AnalysisConflictError,
  ANALYSIS_SAVE_MAX_ATTEMPTS,
} = await import("./dashboards-store.js");

const ctx = { email: "alice@example.com", orgId: null };

beforeEach(() => {
  state.analysis = baseAnalysis();
  state.revisions = [];
  state.loseNextCas = false;
  state.alwaysLoseCas = false;
  state.updateAttempts = 0;
});

describe("analyses-store concurrency", () => {
  it("fences the write and rejects a stale expectedUpdatedAt", async () => {
    const existing = await getAnalysis("closed-lost-q1", ctx);
    expect(existing).not.toBeNull();

    // First writer saves using the value it read — succeeds and bumps
    // updated_at.
    await upsertAnalysis(
      "closed-lost-q1",
      { name: "Renamed By Writer One" },
      ctx,
      existing!.updatedAt,
    );
    expect(state.analysis.name).toBe("Renamed By Writer One");

    // Second writer still holds the OLD updatedAt it read before the first
    // writer's save landed — the fenced write must reject, not clobber.
    await expect(
      upsertAnalysis(
        "closed-lost-q1",
        { name: "Renamed By Writer Two" },
        ctx,
        existing!.updatedAt,
      ),
    ).rejects.toBeInstanceOf(AnalysisConflictError);
    // The first writer's save is untouched by the rejected second attempt.
    expect(state.analysis.name).toBe("Renamed By Writer One");
  });

  it("omits fencing (legacy last-write-wins) when expectedUpdatedAt is not passed", async () => {
    const existing = await getAnalysis("closed-lost-q1", ctx);
    // Simulate the row having changed since `existing` was read.
    state.analysis = {
      ...state.analysis,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };

    await expect(
      upsertAnalysis(
        "closed-lost-q1",
        { name: "Legacy Overwrite" },
        ctx,
        // no expectedUpdatedAt — existing callers (legacy migration, revision
        // restore, save-analysis create/re-run) keep unconditional overwrite
        // behavior.
      ),
    ).resolves.toBeDefined();
    expect(existing).not.toBeNull();
    expect(state.analysis.name).toBe("Legacy Overwrite");
  });

  it("upsertAnalysisWithRetry re-reads and re-applies the mutation after losing the race, landing both the concurrent re-run's fresh results and this call's rename", async () => {
    state.loseNextCas = true;

    const saved = await upsertAnalysisWithRetry("closed-lost-q1", ctx, () => ({
      name: "Renamed While Racing",
    }));

    // "# Findings v2 (concurrent re-run)" / { rows: 9 } was injected by the
    // simulated concurrent writer on the lost first attempt; the new name is
    // this call's own mutation. Both must be present — neither writer's edit
    // was dropped.
    expect(saved.resultMarkdown).toBe("# Findings v2 (concurrent re-run)");
    expect(saved.resultData).toEqual({ rows: 9 });
    expect(saved.name).toBe("Renamed While Racing");
    expect(state.analysis.name).toBe("Renamed While Racing");
    expect(state.analysis.resultMarkdown).toBe(
      "# Findings v2 (concurrent re-run)",
    );
    expect(state.updateAttempts).toBe(2);
  });

  it("gives up with a clear error after repeated conflicts instead of looping forever", async () => {
    state.alwaysLoseCas = true;

    await expect(
      upsertAnalysisWithRetry("closed-lost-q1", ctx, () => ({
        name: "Never Lands",
      })),
    ).rejects.toThrow(/Could not save analysis "closed-lost-q1"/);

    expect(state.updateAttempts).toBe(ANALYSIS_SAVE_MAX_ATTEMPTS);
    // Nothing from the doomed mutation ever landed.
    expect(state.analysis.name).toBe("Closed Lost Q1");
  });
});
