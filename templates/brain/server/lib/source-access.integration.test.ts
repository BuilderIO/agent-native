import { PGlite } from "@electric-sql/pglite";
import { and, eq, SQL } from "drizzle-orm";
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

const harness = vi.hoisted(() => ({
  db: null as unknown,
  afterSourceAccess: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  createGetDb: () => () => harness.db,
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...original,
    assertAccess: async (...args: Parameters<typeof original.assertAccess>) => {
      const access = await original.assertAccess(...args);
      if (
        args[0] === "brain-source" &&
        args[1] === "legacy-ingest" &&
        harness.afterSourceAccess
      ) {
        const pause = harness.afterSourceAccess;
        harness.afterSourceAccess = undefined;
        await pause();
      }
      return access;
    },
  };
});

import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  accessFilter,
  getShareableResource,
  resolveAccess,
  resolveAccessStatus,
} from "@agent-native/core/sharing";
import shareResource from "@agent-native/core/sharing/actions/share-resource";

import getSource from "../../actions/get-source.js";
import listSources from "../../actions/list-sources.js";
import rotateSourceIngestToken from "../../actions/rotate-source-ingest-token.js";
import updateSource from "../../actions/update-source.js";
import { schema } from "../db/index.js";
import { readBrainScreen, sha256Hex } from "./brain.js";
import { searchEverythingWithLanes } from "./search.js";
import { personalGoogleSourceFilter } from "./source-access.js";
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => ({}),
}));
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getSetting: async () => null,
}));

const qaEmail = "qa-fleet@builder.io";
const title = "Private connected calendar";
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
  await client.exec(
    "CREATE TABLE org_members (id text PRIMARY KEY, org_id text, email text, role text, federation_removal_pending_at text); CREATE TABLE organizations (id text PRIMARY KEY, identity_authority text, identity_id text); INSERT INTO organizations VALUES ('qa-org', NULL, NULL); INSERT INTO org_members VALUES ('recipient', 'qa-org', 'recipient@example.test', 'member', NULL), ('owner', 'qa-org', 'qa-fleet@builder.io', 'owner', NULL)",
  );
  harness.db = database;
});
afterAll(async () => client.close());
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  for (const table of Object.values(schema)) await database.delete(table);
  network.mockClear();
  vi.stubGlobal("fetch", network);
  for (const provider of [
    "google_calendar",
    "gmail",
    "google_drive",
    "manual",
  ] as const) {
    await database.insert(schema.brainSources).values({
      id: provider,
      title: `${title} ${provider}`,
      provider,
      ownerEmail: qaEmail,
      orgId: "qa-org",
      visibility: "org",
      configJson: JSON.stringify({
        sourceUrl: `https://private.example.test/${provider}`,
        google: { fileIds: [`private-${provider}`] },
      }),
    });
  }
});
function asUser<T>(email: string, work: () => T | Promise<T>) {
  return runWithRequestContext(
    { userEmail: email, orgId: "qa-org" },
    async () => work(),
  );
}

async function readIngestSource() {
  const rows = await database
    .select()
    .from(schema.brainSources)
    .where(eq(schema.brainSources.id, "legacy-ingest"));
  const source = rows.find((row) => row.id === "legacy-ingest");
  if (!source) throw new Error("Missing ingest source");
  return source;
}

it("allows only a source admin to rotate a legacy ingest key and stores only the token hash", async () => {
  await database.insert(schema.brainSources).values({
    id: "legacy-ingest",
    title: "Legacy ingest",
    provider: "generic",
    ownerEmail: qaEmail,
    orgId: "qa-org",
    visibility: "org",
    configJson: JSON.stringify({
      sourceKey: "legacy-private-key",
      ingestTokenHash: "old-private-hash",
    }),
  });

  const listed = await asUser("recipient@example.test", async () =>
    listSources.run({}),
  );
  expect(
    listed.sources.find((source) => source.id === "legacy-ingest"),
  ).toMatchObject({ hasIngestSourceKey: true });
  expect(JSON.stringify(listed)).not.toContain("legacy-private-key");
  expect(JSON.stringify(listed)).not.toContain("old-private-hash");
  await expect(
    asUser("recipient@example.test", async () =>
      rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
    ),
  ).rejects.toThrow();
  const before = await readIngestSource();
  expect(before.ingestTokenHash).toBeNull();

  const result = await asUser(qaEmail, async () =>
    rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
  );
  expect(result.sourceKey).toBe("legacy-private-key");
  expect(result.ingestToken).toMatch(/^brain_/);
  const after = await readIngestSource();
  expect(after.sourceKey).toBe("legacy-private-key");
  expect(after.ingestTokenHash).toBe(await sha256Hex(result.ingestToken));
  expect(after.configJson).not.toContain(result.ingestToken);
  expect(JSON.stringify(result.source)).not.toContain("legacy-private-key");
  expect(JSON.stringify(result.source)).not.toContain(after.ingestTokenHash);
});

