import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findUnsealedSecretColumns,
  isSourcePath,
  isUnsealedSecretColumnName,
} from "./guard-no-unsealed-secret-columns.js";

const FILE = "templates/example/server/db/schema.ts";

function allLines(source: string) {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function flagged(source: string, added = allLines(source)) {
  return findUnsealedSecretColumns(FILE, source, added).map(
    (finding) => `${finding.line}:${finding.column}`,
  );
}

describe("secret column names", () => {
  it("flags names that say they hold a credential", () => {
    for (const name of [
      "api_key",
      "apiKey",
      "access_token",
      "refreshToken",
      "client_secret",
      "password",
      "slack_bot_token",
      "private_key",
      "webhook_secret",
      "credentials",
    ]) {
      assert.equal(isUnsealedSecretColumnName(name), true, name);
    }
  });

  it("allows names that say the value is sealed, derived, or only metadata", () => {
    for (const name of [
      "encrypted_token",
      "token_ciphertext",
      "token_hash",
      "password_hash",
      "api_key_last4",
      "api_key_prefix",
      "secret_name",
      "token_type",
      "token_expires_at",
      "refresh_token_expires_in",
      "credential_key",
      "credential_id",
      "secret_ref",
      "value",
      "label",
      "key",
    ]) {
      assert.equal(isUnsealedSecretColumnName(name), false, name);
    }
  });
});

describe("added column detection", () => {
  it("flags a Drizzle column and a DDL column", () => {
    const source = [
      'export const t = table("t", {',
      '  accessToken: text("access_token").notNull(),',
      '  tokenHash: text("token_hash"),',
      "});",
      "const ddl = `CREATE TABLE IF NOT EXISTS t (",
      "  id TEXT PRIMARY KEY,",
      "  client_secret TEXT NOT NULL,",
      "  encrypted_secret TEXT",
      ")`;",
      "const alter = `ALTER TABLE t ADD COLUMN IF NOT EXISTS api_key TEXT`;",
    ].join("\n");

    assert.deepEqual(flagged(source), [
      "2:access_token",
      "7:client_secret",
      "10:api_key",
    ]);
  });

  it("only reports lines this branch added", () => {
    const source = [
      'oldToken: text("old_token"),',
      'newToken: text("new_token"),',
    ].join("\n");

    assert.deepEqual(flagged(source, new Set([2])), ["2:new_token"]);
    assert.deepEqual(flagged(source, new Set()), []);
  });

  it("honors the opt-out on the line or the line above", () => {
    const source = [
      'a: text("verify_token"), // guard:allow-plaintext-secret-column — one-time code, expires in 10 minutes',
      "// guard:allow-plaintext-secret-column — public share id, not a credential",
      'b: text("share_token"),',
      'c: text("no_opt_out_token"),',
    ].join("\n");

    assert.deepEqual(flagged(source), ["4:no_opt_out_token"]);
  });

  it("ignores columns that are not secret-named and non-text types", () => {
    const source = [
      'value: text("value").notNull(),',
      'tokenCount: integer("token_count"),',
      'expiresAt: bigint("token_expires_at", { mode: "number" }),',
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });
});

describe("source path scope", () => {
  it("covers package, template, and app source and SQL files", () => {
    for (const rel of [
      "packages/dispatch/src/db/schema.ts",
      "packages/core/src/secrets/schema.ts",
      "templates/clips/server/db/schema.ts",
      "apps/demo/server/db/migrations.sql",
    ]) {
      assert.equal(isSourcePath(rel), true, rel);
    }
  });

  it("skips tests, generated files, docs, and tooling", () => {
    for (const rel of [
      "packages/core/src/secrets/storage.spec.ts",
      "packages/core/src/db/schema-snapshot.generated.ts",
      "packages/core/docs/content/security.mdx",
      "packages/core/changelog/archive/CHANGELOG.md",
      "scripts/guard-no-unsealed-secret-columns.ts",
      "templates/example/README.md",
    ]) {
      assert.equal(isSourcePath(rel), false, rel);
    }
  });
});

describe("guard command", () => {
  it("exits 2, not 0, when it cannot determine the added lines", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(
          import.meta.dirname,
          "guard-no-unsealed-secret-columns.ts",
        ),
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          GUARD_DIFF_BASE: "origin/branch-that-does-not-exist-for-this-test",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /could not determine which lines/);
  });
});
