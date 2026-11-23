import { describe, expect, it, vi } from "vitest";

// Rows 793 and 794: the notebook data rail listed the bundled sample source but
// asking it for datasets answered "Data connection not found", which the panel
// showed as "Datasets could not be loaded". The sample source has no workspace
// row and no warehouse credential; its single schema is the one
// browse-sample-data already answers with.
vi.mock("@agent-native/core/action", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fail: (message: string, options?: Record<string, unknown>) => {
      throw Object.assign(new Error(message), options);
    },
  };
});

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@agent-native/core/server",
  );
  return {
    ...actual,
    getRequestContext: () => ({
      userEmail: "owner@example.test",
      orgId: "org-1",
    }),
  };
});

const readDataConnection = vi.fn(async () => {
  throw Object.assign(new Error("Data connection not found."), {
    errorCode: "data_connection_not_found",
    statusCode: 404,
  });
});

vi.mock("./data-connections.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "./data-connections.js",
  );
  return { ...actual };
});

const { listConnectionDatasets } = await import("./data-connections.js");
const { SAMPLE_DATA_SOURCE_ID } =
  await import("../../shared/sample-data-contract.js");

describe("dataset discovery for the bundled sample source", () => {
  it("answers with the sample schema instead of a missing-connection 404", async () => {
    const page = await listConnectionDatasets({
      connectionId: SAMPLE_DATA_SOURCE_ID,
      first: 10,
    } as never);
    expect(page.items.map((item) => item.name)).toEqual(["PUBLIC"]);
    expect(page.items[0]?.kind).toBe("schema");
    expect(page.hasNextPage).toBe(false);
    // The strict row lookup must not run for the sample source at all.
    expect(readDataConnection).not.toHaveBeenCalled();
  });
  it("walks schema to bounded table pages then stops at a table leaf", async () => {
    const first = await listConnectionDatasets({
      connectionId: SAMPLE_DATA_SOURCE_ID,
      parentId: "schema:PUBLIC",
      first: 2,
    } as never);
    expect(first.items.map((item) => item.name)).toEqual([
      "orders",
      "customers",
    ]);
    expect(
      first.items.every((item) => item.kind === "table" && !item.hasChildren),
    ).toBe(true);
    expect(first.hasNextPage).toBe(true);
    const next = await listConnectionDatasets({
      connectionId: SAMPLE_DATA_SOURCE_ID,
      parentId: "schema:PUBLIC",
      first: 3,
      after: first.endCursor,
    } as never);
    expect(next.items.map((item) => item.name)).toEqual([
      "products",
      "sessions",
      "support_tickets",
    ]);
    expect(next.hasNextPage).toBe(false);
    const leaf = await listConnectionDatasets({
      connectionId: SAMPLE_DATA_SOURCE_ID,
      parentId: "table:sample:PUBLIC:orders",
      first: 2,
    } as never);
    expect(leaf.items).toEqual([]);
    expect(leaf.hasNextPage).toBe(false);
  });

  it("distinguishes invalid parents and cross-level cursors from empty leaves", async () => {
    for (const parentId of [
      "schema:PRIVATE",
      "table:sample:PUBLIC:missing",
      "table:other:PUBLIC:orders",
    ]) {
      await expect(
        listConnectionDatasets({
          connectionId: SAMPLE_DATA_SOURCE_ID,
          parentId,
          first: 2,
        } as never),
      ).rejects.toMatchObject({
        errorCode: "data_connection_dataset_invalid",
        statusCode: 422,
      });
    }
    await expect(
      listConnectionDatasets({
        connectionId: SAMPLE_DATA_SOURCE_ID,
        parentId: "schema:PUBLIC",
        after: "invalid",
        first: 2,
      } as never),
    ).rejects.toMatchObject({
      errorCode: "data_connection_cursor_invalid",
      statusCode: 422,
    });
  });
});
