import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("content database migrations", () => {
  it("keeps document_sync_links migrations aligned with queried columns", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain("sync_comments INTEGER NOT NULL DEFAULT 0");
    expect(source).toContain(
      "ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS sync_comments INTEGER NOT NULL DEFAULT 0",
    );
  });

  it("keeps document source metadata migrations aligned with queried columns", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain('table: "content_source_migrations"');
    for (const column of [
      "source_mode",
      "source_kind",
      "source_path",
      "source_root_path",
      "source_updated_at",
    ]) {
      expect(source).toContain(`${column} TEXT`);
      expect(source).toContain(
        `ALTER TABLE documents ADD COLUMN IF NOT EXISTS ${column} TEXT`,
      );
    }
  });
});
