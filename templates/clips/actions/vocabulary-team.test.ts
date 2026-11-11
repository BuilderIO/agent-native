import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQLWrapper } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../server/db/schema.js";

type Role = "owner" | "admin" | "member";

// Who belongs to which organization, with which role.
const members: Record<string, { orgId: string; role: Role }> = {
  "admin@acme.test": { orgId: "org-acme", role: "admin" },
  "owner@acme.test": { orgId: "org-acme", role: "owner" },
  "zoe@acme.test": { orgId: "org-acme", role: "member" },
  "outsider@other.test": { orgId: "org-other", role: "admin" },
};
const rank: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

let counter = 0;
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("../server/lib/recordings.js", async () => {
  const { getRequestUserEmail } =
    await import("@agent-native/core/server/request-context");
  const { HTTPError } = await import("h3");
  return {
    nanoid: () => `n${++counter}`,
    ownerEmailMatches: (column: SQLWrapper, email: string) =>
      sql`lower(${column}) = ${email.trim().toLowerCase()}`,
    getActiveOrganizationId: async () =>
      members[getRequestUserEmail() ?? ""]?.orgId ?? null,
    getOrganizationRoleForEmail: async (orgId: string, email: string) =>
      members[email]?.orgId === orgId ? members[email].role : null,
    requireOrganizationAccess: async (
      _orgId: string | undefined,
      allowed: Role[],
    ) => {
      const email = getRequestUserEmail() ?? "";
      const member = members[email];
      const needed = Math.min(...allowed.map((role) => rank[role]));
      if (!member || rank[member.role] < needed) {
        throw new HTTPError({
          statusCode: 403,
          statusMessage: "Organization not found or access denied",
        });
      }
      return { organizationId: member.orgId, email, role: member.role };
    },
  };
});

import addTerm from "./add-vocabulary-term.js";
import importTeam from "./import-team-vocabulary.js";
import listVocabulary from "./list-vocabulary.js";
import removeTerm from "./remove-vocabulary-term.js";

const client = new PGlite();
const db = drizzle(client, { schema });

function as<T>(email: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { userEmail: email, orgId: members[email]?.orgId },
    fn,
  ) as Promise<T>;
}

type Listed = {
  vocabulary: Array<{
    id: string;
    term: string;
    replacement: string;
    scope: string;
  }>;
  team: Array<{ id: string; term: string }>;
  canManageTeam: boolean;
};
const list = (email: string, limit = 500) =>
  as(email, () => listVocabulary.run({ limit }) as Promise<Listed>);
const add = (
  email: string,
  args: { term: string; replacement: string; scope?: "personal" | "team" },
) => as(email, () => addTerm.run(args as never) as Promise<{ id: string }>);

