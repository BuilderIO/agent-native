import { createDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { describe, expect, it } from "vitest";

import {
  classifyIconAsset,
  findCalloutIcons,
  inventoryHistoricalIconUrls,
} from "./inventory-historical-icon-urls";

const uploaded = JSON.stringify({
  version: 1,
  kind: "image",
  authority: "url",
  assetId: "https://cdn.builder.io/api/v1/image/example",
});
const external = JSON.stringify({
  version: 1,
  kind: "image",
  authority: "url",
  assetId: "https://example.org/logo.svg",
});

describe("historical icon URL inventory", () => {
  it("treats provider URLs as candidates, not proof of ownership", () => {
    expect(classifyIconAsset("https://cdn.builder.io/example", "url")).toBe(
      "candidate",
    );
    expect(classifyIconAsset("https://other.example/icon", "url")).toBe(
      "external",
    );
    expect(classifyIconAsset("http://cdn.builder.io/example", "url")).toBe(
      "ambiguous",
    );
    expect(
      classifyIconAsset("https://cdn.builder.io.example/icon", "url"),
    ).toBe("external");
    expect(classifyIconAsset("private-handle", "content-private-blob")).toBe(
      "ambiguous",
    );
  });

  it("finds escaped callout icon values without reading other image URLs", () => {
    const encoded = uploaded.replace(/"/g, "&quot;");
    expect(
      findCalloutIcons(
        `<image src="https://cdn.builder.io/other" />\n<callout icon="${encoded}">\n\tBody\n</callout>`,
      ),
    ).toEqual([uploaded]);
  });

  it("covers current, historical, view, property, and workspace references with bounded output", async () => {
    const rows: Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    > = {
      documents: [
        {
          id: "d1",
          icon: uploaded,
          content: `<callout icon="${external.replace(/"/g, "&quot;")}">`,
        },
      ],
      document_property_definitions: [{ id: "p1", icon: uploaded }],
      content_databases: [
        {
          id: "c1",
          view_config_json: JSON.stringify({ views: [{ icon: uploaded }] }),
        },
      ],
      document_versions: [
        {
          id: "v1",
          content: `<callout icon="${uploaded.replace(/"/g, "&quot;")}">`,
        },
      ],
      document_preview_drafts: [
        {
          id: "r1",
          content: `<callout icon="${uploaded.replace(/"/g, "&quot;")}">`,
        },
      ],
      builder_doc_sidecars: [],
      document_block_field_contents: [
        {
          id: "f1",
          content: `<callout icon="${uploaded.replace(/"/g, "&quot;")}">`,
        },
      ],
      document_blocks: [
        {
          id: "b1",
          markdown: `<callout icon="${uploaded.replace(/"/g, "&quot;")}">`,
        },
      ],
      organizations: [{ id: "o1", icon_json: uploaded }],
    };
    const report = await inventoryHistoricalIconUrls(async (sql, args) => {
      if (sql.includes("information_schema.tables"))
        return Object.keys(rows).map((id) => ({ id }));
      const table = sql.match(/FROM ([a-z_]+)/)?.[1];
      if (!table) throw new Error("Unexpected query");
      return rows[table].filter((row) => row.id > String(args[0]));
    });
    expect(report.complete).toBe(true);
    expect(report.imageReferenceCount).toBe(9);
    expect(report.uniqueAssetCounts).toEqual({
      candidate: 1,
      external: 1,
      ambiguous: 0,
    });
    expect(
      report.reportedAssets.find(
        (asset) => asset.classification === "candidate",
      )?.referenceCount,
    ).toBe(8);
    expect(JSON.stringify(report)).not.toContain("https://");
    expect(JSON.stringify(report)).not.toContain("Body");
  });

  it("reports a missing organization table as incomplete", async () => {
    const report = await inventoryHistoricalIconUrls(async (sql) => {
      if (sql.includes("information_schema.tables")) return [];
      throw new Error("Unexpected query");
    });
    expect(report.complete).toBe(false);
    expect(report.missingTables).toContain("organizations");
  });

  it("marks a bounded manifest incomplete when references are omitted", async () => {
    const tables = [
      "documents",
      "document_property_definitions",
      "content_databases",
      "document_versions",
      "document_preview_drafts",
      "builder_doc_sidecars",
      "document_block_field_contents",
      "document_blocks",
      "organizations",
    ];
    const documents = Array.from({ length: 101 }, (_, index) => ({
      id: String(index).padStart(3, "0"),
      icon: JSON.stringify({
        version: 1,
        kind: "image",
        authority: "url",
        assetId: `https://cdn.builder.io/example-${index}`,
      }),
      content: "",
    }));
    const report = await inventoryHistoricalIconUrls(async (sql, args) => {
      if (sql.includes("information_schema.tables"))
        return tables.map((id) => ({ id }));
      return sql.includes("FROM documents ")
        ? documents.filter((row) => row.id > String(args[0]))
        : [];
    });
    expect(report.complete).toBe(false);
    expect(report.omittedAssetCount).toBe(1);
    expect(report.reportedAssets).toHaveLength(100);
  });

  it("executes its exact queries against local PostgreSQL semantics", async () => {
    const db = await createDbExec({ url: "pglite:memory" });
    try {
      await withMigrationRuntime(async () => {
        for (const [table, column] of [
          ["documents", "icon TEXT, content TEXT"],
          ["document_property_definitions", "icon TEXT"],
          ["content_databases", "view_config_json TEXT"],
          ["document_versions", "content TEXT"],
          ["document_preview_drafts", "content TEXT"],
          ["builder_doc_sidecars", "content TEXT"],
          ["document_block_field_contents", "content TEXT"],
          ["document_blocks", "markdown TEXT"],
          ["organizations", "icon_json TEXT"],
        ]) {
          await db.execute(
            `CREATE TABLE ${table} (id TEXT PRIMARY KEY, ${column})`,
          );
        }
      });
      await db.execute({
        sql: "INSERT INTO documents (id, icon, content) VALUES (?, ?, ?)",
        args: ["d1", uploaded, ""],
      });
      const report = await inventoryHistoricalIconUrls(async (sql, args) => {
        const result = await db.execute({ sql, args });
        return result.rows as Array<Record<string, unknown> & { id: string }>;
      });
      expect(report.complete).toBe(true);
      expect(report.scannedRows.documents).toBe(1);
      expect(report.uniqueAssetCounts.candidate).toBe(1);
    } finally {
      await db.close?.();
    }
  });
});
