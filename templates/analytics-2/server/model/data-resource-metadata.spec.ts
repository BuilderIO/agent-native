import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DataCategoryNameConflictError,
  createDataCategory,
  readConnectionAnnotationOverrides,
  readDataCategories,
  readDataResourceMetadata,
  resetDescendantAiUsage,
  writeDataResourceMetadata,
} from "./data-resource-metadata.js";

/**
 * Storage-boundary checks. The organisation settings store is replaced by an
 * in-memory map so these tests can observe the exact key a write lands on, the
 * merge the updater returns, entry-presence handling and an unreadable stored
 * value, without a database. Access and persistence against PGlite are covered
 * by actions/data-resource-metadata.db.test.ts.
 */
const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  invalidJson: new Set<string>(),
  failWrites: false,
}));

function location(orgId: string, key: string): string {
  return `o:${orgId}:${key}`;
}

vi.mock("@agent-native/core/settings", () => ({
  getSetting: async (key: string) =>
    state.values.get(key) === undefined
      ? null
      : (state.values.get(key) as Record<string, unknown>),
  getSettingEntry: async (key: string) => {
    if (state.invalidJson.has(key)) throw new SyntaxError("invalid JSON");
    if (!state.values.has(key)) return { found: false };
    return { found: true, value: state.values.get(key) };
  },
  listOrgSettings: async (orgId: string, prefix?: string) => {
    const scopedPrefix = location(orgId, prefix ?? "");
    const out: Record<string, Record<string, unknown>> = {};
    for (const [entryLocation, value] of state.values) {
      if (!entryLocation.startsWith(scopedPrefix)) continue;
      const key = entryLocation.slice(`o:${orgId}:`.length);
      out[key] = value as Record<string, unknown>;
    }
    return out;
  },
  mutateOrgSetting: async (
    orgId: string,
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    options?: { validateStoredValue?: (value: unknown) => void },
  ) => {
    if (state.failWrites) throw new Error("settings storage unavailable");
    const entryLocation = location(orgId, key);
    const present = state.values.has(entryLocation);
    const current = present
      ? (state.values.get(entryLocation) as Record<string, unknown> | null)
      : null;
    if (present) options?.validateStoredValue?.(current);
    const next = await updater(current);
    state.values.set(entryLocation, next);
    return next;
  },
  deleteSetting: async (key: string) => state.values.delete(key),
}));

const scope = { ownerEmail: "storage@example.test", orgId: "org-storage" };
const otherScope = { ownerEmail: "storage@example.test", orgId: "org-other" };
const connectionId = "conn-storage";

function metadataLocation(orgId: string, kind: string, id: string): string {
  return location(
    orgId,
    `analytics.data.resource-metadata:v1:${encodeURIComponent(connectionId)}:${kind}:${encodeURIComponent(id)}`,
  );
}

beforeEach(() => {
  state.values.clear();
  state.invalidJson.clear();
  state.failWrites = false;
});

describe("organisation settings keyspace", () => {
  it("gives every resource its own collision-safe key", async () => {
    // The two ids differ only by a character that a naive key would treat as a
    // separator, so they must not share a stored annotation.
    await writeDataResourceMetadata(
      scope,
      connectionId,
      { kind: "schema", id: "a:b" },
      { description: "colon id" },
    );
    await writeDataResourceMetadata(
      scope,
      connectionId,
      { kind: "schema", id: "a" },
      { description: "plain id" },
    );
    const read = await readDataResourceMetadata(scope, connectionId, [
      { kind: "schema", id: "a:b" },
      { kind: "schema", id: "a" },
      { kind: "table", id: "a:b" },
    ]);
    expect(read.resources.map((entry) => entry.description)).toEqual([
      "colon id",
      "plain id",
      "",
    ]);
    expect(state.values.size).toBe(2);
    for (const entryLocation of state.values.keys()) {
      expect(
        entryLocation.startsWith(
          `o:${scope.orgId}:analytics.data.resource-metadata:v1:`,
        ),
      ).toBe(true);
      expect(entryLocation).toContain(encodeURIComponent(connectionId));
    }
  });

  it("merges a partial patch instead of replacing the stored annotation", async () => {
    const ref = { kind: "schema" as const, id: "schema_merge" };
    await writeDataResourceMetadata(scope, connectionId, ref, {
      description: "kept description",
    });
    await writeDataResourceMetadata(scope, connectionId, ref, {
      aiUsage: "excluded",
    });
    await writeDataResourceMetadata(scope, connectionId, ref, {
      description: "",
    });
    const read = await readDataResourceMetadata(scope, connectionId, [ref]);
    expect(read.resources[0]).toEqual({
      connectionId,
      kind: "schema",
      id: "schema_merge",
      description: "",
      statusId: null,
      categoryIds: [],
      aiUsage: "excluded",
    });
  });

  it("rejects an empty patch without creating a row or emitting a write", async () => {
    await expect(
      writeDataResourceMetadata(
        scope,
        connectionId,
        { kind: "table", id: "t" },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: "data_resource_patch_empty" });
    expect(state.values.size).toBe(0);
  });

  it("propagates a storage failure instead of reporting a saved annotation", async () => {
    state.failWrites = true;
    await expect(
      writeDataResourceMetadata(
        scope,
        connectionId,
        { kind: "table", id: "table_fail" },
        { description: "never stored" },
      ),
    ).rejects.toThrow("settings storage unavailable");
    expect(state.values.size).toBe(0);
  });
});

