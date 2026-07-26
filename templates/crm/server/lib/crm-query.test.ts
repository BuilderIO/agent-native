// Integration tests for the server-side CRM query. Boots a real libsql (SQLite)
// database, runs the actual migrations, and seeds attribute values through the
// real bitemporal writer — the whole point of this file is that filters, sorts,
// and cursors are proven against SQL rather than against a stub.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CrmAttributeType } from "../../shared/crm-attributes.js";
import type { CrmWritableAttribute } from "./record-fields.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-query-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const TEAMMATE = "teammate@example.test";
const ORG = "org_1";
const CONNECTION = "conn_1";

const SCOPE = {
  key: "native:conn_1",
  mode: "native",
  objectReadable: true,
  objectCreateable: true,
  objectUpdateable: true,
  objectDeleteable: true,
  recordVisibility: "workspace",
} as const;

const ownership = {
  ownerEmail: OWNER,
  orgId: ORG,
  visibility: "org" as const,
};

type QueryModule = typeof import("./crm-query.js");

let getDb: () => any;
let schema: typeof import("../db/schema.js");
let query: QueryModule;
let writeCrmRecordField: typeof import("./record-fields.js").writeCrmRecordField;

let counter = 0;

function asUser<T>(userEmail: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail, orgId: ORG }, fn) as Promise<T>;
}

function run(
  input: Parameters<QueryModule["queryCrmRecords"]>[0],
  user = OWNER,
) {
  return asUser(user, () =>
    query.queryCrmRecords(input, {
      actorEmail: user,
      resolveScope: async () => SCOPE,
      now: new Date("2026-07-26T12:00:00.000Z"),
    }),
  );
}

async function ids(
  input: Parameters<QueryModule["queryCrmRecords"]>[0],
  user = OWNER,
): Promise<string[]> {
  const result = await run(input, user);
  return result.records.map((record) => record.id);
}

async function createAttribute(input: {
  slug: string;
  attributeType: CrmAttributeType;
  multi?: boolean;
  archived?: boolean;
}): Promise<CrmWritableAttribute> {
  const id = `attr_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmFieldPolicies)
    .values({
      id,
      connectionId: CONNECTION,
      objectType: "companies",
      fieldName: input.slug,
      apiSlug: input.slug,
      label: input.slug,
      valueType: "string",
      storagePolicy: "local-authoritative",
      attributeType: input.attributeType,
      multi: input.multi ?? false,
      archived: input.archived ?? false,
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return {
    id,
    apiSlug: input.slug,
    attributeType: input.attributeType,
    multi: input.multi ?? false,
    historyTracked: true,
    valueType: "string",
    storagePolicy: "local-authoritative",
  };
}

async function createRecord(
  displayName: string,
  extra: Record<string, unknown> = {},
) {
  const id = `rec_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION,
      provider: "native",
      objectType: "companies",
      kind: "account",
      remoteId: id,
      displayName,
      accessScopeKey: SCOPE.key,
      accessScopeJson: JSON.stringify(SCOPE),
      ...ownership,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
  return id;
}

async function setValue(
  recordId: string,
  attribute: CrmWritableAttribute,
  value: unknown,
) {
  await asUser(OWNER, () =>
    writeCrmRecordField({
      target: { recordId },
      attribute,
      value: value as never,
      actor: { type: "user", id: OWNER },
      ownership,
    }),
  );
}

// Attributes and records shared by every test below.
let stage: CrmWritableAttribute;
let arr: CrmWritableAttribute;
let amount: CrmWritableAttribute;
let renewal: CrmWritableAttribute;
let active: CrmWritableAttribute;
let owner: CrmWritableAttribute;
let tags: CrmWritableAttribute;
let email: CrmWritableAttribute;
let archived: CrmWritableAttribute;

