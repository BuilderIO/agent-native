import { PGlite } from "@electric-sql/pglite";
import { and, eq, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { createApp, toWebHandler } from "h3";
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
import ingestHandler from "../routes/api/_agent-native/brain/ingest.post.js";
import { readBrainScreen, sha256Hex } from "./brain.js";
import { searchEverythingWithLanes } from "./search.js";
import { personalGoogleSourceFilter } from "./source-access.js";
vi.mock("./brain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./brain.js")>()),
  retireUpstreamDeletedCapture: vi.fn(async () => false),
}));
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
    { config: { sourceKey: null } },
    { configJson: JSON.stringify({ ingestTokenHash: null }) },
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

async function sendIngest(sourceKey: string, token: string) {
  const app = createApp();
  app.use(ingestHandler);
  return toWebHandler(app)(
    new Request("http://localhost/", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sourceKey,
        externalId: "example-deletion",
        deleted: true,
      }),
    }),
  );
}

it.each(["sourceKey", "ingestTokenHash"] as const)(
  "keeps legacy signed ingest working after an admin edits %s",
  async (field) => {
    await seedSharedIngestSource();
    const oldToken = "example-old-token";
    const newToken = "example-new-token";
    const oldHash = await sha256Hex(oldToken);
    const newHash = await sha256Hex(newToken);
    await database
      .update(schema.brainSources)
      .set({
        configJson: JSON.stringify({
          sourceKey: "legacy-key",
          ingestTokenHash: oldHash,
        }),
      })
      .where(eq(schema.brainSources.id, "legacy-ingest"));
    expect((await sendIngest("legacy-key", oldToken)).status).toBe(200);
    const patch =
      field === "sourceKey"
        ? { sourceKey: "new-key" }
        : { ingestTokenHash: newHash };
    await asUser(qaEmail, () =>
      updateSource.run(
        field === "sourceKey"
          ? { id: "legacy-ingest", config: patch }
          : { id: "legacy-ingest", configJson: JSON.stringify(patch) },
      ),
    );
    const saved = await readIngestSource();
    const key = field === "sourceKey" ? "new-key" : "legacy-key";
    const hash = field === "sourceKey" ? oldHash : newHash;
    const token = field === "sourceKey" ? oldToken : newToken;
    expect(saved.sourceKey).toBe(key);
    expect(saved.ingestTokenHash).toBe(hash);
    expect(JSON.parse(saved.configJson)).toMatchObject({
      sourceKey: key,
      ingestTokenHash: hash,
    });
    const response = await sendIngest(key, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      sourceId: "legacy-ingest",
      deleted: true,
    });
    expect((await sendIngest("legacy-key", oldToken)).status).toBe(404);
  },
);

it.each(["sourceKey", "ingestTokenHash"] as const)(
  "clears and restores %s without reviving the cleared credential",
  async (field) => {
    await seedSharedIngestSource();
    const token = "example-token";
    const hash = await sha256Hex(token);
    await database
      .update(schema.brainSources)
      .set({
        configJson: JSON.stringify({
          sourceKey: "legacy-key",
          ingestTokenHash: hash,
        }),
      })
      .where(eq(schema.brainSources.id, "legacy-ingest"));
    await asUser(qaEmail, () =>
      updateSource.run({ id: "legacy-ingest", config: { [field]: null } }),
    );
    const cleared = await readIngestSource();
    expect(cleared[field]).toBeNull();
    expect(JSON.parse(cleared.configJson)[field]).toBeNull();
    expect((await sendIngest("legacy-key", token)).status).toBe(404);
    await asUser("recipient@example.test", () =>
      updateSource.run({ id: "legacy-ingest", config: { pollMinutes: 30 } }),
    );
    expect((await readIngestSource())[field]).toBeNull();
    expect((await sendIngest("legacy-key", token)).status).toBe(404);
    await asUser(qaEmail, () =>
      updateSource.run({
        id: "legacy-ingest",
        config: { [field]: field === "sourceKey" ? "legacy-key" : hash },
      }),
    );
    expect((await sendIngest("legacy-key", token)).status).toBe(200);
  },
);

