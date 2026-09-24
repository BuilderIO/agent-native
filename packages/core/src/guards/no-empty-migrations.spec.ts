import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeEmptyMigrationsSource,
  scanEmptyMigrations,
  shouldScanEmptyMigrationsFile,
} from "./no-empty-migrations.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("analyzeEmptyMigrationsSource", () => {
  it("flags a literal empty migration list", () => {
    const findings = analyzeEmptyMigrationsSource({
      file: "server/plugins/db.ts",
      source: `export default runMigrations([], { table: "app_migrations" });`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "server/plugins/db.ts",
      line: 1,
      message: expect.stringContaining("needless migration startup work"),
    });
  });

  it("ignores comments and string examples", () => {
    expect(
      analyzeEmptyMigrationsSource({
        file: "server/plugins/db.ts",
        source: `
          // runMigrations([], { table: "docs_migrations" });
          const example = "runMigrations([], {})";
        `,
      }),
    ).toEqual([]);
  });

  it("accepts an adjacent reviewed opt-out", () => {
    expect(
      analyzeEmptyMigrationsSource({
        file: "server/plugins/db.ts",
        source: `
          // guard:allow-empty-migrations - compatibility slot is required by the host.
          export default runMigrations([], { table: "app_migrations" });
        `,
      }),
    ).toEqual([]);
  });
});

describe("scanEmptyMigrations", () => {
  it("scans app source and skips tests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-empty-migrations-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "server/plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "server/plugins/db.ts"),
      'export default runMigrations([], { table: "app_migrations" });\n',
    );
    fs.writeFileSync(
      path.join(root, "server/plugins/db.spec.ts"),
      'runMigrations([], { table: "fixture_migrations" });\n',
    );

    expect(scanEmptyMigrations({ root })).toMatchObject({
      name: "no-empty-migrations",
      findings: [
        expect.objectContaining({ file: "server/plugins/db.ts", line: 1 }),
      ],
    });
  });
});

describe("shouldScanEmptyMigrationsFile", () => {
  it("only scans runtime source files", () => {
    expect(shouldScanEmptyMigrationsFile("server/plugins/db.ts")).toBe(true);
    expect(shouldScanEmptyMigrationsFile("server/plugins/db.spec.ts")).toBe(
      false,
    );
    expect(shouldScanEmptyMigrationsFile("vendor/runtime.ts")).toBe(false);
    expect(shouldScanEmptyMigrationsFile("README.md")).toBe(false);
  });
});
