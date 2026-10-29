import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { mockEvent, type H3Event } from "h3";
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
const SECRET = "content-clips-test-secret-0123456789abcdef";
const PEER_SECRET = "content-clips-peer-secret-0123456789abcdef";
const GRANT_SECRET = "content-clips-grant-secret-0123456789abcdef";

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
    db: null as unknown as PgliteDatabase,
    blobs: new Map<string, unknown>(),
    beforeClipOpens: null as (() => Promise<void>) | null,
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
  readAppState: async (key: string) => state.blobs.get(key) ?? null,
  writeAppState: async () => {},
}));
vi.mock("./s3-upload-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./s3-upload-provider.js")>()),
  // No Clip here lives in S3. The real lookup reads vault tables this
  // database lacks, and its error would mask the provider fetch under test.
  fetchS3ObjectByUrl: async () => null,
}));
vi.mock("./context-footage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context-footage.js")>();
  return {
    ...actual,
    contextClipIdForFootage: async (
      ...args: Parameters<typeof actual.contextClipIdForFootage>
    ) => {
      await state.beforeClipOpens?.();
      return actual.contextClipIdForFootage(...args);
    },
  };
});
vi.mock("./activity-notifications.js", () => ({
  notifyRecordingComment: async () => null,
  notifyRecordingReaction: async () => null,
}));
vi.mock("./user-identities.js", () => ({
  hydrateCommentAuthorNames: async (rows: unknown[]) => rows,
}));

const coreRequire = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = coreRequire("@electric-sql/pglite");
const jose = await import(pathToFileURL(coreRequire.resolve("jose")).href);

const { organizations, orgMembers } = await import("@agent-native/core/org");
const { putUserSetting } = await import("@agent-native/core/settings");
const { signA2AToken } = await import("@agent-native/core/a2a");
const { withDbExec } = await import("@agent-native/core/db");
const { schema } = await import("../db/index.js");
const {
  CONTENT_CLIP_COMMENT_AUTHOR_CHARS,
  CONTENT_CLIP_COMMENT_PREVIEW_CHARS,
  CONTENT_CLIP_COMMENT_TEXT_CHARS,
  CONTENT_CLIP_GRANT_EXPIRED,
  CONTENT_CLIP_MAX_COMMENT_THREADS,
  CONTENT_CLIP_MAX_LISTED_REPLIES,
  CONTENT_CLIP_NOT_CONFIGURED,
  CONTENT_CLIP_OPEN_THREADS_VIEW,
  CONTENT_CLIP_PLAYBACK_GRANT_SECONDS,
  CONTENT_CLIP_PUBLIC_READER,
  CONTENT_CLIP_RECORDING_TITLE_CHARS,
  CONTENT_CLIP_SCOPES: SCOPES,
} = await import("../../shared/content-clip-contract.js");
const { __resetContentClipRateLimitsForTests } =
  await import("./content-clip-peer.js");
const { contentPlaybackGrantKey } = await import("./content-peer-secret.js");
const { default: playbackRoute } =
  await import("../routes/api/content-clips/[recordingId]/playback.get.js");
const { default: listCommentsRoute } =
  await import("../routes/api/content-clips/[recordingId]/comments.get.js");
const { default: writeCommentsRoute } =
  await import("../routes/api/content-clips/[recordingId]/comments.post.js");
const { default: videoRoute } =
  await import("../routes/api/video/[recordingId].get.js");
const { default: thumbnailRoute } =
  await import("../routes/api/thumbnail/[recordingId].get.js");

const OWNER = "owner@clips.example.test";
const READER = "reader@content.example.test";
const OTHER_READER = "other-reader@content.example.test";
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const VIDEO_BYTES = Buffer.from("fake mp4 bytes for a test clip");

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
  return `CREATE TABLE "${config.name}" (${columns.join(", ")});`;
}

/**
 * Core reads workspaces, settings and workspace A2A records through its own
 * database handle rather than the app's; point it at this test's database.
 * Core writes `?` placeholders, and none of the statements these routes
 * reach contain a literal `?`.
 */
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

async function insertRecording(
  id: string,
  values: Partial<typeof schema.recordings.$inferInsert> = {},
) {
  await state.db.insert(schema.recordings).values({
    id,
    organizationId: "clips-org",
    ownerEmail: OWNER,
    visibility: "private",
    title: `Clip ${id}`,
    status: "ready",
    durationMs: 42_000,
    width: 1280,
    height: 720,
    enableComments: true,
    videoUrl: `https://storage.example.test/${id}.mp4`,
    videoFormat: "mp4",
    thumbnailUrl: PNG_DATA_URL,
    editsJson: "{}",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...values,
  });
  state.blobs.set(`recording-blob-${id}`, {
    data: VIDEO_BYTES.toString("base64"),
    mimeType: "video/mp4",
  });
}

async function insertBinding(
  id: string,
  values: Partial<typeof schema.recordingContentBindings.$inferInsert> = {},
) {
  await state.db.insert(schema.recordingContentBindings).values({
    id,
    recordingId: "rec-upload",
    contentApp: CONTENT_APP,
    documentId: "doc-1",
    blockId: "block-1",
    origin: "upload",
    state: "active",
    createdBy: OWNER,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...values,
  });
}

async function insertWorkspace(
  id: string,
  values: Partial<typeof organizations.$inferInsert> = {},
) {
  await state.db.insert(organizations).values({
    id,
    name: id,
    createdBy: OWNER,
    createdAt: 1,
    ...values,
  });
}

let workspaceReaders = 0;

/**
 * A new reader who belongs to these workspaces, joined in this order. Core
 * caches memberships and the active-workspace choice per process by email,
 * so a reader with workspaces must never carry over into another test.
 */
async function readerInWorkspaces(...orgIds: string[]): Promise<string> {
  const email = `workspace-reader-${++workspaceReaders}@content.example.test`;
  for (const [index, orgId] of orgIds.entries()) {
    await state.db.insert(orgMembers).values({
      id: `member-${orgId}-${email}`,
      orgId,
      email,
      role: "member",
      joinedAt: index + 1,
    });
  }
  return email;
}

/** Written through core, which drops its cached choice the way a switch does. */
async function setActiveWorkspace(email: string, orgId: string) {
  await withDbExec(coreDb(), () =>
    putUserSetting(email, "active-org-id", { orgId }),
  );
}

