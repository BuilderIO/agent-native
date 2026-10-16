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
  assertAccess: vi.fn(async () => ({ role: "owner" })),
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
  assertAccess: mocks.assertAccess,
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: mocks.dispatchPostFinalizeJob,
}));

import importTranscript from "./import-transcript";
import restoreTranscriptVersion from "./restore-transcript-version";

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

async function readVersions() {
  const { rows } = await client.query(
    `SELECT id, status, full_text, segments_json, source, import_id, language, reason, replaced_by
     FROM recording_transcript_versions WHERE recording_id = 'rec_1'
     ORDER BY created_at DESC, id DESC`,
  );
  return rows as Array<{
    id: string;
    status: string;
    full_text: string;
    segments_json: string;
    source: string | null;
    import_id: string | null;
    language: string;
    reason: string;
    replaced_by: string | null;
  }>;
}

async function readFullTranscript() {
  const { rows } = await client.query(
    `SELECT status, full_text, segments_json, source, import_id, language
     FROM recording_transcripts WHERE recording_id = 'rec_1'`,
  );
  return rows[0];
}

async function currentImportId() {
  const { rows } = await client.query(
    "SELECT import_id FROM recording_transcripts WHERE recording_id = 'rec_1'",
  );
  return (rows[0] as { import_id: string | null }).import_id;
}

