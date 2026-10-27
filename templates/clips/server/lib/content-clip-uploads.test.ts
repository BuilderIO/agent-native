import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { mockEvent } from "h3";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const CLIPS_URL = "https://clips.example.test";
const CONTENT_APP = "https://content.example.test";
const PEER_SECRET = "content-clips-peer-secret-0123456789abcdef";

const state = vi.hoisted(() => {
  vi.stubEnv("APP_URL", "https://clips.example.test");
  vi.stubEnv("A2A_SECRET", "content-clips-test-secret-0123456789abcdef");
  vi.stubEnv(
    "CONTENT_CLIPS_PEER_SECRET",
    "content-clips-peer-secret-0123456789abcdef",
  );
  vi.stubEnv(
    "OAUTH_STATE_SECRET",
    "content-clips-grant-secret-0123456789abcdef",
  );
  return {
    db: null as any,
    storageStatus: {} as Record<string, unknown>,
    created: [] as Array<{ args: any; context: any; caller: any }>,
    chunks: [] as Array<{ owner: unknown }>,
    aborts: [] as Array<Record<string, any>>,
    // Finalization winning the race: the abort finds the file complete.
    finalizedFirst: null as null | {
      status: "processing" | "ready";
      answer: Record<string, unknown>;
      httpStatus?: number;
    },
    // Runs once just before the next read of a final chunk's claim: the
    // final chunk finishing between a reader's reads.
    beforeClaimRead: null as null | (() => Promise<void>),
    // Runs once just after the next read of where an upload stands: another
    // request landing between a repeated start's read and what it does next.
    afterPhaseRead: null as null | (() => Promise<void>),
    // Runs once inside the next storage check: another request landing
    // between an upload start's key lookup and its binding.
    duringStorageCheck: null as null | (() => Promise<void>),
    // Runs once before create-recording makes its row: another request
    // landing between an upload start's binding and its recording.
    duringCreate: null as null | (() => Promise<void>),
    // The storage the next recording is made in.
    rowStorageMode: null as null | "hosted",
    // Runs inside the chunk route while it takes a final chunk.
    duringFinalChunk: null as null | (() => Promise<void>),
    // What the chunk route makes of a final chunk: finalization finishing the
    // recording, parking it until storage is connected, or the chunk failing
    // with the recording still uploading.
    finalChunkOutcome: null as null | "finish" | "park" | "fail",
    // Runs once just before the lease reaper fails the expired uploads it
    // found: a request landing between the reaper's read and its update.
    beforeReaperFails: null as null | (() => Promise<void>),
    // Clips' own abort instead of the stand-in below.
    realAbort: false,
    released: [] as string[],
  };
});

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => state.db,
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@agent-native/core/application-state")
    >();
  return {
    ...real,
    readAppState: async (key: string) => {
      if (key.startsWith("recording-upload-final-chunk-")) {
        const before = state.beforeClaimRead;
        state.beforeClaimRead = null;
        await before?.();
      }
      return real.readAppState(key);
    },
  };
});
vi.mock("./final-chunk-claim.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./final-chunk-claim.js")>();
  return {
    ...real,
    readUploadPhase: async (
      ...args: Parameters<typeof real.readUploadPhase>
    ) => {
      const standing = await real.readUploadPhase(...args);
      const after = state.afterPhaseRead;
      state.afterPhaseRead = null;
      await after?.();
      return standing;
    },
  };
});
// create-recording's own storage, analytics and upload-session work is its
// contract, tested with it; here it makes the row as the caller it ran as.
vi.mock("../../actions/create-recording.js", () => ({
  default: {
    run: async (args: any, caller: any) => {
      const { getRequestContext } = await import("@agent-native/core/server");
      const { schema } = await import("../db/index.js");
      const context = getRequestContext();
      state.created.push({ args, context, caller });
      const during = state.duringCreate;
      state.duringCreate = null;
      await during?.();
      await state.db.insert(schema.recordings).values({
        id: args.id,
        organizationId: context?.orgId,
        ownerEmail: context?.userEmail,
        visibility: args.visibility,
        title: args.title,
        storageMode: state.rowStorageMode,
        status: "uploading",
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
      });
      return { id: args.id, status: "uploading" };
    },
  },
}));
vi.mock("../routes/api/uploads/[recordingId]/chunk.post.js", () => ({
  handleRecordingChunk: async (event: any, owner: any) => {
    state.chunks.push({ owner });
    if (event.url.searchParams.get("isFinal") !== "1") return { ok: true };
    const during = state.duringFinalChunk;
    state.duringFinalChunk = null;
    await during?.();
    if (state.finalChunkOutcome === "fail") {
      const { setResponseStatus } = await import("h3");
      setResponseStatus(event, 502);
      return { ok: false, error: "Chunk upload failed (502)" };
    }
    if (state.finalChunkOutcome === "park") {
      await client.query(
        "UPDATE recordings SET failure_reason = 'Connect storage to finish this upload.' WHERE id = $1",
        [owner.recordingId],
      );
      const { setResponseStatus } = await import("h3");
      setResponseStatus(event, 202);
      return {
        ok: true,
        finalized: false,
        waitingForStorage: true,
        status: "waiting_storage",
      };
    }
    if (state.finalChunkOutcome === "finish") {
      await client.query(
        "UPDATE recordings SET status = 'ready' WHERE id = $1 AND status = 'uploading'",
        [owner.recordingId],
      );
      return { ok: true, finalized: true, status: "ready" };
    }
    return { ok: true };
  },
}));
// Clips' own abort is tested with it; here it fails the row as it would,
// unless a test runs the abort itself.
vi.mock(
  "../routes/api/uploads/[recordingId]/abort.post.js",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("../routes/api/uploads/[recordingId]/abort.post.js")
      >();
    return {
      handleAbortRecordingUpload: async (_event: unknown, override: any) => {
        if (state.realAbort) {
          state.aborts.push(override);
          return real.handleAbortRecordingUpload(_event as never, override);
        }
        return fakeAbort(_event, override);
      },
    };
  },
);
async function fakeAbort(_event: unknown, override: any) {
  const { schema } = await import("../db/index.js");
  const { eq } = await import("drizzle-orm");
  state.aborts.push(override);
  if (state.finalizedFirst) {
    await state.db
      .update(schema.recordings)
      .set({ status: state.finalizedFirst.status })
      .where(eq(schema.recordings.id, override.recordingId));
    if (state.finalizedFirst.httpStatus) {
      const { setResponseStatus } = await import("h3");
      setResponseStatus(_event as any, state.finalizedFirst.httpStatus);
    }
    return state.finalizedFirst.answer;
  }
  await state.db
    .update(schema.recordings)
    .set({ status: "failed", failureCode: override.body?.failureCode })
    .where(eq(schema.recordings.id, override.recordingId));
  return { ok: true, recordingId: override.recordingId, chunksCleared: 0 };
}
vi.mock("./video-storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./video-storage.js")>()),
  getClipsVideoStorageStatus: async () => {
    const during = state.duringStorageCheck;
    state.duringStorageCheck = null;
    await during?.();
    return state.storageStatus;
  },
  releaseHostedClipRecording: async ({
    recordingId,
  }: {
    recordingId: string;
  }) => {
    state.released.push(recordingId);
    return { ok: true };
  },
}));

const coreRequire = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = coreRequire("@electric-sql/pglite");
const jose = await import(pathToFileURL(coreRequire.resolve("jose")).href);

const { organizations, orgMembers } = await import("@agent-native/core/org");
const { withDbExec } = await import("@agent-native/core/db");
const { schema } = await import("../db/index.js");
const { CONTENT_CLIP_SCOPES: SCOPES, CONTENT_CLIP_PUBLIC_READER } =
  await import("../../shared/content-clip-contract.js");
const { contentClipStorageFor, pairedContentOrigin } =
  await import("./content-clip-uploads.js");
const { contentPageUrls } = await import("./content-uploads.js");
const { default: uploadStartRoute } =
  await import("../routes/api/content-clips/uploads.post.js");
const { default: uploadStatusRoute } =
  await import("../routes/api/content-clips/upload-status.get.js");
const { default: contentChunkRoute } =
  await import("../routes/api/uploads/[recordingId]/content-chunk.post.js");
const { default: contentCancelRoute } =
  await import("../routes/api/uploads/[recordingId]/content-cancel.post.js");
const { default: agentChunkRoute } =
  await import("../routes/api/uploads/[recordingId]/agent-chunk.post.js");
const { default: authMiddleware } = await import("../middleware/auth.js");
const { default: playbackRoute } =
  await import("../routes/api/content-clips/[recordingId]/playback.get.js");
