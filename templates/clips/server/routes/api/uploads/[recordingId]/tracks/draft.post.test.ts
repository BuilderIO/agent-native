// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
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

import * as schema from "../../../../../db/schema.js";

type FakeEvent = {
  params: Record<string, string>;
  body: unknown;
  status: number;
};

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const mocks = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  rich: true,
  duringCheck: null as null | (() => Promise<void>),
  afterSave: null as null | (() => Promise<void>),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async (key: string) =>
    mocks.state.has(key) ? structuredClone(mocks.state.get(key)) : null,
  writeAppState: async (key: string, value: unknown) => {
    mocks.state.set(key, structuredClone(value));
  },
  compareAndSetAppState: async (
    key: string,
    expected: unknown,
    next: unknown,
  ) => {
    const current = mocks.state.has(key)
      ? JSON.stringify(mocks.state.get(key))
      : null;
    if (current !== (expected === null ? null : JSON.stringify(expected))) {
      return false;
    }
    if (next === null) {
      mocks.state.delete(key);
      return true;
    }
    mocks.state.set(key, structuredClone(next));
    const afterSave = mocks.afterSave;
    mocks.afterSave = null;
    await afterSave?.();
    return true;
  },
  deleteAppState: async (key: string) => mocks.state.delete(key),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (_context: unknown, fn: () => unknown) => fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (event: FakeEvent, name: string) => event.params[name],
  readBody: async (event: FakeEvent) => event.body,
  setResponseStatus: (event: FakeEvent, status: number) => {
    event.status = status;
  },
  createError: ({
    statusCode,
    message,
  }: {
    statusCode: number;
    message: string;
  }) => Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../../../../../db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../../../../../db/schema.js"),
}));

vi.mock("../../../../../lib/recording-media-cleanup.js", () => ({
  deleteStoredMediaUrl: vi.fn(),
}));
vi.mock("../../../../../lib/recording-media-lifecycle.js", () => ({
  withRecordingMediaProduction: vi.fn(),
}));
vi.mock("../../../../../lib/resumable-upload-cleanup.js", () => ({
  abortResumableUploadSession: vi.fn(),
}));
vi.mock("../../../../../lib/resumable-upload-provider.js", () => ({
  resolveResumableUploadProvider: vi.fn(),
}));
vi.mock("../../../../../lib/upload-recording-media.js", () => ({
  deleteRejectedHostedUpload: vi.fn(),
}));

vi.mock("../../../../../lib/recording-policy.js", () => ({
  snapshotRichRecordingPolicy: async () => {
    await mocks.duringCheck?.();
    return mocks.rich;
  },
}));

vi.mock("../../../../../lib/recordings.js", async () => {
  const { eq } = await import("drizzle-orm");
  return {
    getEventOwnerContext: async () => ({
      userEmail: "Owner@example.com",
      orgId: "org-1",
      authUserId: "user-1",
    }),
    ownerEmailMatches: (column: Parameters<typeof eq>[0], email: string) =>
      eq(column, email),
  };
});

import { RETRYABLE_UPLOAD_INTERRUPTION_REASON } from "../../../../../../shared/upload-interruption.js";
import { readRichDraft } from "../../../../../lib/recording-tracks.js";
import { handleTrackDraft } from "./draft.post";

function createTable(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const parts = ['"' + column.name + '" ' + column.getSQLType()];
    if (column.primary) parts.push("PRIMARY KEY");
    if (typeof column.default === "string")
      parts.push("DEFAULT '" + column.default.replace(/'/g, "''") + "'");
    else if (
      typeof column.default === "number" ||
      typeof column.default === "boolean"
    )
      parts.push("DEFAULT " + column.default);
    return parts.join(" ");
  });
  return 'CREATE TABLE "' + config.name + '" (' + columns.join(",") + ");";
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  status: "recovered",
  startedAt: "2026-11-26T15:00:00.000Z",
  durationMs: 9_000,
  writer: {
    surface: "extension",
    app: "Clips Chrome Extension",
    version: "0.1.24",
    os: "macOS",
  },
  clock: { host: "performance.now", pauses: [] },
  capture: { kind: "tab", displays: [] },
  compat: { offsetMs: 0, cursor: "in-pixels", camera: "none" },
  privacy: { keys: "none", pageInputs: "visible" },
  tracks: [
    {
      id: "page",
      startMs: 500,
      endMs: 9_000,
      complete: false,
      meta: {
        rrweb: "@rrweb/record@2.1.0",
        checkoutMs: 60_000,
        sync: [[1_700_000_000_000, 0]],
        notAField: "dropped",
      },
    },
  ],
  ...overrides,
});

async function send(input: unknown) {
  const event = { params: { recordingId: "rec-1" }, body: input, status: 200 };
  const result = await handleTrackDraft(event as never);
  return { status: event.status, body: result as Record<string, unknown> };
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await client.exec(createTable(schema.recordings));
});

beforeEach(async () => {
  mocks.state.clear();
  mocks.rich = true;
  mocks.duringCheck = null;
  mocks.afterSave = null;
  await client.exec("TRUNCATE recordings");
  await client.query(
    "INSERT INTO recordings (id, owner_email, status, storage_mode, edits_json, media_format, rich_bytes) VALUES ('rec-1', 'Owner@example.com', 'uploading', 'own', '{}', 'flat', 0)",
  );
});

afterAll(async () => {
  await client.close();
});