describe("team vocabulary", () => {
  beforeAll(async () => {
    for (const table of [schema.vocabulary, schema.vocabularyShares]) {
      const config = getTableConfig(table);
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      await client.exec(
        `create table ${quote(config.name)} (${config.columns.map((column) => `${quote(column.name)} ${column.getSQLType()}`).join(", ")})`,
      );
    }
  });
  beforeAll(async () => {
    // Same index as the team-vocabulary-unique-term migration in server/plugins/db.ts.
    await client.exec(
      `create unique index clips_vocabulary_team_term_idx on clips_vocabulary (org_id, lower(term)) where visibility = 'org'`,
    );
  });
  beforeEach(async () => {
    await db.delete(schema.vocabulary);
  });
  afterAll(async () => {
    await client.close();
  });

  it("writes a personal word by default that nobody else sees", async () => {
    await add("zoe@acme.test", { term: "Malu", replacement: "Ines" });
    const [stored] = await db.select().from(schema.vocabulary);
    expect(stored).toMatchObject({ visibility: "private", orgId: null });

    expect((await list("zoe@acme.test")).vocabulary).toMatchObject([
      { term: "Malu", scope: "personal" },
    ]);
    expect((await list("admin@acme.test")).vocabulary).toEqual([]);
  });

  it("shares a team word with every member of the same organization only", async () => {
    await add("admin@acme.test", {
      term: "Zoe",
      replacement: "Zoë",
      scope: "team",
    });
    const [stored] = await db.select().from(schema.vocabulary);
    expect(stored).toMatchObject({ visibility: "org", orgId: "org-acme" });

    const zoe = await list("zoe@acme.test");
    expect(zoe.vocabulary).toMatchObject([
      { term: "Zoe", replacement: "Zoë", scope: "team" },
    ]);
    expect(zoe.team).toHaveLength(1);
    expect(zoe.canManageTeam).toBe(false);
    expect((await list("owner@acme.test")).canManageTeam).toBe(true);

    const outsider = await list("outsider@other.test");
    expect(outsider.vocabulary).toEqual([]);
    expect(outsider.team).toEqual([]);
  });

  it("refuses team words from a plain member", async () => {
    await expect(
      add("zoe@acme.test", {
        term: "Linnea",
        replacement: "Linnea",
        scope: "team",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await db.select().from(schema.vocabulary)).toEqual([]);
  });

  it("lets a personal word win over the team word with the same term", async () => {
    await add("admin@acme.test", {
      term: "Omar",
      replacement: "Omar",
      scope: "team",
    });
    await add("zoe@acme.test", { term: "omar", replacement: "Omer" });

    const zoe = await list("zoe@acme.test");
    expect(zoe.vocabulary).toMatchObject([
      { term: "omar", replacement: "Omer", scope: "personal" },
    ]);
    // The team tab still shows the team word.
    expect(zoe.team).toMatchObject([{ term: "Omar" }]);
    // Everyone else keeps the team word.
    expect((await list("owner@acme.test")).vocabulary).toMatchObject([
      { term: "Omar", scope: "team" },
    ]);
  });

  it("keeps an admin's personal and team word with the same term apart", async () => {
    await add("admin@acme.test", {
      term: "Priya",
      replacement: "Priya",
      scope: "team",
    });
    await add("admin@acme.test", { term: "Priya", replacement: "Pria" });
    const rows = await db.select().from(schema.vocabulary);
    expect(rows.map((row) => [row.visibility, row.replacement]).sort()).toEqual(
      [
        ["org", "Priya"],
        ["private", "Pria"],
      ],
    );
  });

  it("only lets org admins remove team words", async () => {
    const { id } = await add("admin@acme.test", {
      term: "Zoe",
      replacement: "Zoë",
      scope: "team",
    });
    await expect(
      as("zoe@acme.test", () => removeTerm.run({ id })),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      as("outsider@other.test", () => removeTerm.run({ id })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await as("owner@acme.test", () => removeTerm.run({ id }));
    expect(await db.select().from(schema.vocabulary)).toEqual([]);
  });

  it("bulk-imports team words and updates ones that exist", async () => {
    await add("admin@acme.test", {
      term: "Zoe",
      replacement: "Zoe",
      scope: "team",
    });
    const result = await as("admin@acme.test", () =>
      importTeam.run({
        entries: [
          { term: "zoe", replacement: "Zoë" },
          { term: "Ines" },
          { term: "Linnea" },
        ],
      }),
    );
    expect(result).toMatchObject({ created: 2, updated: 1, skipped: 0 });
    // Importing the same list again changes nothing.
    expect(
      await as("admin@acme.test", () =>
        importTeam.run({
          entries: [
            { term: "zoe", replacement: "Zoë" },
            { term: "Ines" },
            { term: "Linnea" },
          ],
        }),
      ),
    ).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    const zoe = await list("zoe@acme.test");
    expect(
      zoe.vocabulary.map((entry) => [entry.term, entry.replacement]),
    ).toEqual(
      expect.arrayContaining([
        ["Zoe", "Zoë"],
        ["Ines", "Ines"],
        ["Linnea", "Linnea"],
      ]),
    );
    await expect(
      as("zoe@acme.test", () =>
        importTeam.run({ entries: [{ term: "Nope" }] }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("keeps team words in the list however many personal words there are", async () => {
    await add("admin@acme.test", {
      term: "Priya",
      replacement: "Priya",
      scope: "team",
    });
    for (const term of ["one", "two", "three"]) {
      await add("zoe@acme.test", { term, replacement: term.toUpperCase() });
    }
    const zoe = await list("zoe@acme.test", 2);
    expect(
      zoe.vocabulary.filter((entry) => entry.scope === "team"),
    ).toMatchObject([{ term: "Priya" }]);
    expect(zoe.team).toHaveLength(1);
  });

  it("stores one team word when two admins add it at the same time", async () => {
    const results = await Promise.all([
      add("admin@acme.test", {
        term: "Ines",
        replacement: "Ines",
        scope: "team",
      }),
      add("owner@acme.test", {
        term: "ines",
        replacement: "Ines",
        scope: "team",
      }),
      add("owner@acme.test", {
        term: "INES",
        replacement: "Ines",
        scope: "team",
      }),
    ]);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await db.select().from(schema.vocabulary)).toHaveLength(1);
  });
});