let acme = "";
let globex = "";
let initech = "";
let hooli = "";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = await import("../db/schema.js");
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  query = await import("./crm-query.js");
  writeCrmRecordField = (await import("./record-fields.js"))
    .writeCrmRecordField;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION,
      provider: "native",
      label: "Native",
      mode: "native",
      accessScopeKey: SCOPE.key,
      accessScopeJson: JSON.stringify(SCOPE),
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });

  stage = await createAttribute({ slug: "stage", attributeType: "status" });
  arr = await createAttribute({ slug: "arr", attributeType: "currency" });
  amount = arr;
  renewal = await createAttribute({ slug: "renewal", attributeType: "date" });
  active = await createAttribute({ slug: "active", attributeType: "checkbox" });
  owner = await createAttribute({
    slug: "account_owner",
    attributeType: "actor-reference",
  });
  tags = await createAttribute({
    slug: "tags",
    attributeType: "select",
    multi: true,
  });
  email = await createAttribute({
    slug: "work_email",
    attributeType: "email-address",
  });
  await createAttribute({
    slug: "alt_emails",
    attributeType: "email-address",
    multi: true,
  });
  archived = await createAttribute({
    slug: "legacy_tier",
    attributeType: "text",
    archived: true,
  });
  void amount;
  void archived;

  for (const value of ["Discovery", "Negotiation", "Won"]) {
    await getDb()
      .insert(schema.crmAttributeOptions)
      .values({
        id: `opt_${++counter}`,
        attributeId: stage.id,
        value,
        title: value,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
  }
  for (const value of ["enterprise", "smb", "expansion"]) {
    await getDb()
      .insert(schema.crmAttributeOptions)
      .values({
        id: `opt_${++counter}`,
        attributeId: tags.id,
        value,
        title: value,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
  }

  acme = await createRecord("Acme Corp", {
    stage: "Won",
    amount: 100,
    remoteRevision: "7",
  });
  globex = await createRecord("Globex", { stage: "Discovery", amount: 50 });
  initech = await createRecord("Initech", { stage: "Won", amount: 50 });
  hooli = await createRecord("Hooli", { stage: "Discovery" });

  await setValue(acme, stage, "Won");
  await setValue(globex, stage, "Discovery");
  await setValue(initech, stage, "Won");
  // hooli deliberately has no stage value — it is the is-empty case.

  await setValue(acme, arr, 120_000);
  await setValue(globex, arr, 40_000);
  await setValue(initech, arr, 40_000);

  await setValue(acme, renewal, "2026-07-26");
  await setValue(globex, renewal, "2026-07-20");
  await setValue(initech, renewal, "2026-08-15");

  await setValue(acme, active, true);
  await setValue(globex, active, false);

  await setValue(acme, owner, OWNER);
  await setValue(globex, owner, TEAMMATE);
  await setValue(initech, owner, OWNER.toUpperCase());

  await setValue(acme, tags, ["enterprise", "expansion"]);
  await setValue(globex, tags, ["smb"]);

  await setValue(acme, email, "ada@acme.example.com");
  await setValue(globex, email, "grace@globex.example.com");
}, 120_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("record summary", () => {
  // The board drags a record between columns with `update-crm-record`, which
  // refuses a native local write without the record's current revision. The
  // summary is that board's only read, so dropping this column silently breaks
  // every drag.
  it("carries the record revision, reporting an absent one as null", async () => {
    const summaries = await run({ limit: 50 });
    expect(
      summaries.records.find((record) => record.id === acme),
    ).toMatchObject({ remoteRevision: "7" });
    expect(
      summaries.records.find((record) => record.id === globex),
    ).toMatchObject({ remoteRevision: null });
  });
});

describe("condition compilation", () => {
  it("filters text attributes on every text condition", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "work_email", condition: "contains", value: "acme" },
          ],
        },
      }),
    ).resolves.toEqual([acme]);

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            {
              attributeId: "work_email",
              condition: "starts-with",
              value: "grace@",
            },
          ],
        },
      }),
    ).resolves.toEqual([globex]);

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            {
              attributeId: "work_email",
              condition: "ends-with",
              value: "globex.example.com",
            },
          ],
        },
      }),
    ).resolves.toEqual([globex]);

    const notContains = await ids({
      limit: 50,
      filter: {
        op: "and",
        conditions: [
          {
            attributeId: "work_email",
            condition: "not-contains",
            value: "acme",
          },
        ],
      },
    });
    expect(notContains).toContain(globex);
    expect(notContains).not.toContain(acme);
    // Records with no value at all are "not containing" it.
    expect(notContains).toContain(hooli);

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "work_email", condition: "is-not-empty" },
          ],
        },
      }),
    ).resolves.toEqual(expect.arrayContaining([acme, globex]));

    const empty = await ids({
      limit: 50,
      filter: {
        op: "and",
        conditions: [{ attributeId: "work_email", condition: "is-empty" }],
      },
    });
    expect(empty).toEqual(expect.arrayContaining([hooli, initech]));
    expect(empty).not.toContain(acme);
  });

  it("escapes LIKE wildcards instead of matching everything", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "work_email", condition: "contains", value: "%" },
          ],
        },
      }),
    ).resolves.toEqual([]);
  });

  it("filters numeric attributes on comparisons and ranges", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [{ attributeId: "arr", condition: ">", value: 50_000 }],
        },
      }),
    ).resolves.toEqual([acme]);

    const between = await ids({
      limit: 50,
      filter: {
        op: "and",
        conditions: [
          { attributeId: "arr", condition: "between", value: [30_000, 50_000] },
        ],
      },
    });
    expect(between.sort()).toEqual([globex, initech].sort());

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [{ attributeId: "arr", condition: "!=", value: 40_000 }],
        },
      }),
    ).resolves.toEqual(expect.arrayContaining([acme, hooli]));
  });

  it("filters dates on absolute bounds and relative tokens", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            {
              attributeId: "renewal",
              condition: "before",
              value: "2026-07-25",
            },
          ],
        },
      }),
    ).resolves.toEqual([globex]);

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "renewal", condition: "is", value: "today" },
          ],
        },
      }),
    ).resolves.toEqual([acme]);

    const lastWeek = await ids({
      limit: 50,
      filter: {
        op: "and",
        conditions: [
          { attributeId: "renewal", condition: "is", value: "last-7-days" },
        ],
      },
    });
    expect(lastWeek.sort()).toEqual([acme, globex].sort());

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "renewal", condition: "after", value: "today" },
          ],
        },
      }),
    ).resolves.toEqual([initech]);
  });

  it("filters checkboxes, status options, and multi-valued sets", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [{ attributeId: "active", condition: "is", value: true }],
        },
      }),
    ).resolves.toEqual([acme]);

    const won = await ids({
      limit: 50,
      filter: {
        op: "and",
        conditions: [
          { attributeId: "stage", condition: "is-any-of", value: ["Won"] },
        ],
      },
    });
    expect(won.sort()).toEqual([acme, initech].sort());

    const notWon = await ids({
      limit: 50,
      filter: {
        op: "and",
        conditions: [
          { attributeId: "stage", condition: "is-none-of", value: ["Won"] },
        ],
      },
    });
    expect(notWon.sort()).toEqual([globex, hooli].sort());

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            {
              attributeId: "tags",
              condition: "is-any-of",
              value: ["expansion"],
            },
          ],
        },
      }),
    ).resolves.toEqual([acme]);

    // "smb" must not match Acme's ["enterprise","expansion"] set.
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "tags", condition: "is-any-of", value: ["smb"] },
          ],
        },
      }),
    ).resolves.toEqual([globex]);
  });

  it("rejects a condition the attribute type cannot express", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "arr", condition: "starts-with", value: "4" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "crm-filter-condition", statusCode: 422 });

    // The option family has no substring condition at all…
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "tags", condition: "contains", value: "smb" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "crm-filter-condition" });

    // …and a multi attribute whose family does have one still refuses it,
    // because the stored value is the whole set rather than one string.
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "alt_emails", condition: "contains", value: "@" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "crm-filter-multi-condition" });
  });

  it("combines groups with or one level deep", async () => {
    const rows = await ids({
      limit: 50,
      filter: {
        op: "or",
        conditions: [
          { attributeId: "arr", condition: ">", value: 100_000 },
          {
            op: "and",
            conditions: [
              { attributeId: "stage", condition: "is", value: "Discovery" },
              { attributeId: "arr", condition: "<", value: 50_000 },
            ],
          },
        ],
      },
    });
    expect(rows.sort()).toEqual([acme, globex].sort());
  });

  it("filters record columns as well as attributes", async () => {
    await expect(ids({ limit: 50, query: "Glob" })).resolves.toEqual([globex]);

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { field: "displayName", condition: "starts-with", value: "Ini" },
          ],
        },
      }),
    ).resolves.toEqual([initech]);
  });
});

