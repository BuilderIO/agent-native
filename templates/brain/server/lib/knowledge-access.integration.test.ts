import { PGlite } from "@electric-sql/pglite";
import { eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
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

const harness = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => harness.db,
}));

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  getShareableResource,
  resolveAccess,
  resolveAccessStatus,
} from "@agent-native/core/sharing";
import shareResource from "@agent-native/core/sharing/actions/share-resource";

import { schema } from "../db/index.js";
import { knowledgeContentRevision } from "./intelligence.js";

const qaEmail = "qa-fleet@builder.io";
const title = "Private launch decision";
const quote = "Morgan will ship Atlas.";
const client = new PGlite();
const database = drizzle(client, { schema });
const quoted = (value: string) => `"${value.split('"').join('""')}"`;
const network = vi.fn(() => {
  throw new Error("No external requests are permitted in this test.");
});

beforeAll(async () => {
  const dialect = new PgDialect();
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let definition = `${quoted(column.name)} ${column.getSQLType()}`;
      if (column.primary) definition += " PRIMARY KEY";
      if (column.notNull) definition += " NOT NULL";
      if (column.default !== undefined) {
        const value = column.default;
        const expression =
          value instanceof SQL
            ? dialect.sqlToQuery(value).sql
            : typeof value === "number"
              ? String(value)
              : `'${String(value).split("'").join("''")}'`;
        definition += ` DEFAULT ${expression}`;
      }
      return definition;
    });
    await client.exec(
      `CREATE TABLE ${quoted(config.name)} (${columns.join(", ")})`,
    );
  }
  harness.db = database;
});
afterAll(async () => client.close());
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  for (const table of Object.values(schema)) await database.delete(table);
  network.mockClear();
  vi.stubGlobal("fetch", network);
  const now = "2026-11-18T12:00:00.000Z";
  await database.insert(schema.brainSources).values({
    id: "source",
    title: "Meeting notes",
    provider: "manual",
    ownerEmail: qaEmail,
    visibility: "private",
  });
  await database.insert(schema.brainRawCaptures).values({
    id: "capture",
    sourceId: "source",
    title: "Planning",
    content: quote,
    contentHash: "current-hash",
    capturedAt: now,
    sensitivityDisposition: "allowed",
    importedBy: qaEmail,
  });
  await database.insert(schema.brainAudiences).values({
    id: "audience",
    sourceId: "source",
    kind: "restricted",
    aclHash: "acl",
    membershipState: "current",
  });
  await database.insert(schema.brainAudienceMembers).values({
    id: "member",
    audienceId: "audience",
    principalType: "user",
    principalId: qaEmail,
    syncedAt: now,
  });
  await database.insert(schema.brainCaptureAudiences).values({
    id: "capture-audience",
    captureId: "capture",
    audienceId: "audience",
    aclHash: "acl",
  });
  await database.insert(schema.brainKnowledge).values({
    id: "derived",
    title,
    body: quote,
    ownerEmail: qaEmail,
    visibility: "private",
    createdBy: qaEmail,
    sourceId: "source",
    captureId: "capture",
    audienceId: "audience",
    intelligenceKind: "action",
    evidenceJson: JSON.stringify([
      {
        captureId: "capture",
        sourceId: "source",
        captureTitle: "Planning",
        quote,
      },
    ]),
  });
  const row = (
    await database
      .select()
      .from(schema.brainKnowledge)
      .where(eq(schema.brainKnowledge.id, "derived"))
  ).find((record) => record.id === "derived");
  if (!row) throw new Error("Missing knowledge fixture");
  await database.insert(schema.brainKnowledgeIntelligence).values({
    knowledgeId: "derived",
    kind: "action",
    knowledgeRevision: await knowledgeContentRevision(row),
    evidenceSnapshotsJson: JSON.stringify([
      { captureId: "capture", contentHash: "current-hash" },
    ]),
    updatedAt: now,
  });
  await database.insert(schema.brainKnowledge).values({
    id: "legacy",
    title: "Ordinary knowledge",
    body: "Unmarked manual knowledge.",
    ownerEmail: qaEmail,
    visibility: "private",
    createdBy: qaEmail,
  });
});

async function asQa<T>(work: () => Promise<T>) {
  return runWithRequestContext(
    { userEmail: qaEmail, orgScope: "personal" },
    work,
  );
}

describe("generic intelligence resource access", () => {
  it("denies owner resolution and title exposure after source access is revoked, including status-only loads", async () => {
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toMatchObject({ role: "owner" });
    await database
      .update(schema.brainSources)
      .set({ ownerEmail: "other@example.test" })
      .where(eq(schema.brainSources.id, "source"));
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toBeNull();
    const status = await asQa(() =>
      resolveAccessStatus("brain-knowledge", "derived"),
    );
    expect(status).toEqual({ state: "denied" });
    expect(JSON.stringify(status)).not.toContain(title);
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "legacy")),
    ).toMatchObject({
      role: "owner",
      resource: { title: "Ordinary knowledge" },
    });
  });

  it("uses the requested target identity instead of the actor's readable source context", async () => {
    await database
      .update(schema.brainKnowledge)
      .set({ ownerEmail: "recipient@example.test" })
      .where(eq(schema.brainKnowledge.id, "derived"));
    const access = await asQa(() =>
      resolveAccess("brain-knowledge", "derived", {
        userEmail: "recipient@example.test",
      }),
    );
    expect(access).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("fails closed when the derived audience no longer includes the current owner", async () => {
    await database
      .update(schema.brainAudienceMembers)
      .set({ status: "revoked" })
      .where(eq(schema.brainAudienceMembers.id, "member"));
    expect(
      await asQa(() => resolveAccess("brain-knowledge", "derived")),
    ).toBeNull();
  });
});

describe("generic sharing boundaries", () => {
  it("refuses new grants before persistence or notification without leaking the private title", async () => {
    await asQa(async () => {
      let rejected: unknown;
      try {
        await shareResource.run({
          resourceType: "brain-knowledge",
          resourceId: "derived",
          principalType: "user",
          principalId: qaEmail,
          role: "viewer",
          notify: true,
        });
      } catch (error) {
        rejected = error;
      }
      expect(rejected).toMatchObject({
        message:
          "Evidence-backed intelligence cannot be shared beyond its source audiences.",
      });
      expect(String(rejected)).not.toContain(title);
      expect(JSON.stringify(rejected)).not.toContain(title);
    });
    expect(await database.select().from(schema.brainKnowledgeShares)).toEqual(
      [],
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects visibility broadening from fresh marker state while allowing private tightening and legacy behavior", async () => {
    const registration = getShareableResource("brain-knowledge");
    if (!registration?.assertSharingChange)
      throw new Error("Missing knowledge sharing policy");
    const guard = registration.assertSharingChange;
    await asQa(async () => {
      await expect(
        guard({
          resource: { id: "derived" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).rejects.toThrow("source audiences");
      await expect(
        guard({
          resource: { id: "derived" },
          change: { kind: "visibility", visibility: "private" },
        }),
      ).resolves.toBeUndefined();
      await expect(
        guard({
          resource: { id: "legacy" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