async function shareWithWorkspace(recordingId: string, orgId: string) {
  await state.db.insert(schema.recordingShares).values({
    id: `share-${recordingId}-${orgId}`,
    resourceId: recordingId,
    principalType: "org",
    principalId: orgId,
    role: "viewer",
    createdBy: OWNER,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
}

async function setBindingState(id: string, bindingState: "active" | "trashed") {
  await client.query(
    "UPDATE recording_content_bindings SET state = $1 WHERE id = $2",
    [bindingState, id],
  );
}

async function updateRecording(id: string, set: Record<string, unknown>) {
  const assignments = Object.keys(set).map(
    (column, index) => `"${column}" = $${index + 1}`,
  );
  await client.query(
    `UPDATE recordings SET ${assignments.join(", ")} WHERE id = $${assignments.length + 1}`,
    [...Object.values(set), id],
  );
}

interface TokenInput {
  scope?: string;
  sub?: string | null;
  documentId?: string | null;
  recordingId?: string | null;
  audience?: string | null;
  issuer?: string | null;
  secret?: string;
  issuedAt?: number | null;
  expiresAt?: number | null;
  extra?: Record<string, unknown>;
}

async function token(input: TokenInput = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    scope: input.scope ?? SCOPES.read,
    ...(input.documentId === null
      ? {}
      : { document_id: input.documentId ?? "doc-1" }),
    ...(input.recordingId === null
      ? {}
      : { recording_id: input.recordingId ?? "rec-upload" }),
    ...(input.sub === null ? {} : { sub: input.sub ?? READER }),
    ...input.extra,
  };
  let jwt = new jose.SignJWT(claims).setProtectedHeader({ alg: "HS256" });
  if (input.issuedAt !== null) jwt = jwt.setIssuedAt(input.issuedAt ?? now);
  if (input.expiresAt !== null) {
    jwt = jwt.setExpirationTime(input.expiresAt ?? now + 60);
  }
  if (input.issuer !== null) jwt = jwt.setIssuer(input.issuer ?? CONTENT_APP);
  if (input.audience !== null) {
    jwt = jwt.setAudience(input.audience ?? `${CLIPS_URL}/content-clips`);
  }
  return jwt.sign(new TextEncoder().encode(input.secret ?? PEER_SECRET));
}

function publicReaderToken(input: TokenInput = {}) {
  return token({
    scope: SCOPES.publicRead,
    sub: CONTENT_CLIP_PUBLIC_READER,
    ...input,
  });
}

function peerEvent(
  path: string,
  options: {
    bearer?: string | undefined;
    method?: string;
    body?: unknown;
  } = {},
) {
  const event = mockEvent(`${CLIPS_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const recordingId = /\/api\/content-clips\/([^/]+)\//.exec(path)?.[1];
  if (!recordingId) throw new Error(`No recording id in ${path}`);
  event.context.params = { recordingId: decodeURIComponent(recordingId) };
  return event;
}

// oxlint-disable-next-line typescript/no-explicit-any -- each case reads the fields of the route it called
type RouteBody = any;

async function respond(
  handler: (event: H3Event) => unknown,
  event: H3Event,
): Promise<{ status: number; body: RouteBody; response?: Response }> {
  const result = await withDbExec(coreDb(), () => handler(event));
  if (result instanceof Response) {
    const type = result.headers.get("content-type") ?? "";
    return {
      status: result.status,
      body: type.includes("json") ? await result.clone().json() : null,
      response: result,
    };
  }
  return { status: event.res.status ?? 200, body: result };
}

function playback(recordingId: string, bearer?: string) {
  return respond(
    playbackRoute,
    peerEvent(`/api/content-clips/${recordingId}/playback`, { bearer }),
  );
}

function listComments(
  recordingId: string,
  bearer?: string,
  limit: string | null = "500",
  view?: string,
) {
  const params = new URLSearchParams();
  if (limit !== null) params.set("limit", limit);
  if (view !== undefined) params.set("view", view);
  const query = params.size ? `?${params}` : "";
  return respond(
    listCommentsRoute,
    peerEvent(`/api/content-clips/${recordingId}/comments${query}`, {
      bearer,
    }),
  );
}

function writeComment(recordingId: string, bearer: string, body: unknown) {
  return respond(
    writeCommentsRoute,
    peerEvent(`/api/content-clips/${recordingId}/comments`, {
      bearer,
      method: "POST",
      body,
    }),
  );
}

async function fetchMedia(
  handler: (event: H3Event) => unknown,
  absoluteUrl: string,
) {
  const url = new URL(absoluteUrl);
  expect(url.origin).toBe(CLIPS_URL);
  const event = mockEvent(url.href);
  const recordingId = url.pathname.split("/").pop();
  if (!recordingId) throw new Error(`No recording id in ${absoluteUrl}`);
  event.context.params = { recordingId: decodeURIComponent(recordingId) };
  const result = await withDbExec(coreDb(), () => handler(event));
  if (result instanceof Response) {
    return {
      status: result.status,
      bytes: new Uint8Array(await result.arrayBuffer()),
    };
  }
  return {
    status: event.res.status ?? 200,
    bytes: result instanceof Uint8Array ? result : null,
    body: result instanceof Uint8Array ? null : (result as RouteBody),
  };
}

/** The media URL with its grant's claims rewritten and signed again. */
function withRewrittenGrant(
  mediaUrl: string,
  rewrite: (claims: Record<string, unknown>) => void,
  key = contentPlaybackGrantKey(PEER_SECRET),
): string {
  const url = new URL(mediaUrl);
  const grant = url.searchParams.get("content_grant");
  if (!grant) throw new Error(`No content_grant in ${mediaUrl}`);
  const [payload = ""] = grant.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  rewrite(claims);
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(encoded)
    .digest("base64url");
  url.searchParams.set("content_grant", `${encoded}.${signature}`);
  return url.href;
}

function afterGrantExpires(issuedAt: number) {
  vi.useFakeTimers({
    toFake: ["Date"],
    now: issuedAt + (CONTENT_CLIP_PLAYBACK_GRANT_SECONDS + 1) * 1000,
  });
}

beforeEach(async () => {
  client = await PGlite.create("memory://");
  state.db = drizzle(client);
  state.blobs.clear();
  __resetContentClipRateLimitsForTests();
  for (const table of [
    schema.recordings,
    schema.recordingShares,
    schema.recordingComments,
    schema.recordingContentBindings,
    schema.recordingContextItems,
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
  `);
  await insertRecording("rec-upload");
  await insertBinding("binding-doc-1");
});

