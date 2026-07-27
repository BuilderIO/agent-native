// Integration tests for the typed attribute surface. These run against a real
// libsql database with the real migrations and the real sharing registry —
// mocking `accessFilter` would make the access-scoping assertions vacuous,
// which is the one thing about these actions worth proving.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-attribute-actions-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const OTHER = "intruder@example.test";
const CONNECTION_ID = "conn_attrs";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listAttributes: typeof import("./list-crm-attributes.js").default;
let createAttribute: typeof import("./create-crm-attribute.js").default;
let updateAttribute: typeof import("./update-crm-attribute.js").default;
let archiveAttribute: typeof import("./archive-crm-attribute.js").default;
let manageOption: typeof import("./manage-crm-attribute-option.js").default;

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

function asUser<T>(userEmail: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail }, fn) as Promise<T>;
}

const ctxFor = (userEmail: string) =>
  ({ caller: "frontend", userEmail }) as never;

/** Run an action end to end the way a signed-in caller would. */
function run<T>(
  action: { run: (args: never, ctx: never) => Promise<T> },
  args: unknown,
  userEmail = OWNER,
): Promise<T> {
  return asUser(userEmail, () =>
    action.run(args as never, ctxFor(userEmail) as never),
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  listAttributes = (await import("./list-crm-attributes.js")).default;
  createAttribute = (await import("./create-crm-attribute.js")).default;
  updateAttribute = (await import("./update-crm-attribute.js")).default;
  archiveAttribute = (await import("./archive-crm-attribute.js")).default;
  manageOption = (await import("./manage-crm-attribute-option.js")).default;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION_ID,
      provider: "native",
      label: "Native SQL",
      mode: "native",
      accessScopeKey: "native",
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let counter = 0;
const uniqueTitle = (prefix: string) => `${prefix} ${++counter}`;

describe("create/list/update/archive round trip", () => {
  it("creates a typed attribute with options and reads it back", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "opportunities",
      title: "Deal Stage",
      type: "status",
      options: [
        { value: "discovery", title: "Discovery", targetDays: 14 },
        { value: "closed_won", title: "Closed Won", celebrate: true },
      ],
    });

    expect(created).toMatchObject({
      apiSlug: "deal_stage",
      attributeType: "status",
      target: "object",
      targetId: "opportunities",
      authority: "local-authoritative",
      storagePolicy: "local-authoritative",
      archived: false,
      multi: false,
    });

    // Both target columns are written: `object_type` is what the legacy unique
    // index guards, `target_id` is the typed one.
    const [row] = await getDb()
      .select()
      .from(schema.crmFieldPolicies)
      .where(eq(schema.crmFieldPolicies.id, created.id))
      .limit(1);
    expect(row).toMatchObject({
      objectType: "opportunities",
      targetId: "opportunities",
      fieldName: "deal_stage",
      apiSlug: "deal_stage",
      valueType: "enum",
    });

    const listed = await run(listAttributes, {
      targetId: "opportunities",
      connectionId: CONNECTION_ID,
    });
    const attribute = listed.attributes.find(
      (entry) => entry.id === created.id,
    );
    expect(attribute?.options?.map((option) => option.value)).toEqual([
      "discovery",
      "closed_won",
    ]);
    expect(attribute?.options?.[0]).toMatchObject({
      targetDays: 14,
      celebrate: false,
    });
    expect(attribute?.options?.[1]).toMatchObject({ celebrate: true });
  });

  it("updates the editable fields and archives without deleting values", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Renewal Owner"),
      type: "text",
    });

    const updated = await run(updateAttribute, {
      attributeId: created.id,
      title: "Renewal Owner (EMEA)",
      description: "Who owns the renewal.",
      required: true,
      historyTracked: false,
      position: 7,
      config: { hint: "initials" },
    });
    expect(updated).toMatchObject({
      label: "Renewal Owner (EMEA)",
      description: "Who owns the renewal.",
      required: true,
      historyTracked: false,
      position: 7,
      // The slug is minted once and never follows the title.
      apiSlug: created.apiSlug,
    });
    expect(updated.config).toEqual({ hint: "initials" });

    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmRecordFields)
      .values({
        id: `field_${created.id}`,
        recordId: "record_1",
        attributeId: created.id,
        fieldPolicyId: created.id,
        fieldName: created.apiSlug,
        valueType: "string",
        storagePolicy: "local-authoritative",
        stringValue: "AB",
        activeFrom: now,
        createdAt: now,
        updatedAt: now,
        ...ownership,
      });

    const archived = await run(archiveAttribute, {
      attributeId: created.id,
    });
    expect(archived).toMatchObject({ archived: true, retainedValueCount: 1 });

    const listed = await run(listAttributes, {
      targetId: "accounts",
      connectionId: CONNECTION_ID,
    });
    expect(listed.attributes.map((entry) => entry.id)).not.toContain(
      created.id,
    );

    const withArchived = await run(listAttributes, {
      targetId: "accounts",
      connectionId: CONNECTION_ID,
      includeArchived: true,
    });
    expect(withArchived.attributes.map((entry) => entry.id)).toContain(
      created.id,
    );
  });
});

