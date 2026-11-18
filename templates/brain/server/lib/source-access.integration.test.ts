import { PGlite } from "@electric-sql/pglite";
import { and, SQL } from "drizzle-orm";
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
  accessFilter,
  getShareableResource,
  resolveAccess,
  resolveAccessStatus,
} from "@agent-native/core/sharing";
import shareResource from "@agent-native/core/sharing/actions/share-resource";

import getSource from "../../actions/get-source.js";
import listSources from "../../actions/list-sources.js";
import { schema } from "../db/index.js";
import { readBrainScreen } from "./brain.js";
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
function asUser<T>(email: string, work: () => Promise<T>) {
  return runWithRequestContext({ userEmail: email, orgId: "qa-org" }, work);
}

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
