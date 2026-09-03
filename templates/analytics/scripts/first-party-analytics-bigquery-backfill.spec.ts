import { describe, expect, it, vi } from "vitest";

import {
  assertSourceAtCheckpoint,
  buildHydrationQuery,
  buildPageKeyQuery,
  parseDedicatedBackfillOptions,
  runDedicatedBackfill,
  type CheckpointStore,
  type DedicatedBackfillCheckpoint,
  type DedicatedBackfillDependencies,
} from "./first-party-analytics-bigquery-backfill.js";

const scope = {
  userEmail: "owner@example.com",
  orgId: "org_builder",
};

function memoryStore(): CheckpointStore & {
  checkpoint: DedicatedBackfillCheckpoint | null;
} {
  return {
    checkpoint: null,
    async load() {
      return this.checkpoint;
    },
    async save(checkpoint) {
      this.checkpoint = checkpoint;
    },
  };
}

function dependencies(
  execute: DedicatedBackfillDependencies["db"]["execute"],
  upload: DedicatedBackfillDependencies["upload"],
  checkpointStore = memoryStore(),
): DedicatedBackfillDependencies {
  return {
    db: { execute },
    upload,
    checkpointStore,
    now: () => "2026-08-08T00:00:00.000Z",
  };
}

describe("dedicated first-party Analytics BigQuery backfill", () => {
  it("parses bounded execution settings and caps unsafe overrides", () => {
    expect(
      parseDedicatedBackfillOptions({
        "owner-email": "owner@example.com",
        "org-id": "org_builder",
        execute: "true",
        "batch-size": "10000",
        concurrency: "20",
        "max-batches": "20000",
        "lookback-days": "30",
        "skip-events": "http.response,action.response",
        finalize: "true",
      }),
    ).toMatchObject({
      scope,
      execute: true,
      finalize: true,
      batchSize: 2500,
      concurrency: 4,
      maxBatches: 10000,
      lookbackDays: 30,
      excludedEventNames: ["http.response", "action.response"],
    });
  });

  it("reads only ordered event keys with a fixed tuple cutoff", () => {
    const query = buildPageKeyQuery(
      {
        name: "org",
        predicate: "org_id = ?",
        predicateArgs: [scope.orgId],
        lookbackStart: "2026-06-09T00:00:00.000Z",
        excludedEventNames: ["http.response"],
      },
      {
        cutoff: {
          receivedAt: "2026-08-08T00:00:00.000Z",
          id: "cutoff",
        },
        cursor: {
          receivedAt: "2026-08-07T00:00:00.000Z",
          id: "cursor",
        },
        copied: 10,
        complete: false,
      },
      1000,
    );

    expect(query.sql).toContain("SELECT received_at, id");
    expect(query.sql).toContain("event_name IS DISTINCT FROM 'http.response'");
    expect(query.sql).toContain("(received_at, id) <= (?, ?)");
    expect(query.sql).toContain("(received_at, id) > (?, ?)");
    expect(query.sql).not.toContain("SELECT *");
    expect(query.sql).not.toContain("WHERE id IN");
    expect(query.args).toEqual([
      scope.orgId,
      "2026-06-09T00:00:00.000Z",
      "2026-08-08T00:00:00.000Z",
      "cutoff",
      "2026-08-07T00:00:00.000Z",
      "cursor",
      1000,
    ]);
  });

  it("hydrates a bounded key page by primary key", () => {
    const query = buildHydrationQuery(["event-1", "event-2"]);

    expect(query.sql).toContain("SELECT id, public_key_id, event_name");
    expect(query.sql).toContain("WHERE id IN (?, ?)");
    expect(query.args).toEqual(["event-1", "event-2"]);
  });

  it("checkpoints only after BigQuery acknowledges a complete page", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:00.000Z", id: "cutoff" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { received_at: "2026-08-07T00:00:00.000Z", id: "event-1" },
          { received_at: "2026-08-07T00:00:01.000Z", id: "event-2" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { received_at: "2026-08-07T00:00:01.000Z", id: "event-2" },
          { received_at: "2026-08-07T00:00:00.000Z", id: "event-1" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const upload = vi.fn().mockResolvedValue(2);
    const store = memoryStore();

    await expect(
      runDedicatedBackfill(
        {
          scope,
          table: "builder-3b0a2.analytics.first_party_analytics_events_raw",
          batchSize: 2,
          concurrency: 2,
          maxBatches: 10,
          checkpointPath: "/tmp/unused-in-memory-checkpoint.json",
        },
        dependencies(execute, upload, store),
      ),
    ).resolves.toMatchObject({
      batches: 1,
      copiedThisRun: 2,
      copiedTotal: 2,
      complete: true,
    });
    expect(upload).toHaveBeenCalledWith([
      { received_at: "2026-08-07T00:00:00.000Z", id: "event-1" },
      { received_at: "2026-08-07T00:00:01.000Z", id: "event-2" },
    ]);
    expect(store.checkpoint?.branches.org).toMatchObject({
      copied: 2,
      complete: true,
      cursor: {
        receivedAt: "2026-08-07T00:00:01.000Z",
        id: "event-2",
      },
    });
  });

  it("reconciles rows written after the initial cutoff", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:00.000Z", id: "cutoff-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:01.000Z", id: "event-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:01.000Z", id: "event-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:02.000Z", id: "cutoff-2" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:02.000Z", id: "event-2" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:02.000Z", id: "event-2" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:02.000Z", id: "cutoff-2" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const upload = vi.fn().mockResolvedValue(1);
    const store = memoryStore();

    await expect(
      runDedicatedBackfill(
        {
          scope,
          table: null,
          batchSize: 2,
          concurrency: 1,
          maxBatches: 10,
          checkpointPath: "/tmp/unused-in-memory-checkpoint.json",
        },
        dependencies(execute, upload, store),
      ),
    ).resolves.toMatchObject({
      batches: 2,
      copiedThisRun: 2,
      copiedTotal: 2,
      complete: true,
    });
    expect(upload).toHaveBeenNthCalledWith(1, [
      { received_at: "2026-08-08T00:00:01.000Z", id: "event-1" },
    ]);
    expect(upload).toHaveBeenNthCalledWith(2, [
      { received_at: "2026-08-08T00:00:02.000Z", id: "event-2" },
    ]);
  });

  it("leaves the cursor unchanged when a page is only partially acknowledged", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:00.000Z", id: "cutoff" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-07T00:00:00.000Z", id: "event-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-07T00:00:00.000Z", id: "event-1" }],
      });
    const store = memoryStore();

    await expect(
      runDedicatedBackfill(
        {
          scope,
          table: null,
          batchSize: 2,
          concurrency: 1,
          maxBatches: 10,
          checkpointPath: "/tmp/unused-in-memory-checkpoint.json",
        },
        dependencies(execute, vi.fn().mockResolvedValue(0), store),
      ),
    ).rejects.toThrow("acknowledged 0 of 1");
    expect(store.checkpoint?.branches.org).toMatchObject({
      copied: 0,
      complete: false,
      cursor: null,
      cutoff: { id: "cutoff" },
    });
  });

  it("rejects a malformed stored cursor before paging", async () => {
    const store = memoryStore();
    store.checkpoint = {
      version: 1,
      scope,
      table: null,
      branches: {
        org: {
          cutoff: {
            receivedAt: "2026-08-08T00:00:00.000Z",
            id: "cutoff",
          },
          cursor: {
            received_at: "2026-08-07T00:00:00.000Z",
            id: "event-1",
          },
          copied: 0,
          complete: false,
        },
        legacy: {
          cutoff: null,
          cursor: null,
          copied: 0,
          complete: false,
        },
      },
      updatedAt: "2026-08-08T00:00:00.000Z",
    } as unknown as DedicatedBackfillCheckpoint;
    const execute = vi.fn();

    await expect(
      runDedicatedBackfill(
        {
          scope,
          table: null,
          batchSize: 2,
          concurrency: 1,
          maxBatches: 10,
          checkpointPath: "/tmp/unused-in-memory-checkpoint.json",
        },
        dependencies(execute, vi.fn(), store),
      ),
    ).rejects.toThrow("org cursor is missing receivedAt");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects finalization when a source branch advanced past its cutoff", async () => {
    const checkpoint: DedicatedBackfillCheckpoint = {
      version: 1,
      scope,
      table: null,
      branches: {
        org: {
          cutoff: {
            receivedAt: "2026-08-08T00:00:00.000Z",
            id: "cutoff",
          },
          cursor: {
            receivedAt: "2026-08-08T00:00:00.000Z",
            id: "cutoff",
          },
          copied: 1,
          complete: true,
        },
        legacy: {
          cutoff: null,
          cursor: null,
          copied: 0,
          complete: true,
        },
      },
      updatedAt: "2026-08-08T00:00:00.000Z",
    };
    const db = {
      execute: vi.fn().mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:01.000Z", id: "new-event" }],
      }),
    };

    await expect(
      assertSourceAtCheckpoint(scope, checkpoint, db),
    ).rejects.toThrow("org branch has events after the checkpoint cutoff");
  });

  it("stops at the explicit work budget and can resume later", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-08T00:00:00.000Z", id: "cutoff" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-07T00:00:00.000Z", id: "event-1" }],
      })
      .mockResolvedValueOnce({
        rows: [{ received_at: "2026-08-07T00:00:00.000Z", id: "event-1" }],
      });
    const store = memoryStore();

    const result = await runDedicatedBackfill(
      {
        scope,
        table: null,
        batchSize: 1,
        concurrency: 1,
        maxBatches: 1,
        checkpointPath: "/tmp/unused-in-memory-checkpoint.json",
      },
      dependencies(execute, vi.fn().mockResolvedValue(1), store),
    );

    expect(result).toMatchObject({
      batches: 1,
      copiedThisRun: 1,
      complete: false,
    });
    expect(store.checkpoint?.branches.legacy.complete).toBe(false);
  });
});