const { createRecordingUploadTicket } =
  await import("./recording-upload-ticket.js");
const { runWithRequestContext } = await import("@agent-native/core/server");
const { writeAppState } = await import("@agent-native/core/application-state");
const { reapExpiredUploads } = await import("./upload-lease.js");
const { default: listRecordings } =
  await import("../../actions/list-recordings.js");

const EDITOR = "editor@content.example.test";
const STRANGER = "no-clips-account@content.example.test";

let client: Awaited<ReturnType<typeof PGlite.create>>;

function createTableSql(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => {
    const parts = [`"${column.name}" ${column.getSQLType()}`];
    if (column.primary) parts.push("PRIMARY KEY");
    const fallback = column.default;
    if (typeof fallback === "string") {
      parts.push(`DEFAULT '${fallback.replace(/'/g, "''")}'`);
    } else if (typeof fallback === "number" || typeof fallback === "boolean") {
      parts.push(`DEFAULT ${fallback}`);
    }
    return parts.join(" ");
  });
  const uniqueIndexes = config.indexes
    .filter((index) => index.config.unique)
    .map(
      (index) =>
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index.config.name}" ON "${config.name}" (${index.config.columns
          .map((column) => `"${(column as { name: string }).name}"`)
          .join(", ")});`,
    );
  return [
    `CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(", ")});`,
    ...uniqueIndexes,
  ].join("\n");
}

function execOn(target: Pick<typeof client, "query">) {
  return {
    async execute(statement: string | { sql: string; args?: unknown[] }) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      if (/^\s*UPDATE recordings\s+SET status = 'failed'/.test(query.sql)) {
        const before = state.beforeReaperFails;
        state.beforeReaperFails = null;
        await before?.();
      }
      let param = 0;
      const result = await target.query(
        query.sql.replace(/\?/g, () => `$${++param}`),
        query.args ?? [],
      );
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  };
}

/** Core reads through its own handle; point it at this test's database. */
function coreDb() {
  return {
    ...execOn(client),
    transaction: <T>(run: (tx: ReturnType<typeof execOn>) => Promise<T>) =>
      client.transaction((tx: Pick<typeof client, "query">) => run(execOn(tx))),
  };
}

let editors = 0;

/**
 * A new editor with a Clips account in a workspace of their own. Core caches
 * memberships per email, so no editor carries over into another test.
 */
async function clipsEditor(): Promise<string> {
  const email = `editor-${++editors}@content.example.test`;
  const orgId = `org-${editors}`;
  await state.db.insert(organizations).values({
    id: orgId,
    name: orgId,
    createdBy: email,
    createdAt: 1,
  });
  await state.db.insert(orgMembers).values({
    id: `member-${orgId}`,
    orgId,
    email,
    role: "owner",
    joinedAt: 1,
  });
  await client.query(
    `INSERT INTO "user" (id, email, email_verified) VALUES ($1, $2, true)`,
    [`user-${editors}`, email],
  );
  return email;
}

interface TokenInput {
  scope?: string;
  sub?: string;
  documentId?: string;
  recordingId?: string;
  audience?: string;
  issuer?: string;
  secret?: string;
  extra?: Record<string, unknown>;
}

async function token(input: TokenInput = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    scope: input.scope ?? SCOPES.upload,
    document_id: input.documentId ?? "doc-1",
    ...(input.recordingId ? { recording_id: input.recordingId } : {}),
    sub: input.sub ?? EDITOR,
    ...input.extra,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setIssuer(input.issuer ?? CONTENT_APP)
    .setAudience(input.audience ?? `${CLIPS_URL}/content-clips`)
    .sign(new TextEncoder().encode(input.secret ?? PEER_SECRET));
}

async function respond(handler: (event: any) => unknown, event: any) {
  const result = await withDbExec(coreDb(), () => handler(event));
  if (result instanceof Response) {
    return {
      status: result.status,
      body: await result.clone().json(),
      headers: result.headers,
    };
  }
  return {
    status: event.res.status ?? 200,
    body: result as any,
    headers: event.res.headers as Headers,
  };
}

const START = {
  fileName: "Quarterly demo.mp4",
  sizeBytes: 5 * 1024 * 1024,
  mimeType: "video/mp4",
  blockId: "block-video-1",
};

let uploadKeys = 0;

/** A start for a newly picked file, unless the body names the pick's key. */
function startUpload(bearer: string, body: unknown = START) {
  if (typeof body === "object" && body !== null && !("uploadKey" in body)) {
    body = {
      ...body,
      uploadKey: `picked-file-${String(++uploadKeys).padStart(8, "0")}`,
    };
  }
  return respond(
    uploadStartRoute,
    mockEvent(`${CLIPS_URL}/api/content-clips/uploads`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function uploadStatus(bearer: string) {
  return respond(
    uploadStatusRoute,
    mockEvent(`${CLIPS_URL}/api/content-clips/upload-status`, {
      headers: { authorization: `Bearer ${bearer}` },
    }),
  );
}

function postChunk(
  url: string,
  options: { origin?: string; guardHeaders?: Record<string, string> } = {},
) {
  const event = mockEvent(url, {
    method: "POST",
    headers: options.origin ? { origin: options.origin } : {},
    body: Buffer.from("fake video bytes for one chunk"),
  });
  event.context.params = {
    recordingId: decodeURIComponent(
      /\/api\/uploads\/([^/]+)\//.exec(new URL(url).pathname)?.[1] ?? "",
    ),
  };
  // What the auth guard sets on every request with an Origin it knows.
  for (const [name, value] of Object.entries(options.guardHeaders ?? {})) {
    event.res.headers.set(name, value);
  }
  return respond(contentChunkRoute, event);
}

function postCancel(url: string, origin?: string) {
  const event = mockEvent(url, {
    method: "POST",
    headers: origin ? { origin } : {},
  });
  event.context.params = {
    recordingId: decodeURIComponent(
      /\/api\/uploads\/([^/]+)\//.exec(new URL(url).pathname)?.[1] ?? "",
    ),
  };
  return respond(contentCancelRoute, event);
}

async function rows(table: string) {
  return (await client.query(`SELECT * FROM ${table}`)).rows as any[];
}

/** Application state as the editor's own requests read and write it. */
async function asEditor<T>(editor: string, run: () => Promise<T>): Promise<T> {
  return await withDbExec(coreDb(), () =>
    runWithRequestContext({ userEmail: editor }, run),
  );
}

beforeEach(async () => {
  client = await PGlite.create("memory://");
  state.db = drizzle(client);
  // A local development Clips: chunks are buffered in SQL.
  state.storageStatus = {
    mode: "none",
    configured: false,
    activeProvider: null,
    localSqlChunkScratchAvailable: true,
    hostedRemaining: 0,
    hostedLimit: 0,
    maxClipBytes: 250 * 1024 * 1024,
    denyReason: "disabled",
  };
  state.created = [];
  state.chunks = [];
  state.aborts = [];
  state.finalizedFirst = null;
  state.beforeClaimRead = null;
  state.afterPhaseRead = null;
  state.duringStorageCheck = null;
  state.duringCreate = null;
  state.rowStorageMode = null;
  state.duringFinalChunk = null;
  state.finalChunkOutcome = null;
  state.realAbort = false;
  state.beforeReaperFails = null;
  state.released = [];
  for (const table of [
    schema.recordings,
    schema.recordingShares,
    schema.recordingContentBindings,
    schema.recordingContextItems,
    schema.recordingViewers,
    schema.recordingViews,
    schema.recordingAgentViews,
    schema.recordingTags,
    schema.recordingTranscripts,
    schema.meetings,
    schema.hostedClipAllowances,
    organizations,
    orgMembers,
  ]) {
    await client.exec(createTableSql(table as PgTable));
  }
  await client.exec(`
    ALTER TABLE organizations
      ADD COLUMN a2a_member_delegation_enabled BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
    );
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, email_verified BOOLEAN
    );
  `);
});

afterEach(async () => {
  await client.close();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("an editor's upload from a Content page", () => {
  it("makes one private recording owned by the editor, bound to the page as an upload", async () => {
    const editor = await clipsEditor();
    const result = await startUpload(await token({ sub: editor }));

    expect(result.status).toBe(200);
    const [recording] = await rows("recordings");
    expect(await rows("recordings")).toHaveLength(1);
    expect(recording).toMatchObject({
      id: result.body.recordingId,
      owner_email: editor,
      visibility: "private",
      status: "uploading",
      title: "Quarterly demo",
    });
    expect(state.created).toEqual([
      expect.objectContaining({
        args: expect.objectContaining({
          id: result.body.recordingId,
          visibility: "private",
          mimeType: "video/mp4",
          sizeBytes: START.sizeBytes,
          recordingSource: "file_upload",
        }),
        context: expect.objectContaining({
          userEmail: editor,
          orgId: state.created[0]?.caller.orgId,
          authUserId: expect.stringMatching(/^user-/),
        }),
      }),
    ]);
    expect(state.created[0]?.caller.orgId).toMatch(/^org-/);
    expect(await rows("recording_shares")).toEqual([]);
    expect(await rows("recording_content_bindings")).toEqual([
      expect.objectContaining({
        recording_id: result.body.recordingId,
        content_app: CONTENT_APP,
        document_id: "doc-1",
        block_id: "block-video-1",
        origin: "upload",
        state: "active",
        created_by: editor,
      }),
    ]);
  });

  it("returns a chunk URL on Clips whose ticket is the only authority, and no headers to send", async () => {
    const editor = await clipsEditor();
    const result = await startUpload(await token({ sub: editor }));

    const chunkUrl = new URL(result.body.chunkUrl);
    expect(chunkUrl.origin).toBe(CLIPS_URL);
    expect(chunkUrl.pathname).toBe(
      `/api/uploads/${result.body.recordingId}/content-chunk`,
    );
    expect(chunkUrl.searchParams.get("ticket")).toMatch(/^clipsup_/);
    expect(chunkUrl.searchParams.get("mimeType")).toBe("video/mp4");
    const cancelUrl = new URL(result.body.cancelUrl);
    expect(cancelUrl.origin).toBe(CLIPS_URL);
    expect(cancelUrl.pathname).toBe(
      `/api/uploads/${result.body.recordingId}/content-cancel`,
    );
    expect([...cancelUrl.searchParams.keys()]).toEqual(["ticket"]);
    expect(cancelUrl.searchParams.get("ticket")).toBe(
      chunkUrl.searchParams.get("ticket"),
    );
    expect(result.body).toMatchObject({
      totalChunks: 2,
      chunkSizeBytes: expect.any(Number),
    });
    expect(result.body).not.toHaveProperty("headers");
    expect(Date.parse(result.body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("lets the page's readers watch the upload but not its other pages", async () => {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }));
    const playback = async (documentId: string) => {
      const bearer = await token({
        scope: SCOPES.read,
        sub: "reader@content.example.test",
        documentId,
        recordingId: body.recordingId,
      });
      const event = mockEvent(
        `${CLIPS_URL}/api/content-clips/${body.recordingId}/playback`,
        { headers: { authorization: `Bearer ${bearer}` } },
      );
      event.context.params = { recordingId: body.recordingId };
      return respond(playbackRoute, event);
    };

    const onPage = await playback("doc-1");
    expect(onPage.status).toBe(200);
    expect(onPage.body.recording.status).toBe("uploading");
    expect((await playback("doc-2")).status).toBe(404);
  });

  it("refuses any token that isn't an editor's upload token", async () => {
    const editor = await clipsEditor();
    for (const bearer of [
      await token({ sub: editor, scope: SCOPES.read }),
      await token({ sub: editor, scope: SCOPES.comment }),
      await token({ sub: editor, recordingId: "rec-1" }),
      await token({ sub: CONTENT_CLIP_PUBLIC_READER }),
      await token({ sub: editor, secret: "another-secret-0123456789abcdefgh" }),
      await token({ sub: editor, audience: `${CLIPS_URL}/other` }),
    ]) {
      expect((await startUpload(bearer)).status).toBe(401);
      expect((await uploadStatus(bearer)).status).toBe(401);
    }
    expect(await rows("recordings")).toEqual([]);
    expect(await rows("recording_content_bindings")).toEqual([]);
  });

  it("never opens a Clip for playback with an upload token", async () => {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }));
    const event = mockEvent(
      `${CLIPS_URL}/api/content-clips/${body.recordingId}/playback`,
      {
        headers: {
          authorization: `Bearer ${await token({
            sub: editor,
            recordingId: body.recordingId,
          })}`,
        },
      },
    );
    event.context.params = { recordingId: body.recordingId };
    expect((await respond(playbackRoute, event)).status).toBe(401);
  });

  it("refuses a file that isn't a video Clips takes", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    for (const body of [
      { ...START, mimeType: "image/png" },
      { ...START, sizeBytes: 0 },
      { ...START, blockId: "has spaces" },
      { ...START, extra: true },
      { ...START, uploadKey: "short" },
      "{not json",
    ]) {
      expect((await startUpload(bearer, body)).status).toBe(400);
    }
    expect(
      (await startUpload(bearer, { ...START, fileName: "a".repeat(20_000) }))
        .status,
    ).toBe(413);
    expect(await rows("recordings")).toEqual([]);
  });

  it("says an email with no Clips account needs one, and writes nothing", async () => {
    const bearer = await token({ sub: STRANGER });

    expect((await uploadStatus(bearer)).body).toEqual({
      storage: { state: "account_required" },
    });
    const result = await startUpload(bearer);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      code: "storage_required",
      storage: { state: "account_required" },
    });
    expect(await rows("recordings")).toEqual([]);
    expect(await rows("recording_content_bindings")).toEqual([]);
    expect(await rows("organizations")).toEqual([]);
  });

  it("says an account with no workspace yet needs one, without making one", async () => {
    await client.query(
      `INSERT INTO "user" (id, email, email_verified) VALUES ('user-new', $1, true)`,
      [STRANGER],
    );
    const result = await uploadStatus(await token({ sub: STRANGER }));
    expect(result.body).toEqual({ storage: { state: "account_required" } });
    expect(await rows("organizations")).toEqual([]);
    expect(await rows("org_members")).toEqual([]);
  });

  it("refuses the upload with the storage state when the free clips are used up", async () => {
    const editor = await clipsEditor();
    state.storageStatus = {
      mode: "none",
      configured: false,
      activeProvider: null,
      localSqlChunkScratchAvailable: false,
      hostedRemaining: 0,
      hostedLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      denyReason: "exhausted",
    };
    const bearer = await token({ sub: editor });

    expect((await uploadStatus(bearer)).body).toEqual({
      storage: { state: "used_up", limit: 3 },
    });
    const result = await startUpload(bearer);
    expect(result.status).toBe(409);
    expect(result.body.storage).toEqual({ state: "used_up", limit: 3 });
    expect(await rows("recordings")).toEqual([]);
    expect(await rows("recording_content_bindings")).toEqual([]);
  });

  it("refuses a file larger than the free storage takes, before anything is made", async () => {
    const editor = await clipsEditor();
    state.storageStatus = {
      mode: "hosted",
      configured: true,
      activeProvider: null,
      localSqlChunkScratchAvailable: false,
      hostedRemaining: 2,
      hostedLimit: 3,
      maxClipBytes: 1024 * 1024,
    };
    const result = await startUpload(await token({ sub: editor }));
    expect(result.status).toBe(413);
    expect(result.body).toMatchObject({
      code: "upload_too_large",
      maxBytes: 1024 * 1024,
    });
    expect(await rows("recordings")).toEqual([]);
  });
});

describe("a start Content repeats for one picked file", () => {
  const KEY = "picked-file-repeated";

  async function startTwice(
    again: Record<string, unknown> = {},
    between?: () => Promise<unknown>,
  ) {
    const editor = await clipsEditor();
    const first = await startUpload(await token({ sub: editor }), {
      ...START,
      uploadKey: KEY,
    });
    await between?.();
    const repeat = await startUpload(await token({ sub: editor }), {
      ...START,
      uploadKey: KEY,
      ...again,
    });
    return { editor, first, repeat };
  }

  it("answers with the same recording, the first start's plan and a ticket of its own, and makes and binds nothing more", async () => {
    const { first, repeat } = await startTwice();

    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({
      recordingId: first.body.recordingId,
      totalChunks: first.body.totalChunks,
      chunkSizeBytes: first.body.chunkSizeBytes,
    });
    const plan = (url: string) => {
      const query = new URL(url).searchParams;
      query.delete("ticket");
      return query.toString();
    };
    expect(plan(repeat.body.chunkUrl)).toBe(plan(first.body.chunkUrl));
    expect(state.created).toHaveLength(1);
    expect(await rows("recordings")).toHaveLength(1);
    expect(await rows("recording_content_bindings")).toEqual([
      expect.objectContaining({
        recording_id: first.body.recordingId,
        upload_key: KEY,
      }),
    ]);
    // The earlier answer still uploads: a page may be acting on either.
    const paired = pairedContentOrigin()!;
    const chunk = (url: string) =>
      postChunk(`${url}&index=0&isFinal=0`, { origin: paired });
    expect((await chunk(repeat.body.chunkUrl)).status).toBe(200);
    expect((await chunk(first.body.chunkUrl)).status).toBe(200);
  });

  it("gives two overlapping repeats tickets that both upload and cancel", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    const first = await startUpload(bearer, { ...START, uploadKey: KEY });
    const repeats = await Promise.all([
      startUpload(bearer, { ...START, uploadKey: KEY }),
      startUpload(bearer, { ...START, uploadKey: KEY }),
    ]);

    const paired = pairedContentOrigin()!;
    for (const repeat of repeats) {
      expect(repeat.status).toBe(200);
      expect(repeat.body.recordingId).toBe(first.body.recordingId);
      const chunk = await postChunk(
        `${repeat.body.chunkUrl}&index=0&isFinal=0`,
        { origin: paired },
      );
      expect(chunk.status).toBe(200);
    }
    for (const repeat of repeats) {
      expect(await postCancel(repeat.body.cancelUrl, paired)).toMatchObject({
        status: 200,
        body: { outcome: "cancelled", recordingId: first.body.recordingId },
      });
    }
  });

  it("keeps a recording's four latest tickets live, retiring older ones", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    const answers = [await startUpload(bearer, { ...START, uploadKey: KEY })];
    for (let repeat = 0; repeat < 4; repeat += 1) {
      answers.push(await startUpload(bearer, { ...START, uploadKey: KEY }));
    }

    const paired = pairedContentOrigin()!;
    const statuses: number[] = [];
    for (const answer of answers) {
      const chunk = await postChunk(
        `${answer.body.chunkUrl}&index=0&isFinal=0`,
        { origin: paired },
      );
      statuses.push(chunk.status);
    }
    expect(statuses).toEqual([401, 200, 200, 200, 200]);
    const [ticketRow] = await rows("settings");
    expect(Object.keys(JSON.parse(ticketRow.value).tickets)).toEqual([
      answers[0].body.recordingId,
    ]);
  });

  it.each([
    ["size", { sizeBytes: START.sizeBytes + 1 }],
    ["type", { mimeType: "video/webm" }],
  ])(
    "refuses a repeat for a file of another %s, and changes nothing",
    async (_what, again) => {
      let before: unknown;
      const { first, repeat } = await startTwice(again, async () => {
        before = {
          recordings: await rows("recordings"),
          bindings: await rows("recording_content_bindings"),
          tickets: await rows("settings"),
        };
      });

      expect(repeat.status).toBe(409);
      expect(repeat.body).toEqual({
        error: "upload_key_used",
        code: "upload_key_used",
      });
      expect({
        recordings: await rows("recordings"),
        bindings: await rows("recording_content_bindings"),
        tickets: await rows("settings"),
      }).toEqual(before);
      const chunk = await postChunk(
        `${first.body.chunkUrl}&index=0&isFinal=0`,
        { origin: pairedContentOrigin()! },
      );
      expect(chunk.status).toBe(200);
    },
  );

  it("asks a repeat that lands before the first start's recording exists to try again", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    let early: Awaited<ReturnType<typeof startUpload>> | undefined;
    state.duringCreate = async () => {
      early = await startUpload(bearer, { ...START, uploadKey: KEY });
    };
    const first = await startUpload(bearer, { ...START, uploadKey: KEY });

    expect(early).toMatchObject({
      status: 409,
      body: { error: "upload_starting", code: "upload_starting" },
    });
    expect(first.status).toBe(200);
    expect(state.created).toHaveLength(1);
    const again = await startUpload(bearer, { ...START, uploadKey: KEY });
    expect(again.status).toBe(200);
    expect(again.body.recordingId).toBe(first.body.recordingId);
  });

  /** create-recording failing as it does when it can't say what it left. */
  async function failCreate(failure: "unconfirmed" | "confirmed" | "untyped") {
    if (failure === "untyped") throw new Error("connection reset");
    const { fail } = await import("@agent-native/core/action");
    const cleanupConfirmed = failure === "confirmed";
    fail("Recording could not be created. Refresh and try again.", {
      errorCode: "recording_create_failed",
      statusCode: 503,
      details: { retryable: cleanupConfirmed, cleanupConfirmed },
    });
  }

  async function failedStart(failure: "unconfirmed" | "confirmed" | "untyped") {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    state.duringCreate = () => failCreate(failure);
    await expect(
      startUpload(bearer, { ...START, uploadKey: KEY }),
    ).rejects.toThrow();
    return { editor, bearer };
  }

  it("makes the next start of a file the same recording when its first start couldn't say it left nothing, so one free clip is held", async () => {
    const { bearer } = await failedStart("unconfirmed");
    const [kept] = await rows("recording_content_bindings");
    expect(kept).toMatchObject({ upload_key: KEY });
    expect(kept.upload_start_failed_at).not.toBeNull();

    const retake = await startUpload(bearer, { ...START, uploadKey: KEY });

    expect(retake.status).toBe(200);
    expect(retake.body.recordingId).toBe(kept.recording_id);
    // Clips reserves a free clip per recording id: both starts share one.
    expect(state.created.map(({ args }) => args.id)).toEqual([
      kept.recording_id,
      kept.recording_id,
    ]);
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ id: kept.recording_id }),
    ]);
    expect(await rows("recording_content_bindings")).toEqual([
      expect.objectContaining({
        recording_id: kept.recording_id,
        upload_start_failed_at: null,
      }),
    ]);
  });

  it.each(["unconfirmed", "untyped"] as const)(
    "keeps the binding of a start that failed %s",
    async (failure) => {
      await failedStart(failure);
      expect(await rows("recording_content_bindings")).toEqual([
        expect.objectContaining({
          upload_key: KEY,
          upload_start_failed_at: expect.any(String),
        }),
      ]);
    },
  );

  it("drops the binding of a start Clips says left nothing, so the next start makes its own recording", async () => {
    const { bearer } = await failedStart("confirmed");
    expect(await rows("recording_content_bindings")).toEqual([]);

    const next = await startUpload(bearer, { ...START, uploadKey: KEY });
    expect(next.status).toBe(200);
    expect(next.body.recordingId).not.toBe(state.created[0].args.id);
  });

  it("refuses the key of a start that failed after making its recording, and makes nothing more", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    // create-recording made the row and failed it, then couldn't say so.
    state.duringCreate = async () => {
      const { args, context } = state.created[state.created.length - 1];
      await state.db.insert(schema.recordings).values({
        id: args.id,
        organizationId: context?.orgId,
        ownerEmail: editor,
        visibility: args.visibility,
        title: args.title,
        status: "failed",
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
      });
      await failCreate("unconfirmed");
    };
    await expect(
      startUpload(bearer, { ...START, uploadKey: KEY }),
    ).rejects.toThrow();
    const [kept] = await rows("recording_content_bindings");
    expect(kept.upload_start_failed_at).not.toBeNull();

    const repeat = await startUpload(bearer, { ...START, uploadKey: KEY });

    expect(repeat).toMatchObject({
      status: 409,
      body: { code: "upload_key_used" },
    });
    expect(state.created).toHaveLength(1);
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ id: kept.recording_id, status: "failed" }),
    ]);
  });

  it("runs one retake of a failed start when two repeats overlap", async () => {
    const { bearer } = await failedStart("unconfirmed");
    const [failedId] = state.created.map(({ args }) => args.id);
    // Both read the failed start before either takes it over.
    let overlapping: Awaited<ReturnType<typeof startUpload>> | undefined;
    state.afterPhaseRead = async () => {
      overlapping = await startUpload(bearer, { ...START, uploadKey: KEY });
    };

    const outer = await startUpload(bearer, { ...START, uploadKey: KEY });

    expect(overlapping).toMatchObject({
      status: 200,
      body: { recordingId: failedId },
    });
    expect(outer).toMatchObject({
      status: 409,
      body: { code: "upload_starting" },
    });
    expect(state.created.map(({ args }) => args.id)).toEqual([
      failedId,
      failedId,
    ]);
    expect(await rows("recordings")).toHaveLength(1);
  });

  it("takes over a key whose binding never got its recording, once that's stale, with the same recording", async () => {
    const editor = await clipsEditor();
    const longAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await state.db.insert(schema.recordingContentBindings).values({
      id: "binding-stranded",
      recordingId: "rec-never-made",
      contentApp: CONTENT_APP,
      documentId: "doc-1",
      blockId: START.blockId,
      origin: "upload",
      state: "active",
      stateChangedAt: longAgo,
      createdBy: editor,
      uploadKey: KEY,
      uploadMimeType: START.mimeType,
      uploadSizeBytes: START.sizeBytes,
      createdAt: longAgo,
      updatedAt: longAgo,
    });

    const repeat = await startUpload(await token({ sub: editor }), {
      ...START,
      uploadKey: KEY,
    });

    expect(repeat.status).toBe(200);
    expect(repeat.body.recordingId).toBe("rec-never-made");
    expect(state.created.map(({ args }) => args.id)).toEqual([
      "rec-never-made",
    ]);
  });

  it("answers even when the first start took the last free clip", async () => {
    const { first, repeat } = await startTwice({}, async () => {
      state.storageStatus = {
        mode: "none",
        configured: false,
        activeProvider: null,
        localSqlChunkScratchAvailable: false,
        hostedRemaining: 0,
        hostedLimit: 3,
        maxClipBytes: 250 * 1024 * 1024,
        denyReason: "exhausted",
      };
    });

    expect(repeat.status).toBe(200);
    expect(repeat.body.recordingId).toBe(first.body.recordingId);
  });

  it.each(["processing", "ready"])(
    "says the upload already finished once its recording is %s",
    async (status) => {
      const { first, repeat } = await startTwice({}, () =>
        client.query("UPDATE recordings SET status = $1", [status]),
      );

      expect(repeat.status).toBe(409);
      expect(repeat.body).toEqual({
        error: "upload_already_finished",
        code: "upload_already_finished",
        recordingId: first.body.recordingId,
        status,
      });
      expect(await rows("recordings")).toHaveLength(1);
    },
  );

  it.each([
    [
      "once its upload was cancelled",
      {},
      () => client.query("UPDATE recordings SET status = 'failed'"),
    ],
    ["from another block", { blockId: "block-video-2" }, undefined],
  ])("refuses the key %s", async (_when, again, between) => {
    const { repeat } = await startTwice(again, between);

    expect(repeat.status).toBe(409);
    expect(repeat.body).toEqual({
      error: "upload_key_used",
      code: "upload_key_used",
    });
    expect(await rows("recordings")).toHaveLength(1);
    expect(await rows("recording_content_bindings")).toHaveLength(1);
  });

  it("makes a new upload for another key", async () => {
    const { first, repeat } = await startTwice({
      uploadKey: "picked-file-another",
    });

    expect(repeat.status).toBe(200);
    expect(repeat.body.recordingId).not.toBe(first.body.recordingId);
    expect(await rows("recordings")).toHaveLength(2);
    expect(await rows("recording_content_bindings")).toHaveLength(2);
  });

  it("never answers another uploader's key with the first one's recording", async () => {
    const one = await clipsEditor();
    const two = await clipsEditor();
    const first = await startUpload(await token({ sub: one }), {
      ...START,
      uploadKey: KEY,
    });
    const second = await startUpload(await token({ sub: two }), {
      ...START,
      uploadKey: KEY,
    });

    expect(second.status).toBe(200);
    expect(second.body.recordingId).not.toBe(first.body.recordingId);
    expect(
      Object.fromEntries(
        (await rows("recordings")).map((row) => [row.id, row.owner_email]),
      ),
    ).toEqual({
      [first.body.recordingId]: one,
      [second.body.recordingId]: two,
    });
  });

  it("answers a start that raced another with the same key with the upload the other made", async () => {
    const editor = await clipsEditor();
    let raced: Awaited<ReturnType<typeof startUpload>> | undefined;
    state.duringStorageCheck = async () => {
      raced = await startUpload(await token({ sub: editor }), {
        ...START,
        uploadKey: KEY,
      });
    };
    const result = await startUpload(await token({ sub: editor }), {
      ...START,
      uploadKey: KEY,
    });

    expect(raced?.status).toBe(200);
    expect(result.status).toBe(200);
    expect(result.body.recordingId).toBe(raced?.body.recordingId);
    expect(state.created).toHaveLength(1);
    expect(await rows("recordings")).toHaveLength(1);
    expect(await rows("recording_content_bindings")).toHaveLength(1);
  });
});

describe("a page's final chunk and its cancel", () => {
  const KEY = "picked-file-finishing";

  beforeEach(() => {
    // A free clip, so a cancel that fails the upload releases it.
    state.rowStorageMode = "hosted";
    state.realAbort = true;
  });

  async function started() {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    const answer = await startUpload(bearer, { ...START, uploadKey: KEY });
    expect(answer.status).toBe(200);
    const body = answer.body as {
      recordingId: string;
      chunkUrl: string;
      cancelUrl: string;
    };
    return { editor, bearer, ...body };
  }

  function finalChunk(upload: { chunkUrl: string }) {
    return postChunk(`${upload.chunkUrl}&index=0&isFinal=1`, {
      origin: pairedContentOrigin()!,
    });
  }

  function cancel(upload: { cancelUrl: string }) {
    return postCancel(upload.cancelUrl, pairedContentOrigin()!);
  }

  /** What a final chunk in flight holds, without the chunk itself. */
  async function holdClaim(
    upload: { editor: string; recordingId: string },
    claimedAt = new Date().toISOString(),
  ) {
    await asEditor(upload.editor, async () => {
      await writeAppState(
        `recording-upload-final-chunk-${upload.recordingId}`,
        {
          claimId: "claim-held",
          claimedAt,
        },
      );
      await writeAppState(`recording-upload-${upload.recordingId}`, {
        recordingId: upload.recordingId,
        finalChunkClaimedAt: claimedAt,
      });
    });
  }

  it("asks a final chunk that lands while Clips takes an earlier send of it to try again, and takes its bytes once", async () => {
    const upload = await started();
    state.finalChunkOutcome = "finish";
    let during: Awaited<ReturnType<typeof finalChunk>> | undefined;
    state.duringFinalChunk = async () => {
      during = await finalChunk(upload);
    };

    const first = await finalChunk(upload);

    expect(first.status).toBe(200);
    expect(during).toMatchObject({
      status: 409,
      body: { outcome: "upload_finishing", recordingId: upload.recordingId },
    });
    expect(state.chunks).toHaveLength(1);
  });

  it.each([
    ["finished", "finish", 200, { finalized: true, status: "ready" }],
    [
      "parked",
      "park",
      202,
      { finalized: false, waitingForStorage: true, status: "waiting_storage" },
    ],
  ] as const)(
    "answers a final chunk sent again once the first %s the upload with the first one's success, without taking it again",
    async (_phase, outcome, httpStatus, answer) => {
      const upload = await started();
      state.finalChunkOutcome = outcome;
      const first = await finalChunk(upload);
      expect(first).toMatchObject({ status: httpStatus, body: answer });

      const again = await finalChunk(upload);

      expect(again).toMatchObject({
        status: httpStatus,
        body: { ok: true, ...answer },
      });
      expect(state.chunks).toHaveLength(1);
    },
  );

  it("lets a final chunk take over a claim older than a final chunk's longest run", async () => {
    const upload = await started();
    await holdClaim(upload, new Date(Date.now() - 10 * 60_000).toISOString());
    state.finalChunkOutcome = "finish";

    const answer = await finalChunk(upload);

    expect(answer).toMatchObject({ status: 200, body: { ok: true } });
    expect(state.chunks).toHaveLength(1);
  });

  /** An upload whose lease ran out a moment ago, as the reaper finds it. */
  async function expireLease(recordingId: string) {
    await client.query(
      "UPDATE recordings SET upload_lease_expires_at = $1 WHERE id = $2",
      [new Date(Date.now() - 1_000).toISOString(), recordingId],
    );
  }

  async function reap() {
    // The reaper reads application state before anything here writes it.
    await client.exec(`CREATE TABLE IF NOT EXISTS application_state (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (session_id, key)
    )`);
    return withDbExec(coreDb(), () => reapExpiredUploads());
  }

  it("leaves the recording uploading when the reaper runs between a final chunk's claim and Clips taking its bytes, and the chunk finishes", async () => {
    state.rowStorageMode = null;
    const upload = await started();
    await expireLease(upload.recordingId);
    state.finalChunkOutcome = "finish";
    let chunk: ReturnType<typeof finalChunk> | undefined;
    let claimed!: () => void;
    const claimTaken = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    let reaping: ReturnType<typeof reap> | undefined;
    // The reaper has read the expired row; the final chunk claims it, and
    // Clips takes the bytes only once the reaper is done.
    state.beforeReaperFails = async () => {
      chunk = finalChunk(upload);
      await claimTaken;
    };
    state.duringFinalChunk = async () => {
      claimed();
      await reaping;
    };

    reaping = reap();
    const reaped = await reaping;
    const answer = await chunk;

    expect(reaped.failed).toBe(0);
    expect(answer).toMatchObject({ status: 200, body: { ok: true } });
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ id: upload.recordingId, status: "ready" }),
    ]);
  });

  it("refuses a final chunk once the reaper failed its expired upload, and changes nothing", async () => {
    state.rowStorageMode = null;
    const upload = await started();
    await expireLease(upload.recordingId);
    expect((await reap()).failed).toBe(1);
    const reaped = await rows("recordings");
    expect(reaped).toEqual([
      expect.objectContaining({
        id: upload.recordingId,
        status: "failed",
        failure_code: "upload_timed_out",
      }),
    ]);
    state.finalChunkOutcome = "finish";

    const answer = await finalChunk(upload);

    expect(answer.status).toBe(409);
    expect(state.chunks).toHaveLength(0);
    expect(await rows("recordings")).toEqual(reaped);
  });

  it("asks a cancel that lands while Clips takes the final chunk to try again, changes nothing, and says it finished once the chunk did", async () => {
    const upload = await started();
    let during: Awaited<ReturnType<typeof cancel>> | undefined;
    state.duringFinalChunk = async () => {
      during = await cancel(upload);
    };
    state.finalChunkOutcome = "finish";

    const chunk = await finalChunk(upload);

    expect(chunk.status).toBe(200);
    expect(during).toMatchObject({
      status: 409,
      body: { outcome: "upload_finishing", recordingId: upload.recordingId },
    });
    expect(await cancel(upload)).toMatchObject({
      status: 409,
      body: {
        outcome: "already_finished",
        recordingId: upload.recordingId,
        status: "ready",
      },
    });
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ id: upload.recordingId, status: "ready" }),
    ]);
    expect(state.released).toEqual([]);
  });

  it("cancels on a cancel's retry once a final chunk that held the upload fails, releasing its free clip", async () => {
    const upload = await started();
    let during: Awaited<ReturnType<typeof cancel>> | undefined;
    state.duringFinalChunk = async () => {
      during = await cancel(upload);
    };
    state.finalChunkOutcome = "fail";

    const chunk = await finalChunk(upload);

    expect(chunk.status).toBe(502);
    expect(during).toMatchObject({
      status: 409,
      body: { outcome: "upload_finishing" },
    });
    // The cancel during the chunk changed nothing.
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ status: "uploading" }),
    ]);
    expect(state.released).toEqual([]);

    expect(await cancel(upload)).toMatchObject({
      status: 200,
      body: { outcome: "cancelled", recordingId: upload.recordingId },
    });
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({
        status: "failed",
        failure_code: "upload_aborted",
      }),
    ]);
    expect(state.released).toEqual([upload.recordingId]);
  });

  it("issues no ticket to a repeat once the final chunk parked the upload until storage is connected", async () => {
    const upload = await started();
    state.finalChunkOutcome = "park";
    expect((await finalChunk(upload)).status).toBe(202);
    const ticketsBefore = await rows("settings");

    const repeat = await startUpload(upload.bearer, {
      ...START,
      uploadKey: KEY,
    });

    expect(repeat).toMatchObject({
      status: 409,
      body: { code: "upload_key_used" },
    });
    expect(await rows("settings")).toEqual(ticketsBefore);
  });

  it("cancels an upload its final chunk parked until storage is connected, releasing its free clip", async () => {
    const upload = await started();
    let during: Awaited<ReturnType<typeof cancel>> | undefined;
    state.duringFinalChunk = async () => {
      during = await cancel(upload);
    };
    state.finalChunkOutcome = "park";
    await finalChunk(upload);

    expect(during).toMatchObject({
      status: 409,
      body: { outcome: "upload_finishing" },
    });
    expect(await cancel(upload)).toMatchObject({
      status: 200,
      body: { outcome: "cancelled", recordingId: upload.recordingId },
    });
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
    expect(state.released).toEqual([upload.recordingId]);
  });

  it("never reads an upload whose final chunk finishes between a repeat's reads as uploading", async () => {
    const upload = await started();
    await holdClaim(upload);
    // The final chunk finishes, records it and gives the claim up just
    // before the repeat reads the claim.
    state.beforeClaimRead = async () => {
      await client.query("UPDATE recordings SET status = 'ready'");
      await asEditor(upload.editor, () =>
        writeAppState(`recording-upload-${upload.recordingId}`, {
          recordingId: upload.recordingId,
          finalChunkOutcome: "finished",
        }),
      );
      await client.query("DELETE FROM application_state WHERE key = $1", [
        `recording-upload-final-chunk-${upload.recordingId}`,
      ]);
    };
    const ticketsBefore = await rows("settings");

    const repeat = await startUpload(upload.bearer, {
      ...START,
      uploadKey: KEY,
    });

    expect(repeat).toMatchObject({
      status: 409,
      body: {
        code: "upload_already_finished",
        recordingId: upload.recordingId,
      },
    });
    expect(await rows("settings")).toEqual(ticketsBefore);
  });

  it("lets a cancel and a repeat take over a claim older than a final chunk's longest run", async () => {
    const upload = await started();
    await holdClaim(upload, new Date(Date.now() - 10 * 60_000).toISOString());

    const repeat = await startUpload(upload.bearer, {
      ...START,
      uploadKey: KEY,
    });
    expect(repeat.status).toBe(200);
    expect(await cancel(upload)).toMatchObject({
      status: 200,
      body: { outcome: "cancelled" },
    });
    expect(state.released).toEqual([upload.recordingId]);
  });

  it.each([
    [
      "finishes",
      "finish" as const,
      (recordingId: string) => ({
        status: 409,
        body: {
          code: "upload_already_finished",
          recordingId,
          status: "ready",
        },
      }),
    ],
    [
      "fails",
      "fail" as const,
      (recordingId: string) => ({ status: 200, body: { recordingId } }),
    ],
  ])(
    "asks a repeat that lands while Clips takes the final chunk to try again, issuing no ticket, and answers the next once the chunk %s",
    async (_, outcome, next) => {
      const upload = await started();
      let repeat: Awaited<ReturnType<typeof startUpload>> | undefined;
      let ticketsBefore: unknown;
      state.duringFinalChunk = async () => {
        ticketsBefore = await rows("settings");
        repeat = await startUpload(upload.bearer, { ...START, uploadKey: KEY });
      };
      state.finalChunkOutcome = outcome;

      await finalChunk(upload);

      expect(repeat).toMatchObject({
        status: 409,
        body: { code: "upload_starting" },
      });
      expect(await rows("settings")).toEqual(ticketsBefore);
      expect(
        await startUpload(upload.bearer, { ...START, uploadKey: KEY }),
      ).toMatchObject(next(upload.recordingId));
    },
  );

  it("refuses a final chunk once a cancel has claimed the upload", async () => {
    const upload = await started();
    // A cancel between claiming the upload state and failing the recording.
    await asEditor(upload.editor, () =>
      writeAppState(`recording-upload-${upload.recordingId}`, {
        recordingId: upload.recordingId,
        status: "failed",
        aborted: true,
      }),
    );
    state.finalChunkOutcome = "finish";

    const chunk = await finalChunk(upload);

    expect(chunk.status).toBe(409);
    expect(state.chunks).toEqual([]);
    expect(await rows("recordings")).toEqual([
      expect.objectContaining({ status: "uploading" }),
    ]);
  });

  it("puts the upload back to uploading when its final chunk fails, so a repeat and a cancel work again", async () => {
    const upload = await started();
    state.finalChunkOutcome = "fail";
    await finalChunk(upload);

    const repeat = await startUpload(upload.bearer, {
      ...START,
      uploadKey: KEY,
    });
    expect(repeat.status).toBe(200);
    expect(await cancel(repeat.body)).toMatchObject({
      status: 200,
      body: { outcome: "cancelled" },
    });
    expect(state.released).toEqual([upload.recordingId]);
  });
});

describe("the storage state Content shows", () => {
  const base = {
    configured: false,
    activeProvider: null,
    localSqlChunkScratchAvailable: false,
    hostedRemaining: 0,
    hostedLimit: 3,
    maxClipBytes: 100,
    maxClipDurationMs: 1,
    builderConfigured: false,
    builderUploadConfigured: false,
    builderReauthorizationRequired: false,
  };

  it.each([
    [
      "Builder.io storage",
      { mode: "own", activeProvider: { id: "builder", name: "Builder.io" } },
      { state: "ready", provider: "builder" },
    ],
    [
      "custom keys",
      { mode: "own", activeProvider: { id: "s3", name: "S3" } },
      { state: "ready", provider: "custom" },
    ],
    [
      "a local Clips",
      {
        mode: "none",
        denyReason: "disabled",
        localSqlChunkScratchAvailable: true,
      },
      { state: "ready", provider: "local" },
    ],
    [
      "free clips left",
      { mode: "hosted", hostedRemaining: 2 },
      { state: "free", remaining: 2, limit: 3, maxClipBytes: 100 },
    ],
    [
      "free clips used up",
      { mode: "none", denyReason: "exhausted" },
      { state: "used_up", limit: 3 },
    ],
    [
      "no free storage offered",
      { mode: "none", denyReason: "disabled" },
      { state: "none", reason: "disabled" },
    ],
    [
      "free storage refused for an unverified email",
      { mode: "none", denyReason: "unverified" },
      { state: "none", reason: "unverified" },
    ],
  ])("maps %s to its own state", (_label, status, expected) => {
    expect(contentClipStorageFor({ ...base, ...status } as any)).toEqual(
      expected,
    );
  });
});

describe("chunks posted from the editor's browser", () => {
  async function upload() {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }));
    return `${body.chunkUrl}&index=0&isFinal=0`;
  }

  it("takes a chunk from the paired Content, allowing that origin alone and no credentials", async () => {
    const paired = pairedContentOrigin();
    expect(paired).toMatch(/^https?:\/\//);
    const result = await postChunk(await upload(), {
      origin: paired!,
      guardHeaders: {
        "access-control-allow-origin": paired!,
        "access-control-allow-credentials": "true",
      },
    });

    expect(result.status).toBe(200);
    expect(state.chunks).toEqual([
      { owner: expect.objectContaining({ ownerEmail: expect.any(String) }) },
    ]);
    expect(result.headers.get("access-control-allow-origin")).toBe(paired);
    expect(result.headers.get("access-control-allow-credentials")).toBeNull();
    expect(result.headers.get("vary")).toBe("Origin");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses a chunk from any other origin, without allowing it to read the answer", async () => {
    const url = await upload();
    const result = await postChunk(url, {
      origin: "https://attacker.example.test",
      guardHeaders: {
        "access-control-allow-origin": "https://attacker.example.test",
        "access-control-allow-credentials": "true",
      },
    });

    expect(result.status).toBe(403);
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
    expect(result.headers.get("access-control-allow-credentials")).toBeNull();
    expect(state.chunks).toEqual([]);
  });

  it("answers a preflight itself, for the paired Content alone and with no credentials", async () => {
    async function preflight(origin: string) {
      const event = mockEvent(
        `${CLIPS_URL}/api/uploads/rec_1/content-chunk?ticket=t`,
        {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "POST" },
        },
      );
      return (await authMiddleware(event)) as Response;
    }
    const paired = pairedContentOrigin()!;
    const allowed = await preflight(paired);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(paired);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const other = await preflight("https://other.example.test");
    expect(other.status).toBe(403);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect(other.headers.get("access-control-allow-credentials")).toBeNull();

    const cancel = (await authMiddleware(
      mockEvent(`${CLIPS_URL}/api/uploads/rec_1/content-cancel?ticket=t`, {
        method: "OPTIONS",
        headers: { origin: paired, "access-control-request-method": "POST" },
      }),
    )) as Response;
    expect(cancel.status).toBe(204);
    expect(cancel.headers.get("access-control-allow-origin")).toBe(paired);
    expect(cancel.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("answers a bad ticket so the paired page can read why", async () => {
    const paired = pairedContentOrigin()!;
    const url = new URL(await upload());
    url.searchParams.set("ticket", "clipsup_bm90LWEtdGlja2V0.forged");
    const result = await postChunk(url.href, { origin: paired });

    expect(result.status).toBe(401);
    expect(result.headers.get("access-control-allow-origin")).toBe(paired);
    expect(state.chunks).toEqual([]);
  });

  it("refuses a ticket for an upload that didn't come from a Content page", async () => {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }));
    await client.query("DELETE FROM recording_content_bindings");
    const result = await postChunk(`${body.chunkUrl}&index=0&isFinal=0`, {
      origin: pairedContentOrigin()!,
    });
    expect(result.status).toBe(401);
  });

  it("refuses a chunk once the upload's page is in Trash", async () => {
    const url = await upload();
    await client.query(
      "UPDATE recording_content_bindings SET state = 'trashed'",
    );
    const result = await postChunk(url, { origin: pairedContentOrigin()! });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "This upload's page is in Trash" });
    expect(state.chunks).toEqual([]);
  });

  it("refuses an agent upload's ticket on the Content route", async () => {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }));
    await state.db.insert(schema.recordings).values({
      id: "rec-agent",
      organizationId: state.created[0]?.caller.orgId,
      ownerEmail: editor,
      title: "An agent's upload",
      status: "uploading",
    });
    const agentTicket = await withDbExec(coreDb(), () =>
      createRecordingUploadTicket(editor, "rec-agent"),
    );
    const url = new URL(`${body.chunkUrl}&index=0&isFinal=0`);
    url.pathname = "/api/uploads/rec-agent/content-chunk";
    url.searchParams.set("ticket", agentTicket.token);
    expect(
      (await postChunk(url.href, { origin: pairedContentOrigin()! })).status,
    ).toBe(401);
  });

  it("refuses a Content upload's ticket on the agent chunk route", async () => {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }));
    const ticket = new URL(body.chunkUrl).searchParams.get("ticket");
    const event = mockEvent(
      `${CLIPS_URL}/api/uploads/${body.recordingId}/agent-chunk?index=0&total=1&isFinal=1`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${ticket}` },
        body: Buffer.from("fake video bytes for one chunk"),
      },
    );
    event.context.params = { recordingId: body.recordingId };

    await expect(respond(agentChunkRoute, event)).rejects.toMatchObject({
      status: 409,
    });
    expect(state.chunks).toEqual([]);
  });
});

