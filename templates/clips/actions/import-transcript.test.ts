import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

let client: PGliteClient;
let db: ReturnType<typeof drizzle>;
const mocks = vi.hoisted(() => ({
  dispatchPostFinalizeJob: vi.fn(async () => undefined),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("../server/db/index.js", async () => {
  const schema = await import("../server/db/schema.js");
  return { getDb: () => db, schema };
});
vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (message: string, options: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ role: "owner" })),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: mocks.dispatchPostFinalizeJob,
}));

import importTranscript from "./import-transcript";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:04.000
<v Sarah>This PR fixes three chart bugs.

00:00:04.000 --> 00:00:09.000
First, the axis labels overlapped.
`;

async function insertTranscript(row: {
  status: string;
  fullText?: string;
  segmentsJson?: string;
  source?: string | null;
}) {
  await client.query(
    `INSERT INTO recording_transcripts (recording_id, status, full_text, segments_json, source)
     VALUES ('rec_1', $1, $2, $3, $4)`,
    [row.status, row.fullText ?? "", row.segmentsJson ?? "[]", row.source],
  );
}

async function readTranscript() {
  const { rows } = await client.query(
    `SELECT status, full_text, segments_json, source, language FROM recording_transcripts WHERE recording_id = 'rec_1'`,
  );
  return rows[0] as
    | {
        status: string;
        full_text: string;
        segments_json: string;
        source: string | null;
        language: string;
      }
    | undefined;
}

async function currentImportId() {
  const { rows } = await client.query(
    "SELECT import_id FROM recording_transcripts WHERE recording_id = 'rec_1'",
  );
  return (rows[0] as { import_id: string | null }).import_id;
}

function run(args: {
  text: string;
  replace?: boolean;
  replaceImportId?: string | null;
  language?: string;
}) {
  return (importTranscript as any).run({
    recordingId: "rec_1",
    replace: false,
    ...args,
  });
}

beforeEach(async () => {
  client = await PGlite.create("memory://");
  db = drizzle(client);
  await client.query(`CREATE TABLE recordings (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, duration_ms INTEGER,
    title TEXT NOT NULL, title_source TEXT, description TEXT
  )`);
  await client.query(`CREATE TABLE recording_transcripts (
    recording_id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    language TEXT NOT NULL DEFAULT 'en',
    segments_json TEXT NOT NULL DEFAULT '[]',
    full_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    failure_reason TEXT, failure_code TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    source TEXT, import_id TEXT,
    created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
  )`);
  await client.query(
    `INSERT INTO recordings (id, status, duration_ms, title, title_source, description)
     VALUES ('rec_1', 'ready', 10000, 'PR 7419', 'manual', 'Chart fixes')`,
  );
  vi.clearAllMocks();
});

afterEach(async () => {
  await client.close();
});

describe("import-transcript", () => {
  it("stores the file's own timings over a pending transcript and labels it imported", async () => {
    await insertTranscript({ status: "pending" });

    const result = await run({ text: VTT });

    expect(result).toMatchObject({
      status: "ready",
      source: "imported",
      format: "vtt",
      segments: 2,
      replaced: false,
    });
    const row = await readTranscript();
    expect(row).toMatchObject({
      status: "ready",
      source: "imported",
      full_text:
        "This PR fixes three chart bugs. First, the axis labels overlapped.",
      language: "und",
    });
    expect(JSON.parse(row!.segments_json)).toEqual([
      {
        startMs: 0,
        endMs: 4000,
        text: "This PR fixes three chart bugs.",
        speaker: "Sarah",
      },
      {
        startMs: 4000,
        endMs: 9000,
        text: "First, the axis labels overlapped.",
      },
    ]);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.anything(),
    );
  });

  it("creates the transcript row when the recording has none yet", async () => {
    await run({ text: "0:00 Hello there.\n0:05 Bye." });

    expect(await readTranscript()).toMatchObject({
      status: "ready",
      source: "imported",
      full_text: "Hello there. Bye.",
    });
  });

  it("refuses to replace a ready transcript without replace, and leaves it alone", async () => {
    await insertTranscript({
      status: "ready",
      fullText: "Automatic words.",
      segmentsJson: JSON.stringify([
        { startMs: 0, endMs: 1000, text: "Automatic words." },
      ]),
    });

    await expect(run({ text: VTT })).rejects.toMatchObject({
      errorCode: "transcript_exists",
      statusCode: 409,
      details: { source: "automatic", importId: null },
    });
    expect(await readTranscript()).toMatchObject({
      full_text: "Automatic words.",
      source: null,
    });

    const result = await run({ text: VTT, replace: true });
    expect(result).toMatchObject({ replaced: true });
    expect(await readTranscript()).toMatchObject({ source: "imported" });
  });

  it("gives a re-import of the same file a new import id", async () => {
    await run({ text: VTT });
    const first = await currentImportId();
    await run({ text: VTT, replace: true, replaceImportId: first });
    const second = await currentImportId();

    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it("replaces only the import the user agreed to replace", async () => {
    await run({ text: "0:00 First import." });
    const agreedTo = await currentImportId();
    await run({
      text: "0:00 Newer import.",
      replace: true,
      replaceImportId: agreedTo,
    });
    const newer = await currentImportId();

    await expect(
      run({ text: VTT, replace: true, replaceImportId: agreedTo }),
    ).rejects.toMatchObject({
      errorCode: "transcript_exists",
      statusCode: 409,
      details: { source: "imported", importId: newer },
    });
    expect(await readTranscript()).toMatchObject({
      full_text: "Newer import.",
    });

    await run({ text: VTT, replace: true, replaceImportId: newer });
    expect(await readTranscript()).toMatchObject({
      full_text:
        "This PR fixes three chart bugs. First, the axis labels overlapped.",
    });
  });

  it("keeps an import that lands after the user agreed to replace an automatic transcript", async () => {
    await insertTranscript({ status: "ready", fullText: "Automatic words." });
    await run({ text: "0:00 Landed first.", replace: true });
    const landed = await currentImportId();

    await expect(
      run({ text: VTT, replace: true, replaceImportId: null }),
    ).rejects.toMatchObject({
      errorCode: "transcript_exists",
      details: { source: "imported", importId: landed },
    });
    expect(await readTranscript()).toMatchObject({
      full_text: "Landed first.",
    });
  });

  it("names the bad line and leaves the existing transcript untouched", async () => {
    await insertTranscript({
      status: "ready",
      fullText: "Keep me.",
      source: "imported",
    });

    await expect(
      run({
        text: "1\n00:00:01,000 --> 00:00:02,000\nok\n\n2\n00:00:05,000 --> later\nbad",
        replace: true,
      }),
    ).rejects.toMatchObject({
      message:
        "Line 6: the cue timing couldn't be read. Use 00:00:01.000 --> 00:00:04.000.",
      errorCode: "transcript_import_invalid",
      statusCode: 422,
      details: { reason: "bad-timing", line: 6, format: "srt" },
    });
    expect(await readTranscript()).toMatchObject({ full_text: "Keep me." });
  });

  it("stores the language argument, else the WebVTT Language header", async () => {
    await run({ text: VTT.replace("WEBVTT", "WEBVTT\nLanguage: pt-BR") });
    expect(await readTranscript()).toMatchObject({ language: "pt-BR" });

    await run({
      text: VTT,
      replace: true,
      replaceImportId: await currentImportId(),
      language: "es",
    });
    expect(await readTranscript()).toMatchObject({ language: "es" });
  });

  it("reports a saved import as saved when the refresh signal fails", async () => {
    mocks.writeAppState.mockRejectedValueOnce(new Error("state store down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await run({ text: VTT });

    expect(result).toMatchObject({ status: "ready", source: "imported" });
    expect(await readTranscript()).toMatchObject({ source: "imported" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("queues the transcript follow-up job for a ready recording", async () => {
    const result = await run({ text: VTT });

    expect(result).toMatchObject({ followUpQueued: true });
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec_1",
      kind: "transcript",
    });
  });

  it("leaves the follow-up to finalize while the recording is still processing", async () => {
    await client.query(
      `UPDATE recordings SET status = 'processing' WHERE id = 'rec_1'`,
    );

    const result = await run({ text: VTT });

    expect(result).toMatchObject({ followUpQueued: false });
    expect(mocks.dispatchPostFinalizeJob).not.toHaveBeenCalled();
  });
});
