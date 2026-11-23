import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  canonicalConnectionAiUsage,
  categoryChangePatch,
  connectionAiUsage,
  dataBrowserHref,
  decodeScopedResourceId,
  encodeScopedResourceId,
  providerResourceName,
  resourceAiUsage,
  resolveDataBrowserDetail,
  resolveDataBrowserView,
  sourceFamiliesForConnections,
} from "./DataPageAdapter.model";
import { DataPageAdapterNoAccess } from "./DataPageAdapterPanels";

describe("Data browser route adapter", () => {
  it("opens Warehouse by default and preserves the backed secondary tabs", () => {
    expect(resolveDataBrowserView(undefined)).toBe("all");
    expect(resolveDataBrowserView("all")).toBe("all");
    expect(resolveDataBrowserView("recommended")).toBe("recommended");
    expect(resolveDataBrowserView("recently-used")).toBe("recently-used");
    expect(resolveDataBrowserView("favorites")).toBe("favorites");
  });

  it("reads a connection or node detail from the route params", () => {
    expect(resolveDataBrowserDetail("data-connection", "conn-1")).toEqual({
      type: "data-connection",
      id: "conn-1",
    });
    expect(resolveDataBrowserDetail("schema", "schema-1")).toEqual({
      type: "schema",
      id: "schema-1",
    });
    expect(resolveDataBrowserDetail("database", "db-1")).toEqual({
      type: "database",
      id: "db-1",
    });
    expect(resolveDataBrowserDetail("table", "table-1")).toEqual({
      type: "table",
      id: "table-1",
    });
    expect(
      resolveDataBrowserDetail("semantic-view", "not-a-data-node"),
    ).toBeUndefined();
    expect(resolveDataBrowserDetail("table", undefined)).toBeUndefined();
    expect(resolveDataBrowserDetail(undefined, "table-1")).toBeUndefined();
  });

  it("builds the source URL shape and encodes the data source id", () => {
    expect(dataBrowserHref("all")).toBe("/home/data/all");
    expect(
      dataBrowserHref("all", { type: "data-connection", id: "conn-1" }),
    ).toBe("/home/data/all/data-connection/conn-1");
    expect(dataBrowserHref("all", { type: "schema", id: "a:b c" })).toBe(
      "/home/data/all/schema/a%3Ab%20c",
    );
  });
});

describe("Data browser metadata adapter", () => {
  it("treats a missing connection AI override as excluded", () => {
    expect(connectionAiUsage(null)).toBe("excluded");
    expect(connectionAiUsage(undefined)).toBe("excluded");
    expect(connectionAiUsage("included")).toBe("included");
    expect(connectionAiUsage("excluded")).toBe("excluded");
  });

  it("keeps only explicit resource overrides so the component inherits the connection", () => {
    const map = resourceAiUsage([
      {
        kind: "connection",
        id: "conn-1",
        aiUsage: "included",
      },
      { kind: "schema", id: "schema-a", aiUsage: null },
      { kind: "schema", id: "schema-b", aiUsage: "included" },
      { kind: "table", id: "table-c", aiUsage: "excluded" },
    ]);
    expect([...map.entries()]).toEqual([
      ["schema-b", "included"],
      ["table-c", "excluded"],
    ]);
    expect(map.has("schema-a")).toBe(false);
    expect(map.has("conn-1")).toBe(false);
  });

  it("sends a single category add/remove change inside the patch", () => {
    expect(categoryChangePatch("category-1", true)).toEqual({
      categoryChange: { categoryId: "category-1", added: true },
    });
    expect(categoryChangePatch("category-1", false)).toEqual({
      categoryChange: { categoryId: "category-1", added: false },
    });
  });
});

describe("Data browser source family", () => {
  it("pins the verified BigQuery schema family and leaves other providers to the default", () => {
    const families = sourceFamiliesForConnections([
      { id: "bigquery-1", type: "bigquery" },
      { id: "snowflake-1", type: "snowflake" },
    ]);
    expect(families.get("bigquery-1")).toBe("schemas");
    expect(families.has("snowflake-1")).toBe(false);
  });
});