describe("entry-aware reads keep corruption explicit", () => {
  it("reads a healthy pinned ref next to an unrelated corrupt entry", async () => {
    await writeDataResourceMetadata(
      scope,
      connectionId,
      { kind: "schema", id: "schema_healthy" },
      { description: "healthy" },
    );
    state.values.set(metadataLocation(scope.orgId, "table", "table_corrupt"), {
      description: 42,
    });
    const read = await readDataResourceMetadata(scope, connectionId, [
      { kind: "schema", id: "schema_healthy" },
    ]);
    expect(read.resources[0]?.description).toBe("healthy");
  });

  it("refuses a present but unreadable annotation, including stored null", async () => {
    state.values.set(
      metadataLocation(scope.orgId, "schema", "schema_null"),
      null,
    );
    await expect(
      readDataResourceMetadata(scope, connectionId, [
        { kind: "schema", id: "schema_null" },
      ]),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });

    state.values.set(
      metadataLocation(scope.orgId, "schema", "schema_scalar"),
      7,
    );
    await expect(
      readDataResourceMetadata(scope, connectionId, [
        { kind: "schema", id: "schema_scalar" },
      ]),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });

    state.values.set(
      metadataLocation(scope.orgId, "schema", "schema_array"),
      [],
    );
    await expect(
      readDataResourceMetadata(scope, connectionId, [
        { kind: "schema", id: "schema_array" },
      ]),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });
  });

  it("refuses malformed stored JSON with the same typed error", async () => {
    state.values.set(
      metadataLocation(scope.orgId, "schema", "schema_json"),
      {},
    );
    state.invalidJson.add(
      metadataLocation(scope.orgId, "schema", "schema_json"),
    );
    await expect(
      readDataResourceMetadata(scope, connectionId, [
        { kind: "schema", id: "schema_json" },
      ]),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });
  });

  it("refuses to overwrite a present stored null or unreadable value", async () => {
    const ref = { kind: "schema" as const, id: "schema_write_null" };
    state.values.set(metadataLocation(scope.orgId, ref.kind, ref.id), null);
    await expect(
      writeDataResourceMetadata(scope, connectionId, ref, {
        description: "overwrite?",
      }),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });
    expect(
      state.values.get(metadataLocation(scope.orgId, ref.kind, ref.id)),
    ).toBe(null);

    const badRef = { kind: "schema" as const, id: "schema_write_json" };
    state.values.set(metadataLocation(scope.orgId, badRef.kind, badRef.id), {});
    state.invalidJson.add(
      metadataLocation(scope.orgId, badRef.kind, badRef.id),
    );
    await expect(
      writeDataResourceMetadata(scope, connectionId, badRef, {
        description: "overwrite?",
      }),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });
  });

  it("refuses a present null catalogue instead of treating it as empty", async () => {
    state.values.set(
      location(scope.orgId, "analytics.data.categories:v1"),
      null,
    );
    await expect(readDataCategories(scope)).rejects.toMatchObject({
      errorCode: "data_resource_metadata_corrupt",
    });
  });
});

it("refuses to read an unreadable stored annotation as an empty one", async () => {
  state.values.set(metadataLocation(scope.orgId, "schema", "schema_corrupt"), {
    description: 42,
  });
  await expect(
    readDataResourceMetadata(scope, connectionId, [
      { kind: "schema", id: "schema_corrupt" },
    ]),
  ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });
});