describe("create rejects what the model does not allow", () => {
  it.each(["interaction", "personal-name"])(
    "rejects the system-only type %s",
    async (type) => {
      await expect(
        run(createAttribute, {
          connectionId: CONNECTION_ID,
          targetId: "people",
          title: uniqueTitle("System"),
          type,
        }),
      ).rejects.toThrow(/created by the system only/);
    },
  );

  it("rejects a slug that is already taken on the same target", async () => {
    const title = uniqueTitle("Account Tier");
    await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title,
      type: "text",
    });

    await expect(
      run(createAttribute, {
        connectionId: CONNECTION_ID,
        targetId: "accounts",
        title: title.toUpperCase(),
        type: "number",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects multi on a type that cannot hold a set", async () => {
    await expect(
      run(createAttribute, {
        connectionId: CONNECTION_ID,
        targetId: "accounts",
        title: uniqueTitle("Score"),
        type: "number",
        multi: true,
      }),
    ).rejects.toThrow(/cannot be multi-valued/);
  });

  it("rejects options on a type that does not use them", async () => {
    await expect(
      run(createAttribute, {
        connectionId: CONNECTION_ID,
        targetId: "accounts",
        title: uniqueTitle("Notes"),
        type: "text",
        options: [{ value: "a" }],
      }),
    ).rejects.toThrow(/does not use managed options/);
  });
});

describe("immutability", () => {
  it("rejects an api slug change and a type change", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Segment"),
      type: "text",
    });

    await expect(
      run(updateAttribute, { attributeId: created.id, apiSlug: "other_slug" }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      run(updateAttribute, { attributeId: created.id, type: "number" }),
    ).rejects.toThrow(/cannot change/);

    // Restating the current values is not a change.
    const unchanged = await run(updateAttribute, {
      attributeId: created.id,
      apiSlug: created.apiSlug,
      type: "text",
    });
    expect(unchanged).toMatchObject({
      apiSlug: created.apiSlug,
      attributeType: "text",
    });
  });
});

describe("managed options", () => {
  it("rejects an option on an attribute type that has none", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Headcount"),
      type: "number",
    });

    await expect(
      run(manageOption, {
        attributeId: created.id,
        operation: "add",
        value: "large",
      }),
    ).rejects.toThrow(/does not use managed options/);
  });

  it("rejects stage fields on a select attribute", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Industries"),
      type: "select",
      multi: true,
    });

    await expect(
      run(manageOption, {
        attributeId: created.id,
        operation: "add",
        value: "saas",
        targetDays: 5,
      }),
    ).rejects.toThrow(/status attributes only/);
  });

  it("rejects an option id that belongs to another attribute", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Priority"),
      type: "select",
    });

    await expect(
      run(manageOption, {
        attributeId: created.id,
        operation: "archive",
        optionId: "option_from_nowhere",
      }),
    ).rejects.toThrow(/does not belong to attribute/);
  });

  it("reorders options and archives one without touching stored values", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "opportunities",
      title: uniqueTitle("Forecast"),
      type: "status",
      options: [{ value: "commit" }, { value: "upside" }],
    });
    const [commit, upside] = created.options!;

    const reordered = await run(manageOption, {
      attributeId: created.id,
      operation: "reorder",
      optionIds: [upside!.id, commit!.id],
    });
    expect(reordered.options?.map((option) => option.value)).toEqual([
      "upside",
      "commit",
    ]);

    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmRecordFields)
      .values({
        id: `field_option_${created.id}`,
        recordId: "record_option",
        attributeId: created.id,
        fieldPolicyId: created.id,
        fieldName: created.apiSlug,
        valueType: "enum",
        storagePolicy: "local-authoritative",
        stringValue: "commit",
        activeFrom: now,
        createdAt: now,
        updatedAt: now,
        ...ownership,
      });

    const afterArchive = await run(manageOption, {
      attributeId: created.id,
      operation: "archive",
      optionId: commit!.id,
    });
    expect(
      afterArchive.options?.find((option) => option.id === commit!.id),
    ).toMatchObject({ archived: true });

    const [stored] = await getDb()
      .select()
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.attributeId, created.id),
          eq(schema.crmRecordFields.recordId, "record_option"),
        ),
      );
    expect(stored).toMatchObject({
      stringValue: "commit",
      activeUntil: null,
      updatedAt: now,
    });

    const visible = await run(listAttributes, {
      targetId: "opportunities",
      connectionId: CONNECTION_ID,
    });
    expect(
      visible.attributes
        .find((entry) => entry.id === created.id)
        ?.options?.map((option) => option.value),
    ).toEqual(["upside"]);
  });
});

describe("access scoping", () => {
  it("hides another user's private attribute and refuses to edit it", async () => {
    const created = await run(createAttribute, {
      connectionId: CONNECTION_ID,
      targetId: "accounts",
      title: uniqueTitle("Private Note"),
      type: "text",
    });

    const listed = await run(
      listAttributes,
      { targetId: "accounts", connectionId: CONNECTION_ID },
      OTHER,
    );
    expect(listed.attributes.map((entry) => entry.id)).not.toContain(
      created.id,
    );

    await expect(
      run(updateAttribute, { attributeId: created.id, title: "Stolen" }, OTHER),
    ).rejects.toThrow(/No access to crm-field-policy/);
    await expect(
      run(archiveAttribute, { attributeId: created.id }, OTHER),
    ).rejects.toThrow(/No access to crm-field-policy/);

    const [row] = await getDb()
      .select()
      .from(schema.crmFieldPolicies)
      .where(eq(schema.crmFieldPolicies.id, created.id))
      .limit(1);
    expect(row).toMatchObject({ label: created.label, archived: false });
  });
});
