import { describe, expect, it } from "vitest";

import listMetadata from "./list-data-resource-metadata.js";
import updateMetadata from "./update-data-resource-metadata.js";

/**
 * Transport contract for the metadata read.
 *
 * The client serialises a nested `resources` array as repeated `resources[]`
 * entries carrying JSON strings. The query-string route keeps each entry a
 * string, which the strict ref schema rejects, so the read is a read-only POST
 * whose JSON body preserves the nested objects.
 */
describe("metadata read transport", () => {
  it("is a read-only POST with persistence off", () => {
    expect(listMetadata.http).toMatchObject({ method: "POST" });
    expect(listMetadata.readOnly).toBe(true);
    expect(listMetadata.persistInBrowser).toBe(false);
  });

  it("keeps nested resource refs intact through a JSON body", () => {
    const refs = [
      { kind: "schema", id: "schema_one" },
      { kind: "table", id: "table_table:one" },
    ];
    const search = new URLSearchParams();
    search.set("connectionId", "connection_one");
    for (const ref of refs) {
      search.append("resources[]", JSON.stringify(ref));
    }
    // What the GET query parser produces: an array of strings.
    const queryArgs = {
      connectionId: search.get("connectionId"),
      resources: search.getAll("resources[]"),
    };
    expect(listMetadata.schema.safeParse(queryArgs).success).toBe(false);

    // What the POST JSON body produces: the nested objects as sent.
    const bodyArgs = { connectionId: "connection_one", resources: refs };
    const parsed = listMetadata.schema.safeParse(bodyArgs);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(bodyArgs);
    }
  });

  it("keeps the annotation write a non-read-only POST with a strict patch", () => {
    expect(updateMetadata.http).toMatchObject({ method: "POST" });
    expect(updateMetadata.readOnly).toBeFalsy();
    expect(
      updateMetadata.schema.safeParse({
        connectionId: "connection_one",
        resource: { kind: "schema", id: "schema_one" },
        patch: {
          categoryIds: ["a"],
          categoryChange: { categoryId: "b", added: true },
        },
      }).success,
    ).toBe(false);
  });
});
