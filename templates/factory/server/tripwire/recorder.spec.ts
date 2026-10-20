import { createRequire } from "node:module";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { factoryTripwires } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import {
  TRIPWIRE_LOG_PREFIX,
  TRIPWIRE_REPEAT_LIMIT,
  TRIPWIRE_SUPPRESSED_PREFIX,
  createTripwireRecorder,
  type TripwireRecorder,
} from "./recorder.js";
import {
  TRIPWIRE_KEEP_PER_FACTORY,
  TRIPWIRE_PRUNE_BATCH,
  createDrizzleTripwireStore,
  type TripwireRow,
  type TripwireStore,
} from "./store.js";
import {
  TRIPWIRE_CODES,
  TRIPWIRE_FAILED_PREFIX,
  type TripwireEvent,
  type TripwireScope,
} from "./types.js";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

const SCOPE: TripwireScope = { orgId: "org-1", factoryId: "factory-1" };
const OTHER_FACTORY: TripwireScope = { orgId: "org-1", factoryId: "factory-2" };

// Assembled at run time so no secret scanner reads this file as a leak.
const fake = (...parts: string[]) => parts.join("");
const SLACK = fake("xox", "b-", "1111111111-", "0123456789abcdefghijklmnop");
const GITHUB = fake("gh", "p_", "A".repeat(36));
const EMAIL = "ana.customer@example.test";
const HEX = "0123456789abcdef0123456789abcdef";
const BASE64 = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRg";
const SECRETS = [SLACK, GITHUB, EMAIL, HEX, BASE64];

type Database = ReturnType<typeof drizzle>;
let client: Awaited<ReturnType<typeof PGlite.create>>;
let db: Database;
let store: TripwireStore;

beforeAll(async () => {
  client = await PGlite.create("memory://");
  for (const migration of factoryMigrations) {
    if (typeof migration.sql === "string") await client.exec(migration.sql);
  }
  db = drizzle(client);
  store = createDrizzleTripwireStore({ getDatabase: () => db });
});

afterAll(async () => {
  await client.close();
});

let lines: string[];
let failures: string[];
let clock: number;
let counter: number;

beforeEach(async () => {
  await client.exec("TRUNCATE factory_tripwires");
  lines = [];
  failures = [];
  clock = Date.parse("2026-10-19T12:00:00.000Z");
  counter = 0;
});

function recorderOver(
  overrides: Partial<Parameters<typeof createTripwireRecorder>[0]> = {},
): TripwireRecorder {
  return createTripwireRecorder({
    store,
    now: () => new Date(clock),
    newId: () => `tw-${String((counter += 1)).padStart(4, "0")}`,
    logLine: (line) => lines.push(line),
    logFailure: (line) => failures.push(line),
    ...overrides,
  });
}

function event(overrides: Record<string, unknown> = {}): TripwireEvent {
  return {
    area: "provider",
    code: "provider_status_unexpected",
    severity: "warn",
    scope: SCOPE,
    workflowId: "wf-1",
    runId: "run-1",
    nodeId: "pull",
    operationId: "hubspot.newLeads",
    details: { status: 502, durationMs: 1204 },
    ...overrides,
  } as TripwireEvent;
}

async function rows() {
  return db
    .select()
    .from(factoryTripwires)
    .orderBy(asc(factoryTripwires.createdAt), asc(factoryTripwires.id));
}

describe("recording", () => {
  it("stores one typed row and writes one greppable line", async () => {
    const recorder = recorderOver();
    recorder.record(event());
    await recorder.flush();

    const [row] = await rows();
    expect(row).toMatchObject({
      id: "tw-0001",
      orgId: "org-1",
      factoryId: "factory-1",
      workflowId: "wf-1",
      runId: "run-1",
      nodeId: "pull",
      area: "provider",
      code: "provider_status_unexpected",
      severity: "warn",
      createdAt: "2026-10-19T12:00:00.000Z",
    });
    expect(JSON.parse(row!.detailsJson)).toEqual({
      operationId: "hubspot.newLeads",
      status: 502,
      durationMs: 1204,
    });
    expect(failures).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith(`${TRIPWIRE_LOG_PREFIX} {`)).toBe(true);
    expect(
      JSON.parse(lines[0]!.slice(TRIPWIRE_LOG_PREFIX.length + 1)),
    ).toMatchObject({
      id: "tw-0001",
      area: "provider",
      code: "provider_status_unexpected",
      orgId: "org-1",
      factoryId: "factory-1",
      details: { status: 502 },
    });
  });

  it("carries the engine invariant in the details", async () => {
    const recorder = recorderOver();
    recorder.record(
      event({
        area: "engine",
        code: "engine_invariant",
        invariant: "tick_overlap",
        operationId: undefined,
        details: { overlapMs: 250 },
      }),
    );
    await recorder.flush();
    const [row] = await rows();
    expect(JSON.parse(row!.detailsJson)).toEqual({
      invariant: "tick_overlap",
      overlapMs: 250,
    });
  });

  it("accepts every code on the closed list", async () => {
    const recorder = recorderOver();
    for (const [area, codes] of Object.entries(TRIPWIRE_CODES)) {
      for (const code of codes) {
        clock += 120_000;
        recorder.record(
          event({
            area,
            code,
            invariant: area === "engine" ? "tick_overlap" : undefined,
          }),
        );
      }
    }
    await recorder.flush();
    const total = Object.values(TRIPWIRE_CODES).flat().length;
    expect(await rows()).toHaveLength(total);
    expect(failures).toEqual([]);
  });
});