afterEach(async () => {
  await client.close();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("Content doc readers play a Clip uploaded to the doc", () => {
  it("gives a doc reader a signed playback URL that plays the video and poster", async () => {
    const result = await playback("rec-upload", await token());

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      recording: {
        id: "rec-upload",
        durationMs: 42_000,
        width: 1280,
        height: 720,
        enableComments: true,
      },
      viewer: { isOwner: false, canComment: true },
    });
    expect(Date.parse(result.body.playback.expiresAt)).toBeGreaterThan(
      Date.now(),
    );

    const video = await fetchMedia(videoRoute, result.body.playback.videoUrl);
    expect(video.status).toBe(200);
    expect(Buffer.from(video.bytes ?? [])).toEqual(VIDEO_BYTES);

    const poster = await fetchMedia(
      thumbnailRoute,
      result.body.playback.posterUrl,
    );
    expect(poster.status).toBe(200);
  });

  it("refuses a reader of a doc the Clip is not bound to", async () => {
    const result = await playback(
      "rec-upload",
      await token({ documentId: "doc-2" }),
    );
    expect(result.status).toBe(404);
  });

  it("refuses a reader once the doc's binding is trashed", async () => {
    await setBindingState("binding-doc-1", "trashed");
    expect((await playback("rec-upload", await token())).status).toBe(404);
  });

  it("cuts the Clip's title to the contract's length", async () => {
    await updateRecording("rec-upload", { title: "T".repeat(5_000) });
    const result = await playback("rec-upload", await token());
    expect(result.status).toBe(200);
    expect(result.body.recording.title).toBe(
      "T".repeat(CONTENT_CLIP_RECORDING_TITLE_CHARS),
    );
  });

  it("stops serving an issued playback URL once the binding is trashed", async () => {
    const result = await playback("rec-upload", await token());
    await setBindingState("binding-doc-1", "trashed");

    for (const [route, url] of [
      [videoRoute, result.body.playback.videoUrl],
      [thumbnailRoute, result.body.playback.posterUrl],
    ] as const) {
      const media = await fetchMedia(route, url);
      expect(media.status).toBe(404);
      expect(media.bytes).toBeNull();
    }
  });

  it("refuses an expired playback URL with a code the player refreshes on", async () => {
    const issuedAt = Date.now();
    const result = await playback("rec-upload", await token());
    expect(Date.parse(result.body.playback.expiresAt)).toBeLessThanOrEqual(
      issuedAt + (CONTENT_CLIP_PLAYBACK_GRANT_SECONDS + 1) * 1000,
    );

    afterGrantExpires(issuedAt);
    try {
      for (const [route, url] of [
        [videoRoute, result.body.playback.videoUrl],
        [thumbnailRoute, result.body.playback.posterUrl],
      ] as const) {
        const media = await fetchMedia(route, url);
        expect(media.status).toBe(403);
        expect(media.body).toMatchObject({ code: CONTENT_CLIP_GRANT_EXPIRED });
        expect(media.bytes).toBeNull();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a reader Content no longer vouches for no fresh grant", async () => {
    const issuedAt = Date.now();
    const vouched = await token();
    expect((await playback("rec-upload", vouched)).status).toBe(200);

    afterGrantExpires(issuedAt);
    try {
      const stale = await playback("rec-upload", vouched);
      expect(stale.status).toBe(401);
      expect(stale.body.playback).toBeUndefined();

      const renewed = await playback("rec-upload", await token());
      expect(renewed.status).toBe(200);
      const video = await fetchMedia(
        videoRoute,
        renewed.body.playback.videoUrl,
      );
      expect(video.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a playback URL whose binding was swapped for another", async () => {
    await insertRecording("rec-other");
    await insertBinding("binding-other", {
      recordingId: "rec-other",
      documentId: "doc-9",
    });
    const result = await playback("rec-upload", await token());
    const tampered = new URL(result.body.playback.videoUrl);
    tampered.searchParams.set("content_binding", "binding-other");

    expect((await fetchMedia(videoRoute, tampered.href)).status).toBe(404);
  });

  it("keeps a duplicated doc readable after the original is trashed", async () => {
    await insertBinding("binding-doc-1-copy", { documentId: "doc-1-copy" });
    await setBindingState("binding-doc-1", "trashed");

    const copy = await playback(
      "rec-upload",
      await token({ documentId: "doc-1-copy" }),
    );
    expect(copy.status).toBe(200);
    expect(
      (await playback("rec-upload", await token({ documentId: "doc-1" })))
        .status,
    ).toBe(404);
  });

  it("refuses doc readers a trashed or expired Clip", async () => {
    await updateRecording("rec-upload", {
      trashed_at: "2026-10-20T00:00:00.000Z",
    });
    expect((await playback("rec-upload", await token())).status).toBe(404);

    await updateRecording("rec-upload", {
      trashed_at: null,
      expires_at: "2000-01-01T00:00:00.000Z",
    });
    expect((await playback("rec-upload", await token())).status).toBe(410);
  });

  it("refuses doc readers a Clip its owner protected with a password", async () => {
    await updateRecording("rec-upload", { password: "hashed-secret" });
    const result = await playback("rec-upload", await token());
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: "password_required" });
  });

  it("stops an issued playback URL once a password is set, even with the password", async () => {
    const result = await playback("rec-upload", await token());
    await updateRecording("rec-upload", { password: "hashed-secret" });

    for (const [route, url] of [
      [videoRoute, result.body.playback.videoUrl],
      [thumbnailRoute, result.body.playback.posterUrl],
    ] as const) {
      const unlocked = new URL(url);
      unlocked.searchParams.set("password", "hashed-secret");
      const media = await fetchMedia(route, unlocked.href);
      expect(media.status).toBe(401);
      expect(media.bytes).toBeNull();
    }
  });

  it("refuses a media grant whose expiry is missing or not a number", async () => {
    const result = await playback("rec-upload", await token());

    for (const [route, url] of [
      [videoRoute, result.body.playback.videoUrl],
      [thumbnailRoute, result.body.playback.posterUrl],
    ] as const) {
      expect(
        (
          await fetchMedia(
            route,
            withRewrittenGrant(url, () => {}),
          )
        ).status,
      ).toBe(200);
      for (const rewrite of [
        (claims: Record<string, unknown>) => delete claims.exp,
        (claims: Record<string, unknown>) => (claims.exp = String(claims.exp)),
      ]) {
        const media = await fetchMedia(route, withRewrittenGrant(url, rewrite));
        expect(media.status).toBe(404);
        expect(media.bytes).toBeNull();
      }
    }
  });

  it("refuses a media URL whose grant is present but empty", async () => {
    await updateRecording("rec-upload", { visibility: "public" });

    for (const [route, path] of [
      [videoRoute, "video"],
      [thumbnailRoute, "thumbnail"],
    ] as const) {
      const url = `${CLIPS_URL}/api/${path}/rec-upload`;
      expect((await fetchMedia(route, url)).status).toBe(200);
      expect((await fetchMedia(route, `${url}?content_grant=`)).status).toBe(
        404,
      );
    }
  });

  it("refuses a media grant signed with any key but the peer secret's", async () => {
    const result = await playback("rec-upload", await token());

    for (const [route, url] of [
      [videoRoute, result.body.playback.videoUrl],
      [thumbnailRoute, result.body.playback.posterUrl],
    ] as const) {
      // The app's own server secret, which a workspace derives from the
      // shared A2A secret, the A2A secret itself, and the underived peer
      // secret: none of them signs a grant, even one naming the owner.
      for (const key of [GRANT_SECRET, SECRET, PEER_SECRET]) {
        const forged = withRewrittenGrant(
          url,
          (claims) => (claims.viewerEmail = OWNER),
          key,
        );
        const media = await fetchMedia(route, forged);
        expect(media.status).toBe(404);
        expect(media.bytes).toBeNull();
      }
    }
  });

  it("answers a media grant with 503 while the peer secret is unset", async () => {
    const result = await playback("rec-upload", await token());
    vi.stubEnv("CONTENT_CLIPS_PEER_SECRET", "");
    try {
      for (const [route, url] of [
        [videoRoute, result.body.playback.videoUrl],
        [thumbnailRoute, result.body.playback.posterUrl],
      ] as const) {
        const media = await fetchMedia(route, url);
        expect(media.status).toBe(503);
        expect(media.body).toEqual({
          error: expect.any(String),
          code: CONTENT_CLIP_NOT_CONFIGURED,
        });
      }
    } finally {
      vi.stubEnv("CONTENT_CLIPS_PEER_SECRET", PEER_SECRET);
    }
  });

  it("keeps the owner's exceptions for a trashed, expired or unbound Clip", async () => {
    await setBindingState("binding-doc-1", "trashed");
    await updateRecording("rec-upload", {
      trashed_at: "2026-10-20T00:00:00.000Z",
      expires_at: "2000-01-01T00:00:00.000Z",
      password: "hashed-secret",
    });

    const result = await playback("rec-upload", await token({ sub: OWNER }));
    expect(result.status).toBe(200);
    expect(result.body.viewer).toMatchObject({ isOwner: true });
    const video = await fetchMedia(videoRoute, result.body.playback.videoUrl);
    expect(video.status).toBe(200);
  });

  it("answers a media URL the server blocks with a 502, never the 403 that means an expired grant", async () => {
    await updateRecording("rec-upload", {
      video_url: "http://127.0.0.1/rec-upload.mp4",
    });
    state.blobs.delete("recording-blob-rec-upload");

    const result = await playback("rec-upload", await token());
    expect(result.status).toBe(200);
    const video = await fetchMedia(videoRoute, result.body.playback.videoUrl);
    expect(video.status).toBe(502);
  });

  it("answers a storage provider that refuses the media with a 502, never the 403 that means an expired grant", async () => {
    await updateRecording("rec-upload", {
      video_url: "https://93.184.216.34/rec-upload.mp4",
    });
    state.blobs.delete("recording-blob-rec-upload");
    const providerFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("denied", { status: 403 }));
    try {
      const result = await playback("rec-upload", await token());
      expect(result.status).toBe(200);
      const video = await fetchMedia(videoRoute, result.body.playback.videoUrl);
      expect(providerFetch).toHaveBeenCalled();
      expect(video.status).toBe(502);
    } finally {
      providerFetch.mockRestore();
    }
  });

  it("refuses earlier-screen-time footage, which only plays through its Clip", async () => {
    await insertRecording("rec-footage");
    await state.db.insert(schema.recordingContextItems).values({
      id: "context-1",
      recordingId: "rec-upload",
      requestedSeconds: 60,
      originalStartedAt: "2026-10-01T00:00:00.000Z",
      originalEndedAt: "2026-10-01T00:01:00.000Z",
      startedAt: "2026-10-01T00:00:00.000Z",
      endedAt: "2026-10-01T00:01:00.000Z",
      status: "ready",
      mediaRecordingId: "rec-footage",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    await insertBinding("binding-footage", { recordingId: "rec-footage" });
    const bearer = await token({ recordingId: "rec-footage" });

    expect((await playback("rec-footage", bearer)).status).toBe(404);
    expect((await listComments("rec-footage", bearer)).status).toBe(404);
  });

  it("hands out a YouTube Clip's own embed URL, checked only when issued", async () => {
    await insertRecording("rec-youtube", {
      videoUrl: "https://www.youtube.com/embed/abcdefghijk",
    });
    await insertBinding("binding-youtube", { recordingId: "rec-youtube" });
    const bearer = await token({ recordingId: "rec-youtube" });

    const result = await playback("rec-youtube", bearer);
    expect(result.status).toBe(200);
    expect(result.body.recording.embedProvider).toBe("youtube");
    const videoUrl = new URL(result.body.playback.videoUrl);
    expect(videoUrl.hostname).toMatch(/youtube/);
    expect(videoUrl.searchParams.has("content_grant")).toBe(false);

    await setBindingState("binding-youtube", "trashed");
    expect((await playback("rec-youtube", bearer)).status).toBe(404);
  });

  it("plays for a signed-out reader of a public doc through its binding", async () => {
    const result = await playback("rec-upload", await publicReaderToken());

    expect(result.status).toBe(200);
    expect(result.body.viewer).toMatchObject({
      isOwner: false,
      canComment: false,
    });
    const video = await fetchMedia(videoRoute, result.body.playback.videoUrl);
    expect(video.status).toBe(200);
  });
});

describe("a pasted Clip keeps its own sharing", () => {
  beforeEach(async () => {
    await insertRecording("rec-pasted");
    await insertBinding("binding-pasted", {
      recordingId: "rec-pasted",
      origin: "link",
    });
  });

  it("gives doc readers nothing through a link binding", async () => {
    const result = await playback(
      "rec-pasted",
      await token({ recordingId: "rec-pasted" }),
    );
    expect(result.status).toBe(404);
    expect(
      (
        await playback(
          "rec-pasted",
          await publicReaderToken({ recordingId: "rec-pasted" }),
        )
      ).status,
    ).toBe(404);
  });

  it("plays for a reader the Clip is shared with", async () => {
    await state.db.insert(schema.recordingShares).values({
      id: "share-1",
      resourceId: "rec-pasted",
      principalType: "user",
      principalId: READER,
      role: "viewer",
      createdBy: OWNER,
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    const shared = await playback(
      "rec-pasted",
      await token({ recordingId: "rec-pasted" }),
    );
    expect(shared.status).toBe(200);
    expect(
      (
        await playback(
          "rec-pasted",
          await token({ recordingId: "rec-pasted", sub: OTHER_READER }),
        )
      ).status,
    ).toBe(404);
  });

  it("plays for a reader whose workspace the Clip is shared with", async () => {
    await insertWorkspace("clips-org");
    const reader = await readerInWorkspaces("clips-org");
    await state.db.insert(schema.recordingShares).values({
      id: "share-org",
      resourceId: "rec-pasted",
      principalType: "org",
      principalId: "clips-org",
      role: "viewer",
      createdBy: OWNER,
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    const shared = await playback(
      "rec-pasted",
      await token({ recordingId: "rec-pasted", sub: reader }),
    );
    expect(shared.status).toBe(200);
    const video = await fetchMedia(videoRoute, shared.body.playback.videoUrl);
    expect(video.status).toBe(200);
    expect(
      (
        await playback(
          "rec-pasted",
          await token({ recordingId: "rec-pasted", sub: OTHER_READER }),
        )
      ).status,
    ).toBe(404);
  });

  it("plays a public Clip for signed-in and signed-out readers", async () => {
    await updateRecording("rec-pasted", { visibility: "public" });

    expect(
      (await playback("rec-pasted", await token({ recordingId: "rec-pasted" })))
        .status,
    ).toBe(200);
    const anonymous = await playback(
      "rec-pasted",
      await publicReaderToken({ recordingId: "rec-pasted" }),
    );
    expect(anonymous.status).toBe(200);
    const video = await fetchMedia(
      videoRoute,
      anonymous.body.playback.videoUrl,
    );
    expect(video.status).toBe(200);
  });
});

describe("a reader in several workspaces acts in the active one", () => {
  let reader: string;

  beforeEach(async () => {
    await insertWorkspace("org-first");
    await insertWorkspace("org-active");
    await insertWorkspace("org-outside");
    reader = await readerInWorkspaces("org-first", "org-active");
    await setActiveWorkspace(reader, "org-active");
    for (const [recordingId, orgId] of [
      ["rec-active-org", "org-active"],
      ["rec-first-org", "org-first"],
      ["rec-outside-org", "org-outside"],
    ] as const) {
      await insertRecording(recordingId);
      await insertBinding(`binding-${recordingId}`, {
        recordingId,
        origin: "link",
      });
      await shareWithWorkspace(recordingId, orgId);
    }
  });

  it("opens a Clip shared with that workspace, through Content and its media URLs", async () => {
    const bearer = await token({ recordingId: "rec-active-org", sub: reader });
    const opened = await playback("rec-active-org", bearer);
    expect(opened.status).toBe(200);
    expect((await listComments("rec-active-org", bearer)).status).toBe(200);
    for (const [route, url] of [
      [videoRoute, opened.body.playback.videoUrl],
      [thumbnailRoute, opened.body.playback.posterUrl],
    ] as const) {
      expect((await fetchMedia(route, url)).status).toBe(200);
    }
  });

  it("refuses a Clip shared with another workspace, even one the reader belongs to", async () => {
    for (const recordingId of ["rec-first-org", "rec-outside-org"]) {
      const bearer = await token({ recordingId, sub: reader });
      expect((await playback(recordingId, bearer)).status).toBe(404);
      expect((await listComments(recordingId, bearer)).status).toBe(404);
    }
  });

  it("stops an issued media URL when the reader switches workspace", async () => {
    const opened = await playback(
      "rec-active-org",
      await token({ recordingId: "rec-active-org", sub: reader }),
    );
    await setActiveWorkspace(reader, "org-first");

    for (const [route, url] of [
      [videoRoute, opened.body.playback.videoUrl],
      [thumbnailRoute, opened.body.playback.posterUrl],
    ] as const) {
      expect((await fetchMedia(route, url)).status).toBe(404);
    }
  });
});

describe("video comments through a doc", () => {
  async function seedComment(
    id: string,
    values: Partial<typeof schema.recordingComments.$inferInsert> = {},
  ) {
    await state.db.insert(schema.recordingComments).values({
      id,
      recordingId: "rec-upload",
      organizationId: "clips-org",
      threadId: id,
      parentId: null,
      authorEmail: OWNER,
      authorName: "Owner",
      content: `Comment ${id}`,
      videoTimestampMs: 1_000,
      emojiReactionsJson: "{}",
      resolved: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      ...values,
    });
  }

  async function storedComments() {
    const { rows } = await client.query(
      "SELECT id, author_email, content, parent_id, resolved, emoji_reactions_json FROM recording_comments ORDER BY created_at, id",
    );
    return rows as Array<Record<string, unknown>>;
  }

  it("lets a doc reader list, add, reply, edit, react, resolve and delete", async () => {
    await seedComment("owner-comment");
    const write = await token({ scope: SCOPES.comment });

    const listed = await listComments("rec-upload", await token());
    expect(listed.status).toBe(200);
    expect(listed.body.comments.map((c: { id: string }) => c.id)).toEqual([
      "owner-comment",
    ]);

    const added = await writeComment("rec-upload", write, {
      operation: "add",
      content: "From the doc",
      videoTimestampMs: 2_500,
    });
    expect(added.status).toBe(200);
    const addedId = added.body.id as string;

    const replied = await writeComment("rec-upload", write, {
      operation: "reply",
      commentId: "owner-comment",
      content: "A reply",
    });
    expect(replied.status).toBe(200);

    expect(
      (
        await writeComment("rec-upload", write, {
          operation: "edit",
          commentId: addedId,
          content: "Edited from the doc",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writeComment("rec-upload", write, {
          operation: "react",
          commentId: "owner-comment",
          emoji: "👍",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writeComment("rec-upload", write, {
          operation: "resolve",
          commentId: addedId,
          resolved: true,
        })
      ).status,
    ).toBe(200);

    const stored = await storedComments();
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: addedId,
          author_email: READER,
          content: "Edited from the doc",
          resolved: true,
        }),
        expect.objectContaining({
          parent_id: "owner-comment",
          author_email: READER,
          content: "A reply",
        }),
        expect.objectContaining({
          id: "owner-comment",
          emoji_reactions_json: JSON.stringify({ "👍": [READER] }),
        }),
      ]),
    );

    expect(
      (
        await writeComment("rec-upload", write, {
          operation: "delete",
          commentId: addedId,
        })
      ).status,
    ).toBe(200);
    expect(
      (await storedComments()).some((comment) => comment.id === addedId),
    ).toBe(false);
  });

  it("cuts a listed comment's text and author to the contract's lengths", async () => {
    await seedComment("long", {
      authorEmail: `${"e".repeat(400)}@example.test`,
      authorName: "N".repeat(400),
      content: "C".repeat(5_000),
    });
    const listed = await listComments("rec-upload", await token());
    expect(listed.status).toBe(200);
    expect(listed.body.comments[0]).toEqual({
      id: "long",
      authorEmail: "e".repeat(CONTENT_CLIP_COMMENT_AUTHOR_CHARS),
      authorName: "N".repeat(CONTENT_CLIP_COMMENT_AUTHOR_CHARS),
      content: "C".repeat(CONTENT_CLIP_COMMENT_PREVIEW_CHARS),
      videoTimestampMs: 1_000,
    });
  });

  it("gives a signed-out reader no commenter's email, nor a name made from one", async () => {
    await seedComment("named", {
      authorEmail: READER,
      authorName: "Rae Reader",
    });
    await seedComment("from-email", {
      authorEmail: "pat.lee@content.example.test",
      authorName: "Pat Lee",
      videoTimestampMs: 2_000,
    });
    await seedComment("address", {
      authorEmail: "sam@content.example.test",
      authorName: "sam@content.example.test",
      videoTimestampMs: 3_000,
    });
    const authors = (body: RouteBody) =>
      body.comments.map(
        (comment: {
          id: string;
          authorEmail: unknown;
          authorName: unknown;
        }) => [comment.id, comment.authorEmail, comment.authorName],
      );

    const signedOut = await listComments(
      "rec-upload",
      await publicReaderToken(),
    );
    expect(signedOut.status).toBe(200);
    expect(authors(signedOut.body)).toEqual([
      ["named", null, "Rae Reader"],
      ["from-email", null, null],
      ["address", null, null],
    ]);
    const signedIn = await listComments("rec-upload", await token());
    expect(authors(signedIn.body)).toEqual([
      ["named", READER, "Rae Reader"],
      ["from-email", "pat.lee@content.example.test", "Pat Lee"],
      ["address", "sam@content.example.test", "sam@content.example.test"],
    ]);
  });

  it("lists thread starts only, at most as many as asked, and says when there are more", async () => {
    await seedComment("late", { videoTimestampMs: 9_000 });
    await seedComment("early", { videoTimestampMs: 1_000 });
    await seedComment("middle", { videoTimestampMs: 5_000 });
    await seedComment("reply", {
      parentId: "early",
      threadId: "early",
      videoTimestampMs: 1_000,
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    const bearer = await token();

    const first = await listComments("rec-upload", bearer, "2");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      comments: [
        expect.objectContaining({ id: "early", videoTimestampMs: 1_000 }),
        expect.objectContaining({ id: "middle", videoTimestampMs: 5_000 }),
      ],
      truncated: true,
    });

    const all = await listComments("rec-upload", bearer, "3");
    expect(all.body.truncated).toBe(false);
    expect(all.body.comments.map((c: { id: string }) => c.id)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  it("lists at most the contract's threads when Content sends no bound", async () => {
    await state.db.insert(schema.recordingComments).values(
      Array.from({ length: CONTENT_CLIP_MAX_COMMENT_THREADS + 1 }, (_, i) => ({
        id: `thread-${i}`,
        recordingId: "rec-upload",
        organizationId: "clips-org",
        threadId: `thread-${i}`,
        parentId: null,
        authorEmail: OWNER,
        authorName: "Owner",
        content: `Comment ${i}`,
        videoTimestampMs: i,
        emojiReactionsJson: "{}",
        resolved: false,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      })),
    );
    const result = await listComments("rec-upload", await token(), null);
    expect(result.status).toBe(200);
    expect(result.body.comments).toHaveLength(CONTENT_CLIP_MAX_COMMENT_THREADS);
    expect(result.body.truncated).toBe(true);
  });

  it("refuses a list whose bound it can't honor", async () => {
    await seedComment("owner-comment");
    const bearer = await token();
    for (const limit of ["", "0", "-1", "1.5", "abc", "501"]) {
      const result = await listComments("rec-upload", bearer, limit);
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).not.toContain("owner-comment");
    }
  });

  describe("in the open-threads view", () => {
    function listOpenThreads(bearer: string, limit = "500") {
      return listComments(
        "rec-upload",
        bearer,
        limit,
        CONTENT_CLIP_OPEN_THREADS_VIEW,
      );
    }

    it("lists open threads with their replies, oldest first", async () => {
      await seedComment("early", { content: "C".repeat(5_000) });
      await seedComment("done", { videoTimestampMs: 2_000, resolved: true });
      await seedComment("late", { videoTimestampMs: 9_000 });
      await seedComment("second-reply", {
        parentId: "first-reply",
        threadId: "early",
        content: "Second",
        createdAt: "2026-10-03T00:00:00.000Z",
      });
      await seedComment("first-reply", {
        parentId: "early",
        threadId: "early",
        authorEmail: READER,
        authorName: "Rae Reader",
        content: "R".repeat(5_000),
        createdAt: "2026-10-02T00:00:00.000Z",
      });
      await seedComment("done-reply", {
        parentId: "done",
        threadId: "done",
        createdAt: "2026-10-02T00:00:00.000Z",
      });

      const listed = await listOpenThreads(await token());
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual({
        comments: [
          {
            id: "early",
            authorEmail: OWNER,
            authorName: "Owner",
            content: "C".repeat(CONTENT_CLIP_COMMENT_TEXT_CHARS),
            videoTimestampMs: 1_000,
            createdAt: "2026-10-01T00:00:00.000Z",
            replyCount: 2,
            replies: [
              {
                id: "first-reply",
                authorEmail: READER,
                authorName: "Rae Reader",
                content: "R".repeat(CONTENT_CLIP_COMMENT_TEXT_CHARS),
                createdAt: "2026-10-02T00:00:00.000Z",
              },
              {
                id: "second-reply",
                authorEmail: OWNER,
                authorName: "Owner",
                content: "Second",
                createdAt: "2026-10-03T00:00:00.000Z",
              },
            ],
          },
          expect.objectContaining({ id: "late", replyCount: 0, replies: [] }),
        ],
        truncated: false,
      });
    });

    it("holds replies back past the contract's bound, from the latest thread", async () => {
      await seedComment("first");
      await seedComment("second", { videoTimestampMs: 2_000 });
      await state.db.insert(schema.recordingComments).values(
        Array.from({ length: CONTENT_CLIP_MAX_LISTED_REPLIES }, (_, i) => ({
          id: `first-reply-${i}`,
          recordingId: "rec-upload",
          organizationId: "clips-org",
          threadId: "first",
          parentId: "first",
          authorEmail: OWNER,
          authorName: "Owner",
          content: `Reply ${i}`,
          videoTimestampMs: 1_000,
          emojiReactionsJson: "{}",
          resolved: false,
          createdAt: "2026-10-02T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
        })),
      );
      await seedComment("second-reply", {
        parentId: "second",
        threadId: "second",
        createdAt: "2026-10-02T00:00:00.000Z",
      });

      const listed = await listOpenThreads(await token());
      const [first, second] = listed.body.comments;
      expect(first.replies).toHaveLength(CONTENT_CLIP_MAX_LISTED_REPLIES);
      expect(first.replyCount).toBe(CONTENT_CLIP_MAX_LISTED_REPLIES);
      expect(second).toEqual(
        expect.objectContaining({ replyCount: 1, replies: [] }),
      );
    });

    it("gives a signed-out reader no replier's email, nor a name made from one", async () => {
      await seedComment("start");
      await seedComment("named-reply", {
        parentId: "start",
        threadId: "start",
        authorEmail: READER,
        authorName: "Rae Reader",
      });
      await seedComment("address-reply", {
        parentId: "start",
        threadId: "start",
        authorEmail: "sam@content.example.test",
        authorName: "sam@content.example.test",
        createdAt: "2026-10-02T00:00:00.000Z",
      });

      const listed = await listOpenThreads(await publicReaderToken());
      expect(
        listed.body.comments[0].replies.map(
          (reply: { authorEmail: unknown; authorName: unknown }) => [
            reply.authorEmail,
            reply.authorName,
          ],
        ),
      ).toEqual([
        [null, "Rae Reader"],
        [null, null],
      ]);
    });

    it("bounds the threads as the plain list does", async () => {
      await seedComment("early");
      await seedComment("late", { videoTimestampMs: 9_000 });
      const listed = await listOpenThreads(await token(), "1");
      expect(listed.body.comments.map((c: { id: string }) => c.id)).toEqual([
        "early",
      ]);
      expect(listed.body.truncated).toBe(true);
    });

    it("refuses a view it doesn't know", async () => {
      await seedComment("owner-comment");
      const result = await listComments(
        "rec-upload",
        await token(),
        "500",
        "everything",
      );
      expect(result.status).toBe(400);
    });
  });

  it("refuses to change another person's comment", async () => {
    await seedComment("owner-comment");
    const write = await token({ scope: SCOPES.comment });

    for (const body of [
      { operation: "edit", commentId: "owner-comment", content: "Hijacked" },
      { operation: "delete", commentId: "owner-comment" },
      { operation: "resolve", commentId: "owner-comment", resolved: true },
    ]) {
      expect((await writeComment("rec-upload", write, body)).status).toBe(403);
    }
    expect(await storedComments()).toEqual([
      expect.objectContaining({
        id: "owner-comment",
        content: "Comment owner-comment",
        resolved: false,
      }),
    ]);
  });

  it("keeps a reader's own stronger role on the Clip", async () => {
    await seedComment("owner-comment");
    await state.db.insert(schema.recordingShares).values({
      id: "share-editor",
      resourceId: "rec-upload",
      principalType: "user",
      principalId: READER,
      role: "editor",
      createdBy: OWNER,
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    const result = await writeComment(
      "rec-upload",
      await token({ scope: SCOPES.comment }),
      { operation: "resolve", commentId: "owner-comment", resolved: true },
    );
    expect(result.status).toBe(200);
    expect(await storedComments()).toEqual([
      expect.objectContaining({ id: "owner-comment", resolved: true }),
    ]);
  });

  it("refuses a comment that belongs to another recording", async () => {
    await insertRecording("rec-other", { visibility: "public" });
    await seedComment("foreign-comment", { recordingId: "rec-other" });

    const write = await token({ scope: SCOPES.comment });
    for (const body of [
      { operation: "reply", commentId: "foreign-comment", content: "Hi" },
      { operation: "edit", commentId: "foreign-comment", content: "Hi" },
      { operation: "delete", commentId: "foreign-comment" },
      { operation: "resolve", commentId: "foreign-comment", resolved: true },
      { operation: "react", commentId: "foreign-comment", emoji: "👍" },
    ]) {
      expect((await writeComment("rec-upload", write, body)).status).toBe(404);
    }
    expect(await storedComments()).toEqual([
      expect.objectContaining({
        id: "foreign-comment",
        content: "Comment foreign-comment",
        resolved: false,
        emoji_reactions_json: "{}",
      }),
    ]);
  });

  it("refuses comments to readers of a doc the Clip is not bound to", async () => {
    await seedComment("owner-comment");
    expect(
      (await listComments("rec-upload", await token({ documentId: "doc-2" })))
        .status,
    ).toBe(404);
    expect(
      (
        await writeComment(
          "rec-upload",
          await token({ scope: SCOPES.comment, documentId: "doc-2" }),
          { operation: "add", content: "Hi", videoTimestampMs: 0 },
        )
      ).status,
    ).toBe(404);
  });

  describe("with comments turned off", () => {
    beforeEach(async () => {
      await seedComment("owner-comment");
      await updateRecording("rec-upload", { enable_comments: false });
    });

    it("shows a signed-in or signed-out doc reader no comments", async () => {
      for (const bearer of [await token(), await publicReaderToken()]) {
        const result = await listComments("rec-upload", bearer);
        expect(result.status).toBe(403);
        expect(result.body).toMatchObject({ code: "comments_disabled" });
        expect(JSON.stringify(result.body)).not.toContain("owner-comment");
      }
      const played = await playback("rec-upload", await token());
      expect(played.body.recording.enableComments).toBe(false);
      expect(played.body.viewer.canComment).toBe(false);
    });

    it("lets no doc reader write", async () => {
      await seedComment("reader-comment", { authorEmail: READER });
      const write = await token({ scope: SCOPES.comment });
      for (const body of [
        { operation: "add", content: "Hi", videoTimestampMs: 0 },
        { operation: "reply", commentId: "owner-comment", content: "Hi" },
        { operation: "edit", commentId: "reader-comment", content: "Hi" },
        { operation: "react", commentId: "owner-comment", emoji: "👍" },
        { operation: "resolve", commentId: "reader-comment", resolved: true },
        { operation: "delete", commentId: "reader-comment" },
      ]) {
        const result = await writeComment("rec-upload", write, body);
        expect(result.status).toBe(403);
        expect(result.body).toMatchObject({ code: "comments_disabled" });
      }
      expect(await storedComments()).toEqual([
        expect.objectContaining({
          id: "owner-comment",
          emoji_reactions_json: "{}",
          resolved: false,
        }),
        expect.objectContaining({
          id: "reader-comment",
          content: "Comment reader-comment",
          resolved: false,
        }),
      ]);
    });

    it("still shows the owner the saved comments", async () => {
      const result = await listComments(
        "rec-upload",
        await token({ sub: OWNER }),
      );
      expect(result.status).toBe(200);
      expect(result.body.comments).toHaveLength(1);
    });
  });
});

describe("a signed-out reader's token", () => {
  it("reads one recording's comments and nothing else", async () => {
    await insertRecording("rec-other", { visibility: "private" });
    await insertBinding("binding-other", {
      recordingId: "rec-other",
      documentId: "doc-2",
    });

    expect(
      (await listComments("rec-upload", await publicReaderToken())).status,
    ).toBe(200);
    // Its claims name rec-upload in doc-1, so another recording is refused
    // even though that recording is bound to a doc of its own.
    expect(
      (await listComments("rec-other", await publicReaderToken())).status,
    ).toBe(401);
    expect(
      (await playback("rec-other", await publicReaderToken())).status,
    ).toBe(401);
    expect(
      (
        await playback(
          "rec-upload",
          await publicReaderToken({ documentId: "doc-2" }),
        )
      ).status,
    ).toBe(404);
  });

  it("can never write a comment", async () => {
    const result = await writeComment("rec-upload", await publicReaderToken(), {
      operation: "add",
      content: "Anonymous",
      videoTimestampMs: 0,
    });
    expect(result.status).toBe(401);

    const asCommenter = await writeComment(
      "rec-upload",
      await token({ scope: SCOPES.comment, sub: CONTENT_CLIP_PUBLIC_READER }),
      { operation: "add", content: "Anonymous", videoTimestampMs: 0 },
    );
    expect(asCommenter.status).toBe(401);
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM recording_comments",
    );
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("is refused when it carries a person instead of the public reader", async () => {
    expect(
      (await playback("rec-upload", await publicReaderToken({ sub: READER })))
        .status,
    ).toBe(401);
    expect(
      (
        await playback(
          "rec-upload",
          await token({ sub: CONTENT_CLIP_PUBLIC_READER }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("token checks", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it.each<[string, () => Promise<string | undefined>]>([
    ["no bearer", async () => undefined],
    [
      "a wrong audience",
      () => token({ audience: `${CLIPS_URL}/private-icon` }),
    ],
    ["another app's audience", () => token({ audience: CONTENT_APP })],
    ["no audience", () => token({ audience: null })],
    ["a wrong scope", () => token({ scope: "private-icon:read" })],
    ["no document claim", () => token({ documentId: null })],
    ["no recording claim", () => token({ recordingId: null })],
    ["another recording's claim", () => token({ recordingId: "rec-other" })],
    ["no subject", () => token({ sub: null })],
    ["no issuer", () => token({ issuer: null })],
    ["a non-http issuer", () => token({ issuer: "urn:content" })],
    ["another secret", () => token({ secret: "not-the-deploy-secret-012345" })],
    ["the deployment A2A secret", () => token({ secret: SECRET })],
    [
      "an expired token",
      () => token({ issuedAt: now() - 120, expiresAt: now() - 60 }),
    ],
    [
      "an issue time in the future",
      () => token({ issuedAt: now() + 300, expiresAt: now() + 360 }),
    ],
    [
      "a lifetime over five minutes",
      () => token({ issuedAt: now(), expiresAt: now() + 60 * 60 }),
    ],
    [
      "a typed credential",
      () => token({ extra: { typ: "agent-native-mcp-oauth" } }),
    ],
    ["no expiry", () => token({ expiresAt: null })],
    ["no issue time", () => token({ issuedAt: null })],
    [
      "an expiry that is a string",
      () => token({ expiresAt: null, extra: { exp: String(now() + 60) } }),
    ],
    [
      "an issue time that is a string",
      () => token({ issuedAt: null, extra: { iat: String(now()) } }),
    ],
    ["a not-before time to come", () => token({ extra: { nbf: now() + 30 } })],
    [
      "a not-before time that is a string",
      () => token({ extra: { nbf: String(now()) } }),
    ],
  ])("refuses %s", async (_name, mint) => {
    const result = await playback("rec-upload", await mint());
    expect(result.status).toBe(401);
    expect(JSON.stringify(result.body)).not.toContain("rec-upload");
  });

  it("refuses a read token for a write", async () => {
    const result = await writeComment("rec-upload", await token(), {
      operation: "add",
      content: "Hi",
      videoTimestampMs: 0,
    });
    expect(result.status).toBe(401);
  });

  it("refuses a comment token for a read", async () => {
    const result = await playback(
      "rec-upload",
      await token({ scope: SCOPES.comment }),
    );
    expect(result.status).toBe(401);
  });

  it("accepts a token core's shared signer mints with the peer secret", async () => {
    const bearer = await signA2AToken(READER, undefined, PEER_SECRET, {
      expiresIn: "1m",
      audience: `${CLIPS_URL}/content-clips`,
      extraClaims: {
        scope: SCOPES.read,
        document_id: "doc-1",
        recording_id: "rec-upload",
      },
    });
    // The shared signer names this app as its issuer, so bind the Clip to it.
    await insertBinding("binding-self", {
      contentApp: CLIPS_URL,
      documentId: "doc-1",
    });
    expect((await playback("rec-upload", bearer)).status).toBe(200);
  });

  describe("without a secret only Content and Clips hold", () => {
    afterEach(() => {
      vi.stubEnv("CONTENT_CLIPS_PEER_SECRET", PEER_SECRET);
    });

    it.each([
      ["unset", "", PEER_SECRET],
      ["the deployment A2A secret", SECRET, SECRET],
      ["too short to sign with", "short-peer-secret", "short-peer-secret"],
    ])("refuses every route while it is %s", async (_name, value, signer) => {
      vi.stubEnv("CONTENT_CLIPS_PEER_SECRET", value);
      const read = await token({ secret: signer });
      const write = await token({ scope: SCOPES.comment, secret: signer });

      for (const result of [
        await playback("rec-upload", read),
        await listComments("rec-upload", read),
        await writeComment("rec-upload", write, {
          operation: "add",
          content: "Hi",
          videoTimestampMs: 0,
        }),
      ]) {
        expect(result.status).toBe(503);
        expect(result.body).toEqual({
          error: expect.any(String),
          code: CONTENT_CLIP_NOT_CONFIGURED,
        });
      }
      const { rows } = await client.query(
        "SELECT count(*)::int AS count FROM recording_comments",
      );
      expect(rows[0]).toEqual({ count: 0 });
    });
  });

  it("refuses a token from another Content app for this doc", async () => {
    const result = await playback(
      "rec-upload",
      await token({ issuer: "https://other-content.example.test" }),
    );
    expect(result.status).toBe(404);
  });

  describe("at the edge of a lifetime", () => {
    const issuedAt = Date.UTC(2026, 9, 23, 12, 0, 0);
    const at = (seconds: number) => vi.setSystemTime(issuedAt + seconds * 1000);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: issuedAt });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("accepts Content's one-minute token until its last second", async () => {
      const bearer = await token();
      at(59);
      expect((await playback("rec-upload", bearer)).status).toBe(200);
      at(61);
      expect((await playback("rec-upload", bearer)).status).toBe(401);
    });

    it("accepts a five-minute lifetime and not one second more", async () => {
      const iat = issuedAt / 1000;
      for (const [lifetime, status] of [
        [300, 200],
        [301, 401],
      ] as const) {
        const bearer = await token({ expiresAt: iat + lifetime });
        expect((await playback("rec-upload", bearer)).status).toBe(status);
      }
    });

    it("allows a minute of clock skew on the issue time and not one second more", async () => {
      const iat = issuedAt / 1000;
      for (const [skew, status] of [
        [60, 200],
        [61, 401],
      ] as const) {
        const bearer = await token({
          issuedAt: iat + skew,
          expiresAt: iat + skew + 60,
        });
        expect((await playback("rec-upload", bearer)).status).toBe(status);
      }
    });

    it("plays a media URL until the grant's last second", async () => {
      const result = await playback("rec-upload", await token());
      const urls = [
        [videoRoute, result.body.playback.videoUrl],
        [thumbnailRoute, result.body.playback.posterUrl],
      ] as const;

      at(CONTENT_CLIP_PLAYBACK_GRANT_SECONDS - 1);
      for (const [route, url] of urls) {
        expect((await fetchMedia(route, url)).status).toBe(200);
      }
      at(CONTENT_CLIP_PLAYBACK_GRANT_SECONDS + 1);
      for (const [route, url] of urls) {
        const media = await fetchMedia(route, url);
        expect(media.status).toBe(403);
        expect(media.body).toMatchObject({ code: CONTENT_CLIP_GRANT_EXPIRED });
      }
    });
  });

  describe("a token that names a workspace", () => {
    const WORKSPACE_DOMAIN = "content.example.test";
    const WORKSPACE_SECRET = "content-workspace-a2a-secret-0123456789";
    let reader: string;

    beforeEach(async () => {
      await insertWorkspace("org-content", {
        allowedDomain: WORKSPACE_DOMAIN,
        a2aSecret: WORKSPACE_SECRET,
      });
      await client.query(
        "UPDATE organizations SET a2a_member_delegation_enabled = true WHERE id = 'org-content'",
      );
      reader = await readerInWorkspaces("org-content");
      await setActiveWorkspace(reader, "org-content");
      await insertWorkspace("org-named", {
        allowedDomain: "named.example.test",
      });
    });

    it("is refused when signed with the workspace's own A2A secret", async () => {
      for (const extra of [
        { org_domain: WORKSPACE_DOMAIN },
        {
          org_domain: WORKSPACE_DOMAIN,
          typ: "agent-native-org-member-delegation",
          jti: "delegation-1",
        },
      ]) {
        const bearer = await token({
          sub: reader,
          secret: WORKSPACE_SECRET,
          extra,
        });
        expect((await playback("rec-upload", bearer)).status).toBe(401);
      }
    });

    it("reaches one recording and document, from the placement's Content app", async () => {
      const named = (input: TokenInput = {}) =>
        token({
          sub: reader,
          ...input,
          extra: { org_domain: WORKSPACE_DOMAIN },
        });
      await insertRecording("rec-other");

      expect((await playback("rec-upload", await named())).status).toBe(200);
      expect(
        (
          await playback(
            "rec-upload",
            await named({ issuer: "https://other-content.example.test" }),
          )
        ).status,
      ).toBe(404);
      expect(
        (await playback("rec-upload", await named({ documentId: "doc-2" })))
          .status,
      ).toBe(404);
      expect((await playback("rec-other", await named())).status).toBe(401);
      expect(
        (await playback("rec-other", await named({ recordingId: "rec-other" })))
          .status,
      ).toBe(404);
    });

    it("gets nothing from the workspace it names", async () => {
      await insertRecording("rec-named");
      await insertBinding("binding-named", {
        recordingId: "rec-named",
        origin: "link",
      });
      await shareWithWorkspace("rec-named", "org-named");

      const bearer = await token({
        recordingId: "rec-named",
        sub: reader,
        extra: { org_domain: "named.example.test" },
      });
      expect((await playback("rec-named", bearer)).status).toBe(404);
    });
  });

  it("rejects malformed comment requests", async () => {
    const write = await token({ scope: SCOPES.comment });
    for (const body of [
      { operation: "add", content: "", videoTimestampMs: 0 },
      { operation: "add", content: "x".repeat(10_001), videoTimestampMs: 0 },
      { operation: "add", content: "Hi", videoTimestampMs: -1 },
      { operation: "rename", commentId: "c" },
      { operation: "react", commentId: "c", emoji: "x".repeat(65) },
    ]) {
      expect((await writeComment("rec-upload", write, body)).status).toBe(400);
    }
  });

  it("rate-limits one reader's comment writes", async () => {
    const write = await token({ scope: SCOPES.comment });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 31; attempt++) {
      statuses.push(
        (
          await writeComment("rec-upload", write, {
            operation: "add",
            content: `Comment ${attempt}`,
            videoTimestampMs: attempt,
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  async function spendWrites(bearer: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await addComment(bearer, attempt)).status).toBe(200);
    }
  }

  function addComment(bearer: string, attempt: number) {
    return writeComment("rec-upload", bearer, {
      operation: "add",
      content: `Comment ${attempt}`,
      videoTimestampMs: attempt,
    });
  }

  it("counts only requests for a Clip that opened, so made-up ids can't push a reader's bucket out", async () => {
    __resetContentClipRateLimitsForTests({ buckets: 2 });
    const write = await token({ scope: SCOPES.comment });
    await spendWrites(write);
    for (const recordingId of ["made-up-1", "made-up-2", "made-up-3"]) {
      expect(
        (await playback(recordingId, await token({ recordingId }))).status,
      ).toBe(404);
    }
    expect((await addComment(write, 30)).status).toBe(429);
  });

  it("drops the oldest bucket when the map is full, refusing no new reader", async () => {
    __resetContentClipRateLimitsForTests({ buckets: 2 });
    const write = await token({ scope: SCOPES.comment });
    await spendWrites(write);
    expect(
      (await listComments("rec-upload", await token({ sub: OTHER_READER })))
        .status,
    ).toBe(200);
    expect(
      (await playback("rec-upload", await publicReaderToken())).status,
    ).toBe(200);
    // The spent bucket was the oldest, so the reader starts a fresh window.
    expect((await addComment(write, 30)).status).toBe(200);
  });

  it("still refuses a reader at their limit while the map has room", async () => {
    __resetContentClipRateLimitsForTests({ buckets: 3 });
    const write = await token({ scope: SCOPES.comment });
    await spendWrites(write);
    expect(
      (await playback("rec-upload", await token({ sub: OTHER_READER }))).status,
    ).toBe(200);
    expect((await addComment(write, 30)).status).toBe(429);
  });

  it("refuses a made-up id once its misses are spent, and nothing else", async () => {
    __resetContentClipRateLimitsForTests({ misses: 2 });
    const reader = await token();
    const madeUp = await token({ recordingId: "made-up-1" });
    expect((await playback("rec-upload", reader)).status).toBe(200);
    expect((await playback("made-up-1", madeUp)).status).toBe(404);
    expect((await playback("made-up-1", madeUp)).status).toBe(404);
    expect((await playback("made-up-1", madeUp)).status).toBe(429);
    expect(
      (await playback("made-up-2", await token({ recordingId: "made-up-2" })))
        .status,
    ).toBe(404);
    expect((await playback("rec-upload", reader)).status).toBe(200);
    expect(
      (
        await playback(
          "made-up-1",
          await token({ recordingId: "made-up-1", sub: OTHER_READER }),
        )
      ).status,
    ).toBe(404);
  });

  it("counts a burst's requests before any of them opens the Clip", async () => {
    __resetContentClipRateLimitsForTests({ misses: 2 });
    const madeUp = await token({ recordingId: "made-up-1" });
    // This database answers before the next request's token is verified, so
    // hold every lookup until the whole burst has been checked.
    let opening = 0;
    let answered = 0;
    const gate: { open?: () => void } = {};
    const held = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    state.beforeClipOpens = async () => {
      opening += 1;
      await held;
    };
    try {
      const requests = Array.from({ length: 6 }, async () => {
        const { status } = await playback("made-up-1", madeUp);
        answered += 1;
        return status;
      });
      await vi.waitFor(() => expect(opening + answered).toBe(6));
      gate.open?.();
      const statuses = await Promise.all(requests);
      expect(opening).toBe(2);
      expect(statuses.sort((a, b) => a - b)).toEqual([
        404, 404, 429, 429, 429, 429,
      ]);
    } finally {
      gate.open?.();
      state.beforeClipOpens = null;
    }
  });

  it("refuses a Clip that opened and then went away once its misses are spent", async () => {
    __resetContentClipRateLimitsForTests({ misses: 2 });
    const reader = await token();
    expect((await playback("rec-upload", reader)).status).toBe(200);
    await setBindingState("binding-doc-1", "trashed");
    expect((await playback("rec-upload", reader)).status).toBe(404);
    expect((await playback("rec-upload", reader)).status).toBe(404);
    expect((await playback("rec-upload", reader)).status).toBe(429);
  });

  it("lets no signed-out reader's misses stop another's first open on the page", async () => {
    __resetContentClipRateLimitsForTests({ misses: 1 });
    for (const recordingId of ["made-up-1", "made-up-2", "made-up-3"]) {
      const madeUp = await publicReaderToken({ recordingId });
      expect((await playback(recordingId, madeUp)).status).toBe(404);
      expect((await playback(recordingId, madeUp)).status).toBe(429);
    }
    expect(
      (await playback("rec-upload", await publicReaderToken())).status,
    ).toBe(200);
  });

  it("forgets the oldest misses when the map is full, locking no one out", async () => {
    __resetContentClipRateLimitsForTests({ buckets: 2, misses: 1 });
    const first = await token({ recordingId: "made-up-1" });
    const second = await token({ recordingId: "made-up-2" });
    expect((await playback("made-up-1", first)).status).toBe(404);
    expect((await playback("made-up-1", first)).status).toBe(429);
    expect((await playback("made-up-2", second)).status).toBe(404);
    expect(
      (await playback("made-up-3", await token({ recordingId: "made-up-3" })))
        .status,
    ).toBe(404);
    expect((await playback("made-up-2", second)).status).toBe(429);
    expect((await playback("made-up-1", first)).status).toBe(404);
  });
});
