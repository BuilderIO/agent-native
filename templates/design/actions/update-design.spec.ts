import { beforeEach, describe, expect, it, vi } from "vitest";

type Predicate =
  | { kind: "eq"; left: unknown; right: unknown }
  | { kind: "and"; conditions: Predicate[] }
  | { kind: "isNull"; value: unknown };

interface DesignRow {
  id: string;
  title: string;
  data: string | null;
  dataOperationRevisions: string | null;
  updatedAt: string;
}

type ResultShape =
  | "rowsAffected"
  | "affectedRows"
  | "rowCount"
  | "count"
  | "changes"
  | "d1-meta"
  | "missing";

const mocks = vi.hoisted(() => {
  const state = {
    row: {
      id: "design-1",
      title: "Untitled",
      data: "{}",
      dataOperationRevisions: "{}",
      updatedAt: "2026-07-09T00:00:00.000Z",
    } as DesignRow,
    gatedReadsRemaining: 0,
    gatedReadCount: 0,
    releaseGatedReads: null as (() => void) | null,
    resultShape: "changes" as ResultShape,
  };

  const resetReadGate = (count: number) => {
    state.gatedReadsRemaining = count;
    state.gatedReadCount = 0;
    state.releaseGatedReads = null;
  };

  const waitAtReadGate = async () => {
    if (state.gatedReadsRemaining <= 0) return;
    state.gatedReadsRemaining -= 1;
    state.gatedReadCount += 1;
    if (state.gatedReadCount === 2) {
      state.releaseGatedReads?.();
      return;
    }
    await new Promise<void>((resolve) => {
      state.releaseGatedReads = resolve;
    });
  };

  return {
    state,
    resetReadGate,
    waitAtReadGate,
    assertAccess: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown): Predicate => ({
    kind: "eq",
    left,
    right,
  }),
  and: (...conditions: Predicate[]): Predicate => ({
    kind: "and",
    conditions,
  }),
  isNull: (value: unknown): Predicate => ({ kind: "isNull", value }),
}));

vi.mock("../server/db/index.js", () => {
  const schema = {
    designs: {
      id: "designs.id",
      data: "designs.data",
      dataOperationRevisions: "designs.dataOperationRevisions",
    },
  };

  const matches = (predicate: Predicate): boolean => {
    if (predicate.kind === "and") {
      return predicate.conditions.every(matches);
    }
    if (predicate.kind === "isNull") {
      if (predicate.value === schema.designs.data) {
        return mocks.state.row.data === null;
      }
      if (predicate.value === schema.designs.dataOperationRevisions) {
        return mocks.state.row.dataOperationRevisions === null;
      }
      return true;
    }
    if (predicate.left === schema.designs.id) {
      return mocks.state.row.id === predicate.right;
    }
    if (predicate.left === schema.designs.data) {
      return mocks.state.row.data === predicate.right;
    }
    if (predicate.left === schema.designs.dataOperationRevisions) {
      return mocks.state.row.dataOperationRevisions === predicate.right;
    }
    return true;
  };

  const select = () => ({
    from: () => ({
      where: async (predicate: Predicate) => {
        const snapshot = { ...mocks.state.row };
        await mocks.waitAtReadGate();
        return matches(predicate)
          ? [
              {
                id: snapshot.id,
                data: snapshot.data,
                dataOperationRevisions: snapshot.dataOperationRevisions,
              },
            ]
          : [];
      },
    }),
  });

  const update = () => ({
    set: (updates: Partial<DesignRow>) => ({
      where: async (predicate: Predicate) => {
        const affected = matches(predicate) ? 1 : 0;
        if (affected > 0) Object.assign(mocks.state.row, updates);
        switch (mocks.state.resultShape) {
          case "rowsAffected":
            return { rowsAffected: affected };
          case "affectedRows":
            return { affectedRows: affected };
          case "rowCount":
            return { rowCount: affected };
          case "count":
            return { count: affected };
          case "changes":
            return { changes: affected };
          case "d1-meta":
            return { meta: { changes: affected } };
          case "missing":
            return {};
        }
      },
    }),
  });

  const tx = { select, update };
  const db = {
    select,
    update,
    transaction: async (run: (transaction: typeof tx) => Promise<void>) =>
      run(tx),
  };

  return { getDb: () => db, schema };
});

import action from "./update-design.js";

const BASE_DATA = {
  canvasFrames: {
    "frame-a": { x: 0, y: 0, width: 400, height: 300 },
    "frame-b": { x: 500, y: 0, width: 400, height: 300 },
  },
  screenMetadata: {
    "frame-a": { title: "A" },
    "frame-b": { title: "B" },
  },
};