describe("an upload the editor's page gives up", () => {
  async function started(blockId = "block-video-1") {
    const editor = await clipsEditor();
    const { body } = await startUpload(await token({ sub: editor }), {
      ...START,
      blockId,
    });
    return { editor, ...body } as {
      editor: string;
      recordingId: string;
      cancelUrl: string;
    };
  }

  it("fails the upload through Clips' own abort, with its ticket alone", async () => {
    const upload = await started();
    const paired = pairedContentOrigin()!;
    const result = await postCancel(upload.cancelUrl, paired);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      outcome: "cancelled",
      recordingId: upload.recordingId,
    });
    expect(state.aborts).toEqual([
      expect.objectContaining({
        recordingId: upload.recordingId,
        ownerEmail: upload.editor,
        orgId: expect.stringMatching(/^org-/),
        authUserId: expect.stringMatching(/^user-/),
        onlyWhileUploading: true,
        body: expect.objectContaining({ failureCode: "upload_aborted" }),
      }),
    ]);
    expect((await rows("recordings"))[0]).toMatchObject({ status: "failed" });
    expect(result.headers.get("access-control-allow-origin")).toBe(paired);
    expect(result.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("answers a repeated cancel the same way, without aborting again", async () => {
    const upload = await started();
    const paired = pairedContentOrigin()!;
    const first = await postCancel(upload.cancelUrl, paired);
    const again = await postCancel(upload.cancelUrl, paired);

    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(state.aborts).toHaveLength(1);
  });

  it.each([
    [
      "answers ok while it verifies the file",
      {
        status: "processing" as const,
        answer: { ok: true, verificationPending: true, chunksCleared: 0 },
      },
    ],
    [
      "answers ok because the Clip is ready",
      {
        status: "ready" as const,
        answer: { ok: true, alreadyReady: true, chunksCleared: 0 },
      },
    ],
    [
      "refuses the abort as stale",
      {
        status: "processing" as const,
        answer: { error: "A newer upload retry is already active." },
        httpStatus: 409,
      },
    ],
  ])(
    "says the upload already finished when Clips finalized it first and the abort %s",
    async (_how, finalizedFirst) => {
      const upload = await started();
      state.finalizedFirst = finalizedFirst;
      const result = await postCancel(upload.cancelUrl, pairedContentOrigin()!);

      expect(result.status).toBe(409);
      expect(result.body).toEqual({
        error: "This upload is already finished",
        outcome: "already_finished",
        recordingId: upload.recordingId,
        status: finalizedFirst.status,
      });
      expect(state.aborts).toHaveLength(1);
      expect((await rows("recordings"))[0]).toMatchObject({
        status: finalizedFirst.status,
      });
    },
  );

  it("asks Content to try again while a final chunk holds the upload, and changes nothing", async () => {
    const upload = await started();
    const claimedAt = new Date().toISOString();
    await asEditor(upload.editor, () =>
      writeAppState(`recording-upload-final-chunk-${upload.recordingId}`, {
        claimId: "claim-held",
        claimedAt,
      }),
    );
    const result = await postCancel(upload.cancelUrl, pairedContentOrigin()!);

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: "This upload is finishing. Try again.",
      outcome: "upload_finishing",
      recordingId: upload.recordingId,
    });
    expect(state.aborts).toEqual([]);
    expect((await rows("recordings"))[0]).toMatchObject({
      status: "uploading",
    });
  });

  it("refuses another recording's ticket and an expired one", async () => {
    const one = await started();
    const other = (
      await startUpload(await token({ sub: one.editor }), {
        ...START,
        blockId: "block-video-2",
      })
    ).body as { recordingId: string; cancelUrl: string };
    const paired = pairedContentOrigin()!;

    const swapped = new URL(other.cancelUrl);
    swapped.searchParams.set(
      "ticket",
      new URL(one.cancelUrl).searchParams.get("ticket")!,
    );
    expect((await postCancel(swapped.href, paired)).status).toBe(401);

    const [setting] = await rows("settings");
    const tickets = JSON.parse(setting.value);
    tickets.tickets[one.recordingId].expiresAt = Date.now() - 1;
    await client.query("UPDATE settings SET value = $1 WHERE key = $2", [
      JSON.stringify(tickets),
      setting.key,
    ]);
    expect((await postCancel(one.cancelUrl, paired)).status).toBe(401);

    expect(state.aborts).toEqual([]);
    expect(
      (await rows("recordings")).map((recording) => recording.status),
    ).toEqual(["uploading", "uploading"]);
  });

  it("refuses a cancel from any other origin", async () => {
    const upload = await started();
    const result = await postCancel(
      upload.cancelUrl,
      "https://attacker.example.test",
    );
    expect(result.status).toBe(403);
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
    expect(state.aborts).toEqual([]);
  });

  it("leaves a Clip alone once Clips has its whole file", async () => {
    const upload = await started();
    await client.query("UPDATE recordings SET status = 'processing'");
    const result = await postCancel(upload.cancelUrl, pairedContentOrigin()!);

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      outcome: "already_finished",
      recordingId: upload.recordingId,
      status: "processing",
    });
    expect(state.aborts).toEqual([]);
  });

  it("still cancels an upload whose page is in Trash", async () => {
    const upload = await started();
    await client.query(
      "UPDATE recording_content_bindings SET state = 'trashed'",
    );
    const result = await postCancel(upload.cancelUrl, pairedContentOrigin()!);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ outcome: "cancelled" });
  });
});

