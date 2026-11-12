import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  scanForVaultSecretsTable,
  type AllowedReference,
} from "./guard-no-vault-secrets-table";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A throwaway tree: each key is a repo-relative path, each value its contents. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "vault-secrets-guard-"));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

const noAllowances: readonly AllowedReference[] = [];

describe("references to the retired vault_secrets table", () => {
  it("passes a tree that never names it", () => {
    const root = tree({
      "packages/dispatch/src/server/lib/vault-store.ts":
        "await db.select().from(schema.vaultGrants);\n",
      "packages/dispatch/src/db/migrations.sql": "SELECT * FROM app_secrets;\n",
    });

    const scan = scanForVaultSecretsTable(root, noAllowances);

    assert.equal(scan.filesScanned, 2);
    assert.deepEqual(scan.findings, []);
    assert.deepEqual(scan.unusedAllowances, []);
  });

  it("flags the table name in SQL, in any case, with its line", () => {
    const root = tree({
      "packages/dispatch/src/server/lib/a.ts": [
        "const a = 1;",
        'const read = "SELECT value FROM vault_secrets";',
        'const loud = "DELETE FROM VAULT_SECRETS";',
      ].join("\n"),
      "packages/dispatch/src/db/b.sql": "UPDATE vault_secrets SET value = '';",
    });

    const scan = scanForVaultSecretsTable(root, noAllowances);

    assert.deepEqual(
      scan.findings.map((f) => `${f.file}:${f.line}:${f.token}`),
      [
        "packages/dispatch/src/db/b.sql:1:vault_secrets",
        "packages/dispatch/src/server/lib/a.ts:2:vault_secrets",
        "packages/dispatch/src/server/lib/a.ts:3:vault_secrets",
      ],
    );
  });

  it("flags the Drizzle export, but not a longer identifier that contains it", () => {
    const root = tree({
      "packages/dispatch/src/server/lib/a.ts": [
        "db.select().from(schema.vaultSecrets);",
        "const myvaultSecretsCache = 1;",
        "const vaultSecretsCount = 2;",
      ].join("\n"),
    });

    const scan = scanForVaultSecretsTable(root, noAllowances);

    assert.deepEqual(
      scan.findings.map((f) => `${f.line}:${f.token}`),
      ["1:vaultSecrets"],
    );
  });

  it("ignores tests, fixtures, docs, build output and dependencies", () => {
    const root = tree({
      "packages/dispatch/src/a.spec.ts": 'sql("SELECT * FROM vault_secrets");',
      "packages/dispatch/src/a.test.ts": "vaultSecrets;",
      "packages/dispatch/src/__tests__/b.ts": "vault_secrets;",
      "packages/dispatch/src/__fixtures__/c.sql": "vault_secrets;",
      "packages/dispatch/e2e/d.ts": "vault_secrets;",
      "packages/dispatch/docs/guide.mdx": "The vault_secrets table.",
      "packages/dispatch/README.md": "`vaultSecrets`",
      "packages/dispatch/dist/index.js": "vault_secrets;",
      "node_modules/pkg/index.js": "vault_secrets;",
      ".claude/worktrees/peer/a.ts": "vault_secrets;",
      "packages/dispatch/src/clean.ts": "export const ok = true;",
    });

    const scan = scanForVaultSecretsTable(root, noAllowances);

    assert.equal(scan.filesScanned, 1);
    assert.deepEqual(scan.findings, []);
  });

  it("allows a documented reference and nothing else in that file", () => {
    const root = tree({
      "packages/dispatch/src/db/migrations.ts": [
        "CREATE TABLE IF NOT EXISTS vault_secrets (id TEXT);",
        "const field = screen.vaultSecrets;",
      ].join("\n"),
    });
    const allowed: AllowedReference[] = [
      {
        file: "packages/dispatch/src/db/migrations.ts",
        tokens: ["vault_secrets"],
        reason: "created the table",
      },
    ];

    const scan = scanForVaultSecretsTable(root, allowed);

    assert.deepEqual(
      scan.findings.map((f) => `${f.line}:${f.token}`),
      ["2:vaultSecrets"],
    );
    assert.deepEqual(scan.unusedAllowances, []);
  });

  it("lets an entry with no tokens allow both spellings, in that file only", () => {
    const root = tree({
      "scripts/guard.ts": "vault_secrets; vaultSecrets;",
      "scripts/other.ts": "vault_secrets;",
    });
    const allowed: AllowedReference[] = [
      { file: "scripts/guard.ts", reason: "names what it forbids" },
    ];

    const scan = scanForVaultSecretsTable(root, allowed);

    assert.deepEqual(
      scan.findings.map((f) => f.file),
      ["scripts/other.ts"],
    );
  });

  it("reports an allowlist entry that no longer matches anything", () => {
    const root = tree({
      "packages/dispatch/src/db/migrations.ts": "export const ok = true;",
      "packages/dispatch/src/server/plugins/db.ts": "vault_secrets;",
    });
    const stale: AllowedReference = {
      file: "packages/dispatch/src/db/migrations.ts",
      tokens: ["vault_secrets"],
      reason: "created the table",
    };
    const live: AllowedReference = {
      file: "packages/dispatch/src/server/plugins/db.ts",
      tokens: ["vault_secrets"],
      reason: "identity policy",
    };

    const scan = scanForVaultSecretsTable(root, [stale, live]);

    assert.deepEqual(scan.findings, []);
    assert.deepEqual(scan.unusedAllowances, [stale]);
  });

  it("scans nothing, and says so, for a tree with no source files", () => {
    const root = tree({ "README.md": "vault_secrets" });

    assert.equal(scanForVaultSecretsTable(root, noAllowances).filesScanned, 0);
  });
});