describe("Data browser adapter boundaries", () => {
  it("uses the source permission sentence for a member without data access", () => {
    const html = renderToStaticMarkup(<DataPageAdapterNoAccess />);
    expect(html).toContain(
      "You do not have permissions to access workspace data connections.",
    );
  });
});

describe("scoped resource route codec", () => {
  const ref = {
    connectionId: "connection-1",
    kind: "table" as const,
    resourceId: "table:project-1:dataset%201:orders",
  };

  it("round-trips the connection, kind and provider resource id", () => {
    const encoded = encodeScopedResourceId(ref);
    expect(encoded.startsWith("dsr1:")).toBe(true);
    expect(decodeScopedResourceId(encoded)).toEqual(ref);
  });

  it("does not collide with a legacy provider id", () => {
    expect(
      decodeScopedResourceId("schema:project-1:dataset-1"),
    ).toBeUndefined();
    expect(
      decodeScopedResourceId("table:project-1:dataset-1:orders"),
    ).toBeUndefined();
    expect(decodeScopedResourceId(encodeScopedResourceId(ref))).not.toBeNull();
  });

  it("returns undefined for malformed or unsupported values", () => {
    expect(decodeScopedResourceId("dsr1:not-json")).toBeUndefined();
    expect(
      decodeScopedResourceId("dsr1:%5B%22conn%22%2C%22view%22%2C%22x%22%5D"),
    ).toBeUndefined();
    expect(
      decodeScopedResourceId("dsr1:%5B%22%22%2C%22table%22%2C%22x%22%5D"),
    ).toBeUndefined();
  });

  it("keeps a connection id that resembles the codec prefix as a connection", () => {
    expect(
      resolveDataBrowserDetail("data-connection", "dsr1:not-a-node"),
    ).toEqual({ type: "data-connection", id: "dsr1:not-a-node" });
  });

  it("resolves a scoped route to the node with the provider id, not the opaque segment", () => {
    const encoded = encodeScopedResourceId(ref);
    expect(resolveDataBrowserDetail("table", encoded)).toEqual({
      type: "table",
      id: ref.resourceId,
    });
    expect(
      resolveDataBrowserDetail(
        "schema",
        encodeScopedResourceId({ ...ref, kind: "schema" }),
      ),
    ).toEqual({ type: "schema", id: ref.resourceId });
  });

  it("writes a scoped node id while keeping the legacy form without a connection", () => {
    const encoded = encodeScopedResourceId(ref);
    expect(
      dataBrowserHref(
        "all",
        { type: "table", id: ref.resourceId },
        ref.connectionId,
      ),
    ).toBe(`/home/data/all/table/${encodeURIComponent(encoded)}`);
    expect(dataBrowserHref("all", { type: "table", id: ref.resourceId })).toBe(
      `/home/data/all/table/${encodeURIComponent(ref.resourceId)}`,
    );
  });

  it("derives a display name from a canonical provider id only", () => {
    expect(providerResourceName("table:project-1:dataset%201:orders")).toBe(
      "orders",
    );
    expect(providerResourceName("schema:project-1:dataset%201")).toBe(
      "dataset 1",
    );
    expect(providerResourceName("dsr1:opaque")).toBeUndefined();
    expect(providerResourceName("not-a-provider-id")).toBeUndefined();
  });

  it("prefers the canonical connection AI value when present", () => {
    expect(canonicalConnectionAiUsage({ aiUsage: "included" })).toBe(
      "included",
    );
    expect(canonicalConnectionAiUsage({ aiUsage: "excluded" })).toBe(
      "excluded",
    );
    expect(canonicalConnectionAiUsage({ aiUsage: null })).toBeUndefined();
    expect(canonicalConnectionAiUsage({ aiUsage: "unknown" })).toBeUndefined();
    expect(canonicalConnectionAiUsage(undefined)).toBeUndefined();
  });
});

// oracle-change: The Data browser no longer renders unsupported tabs or placeholder content.
