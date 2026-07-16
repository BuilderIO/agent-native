import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  contentSpaceCatalogItems,
  contentSpaces,
  contentDatabases,
  documents,
} from "./schema";

const migrationsSource = readFileSync(
  new URL("../plugins/db.ts", import.meta.url),
  "utf8",
);

describe("Content space schema foundation", () => {
  it("declares the normalized space and workspace catalog records", () => {
    expect(contentSpaces.id.name).toBe("id");
    expect(contentSpaces.filesDatabaseId.name).toBe("files_database_id");
    expect(contentSpaces.orgId.name).toBe("org_id");
    expect(contentSpaceCatalogItems.catalogDatabaseId.name).toBe(
      "catalog_database_id",
    );
    expect(contentSpaceCatalogItems.spaceId.name).toBe("space_id");
  });

  it("keeps space and system identifiers nullable on legacy records", () => {
    expect(documents.spaceId.name).toBe("space_id");
    expect(contentDatabases.spaceId.name).toBe("space_id");
    expect(contentDatabases.systemRole.name).toBe("system_role");
  });

  it("declares named additive migrations and their hot-path indexes", () => {
    expect(migrationsSource).toContain('name: "content-spaces-table"');
    expect(migrationsSource).toContain(
      'name: "content-space-catalog-items-table"',
    );
    expect(migrationsSource).toContain('name: "content-space-columns"');
    expect(migrationsSource).toContain(
      'name: "content-space-hot-path-indexes"',
    );
    expect(migrationsSource).toContain("documents_space_idx");
    expect(migrationsSource).toContain(
      "content_databases_space_system_role_unique",
    );
    expect(migrationsSource).toContain(
      "content_space_catalog_items_owner_catalog_idx",
    );
  });
});