describe("POST /api/uploads/:recordingId/tracks/draft", () => {
  it("keeps the recorder's latest draft, with only the track fields Clips reads", async () => {
    await expect(send(draft())).resolves.toEqual({
      status: 200,
      body: { ok: true, recordingId: "rec-1" },
    });
    await send(draft({ durationMs: 12_000 }));

    const saved = await readRichDraft("rec-1");
    expect(saved).toMatchObject({ status: "recovered", durationMs: 12_000 });
    expect(saved?.tracks[0]?.meta).toEqual({
      rrweb: "@rrweb/record@2.1.0",
      checkoutMs: 60_000,
      sync: [[1_700_000_000_000, 0]],
    });
    expect([...mocks.state.keys()]).toEqual(["recording-rich-draft-rec-1"]);
  });

  it("never replaces a later draft of the same upload with an earlier one", async () => {
    await send(draft({ durationMs: 20_000 }));
    const late = await send(draft({ durationMs: 10_000 }));
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ staleDraft: true });
    expect(await readRichDraft("rec-1")).toMatchObject({ durationMs: 20_000 });

    await client.query("UPDATE recordings SET upload_generation_id='gen-2'");
    await expect(
      send(draft({ uploadGenerationId: "gen-2", durationMs: 1_000 })),
    ).resolves.toMatchObject({ status: 200 });
    expect(await readRichDraft("rec-1")).toMatchObject({ durationMs: 1_000 });
  });

  it("refuses a body that isn't a recovered finalize", async () => {
    const complete = await send(draft({ status: "complete" }));
    expect(complete.status).toBe(400);
    expect(complete.body.issues).toEqual([
      { path: "status", message: "A draft's status is recovered." },
    ]);
    expect((await send({ tracks: [] })).status).toBe(400);
    expect(mocks.state.size).toBe(0);
  });

  it("keeps no draft for a recording whose tracks are done, stopped or from another upload", async () => {
    await client.query("UPDATE recordings SET media_format='rich'");
    expect((await send(draft())).body).toMatchObject({
      tracksFinalized: true,
    });

    await client.query(
      "UPDATE recordings SET media_format='flat', upload_generation_id='gen-2'",
    );
    expect((await send(draft())).body).toMatchObject({ staleAttempt: true });
    expect(
      (await send(draft({ uploadGenerationId: "gen-2" }))).body,
    ).toMatchObject({ ok: true });
    mocks.state.clear();

    await client.query(
      "UPDATE recordings SET upload_generation_id=NULL, status='failed', failure_reason='Upload failed'",
    );
    expect((await send(draft())).body).toMatchObject({ tracksStopped: true });
    await client.query("UPDATE recordings SET failure_reason=$1", [
      RETRYABLE_UPLOAD_INTERRUPTION_REASON,
    ]);
    expect((await send(draft())).body).toMatchObject({ retryable: true });

    await client.query(
      "UPDATE recordings SET status='ready', failure_reason=NULL, edits_json=$1",
      [JSON.stringify({ burnedRedactions: [{ id: "redact-1" }] })],
    );
    expect((await send(draft())).body).toMatchObject({ tracksStopped: true });

    await client.query("UPDATE recordings SET edits_json='{}'");
    mocks.rich = false;
    const off = await send(draft());
    expect(off.status).toBe(403);
    expect(off.body).toMatchObject({ labDisabled: true });
    expect(mocks.state.size).toBe(0);
  });

  it("answers not found for a trashed or taken-down recording", async () => {
    await client.query("UPDATE recordings SET trashed_at='2026-11-26T15:00Z'");
    await expect(send(draft())).rejects.toMatchObject({ statusCode: 404 });
    await client.query(
      "UPDATE recordings SET trashed_at=NULL, failure_code='taken_down'",
    );
    await expect(send(draft())).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.state.size).toBe(0);
  });

  it("never replaces a draft a newer upload saved while this one was checked", async () => {
    const newer = { version: 1, body: draft({ uploadGenerationId: "gen-2" }) };
    mocks.duringCheck = async () => {
      mocks.duringCheck = null;
      await client.query("UPDATE recordings SET upload_generation_id='gen-2'");
      mocks.state.set("recording-rich-draft-rec-1", newer);
    };

    const stale = await send(draft());
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ staleAttempt: true });
    expect(mocks.state.get("recording-rich-draft-rec-1")).toEqual(newer);
  });

  it("takes its draft back when the recording was trashed or restarted as it was saved", async () => {
    mocks.afterSave = async () => {
      await client.query(
        "UPDATE recordings SET trashed_at='2026-11-26T15:00Z'",
      );
    };
    await expect(send(draft())).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.state.size).toBe(0);

    await client.query("UPDATE recordings SET trashed_at=NULL");
    mocks.afterSave = async () => {
      await client.query("UPDATE recordings SET upload_generation_id='gen-2'");
    };
    const restarted = await send(draft());
    expect(restarted.status).toBe(409);
    expect(restarted.body).toMatchObject({ staleAttempt: true });
    expect(mocks.state.size).toBe(0);
  });

  it("asks to be sent again when other drafts keep arriving while it is saved", async () => {
    let arrivals = 0;
    mocks.duringCheck = async () => {
      arrivals += 1;
      mocks.state.set("recording-rich-draft-rec-1", { version: 1, arrivals });
    };

    const busy = await send(draft());
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ retryable: true });
    expect(arrivals).toBe(3);
    expect(mocks.state.get("recording-rich-draft-rec-1")).toEqual({
      version: 1,
      arrivals: 3,
    });
  });
});
