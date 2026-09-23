import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializePropertyOptions } from "../shared/properties.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-form-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "form-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let submitForm: typeof import("./submit-content-database-form.js").default;
let spaceId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  submitForm = (await import("./submit-content-database-form.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  const { systemIdsForContentSpace } = await import("./_content-spaces.js");
  spaceId = `form_space_${Date.now()}`;
  const filesIds = systemIdsForContentSpace(spaceId, "files");
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: filesIds.documentId,
    spaceId,
    ownerEmail: OWNER,
    title: "Files",
    content: "",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabases).values({
    id: filesIds.databaseId,
    spaceId,
    systemRole: "files",
    ownerEmail: OWNER,
    documentId: filesIds.documentId,
    title: "Files",
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function seedFormDatabase() {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 9);
  const databaseId = `form_database_${suffix}`;
  const databaseDocumentId = `form_database_document_${suffix}`;
  const primaryBlocksId = `description_${suffix}`;
  const additionalBlocksId = `notes_${suffix}`;
  const priorityId = `priority_${suffix}`;
  const deadlineId = `deadline_${suffix}`;
  const requesterId = `requester_${suffix}`;
  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    spaceId,
    ownerEmail: OWNER,
    title: "Design asks",
    content: "",
    visibility: "org",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    spaceId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Design asks",
    primaryBlocksPropertyId: primaryBlocksId,
    blocksSeeded: 1,
    viewConfigJson: JSON.stringify({
      activeViewId: "request-form",
      views: [
        {
          id: "request-form",
          name: "Request design",
          type: "form",
          formQuestions: [
            { key: "name", enabled: true, required: true },
            { key: primaryBlocksId, enabled: true, required: true },
            { key: priorityId, enabled: true, required: true },
            { key: deadlineId, enabled: true, required: false },
            { key: requesterId, enabled: true, required: false },
            { key: additionalBlocksId, enabled: true, required: false },
          ],
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values([
    {
      id: primaryBlocksId,
      ownerEmail: OWNER,
      databaseId,
      name: "Description",
      type: "blocks",
      optionsJson: serializePropertyOptions({ blocks: { primary: true } }),
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: priorityId,
      ownerEmail: OWNER,
      databaseId,
      name: "Priority",
      type: "select",
      optionsJson: serializePropertyOptions({
        options: [
          { id: "p0", name: "P0 — Urgent", color: "red" },
          { id: "p1", name: "P1 — High", color: "orange" },
        ],
      }),
      position: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deadlineId,
      ownerEmail: OWNER,
      databaseId,
      name: "Deadline",
      type: "date",
      position: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: additionalBlocksId,
      ownerEmail: OWNER,
      databaseId,
      name: "Internal notes",
      type: "blocks",
      optionsJson: serializePropertyOptions({ blocks: { primary: false } }),
      position: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: requesterId,
      ownerEmail: OWNER,
      databaseId,
      name: "Requester",
      type: "person",
      position: 4,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return {
    databaseId,
    databaseDocumentId,
    primaryBlocksId,
    additionalBlocksId,
    priorityId,
    deadlineId,
    requesterId,
  };
}

describe("submit-content-database-form", () => {
  it("atomically writes title, primary/additional Blocks, safe options, and an exact link", async () => {
    const seeded = await seedFormDatabase();
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Refresh the pricing page",
        propertyValues: {
          Description: "Clarify the enterprise story and update the hero.",
          Priority: "P1 — High",
          [seeded.deadlineId]: "2026-08-15",
          Requester: "requester@example.com\npartner@example.com",
          "Internal notes": "Route through the web design queue.",
        },
      }),
    );

    expect(result).toMatchObject({
      databaseId: seeded.databaseId,
      viewId: "request-form",
      verified: true,
      urlPath: `/page/${result.createdDocumentId}`,
    });
    await expect(
      getDb()
        .select({ spaceId: schema.documents.spaceId })
        .from(schema.documents)
        .where(eq(schema.documents.id, result.createdDocumentId)),
    ).resolves.toEqual([{ spaceId }]);
    expect(result.deepLink).toContain(result.createdDocumentId);
    expect(result.submittedProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Description" }),
        expect.objectContaining({ name: "Priority" }),
        expect.objectContaining({ name: "Deadline" }),
        expect.objectContaining({ name: "Requester" }),
        expect.objectContaining({ name: "Internal notes" }),
      ]),
    );

    const db = getDb();
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId));
    expect(document).toMatchObject({
      title: "Refresh the pricing page",
      content: "Clarify the enterprise story and update the hero.",
      visibility: "org",
      createdBy: OWNER,
      updatedBy: OWNER,
    });

    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        eq(schema.documentPropertyValues.documentId, result.createdDocumentId),
      );
    expect(
      values.find((value) => value.propertyId === seeded.priorityId)?.valueJson,
    ).toBe('"p1"');
    expect(
      values.find((value) => value.propertyId === seeded.deadlineId)?.valueJson,
    ).toContain("2026-08-15");
    expect(
      values.find((value) => value.propertyId === seeded.requesterId)
        ?.valueJson,
    ).toBe('["requester@example.com","partner@example.com"]');

    const [notes] = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            result.createdDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            seeded.additionalBlocksId,
          ),
        ),
      );
    expect(notes.content).toBe("Route through the web design queue.");
  });

  it("accepts model-safe property entries without dynamic object keys", async () => {
    const seeded = await seedFormDatabase();
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Explicit entry submission",
        content: "Keep every supplied field.",
        propertyEntries: [
          { property: "Description", value: "Keep every supplied field." },
          { property: "Priority", value: "P1 — High" },
          { property: "Requester", value: "requester@example.com" },
        ],
      }),
    );

    expect(result.submittedProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Description" }),
        expect.objectContaining({ name: "Priority" }),
        expect.objectContaining({ name: "Requester" }),
      ]),
    );
    expect(result.submittedContent).toBe(true);
    const [createdDocument] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId));
    expect(createdDocument?.content).toBe("Keep every supplied field.");
  });

  it("starts the canonical range at zero when legacy rows have negative positions", async () => {
    const seeded = await seedFormDatabase();
    const db = getDb();
    const now = new Date().toISOString();
    const legacyRows = [
      { suffix: "near", position: -11 },
      { suffix: "far", position: -111 },
    ];
    await db.insert(schema.documents).values(
      legacyRows.map(({ suffix, position }) => ({
        id: `${seeded.databaseId}-legacy-document-${suffix}`,
        spaceId,
        ownerEmail: OWNER,
        parentId: seeded.databaseDocumentId,
        title: `Legacy ${suffix}`,
        content: "",
        position,
        visibility: "org" as const,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(schema.contentDatabaseItems).values(
      legacyRows.map(({ suffix, position }) => ({
        id: `${seeded.databaseId}-legacy-item-${suffix}`,
        ownerEmail: OWNER,
        databaseId: seeded.databaseId,
        documentId: `${seeded.databaseId}-legacy-document-${suffix}`,
        position,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "First canonical form row",
        propertyValues: {
          Description: "Preserve legacy rows while appending canonically.",
          Priority: "P1 — High",
        },
      }),
    );
    const [document] = await db
      .select({ position: schema.documents.position })
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId));
    const [item] = await db
      .select({ position: schema.contentDatabaseItems.position })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, seeded.databaseId),
          eq(schema.contentDatabaseItems.documentId, result.createdDocumentId),
        ),
      );

    expect(result.verified).toBe(true);
    expect(document?.position).toBe(0);
    expect(item?.position).toBe(0);
  });

  it("rejects missing required questions without creating a partial row", async () => {
    const seeded = await seedFormDatabase();
    const db = getDb();
    const before = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Missing details",
          propertyValues: { Priority: "P1 — High" },
        }),
      ),
    ).rejects.toThrow("Description");

    const after = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(after).toHaveLength(before.length);
  });

  it("rejects duplicate model-safe entries before creating a row", async () => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Duplicate intake fields",
          propertyEntries: [
            { property: "Description", value: "First description" },
            { property: seeded.primaryBlocksId, value: "Second description" },
            { property: "Priority", value: "P1 — High" },
          ],
        }),
      ),
    ).rejects.toThrow('Property "Description" was submitted more than once');

    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });

  it("rejects a property identifier that collides with another property name", async () => {
    const seeded = await seedFormDatabase();
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: `collision_${Date.now()}`,
        ownerEmail: OWNER,
        databaseId: seeded.databaseId,
        name: seeded.priorityId,
        type: "text",
        position: 99,
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Ambiguous property",
          propertyEntries: [
            { property: seeded.priorityId, value: "P1 — High" },
          ],
        }),
      ),
    ).rejects.toThrow("matches one property ID and another property name");
  });

  it("rejects a non-empty optional value that normalization would drop", async () => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Invalid optional date",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            { property: "Deadline", value: "not-a-date" },
          ],
        }),
      ),
    ).rejects.toThrow(
      'Invalid value for "Deadline"; use a real ISO calendar date',
    );

    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });

  it.each([
    "2026-02-30",
    "2026-20-99anything",
    "2026-09-20T25:00",
    "2026-09-20T12:00+99:99",
    "2026-09-20T12:00Z",
    "2026-09-20T12:34:56.789",
    Date.parse("2026-09-20T12:34:56.789Z"),
  ])("rejects the calendar-invalid date %s", async (value) => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Invalid calendar date",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            { property: "Deadline", value },
          ],
        }),
      ),
    ).rejects.toThrow("use a real ISO calendar date");

    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });

  it("rejects a person array with a discarded value", async () => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Invalid requester",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            { property: "Requester", value: ["alice@example.com", 42] },
          ],
        }),
      ),
    ).rejects.toThrow("every supplied item must be preserved exactly once");

    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });

  it.each([
    [
      "invalid end",
      { start: "2026-09-20", end: "not-a-date", includeTime: false },
    ],
    [
      "backwards end",
      { start: "2026-09-20", end: "2026-09-19", includeTime: false },
    ],
    ["non-string end", { start: "2026-09-20", end: 42, includeTime: false }],
  ])("rejects a date range with an %s", async (_label, value) => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Invalid date range",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            { property: "Deadline", value },
          ],
        }),
      ),
    ).rejects.toThrow(
      _label === "backwards end"
        ? "the supplied date end could not be preserved"
        : _label === "non-string end"
          ? "numeric dates are only supported as scalar values"
          : "use a real ISO calendar date",
    );

    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });

  it("rejects a same-day timed range whose end is before its start", async () => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Backwards timed range",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            {
              property: "Deadline",
              value: {
                start: "2026-09-20T16:00",
                end: "2026-09-20T09:00",
                includeTime: true,
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("the supplied date end is before the start");

    const items = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });

  it.each([
    ["drops time", { start: "2026-09-20T12:30", includeTime: false }],
    ["invents time", { start: "2026-09-20", includeTime: true }],
  ])("rejects a date whose includeTime flag %s", async (_label, value) => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Conflicting date precision",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            { property: "Deadline", value },
          ],
        }),
      ),
    ).rejects.toThrow("includeTime must match the supplied date precision");
  });

  it("rejects numeric parts inside a date range", async () => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Numeric date range",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            {
              property: "Deadline",
              value: {
                start: Date.parse("2026-09-20T12:30:00.000Z"),
                includeTime: true,
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow("numeric dates are only supported as scalar values");
  });

  it("rejects a timed range when includeTime is omitted", async () => {
    const seeded = await seedFormDatabase();

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Implicit timed range",
          propertyEntries: [
            { property: "Description", value: "Keep valid fields." },
            { property: "Priority", value: "P1 — High" },
            {
              property: "Deadline",
              value: { start: "2026-09-20", end: "2026-09-21T12:00" },
            },
          ],
        }),
      ),
    ).rejects.toThrow("includeTime is required for timed date ranges");
  });

  it("accepts a scalar timed date with inferred precision", async () => {
    const seeded = await seedFormDatabase();
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Scalar timed date",
        propertyEntries: [
          { property: "Description", value: "Keep valid fields." },
          { property: "Priority", value: "P1 — High" },
          { property: "Deadline", value: "2026-09-20T12:00" },
        ],
      }),
    );
    expect(result.verified).toBe(true);
  });

  it.each([
    ["invalid select array", "Priority", [42]],
    ["multiple values for a select", "Priority", ["P1 — High", "P2 — Medium"]],
    ["null-containing select array", "Priority", ["P1 — High", null]],
    ["invalid multi-select array", "Tags", [42]],
    ["partially invalid multi-select array", "Tags", ["Design", 42]],
    ["null-containing multi-select array", "Tags", ["Design", null]],
    ["blank-containing multi-select array", "Tags", ["Design", ""]],
  ])(
    "rejects %s values that would be verified as empty",
    async (_label, property, value) => {
      const seeded = await seedFormDatabase();
      if (property === "Priority") {
        const [database] = await getDb()
          .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.id, seeded.databaseId));
        const viewConfig = JSON.parse(database.viewConfigJson);
        viewConfig.views[0].formQuestions =
          viewConfig.views[0].formQuestions.map(
            (question: { key: string; required: boolean }) =>
              question.key === seeded.priorityId
                ? { ...question, required: false }
                : question,
          );
        await getDb()
          .update(schema.contentDatabases)
          .set({ viewConfigJson: JSON.stringify(viewConfig) })
          .where(eq(schema.contentDatabases.id, seeded.databaseId));
      }
      if (property === "Tags") {
        const now = new Date().toISOString();
        const tagsId = `tags_${Date.now()}`;
        await getDb()
          .insert(schema.documentPropertyDefinitions)
          .values({
            id: tagsId,
            ownerEmail: OWNER,
            databaseId: seeded.databaseId,
            name: "Tags",
            type: "multi_select",
            optionsJson: serializePropertyOptions({
              options: [{ id: "design", name: "Design", color: "blue" }],
            }),
            position: 98,
            createdAt: now,
            updatedAt: now,
          });
        const [database] = await getDb()
          .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
          .from(schema.contentDatabases)
          .where(eq(schema.contentDatabases.id, seeded.databaseId));
        const viewConfig = JSON.parse(database.viewConfigJson);
        viewConfig.views[0].formQuestions.push({
          key: tagsId,
          enabled: true,
          required: false,
        });
        await getDb()
          .update(schema.contentDatabases)
          .set({ viewConfigJson: JSON.stringify(viewConfig) })
          .where(eq(schema.contentDatabases.id, seeded.databaseId));
      }

      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          submitForm.run({
            databaseId: seeded.databaseId,
            viewId: "request-form",
            title: "Invalid option value",
            propertyEntries: [
              { property: "Description", value: "Keep valid fields." },
              ...(property === "Priority"
                ? []
                : [{ property: "Priority", value: "P1 — High" }]),
              { property, value },
            ],
          }),
        ),
      ).rejects.toThrow(
        /must be preserved exactly once|could not be preserved/,
      );
    },
  );

  it("resolves an exact multi-select label containing a comma", async () => {
    const seeded = await seedFormDatabase();
    const now = new Date().toISOString();
    const tagsId = `comma_tags_${Date.now()}`;
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: tagsId,
        ownerEmail: OWNER,
        databaseId: seeded.databaseId,
        name: "Comma Tags",
        type: "multi_select",
        optionsJson: serializePropertyOptions({
          options: [
            {
              id: "research-development",
              name: "Research, Development",
              color: "blue",
            },
          ],
        }),
        position: 99,
        createdAt: now,
        updatedAt: now,
      });
    const [database] = await getDb()
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, seeded.databaseId));
    const viewConfig = JSON.parse(database.viewConfigJson);
    viewConfig.views[0].formQuestions.push({
      key: tagsId,
      enabled: true,
      required: false,
    });
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(viewConfig) })
      .where(eq(schema.contentDatabases.id, seeded.databaseId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Comma option",
        propertyEntries: [
          { property: "Description", value: "Keep valid fields." },
          { property: "Priority", value: "P1 — High" },
          { property: tagsId, value: "Research, Development" },
        ],
      }),
    );

    expect(result.verified).toBe(true);
    const [saved] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(
            schema.documentPropertyValues.documentId,
            result.createdDocumentId,
          ),
          eq(schema.documentPropertyValues.propertyId, tagsId),
        ),
      );
    expect(JSON.parse(saved.valueJson)).toEqual(["research-development"]);
  });

  it("accepts an intentionally blank optional date", async () => {
    const seeded = await seedFormDatabase();

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "No deadline",
        propertyEntries: [
          { property: "Description", value: "Keep valid fields." },
          { property: "Priority", value: "P1 — High" },
          { property: "Deadline", value: "   " },
        ],
      }),
    );

    expect(result.verified).toBe(true);
  });

  it("preserves an explicit empty map for compatible title-only callers", async () => {
    const seeded = await seedFormDatabase();
    const db = getDb();
    const [database] = await db
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, seeded.databaseId));
    const viewConfig = JSON.parse(database.viewConfigJson);
    viewConfig.views[0].formQuestions = viewConfig.views[0].formQuestions.map(
      (question: { key: string; required: boolean }) => ({
        ...question,
        required: question.key === "name",
      }),
    );
    await db
      .update(schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(viewConfig) })
      .where(eq(schema.contentDatabases.id, seeded.databaseId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Title-only submission",
        propertyValues: {},
      }),
    );

    expect(result.verified).toBe(true);
    expect(result.submittedProperties).toEqual([]);
    expect(result.submittedContent).toBe(false);
  });

  it("does not report an optional empty primary Blocks value as submitted content", async () => {
    const seeded = await seedFormDatabase();
    const db = getDb();
    const [database] = await db
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, seeded.databaseId));
    const viewConfig = JSON.parse(database.viewConfigJson);
    viewConfig.views[0].formQuestions = viewConfig.views[0].formQuestions.map(
      (question: { key: string; required: boolean }) =>
        question.key === seeded.primaryBlocksId
          ? { ...question, required: false }
          : question,
    );
    await db
      .update(schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(viewConfig) })
      .where(eq(schema.contentDatabases.id, seeded.databaseId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Empty narrative",
        propertyEntries: [
          { property: seeded.primaryBlocksId, value: "" },
          { property: "Priority", value: "P1 — High" },
        ],
      }),
    );

    expect(result.verified).toBe(true);
    expect(result.submittedContent).toBe(false);
    const [document] = await db
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId));
    expect(document.content).toBe("");
  });

  it("rejects unknown option labels before creating a row", async () => {
    const seeded = await seedFormDatabase();
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "New illustration",
          propertyValues: {
            Description: "Create an illustration for the launch post.",
            Priority: "Extremely urgent",
          },
        }),
      ),
    ).rejects.toThrow('Unknown option "Extremely urgent"');
  });

  it("excludes system properties from form questions and rejects supplied values", async () => {
    const seeded = await seedFormDatabase();
    const systemPropertyId = `system_kind_${Date.now()}`;
    const db = getDb();
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, seeded.databaseId));
    const viewConfig = JSON.parse(database.viewConfigJson);
    viewConfig.views[0].formQuestions.push({
      key: systemPropertyId,
      enabled: true,
      required: true,
    });
    await db
      .update(schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(viewConfig) })
      .where(eq(schema.contentDatabases.id, seeded.databaseId));
    await db.insert(schema.documentPropertyDefinitions).values({
      id: systemPropertyId,
      ownerEmail: OWNER,
      databaseId: seeded.databaseId,
      systemRole: "files_kind",
      name: "Kind",
      type: "select",
      optionsJson: serializePropertyOptions({
        options: [{ id: "page", name: "Page", color: "gray" }],
      }),
      position: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "System fields stay derived",
          propertyValues: {
            Description: "The configured required system question is ignored.",
            Priority: "P1 — High",
          },
        }),
      ),
    ).resolves.toMatchObject({ verified: true });
    const beforeRejectedSubmission = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Cannot override Kind",
          propertyValues: {
            Description: "This row must not be created.",
            Priority: "P1 — High",
            [systemPropertyId]: "page",
          },
        }),
      ),
    ).rejects.toThrow('System property "Kind" cannot be submitted');
    const afterRejectedSubmission = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(afterRejectedSubmission).toHaveLength(
      beforeRejectedSubmission.length,
    );
  });

  it("rolls back the document and item when an in-transaction property write fails", async () => {
    const seeded = await seedFormDatabase();
    const triggerName = `force_form_rollback_${Date.now()}`;
    const functionName = `${triggerName}_fn`;
    await getDbExec().execute(
      `CREATE FUNCTION ${functionName}() RETURNS trigger
       LANGUAGE plpgsql AS $form$
       BEGIN
         IF NEW.property_id = '${seeded.priorityId}' THEN
           RAISE EXCEPTION 'forced form rollback';
         END IF;
         RETURN NEW;
       END;
       $form$`,
    );
    await getDbExec().execute(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT ON document_property_values
       FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          submitForm.run({
            databaseId: seeded.databaseId,
            viewId: "request-form",
            title: "Rollback this row",
            propertyValues: {
              Description: "This write should be rolled back.",
              Priority: "P0 — Urgent",
            },
          }),
        ),
      ).rejects.toThrow(/forced form rollback|Failed query:/);
    } finally {
      await getDbExec().execute(
        `DROP TRIGGER IF EXISTS ${triggerName} ON document_property_values`,
      );
      await getDbExec().execute(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    const db = getDb();
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.title, "Rollback this row"));
    expect(document).toBeUndefined();
    const items = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });
});