describe("From Content and Library in Clips", () => {
  async function list(
    editor: string,
    orgId: string,
    view: "library" | "from-content" | "space",
    countOnly = false,
    where: { folderId?: string; spaceId?: string } = {},
  ) {
    return withDbExec(coreDb(), () =>
      runWithRequestContext({ userEmail: editor, orgId }, () =>
        listRecordings.run(
          {
            view,
            kind: "all",
            sort: "recent",
            limit: 100,
            offset: 0,
            countOnly,
            includeMedia: false,
            ...where,
          },
          { caller: "frontend", userEmail: editor },
        ),
      ),
    ) as Promise<any>;
  }

  it("lists a page's upload under From Content with its page link, and keeps it out of Library", async () => {
    const editor = await clipsEditor();
    const { body } = await startUpload(
      await token({ sub: editor, documentId: "doc/1" }),
    );
    const orgId = state.created[0]!.caller.orgId as string;
    for (const id of ["rec-made-in-clips", "rec-linked-into-a-page"]) {
      await state.db.insert(schema.recordings).values({
        id,
        organizationId: orgId,
        ownerEmail: editor,
        title: id,
        status: "ready",
      });
    }
    await state.db.insert(schema.recordingContentBindings).values({
      id: "binding-link",
      recordingId: "rec-linked-into-a-page",
      contentApp: CONTENT_APP,
      documentId: "doc-2",
      origin: "link",
      createdBy: editor,
    });

    const fromContent = await list(editor, orgId, "from-content");
    expect(
      fromContent.recordings.map((r: any) => [r.id, r.contentPageUrl]),
    ).toEqual([[body.recordingId, `${CONTENT_APP}/page/doc%2F1`]]);

    const library = await list(editor, orgId, "library");
    expect(library.recordings.map((r: any) => r.id).sort()).toEqual([
      "rec-linked-into-a-page",
      "rec-made-in-clips",
    ]);
    expect(library.recordings[0]).not.toHaveProperty("contentPageUrl");

    expect((await list(editor, orgId, "library", true)).total).toBe(2);
    expect((await list(editor, orgId, "from-content", true)).total).toBe(1);
  });

  it("lists an upload someone moved into a folder in that folder, and still not in Library", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    const moved = (await startUpload(bearer)).body.recordingId;
    const kept = (
      await startUpload(bearer, { ...START, blockId: "block-video-2" })
    ).body.recordingId;
    const orgId = state.created[0]!.caller.orgId as string;
    await client.query(
      "UPDATE recordings SET folder_id = 'folder-1' WHERE id = $1",
      [moved],
    );

    const folder = await list(editor, orgId, "library", false, {
      folderId: "folder-1",
    });
    expect(folder.recordings.map((r: any) => r.id)).toEqual([moved]);
    expect(
      (await list(editor, orgId, "library", true, { folderId: "folder-1" }))
        .total,
    ).toBe(1);
    expect((await list(editor, orgId, "library")).recordings).toEqual([]);
    const fromContent = await list(editor, orgId, "from-content");
    expect(fromContent.recordings.map((r: any) => r.id).sort()).toEqual(
      [moved, kept].sort(),
    );
  });

  it("lists an upload whose page is in Trash in neither From Content nor Library", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    const trashed = (await startUpload(bearer)).body.recordingId;
    const kept = (
      await startUpload(bearer, { ...START, blockId: "block-video-2" })
    ).body.recordingId;
    const orgId = state.created[0]!.caller.orgId as string;
    await client.query(
      "UPDATE recording_content_bindings SET state = 'trashed' WHERE recording_id = $1",
      [trashed],
    );

    const fromContent = await list(editor, orgId, "from-content");
    expect(fromContent.recordings.map((r: any) => r.id)).toEqual([kept]);
    expect((await list(editor, orgId, "from-content", true)).total).toBe(1);
    expect([...(await contentPageUrls([trashed, kept])).keys()]).toEqual([
      kept,
    ]);
    expect((await list(editor, orgId, "library")).recordings).toEqual([]);
    expect((await list(editor, orgId, "library", true)).total).toBe(0);
  });

  it("drops an upload from the folder and space someone moved it into while its page is in Trash", async () => {
    const editor = await clipsEditor();
    const bearer = await token({ sub: editor });
    const trashed = (await startUpload(bearer)).body.recordingId;
    const kept = (
      await startUpload(bearer, { ...START, blockId: "block-video-2" })
    ).body.recordingId;
    const orgId = state.created[0]!.caller.orgId as string;
    await state.db.insert(schema.recordings).values({
      id: "rec-made-in-clips",
      organizationId: orgId,
      ownerEmail: editor,
      title: "rec-made-in-clips",
      status: "ready",
      folderId: "folder-1",
      spaceIds: '["space-1"]',
    });
    await client.query(
      `UPDATE recordings SET folder_id = 'folder-1', space_ids = '["space-1"]' WHERE id = ANY($1)`,
      [[trashed, kept]],
    );
    await client.query(
      "UPDATE recording_content_bindings SET state = 'trashed' WHERE recording_id = $1",
      [trashed],
    );

    const folder: { recordings: { id: string }[] } = await list(
      editor,
      orgId,
      "library",
      false,
      { folderId: "folder-1" },
    );
    expect(folder.recordings.map((r) => r.id).sort()).toEqual(
      [kept, "rec-made-in-clips"].sort(),
    );
    expect(
      (await list(editor, orgId, "library", true, { folderId: "folder-1" }))
        .total,
    ).toBe(2);
    const space: { recordings: { id: string }[] } = await list(
      editor,
      orgId,
      "space",
      false,
      { folderId: "folder-1", spaceId: "space-1" },
    );
    expect(space.recordings.map((r) => r.id).sort()).toEqual(
      [kept, "rec-made-in-clips"].sort(),
    );
  });

  it("lists only the signed-in person's own uploads", async () => {
    const editor = await clipsEditor();
    expect((await startUpload(await token({ sub: editor }))).status).toBe(200);
    const orgId = state.created[0]!.caller.orgId as string;
    const someoneElse = await clipsEditor();

    expect((await list(someoneElse, orgId, "from-content")).recordings).toEqual(
      [],
    );
  });
});
