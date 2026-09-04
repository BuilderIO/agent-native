// The settings surfaces build their action payloads with the helpers in
// `settings-admin.ts`. These tests feed those exact payloads to the real
// actions against a real migrated database, so a payload the UI can produce but
// the server rejects fails here rather than in the browser.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attributeEditDraft,
  buildCreateAttributeInput,
  buildUpdateAttributeInput,
  emptyAttributeDraft,
  hasAttributeEdits,
  reorderedOptionIds,
  type AttributeDraft,
} from "./settings-admin";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-settings-admin-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const NATIVE_CONNECTION = "conn_settings_native";
const HYBRID_CONNECTION = "conn_settings_hybrid";

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};

let getDb: () => any;
let schema: typeof import("../../../../server/db/schema.js");
let listAttributes: typeof import("../../../../actions/list-crm-attributes.js").default;
let createAttribute: typeof import("../../../../actions/create-crm-attribute.js").default;
let updateAttribute: typeof import("../../../../actions/update-crm-attribute.js").default;
let archiveAttribute: typeof import("../../../../actions/archive-crm-attribute.js").default;
let manageOption: typeof import("../../../../actions/manage-crm-attribute-option.js").default;
let listConnections: typeof import("../../../../actions/list-crm-connections.js").default;

function run<T>(
  action: { run: (args: never, ctx: never) => Promise<T> },
  args: unknown,
): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, () =>
    action.run(
      args as never,
      { caller: "frontend", userEmail: OWNER } as never,
    ),
  ) as Promise<T>;
}