describe("what never reaches storage", () => {
  it("keeps tokens, emails and long secrets out of the row and the log line", async () => {
    const recorder = recorderOver();
    recorder.record(
      event({
        workflowId: SLACK,
        runId: `run for ${EMAIL}`,
        nodeId: GITHUB,
        operationId: `op ${BASE64}`,
        details: {
          message: `Slack said ${SLACK} to ${EMAIL}`,
          cause: new Error(`Bearer ${BASE64} was rejected for ${EMAIL}`),
          response: {
            body: { secret: GITHUB, notes: [`mail ${EMAIL}`, HEX] },
            headers: { [SLACK]: HEX },
          },
          [GITHUB]: "named by a token",
          token: GITHUB,
        },
      }),
    );
    await recorder.flush();

    const stored = JSON.stringify(await rows());
    for (const secret of SECRETS) {
      expect(stored, secret).not.toContain(secret);
      expect(lines.join("\n"), secret).not.toContain(secret);
    }
    expect(failures).toEqual([]);
    const [row] = await rows();
    expect(JSON.parse(row!.detailsJson).droppedFields).toBeGreaterThan(0);
  });

  it("keeps a failure line free of what the failing call carried", async () => {
    const recorder = recorderOver({
      store: {
        ...store,
        insert: async () => {
          throw new Error(`insert failed for ${EMAIL} using ${SLACK}`);
        },
      },
    });
    recorder.record(event());
    await recorder.flush();
    expect(failures).toHaveLength(1);
    for (const secret of SECRETS) expect(failures[0]).not.toContain(secret);
  });

  it("holds details to 4 KB and says what it cut", async () => {
    const recorder = recorderOver();
    recorder.record(
      event({
        details: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [
            `field${index}`,
            "a plain sentence about what happened here. ".repeat(4),
          ]),
        ),
      }),
    );
    await recorder.flush();
    const [row] = await rows();
    expect(
      new TextEncoder().encode(row!.detailsJson).length,
    ).toBeLessThanOrEqual(4096);
    expect(JSON.parse(row!.detailsJson).droppedFields).toBeGreaterThan(0);
  });
});

describe("the closed list and the scope", () => {
  it.each([
    ["a code outside the list", { code: "provider_on_fire" }],
    ["a code from another area", { code: "merge_blocked" }],
    ["an unknown area", { area: "billing" }],
    ["an unknown severity", { severity: "fatal" }],
    [
      "an engine invariant that is not on the list",
      {
        area: "engine",
        code: "engine_invariant",
        invariant: "something_else",
      },
    ],
    [
      "an engine event with no invariant",
      {
        area: "engine",
        code: "engine_invariant",
      },
    ],
    [
      "a scope that is not valid",
      { scope: { orgId: "", factoryId: "factory-1" } },
    ],
    ["no scope at all", { scope: undefined }],
  ])("refuses %s, loudly, and writes nothing", async (_name, overrides) => {
    const recorder = recorderOver();
    expect(() => recorder.record(event(overrides))).not.toThrow();
    await recorder.flush();
    expect(await rows()).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.startsWith(TRIPWIRE_FAILED_PREFIX)).toBe(true);
  });

  it("never throws, whatever it is handed", () => {
    const recorder = recorderOver();
    for (const bad of [null, undefined, 7, "x", {}, { area: {} }]) {
      expect(() => recorder.record(bad as never)).not.toThrow();
    }
    expect(failures.length).toBe(6);
  });

  it("writes into the scope it was given and no other", async () => {
    const recorder = recorderOver();
    recorder.record(event({ scope: OTHER_FACTORY }));
    await recorder.flush();
    const all = await rows();
    expect(all.map((row) => [row.orgId, row.factoryId])).toEqual([
      ["org-1", "factory-2"],
    ]);
  });
});