async function seedSharedIngestSource() {
  await database.insert(schema.brainSources).values({
    id: "legacy-ingest",
    title: "Legacy ingest",
    provider: "generic",
    ownerEmail: qaEmail,
    orgId: "qa-org",
    visibility: "org",
    configJson: JSON.stringify({
      sourceKey: "legacy-key",
      ingestTokenHash: "legacy-hash",
      pollMinutes: 60,
    }),
  });
  await database.insert(schema.brainSourceShares).values({
    id: "editor-share",
    resourceId: "legacy-ingest",
    principalType: "user",
    principalId: "recipient@example.test",
    role: "editor",
  });
}

function pauseNextSourceAccess() {
  let signalRead: () => void = () => {};
  let resume: () => void = () => {};
  const read = new Promise<void>((resolve) => {
    signalRead = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  harness.afterSourceAccess = async () => {
    signalRead();
    await resumed;
  };
  return { read, resume };
}

it("rejects explicitly submitted credentials from editors before saving while allowing ordinary edits and admin key edits", async () => {
  await seedSharedIngestSource();
  const before = await readIngestSource();
  for (const patch of [
    { config: { sourceKey: "attacker-key" } },
    { config: { ingestTokenHash: "attacker-hash" } },
    { configJson: JSON.stringify({ sourceKey: "attacker-key" }) },
    { configJson: JSON.stringify({ ingestTokenHash: "attacker-hash" }) },
    {
      config: { ingestTokenHash: "attacker-hash" },
      configJson: JSON.stringify({ ingestTokenHash: null }),
    },
  ]) {
    await expect(
      asUser("recipient@example.test", () =>
        updateSource.run({
          id: "legacy-ingest",
          title: "Should not save",
          ...patch,
        }),
      ),
    ).rejects.toThrow();
    const after = await readIngestSource();
    expect(after).toEqual(before);
  }
  await asUser("recipient@example.test", () =>
    updateSource.run({ id: "legacy-ingest", config: { pollMinutes: 30 } }),
  );
  const edited = await readIngestSource();
  expect(edited.sourceKey).toBeNull();
  expect(edited.ingestTokenHash).toBeNull();
  expect(JSON.parse(edited.configJson)).toMatchObject({
    sourceKey: "legacy-key",
    ingestTokenHash: "legacy-hash",
    pollMinutes: 30,
  });
  await asUser(qaEmail, () =>
    updateSource.run({ id: "legacy-ingest", config: { sourceKey: "new-key" } }),
  );
  const adminEdited = await readIngestSource();
  expect(adminEdited.sourceKey).toBe("new-key");
});

it("does not copy stale legacy credentials over authoritative columns during an ordinary edit", async () => {
  await seedSharedIngestSource();
  await database
    .update(schema.brainSources)
    .set({ sourceKey: "current-key", ingestTokenHash: "current-hash" })
    .where(eq(schema.brainSources.id, "legacy-ingest"));
  await asUser("recipient@example.test", () =>
    updateSource.run({ id: "legacy-ingest", config: { pollMinutes: 30 } }),
  );
  const saved = await readIngestSource();
  expect(saved.sourceKey).toBe("current-key");
  expect(saved.ingestTokenHash).toBe("current-hash");
  expect(JSON.parse(saved.configJson)).toMatchObject({
    sourceKey: "legacy-key",
    ingestTokenHash: "legacy-hash",
    pollMinutes: 30,
  });
});

it.each(["sourceKey", "ingestTokenHash"] as const)(
  "rejects rotation when only the observed %s column changes",
  async (field) => {
    await seedSharedIngestSource();
    const pause = pauseNextSourceAccess();
    const losing = asUser(qaEmail, () =>
      rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
    );
    await pause.read;
    await database
      .update(schema.brainSources)
      .set({ [field]: "concurrent-value" })
      .where(eq(schema.brainSources.id, "legacy-ingest"));
    pause.resume();
    await expect(losing).rejects.toMatchObject({ statusCode: 409 });
    const saved = await readIngestSource();
    expect(saved[field]).toBe("concurrent-value");
  },
);

it("returns a conflict without a token to the loser of overlapping rotations", async () => {
  await seedSharedIngestSource();
  const pause = pauseNextSourceAccess();
  const losing = asUser(qaEmail, () =>
    rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
  );
  await pause.read;
  const winner = await asUser(qaEmail, () =>
    rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
  );
  pause.resume();
  await expect(losing).rejects.toMatchObject({ statusCode: 409 });
  const saved = await readIngestSource();
  expect(saved.ingestTokenHash).toBe(await sha256Hex(winner.ingestToken));
});

it.each(["rotation", "config"] as const)(
  "rejects a stale %s write when a config update and rotation overlap",
  async (first) => {
    await seedSharedIngestSource();
    const pause = pauseNextSourceAccess();
    const rotate = () =>
      asUser(qaEmail, () =>
        rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
      );
    const edit = () =>
      asUser("recipient@example.test", () =>
        updateSource.run({ id: "legacy-ingest", config: { pollMinutes: 30 } }),
      );
    const losing = first === "rotation" ? rotate() : edit();
    await pause.read;
    const winner = first === "rotation" ? await edit() : await rotate();
    pause.resume();
    await expect(losing).rejects.toMatchObject({ statusCode: 409 });
    const saved = await readIngestSource();
    const expectedHash =
      "ingestToken" in winner && typeof winner.ingestToken === "string"
        ? await sha256Hex(winner.ingestToken)
        : "legacy-hash";
    expect(saved.ingestTokenHash).toBe(
      first === "rotation" ? null : expectedHash,
    );
    expect(JSON.parse(saved.configJson)).toMatchObject({
      pollMinutes: first === "rotation" ? 30 : 60,
      ingestTokenHash: expectedHash,
    });
  },
);

describe("personal connected source privacy", () => {
  it("denies all personal Google generic reads and status projections despite old org visibility", async () => {
    for (const provider of ["google_calendar", "gmail", "google_drive"]) {
      await asUser("recipient@example.test", async () => {
        expect(await resolveAccess("brain-source", provider)).toBeNull();
        expect(await resolveAccessStatus("brain-source", provider)).toEqual({
          state: "denied",
        });
        expect(await getSource.run({ id: provider })).toEqual({ source: null });
      });
    }
    expect(
      await asUser(qaEmail, () => resolveAccess("brain-source", "gmail")),
    ).toMatchObject({ role: "owner" });
    expect(
      await asUser("recipient@example.test", () =>
        resolveAccess("brain-source", "manual"),
      ),
    ).toMatchObject({ role: "viewer" });
  });
  it("filters current source lists, search and screen metadata without changing ordinary org sources", async () => {
    await asUser("recipient@example.test", async () => {
      const rows = await database
        .select()
        .from(schema.brainSources)
        .where(
          and(
            accessFilter(schema.brainSources, schema.brainSourceShares),
            personalGoogleSourceFilter(),
          ),
        );
      expect(rows.map((row) => row.id)).toEqual(["manual"]);
      const listed = await listSources.run({});
      const searched = await searchEverythingWithLanes({
        query: "Private connected",
        type: "source",
      });
      const screen = await readBrainScreen();
      for (const output of [listed, searched, screen]) {
        const encoded = JSON.stringify(output);
        expect(encoded).not.toContain("google_calendar");
        expect(encoded).not.toContain("gmail");
        expect(encoded).not.toContain("google_drive");
      }
    });
  });
  it("uses the explicit target identity rather than the ambient owner", async () => {
    expect(
      await asUser(qaEmail, () =>
        resolveAccess("brain-source", "gmail", {
          userEmail: "recipient@example.test",
          orgId: "qa-org",
        }),
      ),
    ).toBeNull();
  });
  it("refuses grants without storing shares, notifications or private titles", async () => {
    for (const provider of ["google_calendar", "gmail", "google_drive"]) {
      await asUser(qaEmail, async () => {
        let denied: unknown;
        try {
          await shareResource.run({
            resourceType: "brain-source",
            resourceId: provider,
            principalType: "user",
            principalId: "recipient@example.test",
            role: "viewer",
            notify: true,
          });
        } catch (error) {
          denied = error;
        }
        expect(denied).toMatchObject({
          message:
            "Personal connected sources must remain private to their owner.",
        });
        expect(String(denied)).not.toContain(title);
      });
    }
    expect(await database.select().from(schema.brainSourceShares)).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  });
  it("fresh status-only sharing guards forbid broadening and allow private tightening or ordinary sources", async () => {
    const guard = getShareableResource("brain-source")?.assertSharingChange;
    if (!guard) throw new Error("Missing source sharing guard");
    await asUser(qaEmail, async () => {
      for (const provider of ["google_calendar", "gmail", "google_drive"]) {
        await expect(
          guard({
            resource: { id: provider },
            change: { kind: "visibility", visibility: "org" },
          }),
        ).rejects.toThrow("must remain private");
        await expect(
          guard({
            resource: { id: provider },
            change: { kind: "visibility", visibility: "private" },
          }),
        ).resolves.toBeUndefined();
      }
      await expect(
        guard({
          resource: { id: "manual" },
          change: { kind: "visibility", visibility: "org" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