it("reads a legacy category with a null color", async () => {
  state.values.set(location(scope.orgId, "analytics.data.categories:v1"), {
    categories: [
      { id: "legacy-category", name: "Legacy category", color: null },
    ],
  });
  expect(await readDataCategories(scope)).toEqual({
    categories: [
      {
        id: "legacy-category",
        name: "Legacy category",
        color: null,
        description: "", // oracle-change: Both merge parents normalize missing category descriptions to an empty string.
      },
    ],
  });
});

describe("category catalogue", () => {
  it("stores one catalogue per organisation and keeps the typed conflict", async () => {
    const first = await createDataCategory(scope, {
      name: "Ops",
      color: "#111111",
    });
    await expect(
      createDataCategory(scope, { name: "Ops", color: "#222222" }),
    ).rejects.toBeInstanceOf(DataCategoryNameConflictError);
    const other = await createDataCategory(otherScope, {
      name: "Ops",
      color: "#111111",
    });
    expect(first.id).not.toBe(other.id);
    expect(
      state.values.has(location(scope.orgId, "analytics.data.categories:v1")),
    ).toBe(true);
    expect(
      state.values.has(
        location(otherScope.orgId, "analytics.data.categories:v1"),
      ),
    ).toBe(true);
  });
});

it("clears a valid legacy child AI override when the root policy resets", async () => {
  state.values.set(
    metadataLocation(scope.orgId, "schema", "schema_legacy_ai"),
    { description: "", statusId: null, categoryIds: [], aiUsage: "excluded" },
  );
  expect(
    (
      await readDataResourceMetadata(scope, connectionId, [
        { kind: "schema", id: "schema_legacy_ai" },
      ])
    ).resources[0]?.aiUsage,
  ).toBe("excluded");
  await resetDescendantAiUsage(scope, connectionId);
  expect(
    (
      await readDataResourceMetadata(scope, connectionId, [
        { kind: "schema", id: "schema_legacy_ai" },
      ])
    ).resources[0]?.aiUsage,
  ).toBeNull();
});

describe("batch connection annotation overrides", () => {
  it("returns an empty map for empty connectionIds", async () => {
    const result = await readConnectionAnnotationOverrides(scope, []);
    expect(result.size).toBe(0);
  });

  it("reads a single connection override directly", async () => {
    state.values.set(
      metadataLocation(scope.orgId, "connection", connectionId),
      {
        description: "conn description",
        statusId: null,
        categoryIds: [],
        aiUsage: "included",
        descriptionInitialized: true,
      },
    );
    const result = await readConnectionAnnotationOverrides(scope, [
      connectionId,
    ]);
    expect(result.size).toBe(1);
    expect(result.get(connectionId)?.description).toBe("conn description");
  });

  it("reads multiple connection overrides with a single batch list", async () => {
    const conn1 = "conn-1";
    const conn2 = "conn-2";
    const conn3 = "conn-3";
    state.values.set(
      location(
        scope.orgId,
        `analytics.data.resource-metadata:v1:${encodeURIComponent(conn1)}:connection:${encodeURIComponent(conn1)}`,
      ),
      {
        description: "first conn",
        statusId: null,
        categoryIds: [],
        aiUsage: "included",
      },
    );
    state.values.set(
      location(
        scope.orgId,
        `analytics.data.resource-metadata:v1:${encodeURIComponent(conn2)}:connection:${encodeURIComponent(conn2)}`,
      ),
      {
        description: "second conn",
        statusId: null,
        categoryIds: [],
        aiUsage: "excluded",
      },
    );
    const result = await readConnectionAnnotationOverrides(scope, [
      conn1,
      conn2,
      conn3,
    ]);
    expect(result.size).toBe(3);
    expect(result.get(conn1)?.description).toBe("first conn");
    expect(result.get(conn2)?.aiUsage).toBe("excluded");
    expect(result.get(conn3)).toBeNull();
  });

  it("rejects corrupted entries in batch read", async () => {
    const conn1 = "conn-1";
    const conn2 = "conn-2";
    state.values.set(
      location(
        scope.orgId,
        `analytics.data.resource-metadata:v1:${encodeURIComponent(conn1)}:connection:${encodeURIComponent(conn1)}`,
      ),
      {
        description: 42,
      },
    );
    await expect(
      readConnectionAnnotationOverrides(scope, [conn1, conn2]),
    ).rejects.toMatchObject({ errorCode: "data_resource_metadata_corrupt" });
  });
});
