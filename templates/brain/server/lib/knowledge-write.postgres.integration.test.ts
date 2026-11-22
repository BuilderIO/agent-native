import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const POSTGRES_URL = process.env.BRAIN_POSTGRES_URL;
const QA = "qa-fleet@builder.io";
const STAMP = "2026-11-18T12:00:00.000Z";

const harness = vi.hoisted(() => ({
  autoRedactEmails: false,
  notifications: [] as string[],
  failNotifications: false,
  telemetry: [] as string[],
}));

vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getSetting: async () => ({
    sourcePolicy: "strict",
    defaultPublishTier: "company",
    autoRedactEmails: harness.autoRedactEmails,
  }),
}));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  track: (event: string) => {
    harness.telemetry.push(event);
  },
}));
vi.mock("@agent-native/core/resources/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/resources/store")>();
  const observe = <T>(
    label: string,
    write: { value: T; notifyAfterCommit: () => void | Promise<void> },
  ) => ({
    ...write,
    notifyAfterCommit: async () => {
      if (harness.failNotifications) throw new Error("notification failed");
      harness.notifications.push(label);
      await write.notifyAfterCommit();
    },
  });
  return {
    ...actual,
    resourcePutWithDb: async (
      ...args: Parameters<typeof actual.resourcePutWithDb>
    ) => observe(`change:${args[2]}`, await actual.resourcePutWithDb(...args)),
    resourceDeleteWithDb: async (
      ...args: Parameters<typeof actual.resourceDeleteWithDb>
    ) =>
      observe(`delete:${args[1]}`, await actual.resourceDeleteWithDb(...args)),
  };
});

type Db = ReturnType<typeof import("../db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../db/schema.js");
let brain: typeof import("./brain.js");
let intelligence: typeof import("./intelligence.js");
let runWithRequestContext: typeof import("@agent-native/core/server/request-context").runWithRequestContext;

const asQa = async <T>(work: () => Promise<T>): Promise<T> =>
  await runWithRequestContext({ userEmail: QA, orgId: "qa-org" }, work);

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

function postgresCode(error: unknown): string | undefined {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.code === "string") return current.code;
    current = current.cause as typeof current;
  }
  return undefined;
}