describe("@currentUser", () => {
  it("resolves to the calling actor so one view renders per person", async () => {
    const filter = {
      op: "and" as const,
      conditions: [
        {
          attributeId: "account_owner",
          condition: "is" as const,
          value: "@currentUser",
        },
      ],
    };

    const mine = await ids({ limit: 50, filter }, OWNER);
    expect(mine.sort()).toEqual([acme, initech].sort());

    const theirs = await ids({ limit: 50, filter }, TEAMMATE);
    expect(theirs).toEqual([globex]);
  });

  it("refuses to resolve on a target that is not an actor", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "stage", condition: "is", value: "@currentUser" },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "crm-filter-current-user-target" });
  });

  it("fails loudly when there is no caller to resolve against", async () => {
    await expect(
      asUser(OWNER, () =>
        query.queryCrmRecords(
          {
            limit: 50,
            filter: {
              op: "and",
              conditions: [
                {
                  attributeId: "account_owner",
                  condition: "is",
                  value: "@currentUser",
                },
              ],
            },
          },
          { actorEmail: null, resolveScope: async () => SCOPE },
        ),
      ),
    ).rejects.toMatchObject({ code: "crm-filter-no-actor" });
  });
});

describe("unknown and archived attributes", () => {
  it("throws a typed error naming the attribute instead of returning every row", async () => {
    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "not_a_field", condition: "is", value: "x" },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "crm-filter-unknown-attribute",
      statusCode: 422,
      message: expect.stringContaining("not_a_field"),
    });

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [
            { attributeId: "legacy_tier", condition: "is", value: "gold" },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "crm-filter-archived-attribute",
      message: expect.stringContaining("legacy_tier"),
    });

    await expect(
      ids({
        limit: 50,
        filter: {
          op: "and",
          conditions: [{ field: "not_a_column", condition: "is", value: "x" }],
        },
      }),
    ).rejects.toMatchObject({ code: "crm-filter-unknown-field" });
  });
});