describe("a recorder that cannot record", () => {
  it("logs the failure with the code and keeps the event in the function log", async () => {
    const recorder = recorderOver({
      store: {
        ...store,
        insert: async () => {
          throw new Error("connection refused");
        },
      },
    });
    expect(() => recorder.record(event())).not.toThrow();
    await recorder.flush();
    expect(failures).toEqual([
      `${TRIPWIRE_FAILED_PREFIX} provider_status_unexpected: connection refused`,
    ]);
    expect(lines).toHaveLength(1);
  });

  it("does not throw when the store throws before returning a promise", async () => {
    const recorder = recorderOver({
      store: {
        ...store,
        insert: () => {
          throw new Error("pool is closed");
        },
      },
    });
    expect(() => recorder.record(event())).not.toThrow();
    await recorder.flush();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("pool is closed");
  });

  it("keeps the event and reports a retention failure of its own", async () => {
    const recorder = recorderOver({
      store: {
        ...store,
        prune: async () => {
          throw new Error("delete timed out");
        },
      },
    });
    recorder.record(event());
    await recorder.flush();
    expect(await rows()).toHaveLength(1);
    expect(failures).toEqual([
      `${TRIPWIRE_FAILED_PREFIX} provider_status_unexpected (retention): delete timed out`,
    ]);
  });

  it("survives a logger that throws", () => {
    const recorder = recorderOver({
      logLine: () => {
        throw new Error("stdout closed");
      },
      logFailure: () => {
        throw new Error("stderr closed");
      },
    });
    expect(() => recorder.record(event())).not.toThrow();
  });
});

describe("retention", () => {
  async function seed(scope: TripwireScope, count: number, from = 0) {
    const batch: TripwireRow[] = Array.from({ length: count }, (_, index) => ({
      id: `${scope.factoryId}-seed-${String(from + index).padStart(5, "0")}`,
      orgId: scope.orgId,
      factoryId: scope.factoryId,
      workflowId: null,
      runId: null,
      nodeId: null,
      area: "provider",
      code: "provider_slow",
      severity: "info",
      detailsJson: "{}",
      createdAt: new Date(
        Date.parse("2026-10-01T00:00:00.000Z") + (from + index) * 1000,
      ).toISOString(),
    }));
    await db.insert(factoryTripwires).values(batch);
  }

  const count = async (scope: TripwireScope) =>
    (
      await db
        .select()
        .from(factoryTripwires)
        .where(eq(factoryTripwires.factoryId, scope.factoryId))
    ).length;

  it("deletes a small batch beyond the newest 500 of that factory after an insert", async () => {
    await seed(SCOPE, TRIPWIRE_KEEP_PER_FACTORY + 120);
    await seed(OTHER_FACTORY, 30);
    const recorder = recorderOver();
    recorder.record(event());
    await recorder.flush();

    expect(await count(SCOPE)).toBe(
      TRIPWIRE_KEEP_PER_FACTORY + 120 + 1 - TRIPWIRE_PRUNE_BATCH,
    );
    expect(await count(OTHER_FACTORY)).toBe(30);
  });

  it("converges on 500 and removes the oldest first", async () => {
    await seed(SCOPE, TRIPWIRE_KEEP_PER_FACTORY + 120);
    const deleted: number[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      deleted.push(await store.prune(SCOPE));
    }
    expect(deleted).toEqual([50, 50, 20, 0]);
    expect(await count(SCOPE)).toBe(TRIPWIRE_KEEP_PER_FACTORY);
    const remaining = await db
      .select({ id: factoryTripwires.id })
      .from(factoryTripwires)
      .orderBy(asc(factoryTripwires.id))
      .limit(1);
    expect(remaining[0]!.id).toBe("factory-1-seed-00120");
  });

  it("keeps what is under the cap", async () => {
    await seed(SCOPE, 40);
    expect(await store.prune(SCOPE)).toBe(0);
    expect(await count(SCOPE)).toBe(40);
  });
});

describe("repeats", () => {
  it("stores the first five a minute, logs the rest once, and counts them in the next window", async () => {
    const recorder = recorderOver();
    for (let index = 0; index < 8; index += 1) recorder.record(event());
    await recorder.flush();

    expect(await rows()).toHaveLength(TRIPWIRE_REPEAT_LIMIT);
    const suppressedLines = lines.filter((line) =>
      line.startsWith(TRIPWIRE_SUPPRESSED_PREFIX),
    );
    expect(suppressedLines).toHaveLength(1);

    // A different place is its own event.
    recorder.record(event({ nodeId: "other" }));
    clock += 61_000;
    recorder.record(event());
    await recorder.flush();

    const all = await rows();
    expect(all).toHaveLength(TRIPWIRE_REPEAT_LIMIT + 2);
    const last = all[all.length - 1]!;
    expect(JSON.parse(last.detailsJson).suppressed).toBe(3);
  });
});

describe("the platform's waitUntil", () => {
  it("is handed the write, so a response that returns first does not cut it off", async () => {
    const handed: Promise<unknown>[] = [];
    const recorder = recorderOver({
      waitUntil: () => (work) => void handed.push(work),
    });
    recorder.record(event());
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(await rows()).toHaveLength(1);
  });

  it("flush waits for a slow write", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = vi.fn(async (row: TripwireRow) => {
      await gate;
      await store.insert(row);
    });
    const recorder = recorderOver({ store: { ...store, insert: slow } });
    recorder.record(event());
    let flushed = false;
    const flushing = recorder.flush().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(await rows()).toHaveLength(1);
  });
});