describe("update-design data concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.row = {
      id: "design-1",
      title: "Untitled",
      data: JSON.stringify(BASE_DATA),
      dataOperationRevisions: "{}",
      updatedAt: "2026-07-09T00:00:00.000Z",
    };
    mocks.resetReadGate(0);
    mocks.state.resultShape = "changes";
    mocks.assertAccess.mockResolvedValue(undefined);
  });

  it("rejects one ambiguous legacy snapshot instead of silently losing a concurrent frame edit", async () => {
    mocks.resetReadGate(2);
    const moveA = {
      ...BASE_DATA,
      canvasFrames: {
        ...BASE_DATA.canvasFrames,
        "frame-a": { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
      },
    };
    const moveB = {
      ...BASE_DATA,
      canvasFrames: {
        ...BASE_DATA.canvasFrames,
        "frame-b": { ...BASE_DATA.canvasFrames["frame-b"], x: 560 },
      },
    };

    const results = await Promise.allSettled([
      action.run({ id: "design-1", data: JSON.stringify(moveA) } as never),
      action.run({ id: "design-1", data: JSON.stringify(moveB) } as never),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(Error);
    expect((rejected?.reason as Error).message).toContain(
      "Design data changed while this snapshot was being saved",
    );
    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect([
      [40, 500],
      [0, 560],
    ]).toContainEqual([
      persisted.canvasFrames["frame-a"].x,
      persisted.canvasFrames["frame-b"].x,
    ]);
  });

  it("CAS-retries explicit path operations so concurrent edits to different frame entries both persist", async () => {
    mocks.resetReadGate(2);

    await Promise.all([
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-a"],
            value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
          },
        ],
      } as never),
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-b"],
            value: { ...BASE_DATA.canvasFrames["frame-b"], x: 560 },
          },
        ],
      } as never),
    ]);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames["frame-a"].x).toBe(40);
    expect(persisted.canvasFrames["frame-b"].x).toBe(560);
  });

  it("rejects an older same-client operation that arrives after a newer keepalive", async () => {
    const newer = await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { ...BASE_DATA.canvasFrames["frame-a"], x: 80 },
        },
      ],
      operationSource: "tab-a",
      operationRevision: 2,
    } as never);
    const stale = await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
        },
      ],
      operationSource: "tab-a",
      operationRevision: 1,
    } as never);

    expect(newer).toEqual({ id: "design-1", updated: true });
    expect(stale).toEqual({ id: "design-1", updated: true, stale: true });
    expect(
      (JSON.parse(mocks.state.row.data!) as typeof BASE_DATA).canvasFrames[
        "frame-a"
      ].x,
    ).toBe(80);
    expect(JSON.parse(mocks.state.row.dataOperationRevisions!)).toEqual({
      "tab-a": 2,
    });
  });

  it("uses an explicit delete operation so a concurrent write cannot resurrect a removed frame", async () => {
    mocks.resetReadGate(2);

    await Promise.all([
      action.run({
        id: "design-1",
        dataOperations: [{ op: "delete", path: ["canvasFrames", "frame-a"] }],
      } as never),
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-b"],
            value: { ...BASE_DATA.canvasFrames["frame-b"], x: 560 },
          },
        ],
      } as never),
    ]);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames).not.toHaveProperty("frame-a");
    expect(persisted.canvasFrames["frame-b"].x).toBe(560);
  });

  it("rejects unsafe patch paths and mixing legacy snapshots with path operations", () => {
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [
          { op: "set", path: ["__proto__", "polluted"], value: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [{ op: "delete", path: ["canvasFrames", "frame-a"] }],
        operationSource: "tab-a",
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        operationSource: "tab-a",
        operationRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        data: "{}",
        dataOperations: [{ op: "delete", path: ["canvasFrames", "frame-a"] }],
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        id: "design-1",
        dataOperations: [{ op: "set", path: ["canvasFrames", "frame-a"] }],
      }).success,
    ).toBe(false);
  });

  it("CAS-matches a legacy null data row", async () => {
    mocks.state.row.data = null;

    await action.run({
      id: "design-1",
      data: JSON.stringify({
        canvasFrames: {
          "frame-a": { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
        },
      }),
    } as never);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames["frame-a"].x).toBe(40);
  });

  it.each(["{broken-json", "[]", '"primitive"'])(
    "fails loud instead of overwriting malformed persisted data: %s",
    async (persistedData) => {
      mocks.state.row.data = persistedData;

      await expect(
        action.run({
          id: "design-1",
          dataOperations: [
            {
              op: "set",
              path: ["canvasFrames", "frame-a"],
              value: BASE_DATA.canvasFrames["frame-a"],
            },
          ],
        } as never),
      ).rejects.toThrow("invalid data JSON");
      expect(mocks.state.row.data).toBe(persistedData);
    },
  );

  it.each<ResultShape>([
    "rowsAffected",
    "affectedRows",
    "rowCount",
    "count",
    "changes",
    "d1-meta",
  ])("normalizes the %s affected-row result shape", async (resultShape) => {
    mocks.state.resultShape = resultShape;

    await action.run({
      id: "design-1",
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", "frame-a"],
          value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
        },
      ],
    } as never);

    const persisted = JSON.parse(mocks.state.row.data!) as typeof BASE_DATA;
    expect(persisted.canvasFrames["frame-a"].x).toBe(40);
  });

  it("fails loud when a driver cannot report whether the CAS matched", async () => {
    mocks.state.resultShape = "missing";

    await expect(
      action.run({
        id: "design-1",
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", "frame-a"],
            value: { ...BASE_DATA.canvasFrames["frame-a"], x: 40 },
          },
        ],
      } as never),
    ).rejects.toThrow("did not report an affected-row count");
  });
});