function restore(versionId: string, recordingId = "rec_1") {
  return (restoreTranscriptVersion as any).run({ recordingId, versionId });
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
  await client.query(`CREATE TABLE recording_transcript_versions (
    id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, owner_email TEXT NOT NULL,
    language TEXT NOT NULL, segments_json TEXT NOT NULL, full_text TEXT NOT NULL,
    status TEXT NOT NULL, source TEXT, import_id TEXT, reason TEXT NOT NULL,
    replaced_by TEXT, created_at TEXT NOT NULL
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

  it("keeps the transcript it replaces as a version", async () => {
    const segmentsJson = JSON.stringify([
      { startMs: 0, endMs: 1000, text: "Automatic words.", speaker: "A" },
    ]);
    await insertTranscript({
      status: "ready",
      fullText: "Automatic words.",
      segmentsJson,
    });

    const result = await run({ text: VTT, replace: true });

    expect(result.savedVersionId).toEqual(expect.any(String));
    expect(await readVersions()).toEqual([
      {
        id: result.savedVersionId,
        status: "ready",
        full_text: "Automatic words.",
        segments_json: segmentsJson,
        source: null,
        import_id: null,
        language: "en",
        reason: "import",
        replaced_by: "owner@example.com",
      },
    ]);
  });

  it("keeps no version when it fills a transcript that was not ready", async () => {
    await insertTranscript({ status: "pending" });

    const result = await run({ text: VTT });

    expect(result).toMatchObject({ replaced: false, savedVersionId: null });
    expect(await readVersions()).toEqual([]);
  });

  it("keeps no version when a replace is refused", async () => {
    await insertTranscript({ status: "ready", fullText: "Automatic words." });

    await expect(run({ text: VTT })).rejects.toMatchObject({
      errorCode: "transcript_exists",
    });

    expect(await readVersions()).toEqual([]);
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

  it("is listed in the compact MCP catalog without switching Clips to the connector tier", () => {
    expect((importTranscript as any).mcpApp).toEqual({ compactCatalog: true });
    expect((importTranscript as any).mcpTool).toBeUndefined();
  });
});

describe("restore-transcript-version", () => {
  const automatic = {
    status: "ready",
    full_text: "Automatic words. And more words.",
    segments_json: JSON.stringify([
      { startMs: 0, endMs: 1200, text: "Automatic words.", speaker: "A" },
      { startMs: 1200, endMs: 2600, text: "And more words." },
    ]),
    source: null,
    import_id: null,
    language: "de",
  };

  beforeEach(async () => {
    await client.query(
      `INSERT INTO recording_transcripts (recording_id, status, full_text, segments_json, source, language)
       VALUES ('rec_1', $1, $2, $3, $4, $5)`,
      [
        automatic.status,
        automatic.full_text,
        automatic.segments_json,
        automatic.source,
        automatic.language,
      ],
    );
  });

  it("brings back exactly the transcript an import replaced", async () => {
    const imported = await run({ text: VTT, replace: true });
    const importedRow = await readFullTranscript();

    const result = await restore(imported.savedVersionId);

    expect(await readFullTranscript()).toEqual(automatic);
    expect(result).toMatchObject({
      status: "ready",
      source: null,
      language: "de",
      segments: 2,
      savedVersionId: expect.any(String),
    });
    // The restored version leaves the list and the import takes its place.
    const versions = await readVersions();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: result.savedVersionId,
      full_text: importedRow.full_text,
      segments_json: importedRow.segments_json,
      source: "imported",
      import_id: importedRow.import_id,
      reason: "restore",
    });
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "recording",
      "rec_1",
      "editor",
    );
    expect(mocks.writeAppState).toHaveBeenLastCalledWith(
      "refresh-signal",
      expect.anything(),
    );
    expect(mocks.dispatchPostFinalizeJob).toHaveBeenLastCalledWith({
      recordingId: "rec_1",
      kind: "transcript",
    });
  });

  it("can undo a restore by restoring the version it saved", async () => {
    const imported = await run({ text: VTT, replace: true });
    const importedRow = await readFullTranscript();
    const restored = await restore(imported.savedVersionId);

    const undone = await restore(restored.savedVersionId);

    expect(await readFullTranscript()).toEqual(importedRow);
    expect(undone).toMatchObject({ source: "imported", segments: 2 });
    const versions = await readVersions();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: undone.savedVersionId,
      full_text: automatic.full_text,
      segments_json: automatic.segments_json,
      language: "de",
    });
  });

  it("refuses a version already restored or saved for another recording", async () => {
    const imported = await run({ text: VTT, replace: true });
    await restore(imported.savedVersionId);
    const before = await readFullTranscript();

    await expect(restore(imported.savedVersionId)).rejects.toMatchObject({
      errorCode: "transcript_version_not_found",
      statusCode: 404,
    });
    await client.query(
      `INSERT INTO recordings (id, status, duration_ms, title) VALUES ('rec_2', 'ready', 1000, 'Other')`,
    );
    const [kept] = await readVersions();
    await expect(restore(kept.id, "rec_2")).rejects.toMatchObject({
      errorCode: "transcript_version_not_found",
    });
    expect(await readFullTranscript()).toEqual(before);
  });

  it("leaves the transcript alone for a caller without editor access", async () => {
    const imported = await run({ text: VTT, replace: true });
    const before = await readFullTranscript();
    mocks.assertAccess.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { statusCode: 403 }),
    );

    await expect(restore(imported.savedVersionId)).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(await readFullTranscript()).toEqual(before);
    expect(await readVersions()).toHaveLength(1);
  });

  it("keeps the ten most recently replaced transcripts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 1; i <= 11; i++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 16, 12, 0, i)));
        await run({
          text: `0:00 Import ${i}.`,
          replace: true,
          replaceImportId: i === 1 ? null : await currentImportId(),
        });
      }
    } finally {
      vi.useRealTimers();
    }

    const versions = await readVersions();
    expect(versions.map((v) => v.full_text)).toEqual([
      "Import 10.",
      "Import 9.",
      "Import 8.",
      "Import 7.",
      "Import 6.",
      "Import 5.",
      "Import 4.",
      "Import 3.",
      "Import 2.",
      "Import 1.",
    ]);
  });

  it("is listed in the compact MCP catalog", () => {
    expect((restoreTranscriptVersion as any).mcpApp).toEqual({
      compactCatalog: true,
    });
  });
});