describe("sorting", () => {
  it("orders by each key in turn and breaks ties on record id", async () => {
    const byArrThenName = await ids({
      limit: 50,
      sort: [
        { attributeId: "arr", direction: "desc" },
        { field: "displayName", direction: "asc" },
      ],
    });
    // Acme 120k, then the 40k pair ordered by name, then the record with no
    // value at all — NULLs last in both dialects.
    expect(byArrThenName).toEqual([acme, globex, initech, hooli]);

    const ascending = await ids({
      limit: 50,
      sort: [{ attributeId: "arr", direction: "asc" }],
    });
    expect(ascending.slice(0, 2).sort()).toEqual([globex, initech].sort());
    expect(ascending[2]).toBe(acme);
    expect(ascending[3]).toBe(hooli);
  });

  it("is stable across repeated runs when the sort key ties", async () => {
    const first = await ids({
      limit: 50,
      sort: [{ attributeId: "stage", direction: "asc" }],
    });
    const second = await ids({
      limit: 50,
      sort: [{ attributeId: "stage", direction: "asc" }],
    });
    expect(second).toEqual(first);
  });
});

describe("cursor pagination", () => {
  it("walks three pages returning each record exactly once", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const result = await run({
        limit: 2,
        cursor,
        sort: [{ attributeId: "arr", direction: "desc" }],
      });
      seen.push(...result.records.map((record) => record.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(seen.sort()).toEqual([acme, globex, hooli, initech].sort());
  });

  it("paginates a filtered set without gaps", async () => {
    const filter = {
      op: "and" as const,
      conditions: [{ attributeId: "arr", condition: "is-not-empty" as const }],
    };
    const first = await run({
      limit: 1,
      filter,
      sort: [{ field: "displayName", direction: "asc" }],
    });
    const second = await run({
      limit: 1,
      filter,
      cursor: first.nextCursor,
      sort: [{ field: "displayName", direction: "asc" }],
    });
    const third = await run({
      limit: 1,
      filter,
      cursor: second.nextCursor,
      sort: [{ field: "displayName", direction: "asc" }],
    });
    expect(
      [...first.records, ...second.records, ...third.records].map(
        (record) => record.id,
      ),
    ).toEqual([acme, globex, initech]);
    expect(third.complete).toBe(true);
  });

  it("rejects a cursor that belongs to a different query", async () => {
    const first = await run({
      limit: 1,
      sort: [{ field: "displayName", direction: "asc" }],
    });
    await expect(
      run({
        limit: 1,
        cursor: first.nextCursor,
        sort: [{ field: "displayName", direction: "desc" }],
      }),
    ).rejects.toMatchObject({ code: "crm-cursor-mismatch", statusCode: 400 });
  });

  it("reports a total estimate only when asked", async () => {
    const withTotal = await run({ limit: 2, includeTotal: true });
    expect(withTotal.totalEstimate).toBe(4);
    const withoutTotal = await run({ limit: 2 });
    expect(withoutTotal).not.toHaveProperty("totalEstimate");
  });
});

describe("relative date tokens", () => {
  it("resolves day-boundary ranges in UTC", () => {
    const now = new Date("2026-07-26T12:00:00.000Z"); // a Sunday
    expect(query.resolveRelativeDateToken("today", now)).toEqual({
      from: "2026-07-26",
      to: "2026-07-27",
    });
    expect(query.resolveRelativeDateToken("this-week", now)).toEqual({
      from: "2026-07-20",
      to: "2026-07-27",
    });
    expect(query.resolveRelativeDateToken("last-7-days", now)).toEqual({
      from: "2026-07-20",
      to: "2026-07-27",
    });
    expect(query.resolveRelativeDateToken("next-3-days", now)).toEqual({
      from: "2026-07-26",
      to: "2026-07-29",
    });
    expect(query.resolveRelativeDateToken("whenever", now)).toBeNull();
  });
});