function isForcedFailure(error: unknown) {
  let current = error as { message?: string; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current.message?.includes("forced failure")) return true;
    current = current.cause as typeof current;
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function query(text: string) {
  return rowsOf(await getDb().execute(sql.raw(text)));
}

const openHolders: Array<() => void> = [];

async function holdRows(table: string, ids: string[]) {
  let release!: (work?: (tx: Db) => Promise<void>) => void;
  const released = new Promise<((tx: Db) => Promise<void>) | undefined>(
    (resolve) => {
      release = resolve;
    },
  );
  let held!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => {
    held = resolve;
  });
  const done = getDb().transaction(async (tx) => {
    const holderPid = Number(
      only(rowsOf(await tx.execute(sql`SELECT pg_backend_pid() AS pid`))).pid,
    );
    for (const id of ids)
      await tx.execute(
        sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${id} FOR UPDATE`,
      );
    held(holderPid);
    const work = await released;
    if (work) await work(tx as unknown as Db);
  });
  openHolders.push(() => release());
  return { pid: await pid, release, done };
}

async function waitUntilBlocked(settled: () => boolean, waiters = 1) {
  for (;;) {
    if (settled()) return false;
    const waiting = await query(
      "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
    );
    if (waiting.length >= waiters) return true;
    // fixed-sleep-ok: polling interval between pg_stat_activity observations
    await sleep(5);
  }
}

function only<T>(rows: readonly T[]): T {
  const row: T | undefined = rows[0];
  if (row === undefined) throw new Error("Expected a row.");
  return row;
}

function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  void outcome.then(() => {
    state.settled = true;
  });
  return { state, outcome };
}

const CONTENT_A = "Morgan will ship Atlas by Friday.";
const CONTENT_B = "Atlas depends on the security review.";

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const target = new URL(POSTGRES_URL);
  if (!/(^|_)test(_|$)/.test(target.pathname.slice(1).toLowerCase()))
    throw new Error(
      'BRAIN_POSTGRES_URL must name an isolated database whose name has a standalone "test" word, such as brain_test.',
    );
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  brain = await import("./brain.js");
  intelligence = await import("./intelligence.js");
  ({ runWithRequestContext } =
    await import("@agent-native/core/server/request-context"));
  await (await import("../plugins/db.js")).default(undefined as never);
  await getDb().execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT, created_by TEXT, created_at BIGINT,
      identity_authority TEXT, identity_id TEXT)`),
  );
  await getDb().execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
      joined_at BIGINT, federation_removal_pending_at BIGINT)`),
  );
  const { ensureResourceStoreReady } =
    await import("@agent-native/core/resources/store");
  await ensureResourceStoreReady();
}, 120_000);

afterAll(async () => {
  if (!POSTGRES_URL) return;
  await query("DROP TRIGGER IF EXISTS fail_supersession ON brain_knowledge");
  await query(
    "DROP TRIGGER IF EXISTS fail_capture_update ON brain_raw_captures",
  );
  await query(
    "DROP TRIGGER IF EXISTS fail_access_invalidation ON brain_ingest_queue",
  );
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  for (const release of openHolders.splice(0)) release();
});

beforeEach(async () => {
  if (!POSTGRES_URL) return;
  harness.autoRedactEmails = false;
  harness.notifications.length = 0;
  harness.failNotifications = false;
  harness.telemetry.length = 0;
  await query("DROP TRIGGER IF EXISTS fail_supersession ON brain_knowledge");
  await query(
    "DROP TRIGGER IF EXISTS fail_capture_update ON brain_raw_captures",
  );
  await query(
    "DROP TRIGGER IF EXISTS fail_access_invalidation ON brain_ingest_queue",
  );
  await query(
    `TRUNCATE brain_sources, brain_search_artifacts, brain_raw_captures, brain_audiences, brain_audience_members, brain_capture_audiences, brain_knowledge, brain_knowledge_intelligence, brain_knowledge_verifications, brain_knowledge_shares, brain_source_shares, brain_proposals, brain_sensitivity_events, resources, org_members, organizations`,
  );
  await query(
    `INSERT INTO organizations (id, name, created_by, created_at) VALUES ('qa-org', 'QA', '${QA}', 0)`,
  );
  await query(
    `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ('owner', 'qa-org', '${QA}', 'owner', 0)`,
  );
  const db = getDb();
  await db.insert(schema.brainSources).values({
    id: "source",
    title: "Meeting notes",
    provider: "manual",
    ownerEmail: QA,
    orgId: "qa-org",
    visibility: "org",
  });
  await db.insert(schema.brainAudiences).values({
    id: "audience",
    sourceId: "source",
    kind: "org",
    aclHash: "acl",
    membershipState: "current",
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db.insert(schema.brainAudienceMembers).values({
    id: "member",
    audienceId: "audience",
    principalType: "org",
    principalId: "qa-org",
    syncedAt: STAMP,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await seedCaptures();
});

async function seedCaptures() {
  await query(
    "DELETE FROM brain_capture_audiences; DELETE FROM brain_raw_captures",
  );
  const db = getDb();
  for (const [id, content] of [
    ["capture-a", CONTENT_A],
    ["capture-b", CONTENT_B],
  ] as const) {
    await db.insert(schema.brainRawCaptures).values({
      id,
      sourceId: "source",
      externalId: `external-${id}`,
      title: id,
      content,
      capturedAt: STAMP,
      sensitivityDisposition: "allowed",
      importedBy: QA,
      audienceAclHash: "acl",
    });
    await db.insert(schema.brainCaptureAudiences).values({
      id: `link-${id}`,
      captureId: id,
      audienceId: "audience",
      aclHash: "acl",
      createdAt: STAMP,
    });
  }
}

const write = (
  input: Parameters<typeof import("./brain.js").writeKnowledgeRecord>[0],
) => asQa(() => brain.writeKnowledgeRecord(input));

const publishInput = (existing?: { id: string; revision: string }) => ({
  ...(existing
    ? { knowledgeId: existing.id, expectedRevision: existing.revision }
    : {}),
  title: "Atlas launch",
  body: "Morgan ships Atlas on Friday.",
  evidence: [{ captureId: "capture-a", quote: "Morgan will ship Atlas" }],
  publishTier: "company" as const,
  publishCanonical: true,
});

const resourcePaths = async () =>
  (await query("SELECT path FROM resources WHERE owner = '__shared__'")).map(
    (row) => String(row.path),
  );

async function knowledgeRows() {
  return query(
    "SELECT id, status, published_resource_path AS path, evidence_json, provenance_json FROM brain_knowledge ORDER BY id",
  );
}

async function failSupersessionWithTrigger() {
  await query(`CREATE OR REPLACE FUNCTION fail_supersession() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'forced failure after the resource write'; END $$ LANGUAGE plpgsql`);
  await query(
    `CREATE TRIGGER fail_supersession BEFORE UPDATE ON brain_knowledge FOR EACH ROW WHEN (NEW.status = 'archived') EXECUTE FUNCTION fail_supersession()`,
  );
}

async function failCaptureUpdateWithTrigger() {
  await query(`CREATE OR REPLACE FUNCTION fail_capture_update() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'forced failure before the capture update'; END $$ LANGUAGE plpgsql`);
  await query(
    `CREATE TRIGGER fail_capture_update BEFORE UPDATE ON brain_raw_captures FOR EACH ROW WHEN (NEW.title = 'retitled') EXECUTE FUNCTION fail_capture_update()`,
  );
}

async function failAccessInvalidationWithTrigger() {
  await query(`CREATE OR REPLACE FUNCTION fail_access_invalidation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'forced failure while queueing the access change'; END $$ LANGUAGE plpgsql`);
  await query(
    `CREATE TRIGGER fail_access_invalidation BEFORE INSERT ON brain_ingest_queue FOR EACH ROW WHEN (NEW.payload_json LIKE '%"reason":"access-changed"%') EXECUTE FUNCTION fail_access_invalidation()`,
  );
}

it("has a PostgreSQL URL when the job requires one", () => {
  expect(!process.env.BRAIN_POSTGRES_REQUIRED || Boolean(POSTGRES_URL)).toBe(
    true,
  );
});

// oracle-change: new real-PostgreSQL suite that runs only where BRAIN_POSTGRES_URL names a test database; CI requires it
describe.skipIf(!POSTGRES_URL)(
  "canonical resources commit or roll back with the knowledge row",
  () => {
    it("publishes the resource, row and notification together after commit", async () => {
      const saved = await write(publishInput());
      const path = saved.knowledge.publishedResourcePath;
      expect(path).toMatch(/^context\/company-brain\//);
      expect(await resourcePaths()).toEqual([path]);
      expect(harness.notifications).toEqual([`change:${path}`]);
      const row = only(await knowledgeRows());
      expect(row.path).toBe(path);
      expect(row.provenance_json).not.toBeNull();
    });

    it("rolls back the new resource, row and supersession, with no notification, when a later statement fails", async () => {
      const older = await write({
        title: "Older decision",
        body: "Standalone older decision.",
      });
      await failSupersessionWithTrigger();
      await expect(
        write({
          ...publishInput(),
          supersedesId: older.knowledge.id,
          supersedesRevision: older.knowledge.revision,
        }),
      ).rejects.toSatisfy(isForcedFailure);
      expect(await resourcePaths()).toEqual([]);
      expect((await knowledgeRows()).map((row) => row.id)).toEqual([
        older.knowledge.id,
      ]);
      expect(harness.notifications).toEqual([]);
      expect(harness.telemetry).toEqual(["knowledge_created"]);
    });

    it("rolls back an update that would replace the canonical resource, keeping the old one", async () => {
      const first = await write(publishInput());
      const oldPath = first.knowledge.publishedResourcePath;
      const older = await write({ title: "Other", body: "Other standalone." });
      harness.notifications.length = 0;
      await failSupersessionWithTrigger();
      await expect(
        write({
          ...publishInput(first.knowledge),
          title: "Atlas launch renamed",
          supersedesId: older.knowledge.id,
          supersedesRevision: older.knowledge.revision,
        }),
      ).rejects.toSatisfy(isForcedFailure);
      expect(await resourcePaths()).toEqual([oldPath]);
      expect(harness.notifications).toEqual([]);
      const row = only(
        (await knowledgeRows()).filter(
          (entry) => entry.id === first.knowledge.id,
        ),
      );
      expect(row.path).toBe(oldPath);
    });

    it("redaction removes the canonical resource in the same commit and notifies once afterwards", async () => {
      const first = await write(publishInput());
      harness.notifications.length = 0;
      const redacted = await write({
        ...publishInput(first.knowledge),
        redactions: ["Friday"],
      });
      expect(redacted.knowledge.status).toBe("redacted");
      expect(redacted.knowledge.publishedResourcePath).toBeNull();
      expect(await resourcePaths()).toEqual([]);
      expect(harness.notifications).toHaveLength(1);
      expect(harness.notifications[0]).toMatch(/^delete:/);
    });

    it("reports a failed notification as a post-commit warning, not a rollback", async () => {
      harness.failNotifications = true;
      const saved = await write(publishInput());
      expect(saved.postCommitWarnings).toHaveLength(1);
      expect(await resourcePaths()).toEqual([
        saved.knowledge.publishedResourcePath,
      ]);
      expect((await knowledgeRows()).map((row) => row.id)).toEqual([
        saved.knowledge.id,
      ]);
    });

    it("retries with the resource store ready when a concurrent publication appears after the pre-read", async () => {
      const standalone = await write({
        title: "Standalone decision",
        body: "Standalone body.",
      });
      const id = standalone.knowledge.id;
      const holder = await holdRows("brain_knowledge", [id]);
      const writer = track(
        write({
          knowledgeId: id,
          expectedRevision: standalone.knowledge.revision,
          title: "Renamed",
          body: "Renamed body.",
        }),
      );
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx.execute(
          sql`UPDATE brain_knowledge SET published_resource_path = 'context/company-brain/stale.md' WHERE id = ${id}`,
        );
      });
      await holder.done;
      const outcome = await writer.outcome;
      expect(outcome.ok ? "ok" : String(outcome.error)).toBe("ok");
      const row = only(
        (await knowledgeRows()).filter((entry) => entry.id === id),
      );
      expect(await resourcePaths()).toEqual(row.path ? [row.path] : []);
    });

    it("superseding published knowledge removes the old canonical resource and clears its path", async () => {
      const older = await write(publishInput());
      const oldPath = older.knowledge.publishedResourcePath;
      const newer = await write({
        ...publishInput(),
        title: "Atlas launch v2",
        supersedesId: older.knowledge.id,
        supersedesRevision: older.knowledge.revision,
      });
      const newPath = newer.knowledge.publishedResourcePath;
      expect(newPath).toBeTruthy();
      expect(newPath).not.toBe(oldPath);
      expect(await resourcePaths()).toEqual([newPath]);
      const oldRow = only(
        (await knowledgeRows()).filter((row) => row.id === older.knowledge.id),
      );
      expect(oldRow.status).toBe("archived");
      expect(oldRow.path).toBeNull();
      expect(
        harness.notifications.filter((entry) => entry.startsWith("delete:")),
      ).toHaveLength(1);
    });

    it("keeps the superseded record and its canonical resource when the superseded revision is stale", async () => {
      const older = await write(publishInput());
      const edited = await write({
        ...publishInput(older.knowledge),
        body: "Morgan ships Atlas next Friday.",
      });
      const oldPath = edited.knowledge.publishedResourcePath;
      const before = await knowledgeRows();
      harness.notifications.length = 0;
      const outcome = await track(
        write({
          ...publishInput(),
          title: "Atlas launch v2",
          supersedesId: older.knowledge.id,
          supersedesRevision: older.knowledge.revision,
        }),
      ).outcome;
      expect(outcome.ok ? "written" : outcome.error).toMatchObject({
        errorCode: "save_conflict",
        details: {
          current: { id: older.knowledge.id, publishedResourcePath: oldPath },
          currentRevision: edited.knowledge.revision,
        },
      });
      expect(await knowledgeRows()).toEqual(before);
      expect(await resourcePaths()).toEqual([oldPath]);
      expect(harness.notifications).toEqual([]);
    });

    it("counts a resent canonical update as applied only while its mirror holds what publishing writes", async () => {
      const created = await write(publishInput());
      const edit = {
        ...publishInput(created.knowledge),
        body: "Morgan ships Atlas next Friday.",
      };
      const first = await write(edit);
      const path = first.knowledge.publishedResourcePath;
      expect(await resourcePaths()).toEqual([path]);
      const resent = await write(edit);
      expect(resent.knowledge).toEqual(first.knowledge);
      await getDb().execute(
        sql`DELETE FROM resources WHERE owner = '__shared__' AND path = ${path}`,
      );
      const before = await knowledgeRows();
      const outcome = await track(write(edit)).outcome;
      expect(outcome.ok ? "written" : outcome.error).toMatchObject({
        errorCode: "save_conflict",
        statusCode: 409,
        details: {
          current: { id: first.knowledge.id, publishedResourcePath: path },
          currentRevision: first.knowledge.revision,
        },
      });
      expect(await knowledgeRows()).toEqual(before);
      expect(await resourcePaths()).toEqual([]);
    });

    it("answers a stale writer whose evidence grew while it waited with the current record", async () => {
      const saved = await write({
        title: "Atlas launch",
        body: "Morgan ships Atlas on Friday.",
        evidence: [{ captureId: "capture-a", quote: "Morgan will ship Atlas" }],
        publishTier: "company",
      });
      const id = saved.knowledge.id;
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const grower = track(
        write({
          knowledgeId: id,
          expectedRevision: saved.knowledge.revision,
          title: "Atlas launch",
          body: "Morgan ships Atlas after the security review.",
          evidence: [
            { captureId: "capture-a", quote: "Morgan will ship Atlas" },
            { captureId: "capture-b", quote: "the security review" },
          ],
          publishTier: "company",
        }),
      );
      expect(await waitUntilBlocked(() => grower.state.settled)).toBe(true);
      const stale = track(
        write({
          knowledgeId: id,
          expectedRevision: saved.knowledge.revision,
          title: "Atlas launch",
          body: "A stale edit of Atlas.",
          evidence: [
            { captureId: "capture-a", quote: "Morgan will ship Atlas" },
          ],
          publishTier: "company",
        }),
      );
      expect(await waitUntilBlocked(() => stale.state.settled, 2)).toBe(true);
      holder.release();
      await holder.done;
      const grown = await grower.outcome;
      if (!grown.ok) throw grown.error;
      const outcome = await stale.outcome;
      expect(outcome.ok ? "written" : outcome.error).toMatchObject({
        errorCode: "save_conflict",
        statusCode: 409,
        details: {
          current: {
            id,
            body: "Morgan ships Atlas after the security review.",
          },
          currentRevision: grown.value.knowledge.revision,
        },
      });
      expect(
        only((await knowledgeRows()).filter((row) => row.id === id))
          .evidence_json,
      ).toContain("capture-b");
    });

    it("unpublishing deletes the resource atomically and notifies after commit", async () => {
      const saved = await write(publishInput());
      harness.notifications.length = 0;
      await asQa(() =>
        brain.setKnowledgeCanonicalResource(
          saved.knowledge.id,
          false,
          saved.knowledge.revision,
        ),
      );
      expect(await resourcePaths()).toEqual([]);
      expect(harness.notifications).toHaveLength(1);
      expect(harness.notifications[0]).toMatch(/^delete:/);
    });
  },
);

// oracle-change: new real-PostgreSQL suite that runs only where BRAIN_POSTGRES_URL names a test database; CI requires it
describe.skipIf(!POSTGRES_URL)(
  "capture finalization commits audience, row and invalidation together",
  () => {
    const capture = (overrides: Record<string, unknown> = {}) => ({
      sourceId: "source",
      externalId: "external-capture-a",
      title: "capture-a",
      kind: "generic" as const,
      content: CONTENT_A,
      ...overrides,
    });

    const audienceState = async () => ({
      audiences: await query(
        "SELECT id, acl_hash FROM brain_audiences ORDER BY id",
      ),
      links: await query(
        "SELECT id, audience_id FROM brain_capture_audiences ORDER BY id",
      ),
    });

    it("rejects a reimport whose capture changed while it waited for the row lock", async () => {
      const oldHash = await brain.contentHash(CONTENT_A);
      const newHash = await brain.contentHash(CONTENT_B);
      await getDb()
        .update(schema.brainRawCaptures)
        .set({
          contentHash: oldHash,
          kind: "generic",
          status: "distilled",
          distilledAt: STAMP,
        })
        .where(eq(schema.brainRawCaptures.id, "capture-a"));
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(asQa(() => brain.createCapture(capture())));
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx
          .update(schema.brainRawCaptures)
          .set({
            content: CONTENT_B,
            contentHash: newHash,
            status: "queued",
            distilledAt: null,
          })
          .where(eq(schema.brainRawCaptures.id, "capture-a"));
      });
      await holder.done;
      const outcome = await writer.outcome;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("stale write unexpectedly succeeded");
      expect(outcome.error).toBeInstanceOf(brain.BrainCaptureConcurrentError);
      expect(
        only(
          await getDb()
            .select()
            .from(schema.brainRawCaptures)
            .where(eq(schema.brainRawCaptures.id, "capture-a")),
        ),
      ).toMatchObject({
        content: CONTENT_B,
        contentHash: newHash,
        status: "queued",
        distilledAt: null,
      });
    });

    it("rejects a stale blocked reimport before changing a newer capture or recording a block", async () => {
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(
        asQa(() =>
          brain.createCapture(
            capture({
              content: "password: fake-value",
              privacyClassifier: "deterministic",
            }),
          ),
        ),
      );
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx
          .update(schema.brainRawCaptures)
          .set({
            content: CONTENT_B,
            contentHash: await brain.contentHash(CONTENT_B),
            status: "queued",
            sensitivityDisposition: "allowed",
          })
          .where(eq(schema.brainRawCaptures.id, "capture-a"));
      });
      await holder.done;
      const outcome = await writer.outcome;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("stale block unexpectedly succeeded");
      expect(outcome.error).toBeInstanceOf(brain.BrainCaptureConcurrentError);
      expect(
        only(
          await getDb()
            .select()
            .from(schema.brainRawCaptures)
            .where(eq(schema.brainRawCaptures.id, "capture-a")),
        ),
      ).toMatchObject({
        content: CONTENT_B,
        status: "queued",
        sensitivityDisposition: "allowed",
      });
      expect(await query("SELECT id FROM brain_sensitivity_events")).toEqual(
        [],
      );
    });

    it("a changed capture with a null stored hash removes the stale canonical resource and derived knowledge", async () => {
      await write(publishInput());
      expect(await resourcePaths()).toHaveLength(1);
      await query(
        "UPDATE brain_raw_captures SET content_hash = NULL WHERE id = 'capture-a'",
      );
      harness.notifications.length = 0;
      await asQa(() =>
        brain.createCapture(capture({ content: `${CONTENT_A} Revised.` })),
      );
      expect(await resourcePaths()).toEqual([]);
      for (const row of await knowledgeRows()) {
        expect(row.path).toBeNull();
        expect(row.status).not.toBe("published");
      }
      expect(harness.notifications.map((entry) => entry.split(":")[0])).toEqual(
        ["delete"],
      );
    });

    it("reports a failed resource notification as a post-commit warning on the capture write", async () => {
      await write(publishInput());
      harness.failNotifications = true;
      const written = await asQa(() =>
        brain.createCaptureWithWarnings(
          capture({ content: `${CONTENT_A} Revised.` }),
        ),
      );
      expect(written.postCommitWarnings).toHaveLength(1);
      expect(await resourcePaths()).toEqual([]);
      const plain = await asQa(() =>
        brain.createCaptureWithWarnings(
          capture({ content: `${CONTENT_A} Revised again.` }),
        ),
      );
      expect(plain.postCommitWarnings).toBeUndefined();
    });

    const sharedAudience = (members: string[]) => ({
      kind: "restricted" as const,
      upstreamRefHash: "shared-upstream-group",
      memberEmails: members,
    });

    async function linkBothCapturesToOneAudience() {
      for (const id of ["a", "b"])
        await asQa(() =>
          brain.createCapture(
            capture({
              externalId: `external-capture-${id}`,
              title: `capture-${id}`,
              content: id === "a" ? CONTENT_A : CONTENT_B,
              audience: sharedAudience([QA]),
            }),
          ),
        );
      const links = await query(
        "SELECT DISTINCT audience_id FROM brain_capture_audiences",
      );
      expect(links).toHaveLength(1);
    }

    it("a membership change locks every capture of the audience in sorted order, so a multi-capture writer cannot deadlock it", async () => {
      await linkBothCapturesToOneAudience();
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(
        asQa(() =>
          brain.createCapture(
            capture({
              externalId: "external-capture-b",
              title: "capture-b",
              content: `${CONTENT_B} Updated.`,
              audience: sharedAudience([QA, "second-member@example.test"]),
            }),
          ),
        ),
      );
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM brain_raw_captures WHERE id = ${"capture-b"} FOR UPDATE`,
        );
      });
      const held = await holder.done.then(
        () => "ok",
        (error: unknown) => postgresCode(error) ?? String(error),
      );
      const outcome = await writer.outcome;
      expect(held).toBe("ok");
      expect(outcome.ok ? "ok" : postgresCode(outcome.error)).toBe("ok");
    });

    it("reports a failed audience invalidation after commit as a warning and keeps the committed capture", async () => {
      await linkBothCapturesToOneAudience();
      await failAccessInvalidationWithTrigger();
      const written = await asQa(() =>
        brain.createCaptureWithWarnings(
          capture({
            externalId: "external-capture-b",
            title: "capture-b",
            content: `${CONTENT_B} Updated.`,
            audience: sharedAudience([QA, "second-member@example.test"]),
          }),
        ),
      );
      expect(written.postCommitWarnings).toHaveLength(1);
      expect(written).toMatchObject({
        capture: { content: `${CONTENT_B} Updated.` },
      });
    });

    it("a failed index queue insert for the capture itself is a post-commit warning, not a failed write", async () => {
      await query(`CREATE OR REPLACE FUNCTION fail_access_invalidation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure while queueing the capture refresh'; END $$ LANGUAGE plpgsql`);
      await query(
        `CREATE TRIGGER fail_access_invalidation BEFORE INSERT ON brain_ingest_queue FOR EACH ROW WHEN (NEW.capture_id = 'capture-a') EXECUTE FUNCTION fail_access_invalidation()`,
      );
      const written = await asQa(() =>
        brain.createCaptureWithWarnings(
          capture({ content: `${CONTENT_A} Revised.` }),
        ),
      );
      expect(written.postCommitWarnings).toHaveLength(1);
      expect(written).toMatchObject({
        capture: { content: `${CONTENT_A} Revised.` },
      });
      const stored = await query(
        "SELECT content FROM brain_raw_captures WHERE id = 'capture-a'",
      );
      expect(stored.map((row) => row.content)).toEqual([
        `${CONTENT_A} Revised.`,
      ]);
    });

    it("never serves superseded text from a stale search entry when queueing and unindexing both fail", async () => {
      await query(
        "UPDATE brain_raw_captures SET content_hash = 'hash-before', sensitivity_policy_version = 'policy-before', sensitivity_disposition = 'allowed' WHERE id = 'capture-a'",
      );
      await query(`INSERT INTO brain_search_artifacts (id, capture_id, source_id, audience_id, acl_hash, title, summary, content_hash, sensitivity_policy_version, index_version, status, captured_at, created_at, updated_at)
        SELECT 'artifact-stale', c.id, c.source_id, ca.audience_id, c.audience_acl_hash, 'capture-a', 'stale superseded summary', c.content_hash, c.sensitivity_policy_version, '1', 'active', '${STAMP}', '${STAMP}', '${STAMP}'
        FROM brain_raw_captures c JOIN brain_capture_audiences ca ON ca.capture_id = c.id WHERE c.id = 'capture-a'`);
      const { hybridSearchArtifacts } = await import("./hybrid-search.js");
      const before = await asQa(() =>
        hybridSearchArtifacts({ query: "superseded" }),
      );
      expect(before.results.map((hit) => hit.id)).toEqual(["artifact-stale"]);
      await query(`CREATE OR REPLACE FUNCTION fail_access_invalidation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure while queueing the capture refresh'; END $$ LANGUAGE plpgsql`);
      await query(
        `CREATE TRIGGER fail_access_invalidation BEFORE INSERT ON brain_ingest_queue FOR EACH ROW WHEN (NEW.capture_id = 'capture-a') EXECUTE FUNCTION fail_access_invalidation()`,
      );
      await query(`CREATE OR REPLACE FUNCTION fail_capture_update() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure while removing the stale entry'; END $$ LANGUAGE plpgsql`);
      await query(
        `CREATE TRIGGER fail_unindex BEFORE UPDATE ON brain_search_artifacts FOR EACH ROW EXECUTE FUNCTION fail_capture_update()`,
      );
      try {
        const written = await asQa(() =>
          brain.createCaptureWithWarnings(
            capture({ content: `${CONTENT_A} Revised.` }),
          ),
        );
        expect(written.postCommitWarnings).toHaveLength(1);
        const stale = await query(
          "SELECT status FROM brain_search_artifacts WHERE id = 'artifact-stale'",
        );
        expect(stale.map((row) => row.status)).toEqual(["active"]);
        const after = await asQa(() =>
          hybridSearchArtifacts({ query: "superseded" }),
        );
        expect(after.results).toEqual([]);
      } finally {
        await query(
          "DROP TRIGGER IF EXISTS fail_unindex ON brain_search_artifacts",
        );
      }
    });

    it("one failed audience invalidation does not skip the remaining captures", async () => {
      await linkBothCapturesToOneAudience();
      await query(`CREATE OR REPLACE FUNCTION fail_access_invalidation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure while queueing the access change'; END $$ LANGUAGE plpgsql`);
      await query(
        `CREATE TRIGGER fail_access_invalidation BEFORE INSERT ON brain_ingest_queue FOR EACH ROW WHEN (NEW.capture_id = 'capture-a' AND NEW.payload_json LIKE '%"reason":"access-changed"%') EXECUTE FUNCTION fail_access_invalidation()`,
      );
      await query("DELETE FROM brain_ingest_queue");
      const written = await asQa(() =>
        brain.createCaptureWithWarnings(
          capture({
            externalId: "external-capture-b",
            title: "capture-b",
            content: `${CONTENT_B} Updated.`,
            audience: sharedAudience([QA, "second-member@example.test"]),
          }),
        ),
      );
      expect(written.postCommitWarnings).toHaveLength(1);
      const queued = await query(
        'SELECT capture_id FROM brain_ingest_queue WHERE payload_json LIKE \'%"reason":"access-changed"%\'',
      );
      expect(queued.map((row) => row.capture_id)).toEqual(["capture-b"]);
    });

    it("surfaces a failed canonical-resource notification raised while refreshing other captures of the audience", async () => {
      await linkBothCapturesToOneAudience();
      const cited = await write({ ...publishInput(), publishCanonical: false });
      await query(
        `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES ('mirror', 'context/company-brain/mirror.md', '__shared__', 'mirror', 'text/markdown', 6, 0, 0)`,
      );
      await query(
        `UPDATE brain_knowledge SET published_resource_path = 'context/company-brain/mirror.md' WHERE id = '${cited.knowledge.id}'`,
      );
      expect(await resourcePaths()).toHaveLength(1);
      harness.failNotifications = true;
      const written = await asQa(() =>
        brain.createCaptureWithWarnings(
          capture({
            externalId: "external-capture-b",
            title: "capture-b",
            content: `${CONTENT_B} Updated.`,
            audience: sharedAudience([QA, "second-member@example.test"]),
          }),
        ),
      );
      expect(written.postCommitWarnings).toHaveLength(1);
      expect(await resourcePaths()).toEqual([]);
    });

    it("rolls back the audience assignment when finalizing the capture fails", async () => {
      const before = await audienceState();
      await failCaptureUpdateWithTrigger();
      await expect(
        asQa(() =>
          brain.createCapture(
            capture({
              title: "retitled",
              audience: { kind: "restricted", memberEmails: [QA] },
            }),
          ),
        ),
      ).rejects.toSatisfy(isForcedFailure);
      expect(await audienceState()).toEqual(before);
    });

    it("commits the audience assignment with the capture when finalizing succeeds", async () => {
      const before = await audienceState();
      await asQa(() =>
        brain.createCapture(
          capture({
            title: "retitled",
            audience: { kind: "restricted", memberEmails: [QA] },
          }),
        ),
      );
      const after = await audienceState();
      expect(after.audiences.length).toBe(before.audiences.length + 1);
      expect(after.links).not.toEqual(before.links);
    });
  },
);