it.each(["sourceKey", "ingestTokenHash"] as const)(
  "rejects invalid %s values before writing",
  async (field) => {
    await seedSharedIngestSource();
    const before = await readIngestSource();
    await expect(
      asUser(qaEmail, () =>
        updateSource.run({
          id: "legacy-ingest",
          title: "Must not save",
          config: { [field]: 42 },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_source_config" });
    expect(await readIngestSource()).toEqual(before);
  },
);

it.each([
  { field: "ingestTokenHash", jsonValue: null, clearColumn: false },
  { field: "ingestTokenHash", jsonValue: undefined, clearColumn: false },
  { field: "ingestTokenHash", jsonValue: "different-hash", clearColumn: false },
  { field: "ingestTokenHash", jsonValue: "stale-hash", clearColumn: true },
  { field: "sourceKey", jsonValue: null, clearColumn: false },
  { field: "sourceKey", jsonValue: undefined, clearColumn: false },
  { field: "sourceKey", jsonValue: "different-key", clearColumn: false },
  { field: "sourceKey", jsonValue: "stale-key", clearColumn: true },
] as const)(
  "rejects an edit when untouched $field disagrees with its indexed column",
  async ({ field, jsonValue, clearColumn }) => {
    await seedSharedIngestSource();
    const oldToken = "example-old-token";
    const newToken = "example-new-token";
    const oldHash = await sha256Hex(oldToken);
    const newHash = await sha256Hex(newToken);
    const config = {
      sourceKey: "indexed-key",
      ingestTokenHash: oldHash,
      [field]: jsonValue,
    };
    await database
      .update(schema.brainSources)
      .set({
        sourceKey: "indexed-key",
        ingestTokenHash: oldHash,
        [field]: clearColumn
          ? null
          : field === "sourceKey"
            ? "indexed-key"
            : oldHash,
        configJson: JSON.stringify(config),
      })
      .where(eq(schema.brainSources.id, "legacy-ingest"));
    const before = await readIngestSource();
    expect((await sendIngest("indexed-key", oldToken)).status).toBe(404);
    const patch =
      field === "ingestTokenHash"
        ? { sourceKey: "new-key" }
        : { ingestTokenHash: newHash };
    await expect(
      asUser(qaEmail, () =>
        updateSource.run({
          id: "legacy-ingest",
          title: "Must not save",
          config: patch,
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "source_config_conflict",
      statusCode: 409,
    });
    expect(await readIngestSource()).toEqual(before);
    expect(
      (
        await sendIngest(
          field === "sourceKey" ? "indexed-key" : "new-key",
          field === "sourceKey" ? newToken : oldToken,
        )
      ).status,
    ).toBe(404);
  },
);

it.each(["sourceKey", "ingestTokenHash"] as const)(
  "preserves coherent indexed credentials when editing %s",
  async (field) => {
    await seedSharedIngestSource();
    const token = "example-token";
    const newToken = "example-new-token";
    const hash = await sha256Hex(token);
    const newHash = await sha256Hex(newToken);
    await database
      .update(schema.brainSources)
      .set({
        sourceKey: "current-key",
        ingestTokenHash: hash,
        configJson: JSON.stringify({
          sourceKey: "current-key",
          ingestTokenHash: hash,
        }),
      })
      .where(eq(schema.brainSources.id, "legacy-ingest"));
    expect((await sendIngest("current-key", token)).status).toBe(200);
    const patch =
      field === "sourceKey"
        ? { sourceKey: "new-key" }
        : { ingestTokenHash: newHash };
    await asUser(qaEmail, () =>
      updateSource.run({ id: "legacy-ingest", config: patch }),
    );
    const saved = await readIngestSource();
    const key = field === "sourceKey" ? "new-key" : "current-key";
    const expectedHash = field === "sourceKey" ? hash : newHash;
    expect(saved.sourceKey).toBe(key);
    expect(saved.ingestTokenHash).toBe(expectedHash);
    expect(JSON.parse(saved.configJson)).toMatchObject({
      sourceKey: key,
      ingestTokenHash: expectedHash,
    });
    expect(
      (await sendIngest(key, field === "sourceKey" ? token : newToken)).status,
    ).toBe(200);
    expect((await sendIngest("current-key", token)).status).toBe(404);
  },
);

it("allows an admin to explicitly replace both inconsistent credentials", async () => {
  await seedSharedIngestSource();
  const token = "example-replacement-token";
  const hash = await sha256Hex(token);
  await database
    .update(schema.brainSources)
    .set({ sourceKey: "indexed-key", ingestTokenHash: "indexed-hash" })
    .where(eq(schema.brainSources.id, "legacy-ingest"));
  await asUser(qaEmail, () =>
    updateSource.run({
      id: "legacy-ingest",
      config: { sourceKey: "replacement-key", ingestTokenHash: hash },
    }),
  );
  const saved = await readIngestSource();
  expect(saved.sourceKey).toBe("replacement-key");
  expect(saved.ingestTokenHash).toBe(hash);
  expect(JSON.parse(saved.configJson)).toMatchObject({
    sourceKey: "replacement-key",
    ingestTokenHash: hash,
  });
  expect((await sendIngest("replacement-key", token)).status).toBe(200);
});

it.each([
  {
    column: "indexed-key",
    jsonValue: null,
    expectedKey: "indexed-key",
    hashMismatch: false,
  },
  {
    column: "indexed-key",
    jsonValue: "different-key",
    expectedKey: "indexed-key",
    hashMismatch: false,
  },
  {
    column: null,
    jsonValue: "stale-key",
    expectedKey: "stale-key",
    hashMismatch: false,
  },
  {
    column: "indexed-key",
    jsonValue: "indexed-key",
    expectedKey: "indexed-key",
    hashMismatch: true,
  },
] as const)(
  "repairs inconsistent source credentials with a fresh token during rotation",
  async ({ column, jsonValue, expectedKey, hashMismatch }) => {
    await seedSharedIngestSource();
    const oldToken = "example-old-token";
    const oldHash = await sha256Hex(oldToken);
    await database
      .update(schema.brainSources)
      .set({
        sourceKey: column,
        ingestTokenHash: oldHash,
        configJson: JSON.stringify({
          sourceKey: jsonValue,
          ingestTokenHash: hashMismatch ? "different-hash" : oldHash,
          pollMinutes: 60,
        }),
      })
      .where(eq(schema.brainSources.id, "legacy-ingest"));
    const before = await readIngestSource();
    await expect(
      asUser("recipient@example.test", () =>
        rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
      ),
    ).rejects.toThrow();
    expect(await readIngestSource()).toEqual(before);
    expect((await sendIngest(expectedKey, oldToken)).status).toBe(404);
    const result = await asUser(qaEmail, () =>
      rotateSourceIngestToken.run({ sourceId: "legacy-ingest" }),
    );
    const saved = await readIngestSource();
    const newHash = await sha256Hex(result.ingestToken);
    expect(result.sourceKey).toBe(expectedKey);
    expect(result.ingestToken).not.toBe(oldToken);
    expect(saved.sourceKey).toBe(expectedKey);
    expect(saved.ingestTokenHash).toBe(newHash);
    expect(JSON.parse(saved.configJson)).toMatchObject({
      sourceKey: expectedKey,
      ingestTokenHash: newHash,
      pollMinutes: 60,
    });
    expect((await sendIngest(expectedKey, result.ingestToken)).status).toBe(
      200,
    );
    expect((await sendIngest(expectedKey, oldToken)).status).toBe(404);
    const legacyKey = jsonValue ?? expectedKey;
    expect((await sendIngest(legacyKey, oldToken)).status).toBe(404);
    expect((await sendIngest(legacyKey, result.ingestToken)).status).toBe(
      legacyKey === expectedKey ? 200 : 404,
    );
  },
);

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