function draft(patch: Partial<AttributeDraft>): AttributeDraft {
  return { ...emptyAttributeDraft(), ...patch };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../../../../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../../../../server/plugins/db.js")).default;
  await plugin(undefined as never);

  listAttributes = (await import("../../../../actions/list-crm-attributes.js"))
    .default;
  createAttribute = (
    await import("../../../../actions/create-crm-attribute.js")
  ).default;
  updateAttribute = (
    await import("../../../../actions/update-crm-attribute.js")
  ).default;
  archiveAttribute = (
    await import("../../../../actions/archive-crm-attribute.js")
  ).default;
  manageOption = (
    await import("../../../../actions/manage-crm-attribute-option.js")
  ).default;
  listConnections = (
    await import("../../../../actions/list-crm-connections.js")
  ).default;

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values([
      {
        id: NATIVE_CONNECTION,
        provider: "native",
        label: "Native SQL",
        mode: "native",
        status: "connected",
        selectedObjectTypesJson: JSON.stringify([
          "accounts",
          "people",
          "opportunities",
        ]),
        accessScopeKey: `native:${NATIVE_CONNECTION}`,
        createdAt: now,
        updatedAt: now,
        ...ownership,
      },
      {
        // Configured before per-attribute authority replaced connection-level
        // hybrid. It must keep rendering; it must never be re-selectable.
        id: HYBRID_CONNECTION,
        provider: "hubspot",
        label: "HubSpot (legacy)",
        mode: "hybrid",
        status: "connected",
        selectedObjectTypesJson: JSON.stringify(["companies", "deals"]),
        accessScopeKey: `workspace:${HYBRID_CONNECTION}`,
        createdAt: now,
        updatedAt: now,
        ...ownership,
      },
    ]);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("attribute create / edit / archive round trip", () => {
  it("creates, edits, archives, and restores through the real actions", async () => {
    const created: any = await run(
      createAttribute,
      buildCreateAttributeInput(
        draft({
          title: "Deal Stage",
          type: "status",
          description: "Where the deal is",
          required: true,
          options: [
            {
              value: "discovery",
              title: "Discovery",
              color: "blue",
              targetDays: 14,
              celebrate: false,
            },
            {
              value: "closed_won",
              title: "Closed Won",
              color: "green",
              targetDays: null,
              celebrate: true,
            },
          ],
        }),
        {
          target: "object",
          targetId: "opportunities",
          connectionId: NATIVE_CONNECTION,
        },
      ),
    );

    expect(created).toMatchObject({
      apiSlug: "deal_stage",
      attributeType: "status",
      authority: "local-authoritative",
      required: true,
      archived: false,
    });
    expect(created.options.map((option: any) => option.value)).toEqual([
      "discovery",
      "closed_won",
    ]);
    expect(created.options[0].targetDays).toBe(14);
    expect(created.options[1].celebrate).toBe(true);

    const edit = buildUpdateAttributeInput(created, {
      ...attributeEditDraft(created),
      title: "Pipeline Stage",
      required: false,
    });
    expect(hasAttributeEdits(edit)).toBe(true);
    const updated: any = await run(updateAttribute, edit);
    expect(updated).toMatchObject({
      label: "Pipeline Stage",
      required: false,
      apiSlug: "deal_stage",
      attributeType: "status",
    });

    const archived: any = await run(archiveAttribute, {
      attributeId: created.id,
    });
    expect(archived).toMatchObject({ archived: true });
    expect(archived.retainedValueCount).toBe(0);

    const activeOnly: any = await run(listAttributes, {
      targetId: "opportunities",
      connectionId: NATIVE_CONNECTION,
    });
    expect(
      activeOnly.attributes.some((row: any) => row.id === created.id),
    ).toBe(false);

    const restored: any = await run(updateAttribute, {
      attributeId: created.id,
      archived: false,
    });
    expect(restored.archived).toBe(false);
  });

  it("rejects an edit to the slug or the type, which is why neither is offered", async () => {
    const created: any = await run(
      createAttribute,
      buildCreateAttributeInput(
        draft({ title: "Renewal Owner", type: "text" }),
        {
          target: "object",
          targetId: "accounts",
          connectionId: NATIVE_CONNECTION,
        },
      ),
    );

    await expect(
      run(updateAttribute, {
        attributeId: created.id,
        apiSlug: "renewal_owner_v2",
      }),
    ).rejects.toThrow(/immutable|cannot change/i);
    await expect(
      run(updateAttribute, { attributeId: created.id, type: "number" }),
    ).rejects.toThrow(/immutable|cannot change/i);
  });

  it("refuses stage fields on a non-status type, which is why the form hides them", async () => {
    const created: any = await run(
      createAttribute,
      buildCreateAttributeInput(
        draft({
          title: "Region",
          type: "select",
          options: [
            {
              value: "emea",
              title: "EMEA",
              color: null,
              targetDays: null,
              celebrate: false,
            },
          ],
        }),
        {
          target: "object",
          targetId: "accounts",
          connectionId: NATIVE_CONNECTION,
        },
      ),
    );

    await expect(
      run(manageOption, {
        attributeId: created.id,
        operation: "update",
        optionId: created.options[0].id,
        targetDays: 30,
      }),
    ).rejects.toThrow(/status/i);
  });
});

describe("option reorder", () => {
  it("persists the order the drag produced", async () => {
    const created: any = await run(
      createAttribute,
      buildCreateAttributeInput(
        draft({
          title: "Support Tier",
          type: "select",
          options: ["bronze", "silver", "gold"].map((value) => ({
            value,
            title: value,
            color: null,
            targetDays: null,
            celebrate: false,
          })),
        }),
        {
          target: "object",
          targetId: "accounts",
          connectionId: NATIVE_CONNECTION,
        },
      ),
    );

    const optionIds = reorderedOptionIds(created.options, 2, 0);
    const reordered: any = await run(manageOption, {
      attributeId: created.id,
      operation: "reorder",
      optionIds,
    });
    expect(reordered.options.map((option: any) => option.value)).toEqual([
      "gold",
      "bronze",
      "silver",
    ]);

    const listed: any = await run(listAttributes, {
      targetId: "accounts",
      connectionId: NATIVE_CONNECTION,
    });
    const persisted = listed.attributes.find(
      (row: any) => row.id === created.id,
    );
    expect(persisted.options.map((option: any) => option.value)).toEqual([
      "gold",
      "bronze",
      "silver",
    ]);
  });
});

describe("connection modes", () => {
  it("reads back an existing hybrid connection with its mode intact", async () => {
    const result: any = await run(listConnections, {});
    const hybrid = result.connections.find(
      (connection: any) => connection.id === HYBRID_CONNECTION,
    );
    expect(hybrid).toMatchObject({ mode: "hybrid", provider: "hubspot" });
    expect(hybrid.objectTypes).toEqual(["companies", "deals"]);
  });

  it("fails loudly when a connection's mirrored object types are unreadable", async () => {
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.crmConnections)
      .values({
        id: "conn_settings_broken",
        provider: "native",
        label: "Broken",
        mode: "native",
        status: "connected",
        selectedObjectTypesJson: "{not json",
        accessScopeKey: "native:conn_settings_broken",
        createdAt: now,
        updatedAt: now,
        ...ownership,
      });

    await expect(run(listConnections, {})).rejects.toThrow(/unreadable/i);

    await getDb()
      .delete(schema.crmConnections)
      .where(eq(schema.crmConnections.id, "conn_settings_broken"));
  });
});
