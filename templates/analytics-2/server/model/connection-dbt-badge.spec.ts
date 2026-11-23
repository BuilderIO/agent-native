import { describe, expect, it } from "vitest";

import {
  connectionDbtBadge,
  dataConnectionOutput,
} from "./data-connection-dto";

/**
 * The reference marks a connection whose dbt metadata is configured with a "(dbt)"
 * chip in the connection header, tooltip "dbt metadata is configured" (original
 * 6c8f25a7…js, the header's connection name row). These rules hold without a
 * database.
 */
describe("connection dbt badge", () => {
  it("marks a connection with dbt metadata", () => {
    expect(connectionDbtBadge({ hasDbtMetadata: true })).toEqual({
      label: "(dbt)",
      tooltip: "dbt metadata is configured",
    });
  });

  it("stays off for a connection without dbt metadata", () => {
    expect(connectionDbtBadge({ hasDbtMetadata: false })).toBeNull();
    expect(connectionDbtBadge({})).toBeNull();
    expect(connectionDbtBadge(null)).toBeNull();
  });

  it("carries the flag on the connection the client renders, defaulting off", () => {
    const base = {
      id: "conn_1",
      name: "Warehouse",
      type: "bigquery",
      isDefault: false,
      isDraft: false,
      shared: true,
      canQuery: "Admins only",
      canView: "Admins only",
      aiUsage: "included" as const,
    };
    expect(dataConnectionOutput.parse(base).hasDbtMetadata).toBe(false);
    expect(
      dataConnectionOutput.parse({ ...base, hasDbtMetadata: true })
        .hasDbtMetadata,
    ).toBe(true);
  });
});
