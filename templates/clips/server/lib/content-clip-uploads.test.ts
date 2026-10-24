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
  };
});

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => state.db,
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  readAppState: async () => null,
  writeAppState: async () => {},
}));
// create-recording's own storage, analytics and upload-session work is its
// contract, tested with it; here it makes the row as the caller it ran as.
vi.mock("../../actions/create-recording.js", () => ({
  default: {
    run: async (args: any, caller: any) => {
      const { getRequestContext } = await import("@agent-native/core/server");
      const { schema } = await import("../db/index.js");
      const context = getRequestContext();
      state.created.push({ args, context, caller });
      await state.db.insert(schema.recordings).values({
        id: args.id,
        organizationId: context?.orgId,
        ownerEmail: context?.userEmail,
        visibility: args.visibility,
        title: args.title,
        status: "uploading",
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
      });
      return { id: args.id, status: "uploading" };
    },
  },
}));
vi.mock("../routes/api/uploads/[recordingId]/chunk.post.js", () => ({
  handleRecordingChunk: async (_event: unknown, owner: unknown) => {
    state.chunks.push({ owner });
    return { ok: true };
  },
}));
// Clips' own abort is tested with it; here it fails the row as it would.
vi.mock("../routes/api/uploads/[recordingId]/abort.post.js", () => ({
  handleAbortRecordingUpload: async (_event: unknown, override: any) => {
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
  },
}));
vi.mock("./video-storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./video-storage.js")>()),
  getClipsVideoStorageStatus: async () => state.storageStatus,
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
const { default: authMiddleware } = await import("../middleware/auth.js");
const { default: playbackRoute } =
  await import("../routes/api/content-clips/[recordingId]/playback.get.js");
const { createRecordingUploadTicket } =
  await import("./recording-upload-ticket.js");
const { runWithRequestContext } = await import("@agent-native/core/server");
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
  return `CREATE TABLE IF NOT EXISTS "${config.name}" (${columns.join(", ")});`;
}

/** Core reads through its own handle; point it at this test's database. */
function coreDb() {
  return {
    async execute(statement: string | { sql: string; args?: unknown[] }) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      let param = 0;
      const result = await client.query(
        query.sql.replace(/\?/g, () => `$${++param}`),
        query.args ?? [],
      );
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
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

function startUpload(bearer: string, body: unknown = START) {
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
    view: "library" | "from-content",
    countOnly = false,
    folderId?: string,
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
            ...(folderId ? { folderId } : {}),
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

    const folder = await list(editor, orgId, "library", false, "folder-1");
    expect(folder.recordings.map((r: any) => r.id)).toEqual([moved]);
    expect((await list(editor, orgId, "library", true, "folder-1")).total).toBe(
      1,
    );
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