// oracle-change: new real-PostgreSQL suite that runs only where BRAIN_POSTGRES_URL names a test database; CI requires it
describe.skipIf(!POSTGRES_URL)(
  "structured intelligence owns the root transaction",
  () => {
    const structured = () => ({
      kind: "action" as const,
      title: "Ship Atlas",
      body: "Morgan ships Atlas.",
      owner: "Morgan",
      status: "open" as const,
      ownershipConfidence: "explicit" as const,
      confidence: 90,
      entities: [{ type: "person" as const, name: "Morgan" }],
      evidence: [{ captureId: "capture-a", quote: "Morgan will ship Atlas" }],
    });

    it("commits the record and runs deferred work once after the commit", async () => {
      const result = await asQa(() =>
        intelligence.writeIntelligence(structured()),
      );
      expect(result.item.title).toBe("Ship Atlas");
      expect(harness.telemetry).toEqual(["knowledge_created"]);
      expect((await knowledgeRows()).length).toBe(1);
    });

    it("reports a failed notification as a post-commit warning, not a rollback", async () => {
      const created = await asQa(() =>
        intelligence.writeIntelligence(structured()),
      );
      expect(created.postCommitWarnings).toBeUndefined();
      await query(
        `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES ('legacy-resource', 'context/company-brain/legacy.md', '__shared__', 'legacy', 'text/markdown', 6, 0, 0)`,
      );
      await query(
        `UPDATE brain_knowledge SET published_resource_path = 'context/company-brain/legacy.md' WHERE id = '${created.item.id}'`,
      );
      harness.failNotifications = true;
      const edited = await asQa(() =>
        intelligence.writeIntelligence({
          ...structured(),
          id: created.item.id,
          expectedRevision: created.item.revision,
          title: "Ship Atlas renamed",
        }),
      );
      expect(edited.item.title).toBe("Ship Atlas renamed");
      expect(edited.postCommitWarnings).toHaveLength(1);
      expect(await resourcePaths()).toEqual([]);
    });

    it("rolls back the record and runs no deferred work when privacy settings reject it", async () => {
      harness.autoRedactEmails = true;
      await query(
        "UPDATE brain_raw_captures SET content = 'Morgan (morgan@example.test) will ship Atlas.' WHERE id = 'capture-a'",
      );
      await expect(
        asQa(() =>
          intelligence.writeIntelligence({
            ...structured(),
            evidence: [
              {
                captureId: "capture-a",
                quote: "Morgan (morgan@example.test) will ship Atlas.",
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "intelligence_redaction_required" });
      expect(await knowledgeRows()).toEqual([]);
      expect(harness.telemetry).toEqual([]);
    });
  },
);

// oracle-change: new real-PostgreSQL suite that runs only where BRAIN_POSTGRES_URL names a test database; CI requires it
describe.skipIf(!POSTGRES_URL)(
  "knowledge writes serialize with capture changes on real row locks",
  () => {
    const blockedDecision = () => ({
      disposition: "suppressed" as const,
      categories: [],
      confidenceBand: "deterministic" as const,
      policyVersion: "test-policy",
      safeSegments: [],
      safeContent: "",
      classifier: "deterministic" as const,
    });

    async function captureRow(id: string) {
      return only(
        await getDb()
          .select()
          .from(schema.brainRawCaptures)
          .where(sql`${schema.brainRawCaptures.id} = ${id}`),
      );
    }

    async function assertNothingStaleSurvives(captureIds: string[]) {
      for (const row of await knowledgeRows()) {
        const evidence = JSON.parse(String(row.evidence_json)) as Array<{
          captureId: string;
        }>;
        const cites = evidence.some((entry) =>
          captureIds.includes(entry.captureId),
        );
        expect(
          cites,
          `row ${String(row.id)} still cites a changed capture`,
        ).toBe(false);
        expect(row.path).toBeNull();
      }
      expect(await resourcePaths()).toEqual([]);
    }

    it("a publication that waits for a content change binds the new content", async () => {
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(write(publishInput()));
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx.execute(
          sql`UPDATE brain_raw_captures SET content = ${`${CONTENT_A} Confirmed.`} WHERE id = 'capture-a'`,
        );
      });
      await holder.done;
      const outcome = await writer.outcome;
      expect(outcome.ok).toBe(true);
      const read = await asQa(() =>
        import("../../actions/list-knowledge.js").then((module) =>
          module.default.run({ limit: 10 }),
        ),
      );
      expect(read.knowledge.map((entry) => entry.title)).toEqual([
        "Atlas launch",
      ]);
    });

    it("a structured write that waits for a content change snapshots the locked content", async () => {
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(
        asQa(() =>
          intelligence.writeIntelligence({
            kind: "action",
            title: "Ship Atlas",
            body: "Morgan ships Atlas.",
            owner: "Morgan",
            status: "open",
            ownershipConfidence: "explicit",
            confidence: 90,
            entities: [{ type: "person", name: "Morgan" }],
            evidence: [
              { captureId: "capture-a", quote: "Morgan will ship Atlas" },
            ],
          }),
        ),
      );
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx.execute(
          sql`UPDATE brain_raw_captures SET content = ${`${CONTENT_A} Confirmed.`}, content_hash = ${"changed-hash"} WHERE id = ${"capture-a"}`,
        );
      });
      await holder.done;
      const outcome = await writer.outcome;
      expect(outcome.ok ? "ok" : String(outcome.error)).toBe("ok");
      const read = await asQa(() =>
        import("../../actions/list-intelligence.js").then((module) =>
          module.default.run({ limit: 10 }),
        ),
      );
      expect(read.records.map((entry) => entry.title)).toEqual(["Ship Atlas"]);
    });

    it("a publication that waits for a content change that removes the quote is rejected with nothing published", async () => {
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(write(publishInput()));
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      holder.release(async (tx) => {
        await tx.execute(
          sql`UPDATE brain_raw_captures SET content = 'Nothing relevant remains.' WHERE id = 'capture-a'`,
        );
      });
      await holder.done;
      const outcome = await writer.outcome;
      expect(outcome.ok).toBe(false);
      expect(await knowledgeRows()).toEqual([]);
      expect(await resourcePaths()).toEqual([]);
      expect(harness.notifications).toEqual([]);
    });

    it("publication racing a block leaves no stale knowledge or resource", async () => {
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(write(publishInput()));
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      const existing = await captureRow("capture-a");
      const source = only(await getDb().select().from(schema.brainSources));
      const blocker = track(
        brain.recordBlockedCapture({
          id: "capture-a",
          existing,
          source,
          values: {
            sourceId: "source",
            externalId: "external-capture-a",
            title: "capture-a",
            kind: "generic",
            content: CONTENT_A,
          },
          decision: blockedDecision(),
          retentionHours: 1,
        }),
      );
      expect(await waitUntilBlocked(() => writer.state.settled, 2)).toBe(true);
      holder.release();
      await holder.done;
      const written = await writer.outcome;
      expect(written.ok ? "ok" : String(written.error)).toBe("ok");
      const blocked = await blocker.outcome;
      expect(blocked.ok ? "ok" : String(blocked.error)).toBe("ok");
      expect(harness.notifications.map((entry) => entry.split(":")[0])).toEqual(
        ["change", "delete"],
      );
      await assertNothingStaleSurvives(["capture-a"]);
    });

    it("publication racing a retirement leaves no stale knowledge or resource", async () => {
      const holder = await holdRows("brain_raw_captures", ["capture-a"]);
      const writer = track(write(publishInput()));
      expect(await waitUntilBlocked(() => writer.state.settled)).toBe(true);
      const retirement = track(
        brain.retireUpstreamDeletedCapture({
          sourceId: "source",
          externalId: "external-capture-a",
          provider: "manual",
        }),
      );
      expect(await waitUntilBlocked(() => writer.state.settled, 2)).toBe(true);
      holder.release();
      await holder.done;
      const written = await writer.outcome;
      expect(written.ok ? "ok" : String(written.error)).toBe("ok");
      const retired = await retirement.outcome;
      expect(retired.ok ? "ok" : String(retired.error)).toBe("ok");
      expect(harness.notifications.map((entry) => entry.split(":")[0])).toEqual(
        ["change", "delete"],
      );
      await assertNothingStaleSurvives(["capture-a"]);
    });

    it("publication racing an audience revocation never lists the knowledge afterwards", async () => {
      const [writer, revocation] = await Promise.all([
        track(write(publishInput())).outcome,
        track(
          Promise.resolve(
            getDb().execute(
              sql`UPDATE brain_audience_members SET status = 'revoked' WHERE id = 'member'`,
            ),
          ),
        ).outcome,
      ]);
      expect(revocation.ok).toBe(true);
      expect(writer.ok ? "ok" : String(writer.error)).toMatch(
        /^(ok|Error: No access to capture)/,
      );
      const read = await asQa(() =>
        import("../../actions/list-knowledge.js").then((module) =>
          module.default.run({ limit: 10 }),
        ),
      );
      expect(read.knowledge).toEqual([]);
    });

    it("opposite-order multi-capture writers, invalidations and retirements never deadlock", async () => {
      const deadlocks: unknown[] = [];
      for (let round = 0; round < 15; round += 1) {
        await query("TRUNCATE brain_knowledge, resources");
        await seedCaptures();
        const evidenceAB = [
          { captureId: "capture-a", quote: "Morgan will ship Atlas" },
          { captureId: "capture-b", quote: "security review" },
        ];
        const outcomes = await Promise.all([
          track(
            write({
              ...publishInput(),
              title: `AB ${round}`,
              evidence: evidenceAB,
            }),
          ).outcome,
          track(
            write({
              ...publishInput(),
              title: `BA ${round}`,
              evidence: [...evidenceAB].reverse(),
            }),
          ).outcome,
          track(brain.invalidateDerivedForCapture("capture-a")).outcome,
          track(brain.invalidateDerivedForCapture("capture-b")).outcome,
        ]);
        for (const outcome of outcomes)
          if (!outcome.ok && postgresCode(outcome.error) === "40P01")
            deadlocks.push(outcome.error);
      }
      expect(deadlocks).toEqual([]);
    });

    it("a structured edit racing a capture retirement does not deadlock", async () => {
      const structured = {
        kind: "action" as const,
        title: "Ship Atlas",
        body: "Morgan ships Atlas.",
        owner: "Morgan",
        status: "open" as const,
        ownershipConfidence: "explicit" as const,
        confidence: 90,
        entities: [{ type: "person" as const, name: "Morgan" }],
        evidence: [{ captureId: "capture-a", quote: "Morgan will ship Atlas" }],
      };
      const deadlocks: unknown[] = [];
      for (let round = 0; round < 10; round += 1) {
        await query("TRUNCATE brain_knowledge, brain_knowledge_intelligence");
        await seedCaptures();
        const created = await asQa(() =>
          intelligence.writeIntelligence(structured),
        );
        const [edit, retire] = await Promise.all([
          track(
            asQa(() =>
              intelligence.writeIntelligence({
                ...structured,
                id: created.item.id,
                expectedRevision: created.item.revision,
                title: `Ship Atlas ${round}`,
              }),
            ),
          ).outcome,
          track(
            brain.retireUpstreamDeletedCapture({
              sourceId: "source",
              externalId: "external-capture-a",
              provider: "manual",
            }),
          ).outcome,
        ]);
        for (const outcome of [edit, retire])
          if (!outcome.ok && postgresCode(outcome.error) === "40P01")
            deadlocks.push(outcome.error);
      }
      expect(deadlocks).toEqual([]);
    });
  },
);
