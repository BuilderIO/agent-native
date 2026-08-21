import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findNetlifyReleaseMigrationIssues,
  validateBetaPrebuiltReleaseEnvironment,
  validateBetaSchemaOwnerRuntimeContract,
  validateNetlifyReleaseMigrationConfig,
  validatePublishedNetlifyReleaseMigrationConfig,
} from "./guard-netlify-release-migrations.ts";

describe("Netlify release migration guard", () => {
  it("accepts a production release owner", () => {
    assert.deepEqual(
      validateNetlifyReleaseMigrationConfig(
        `[build]\ncommand = "pnpm migrate:production"\n\n[context.production.environment]\nAGENT_NATIVE_RELEASE_MIGRATIONS = "1"\n`,
        "templates/example/netlify.toml",
      ),
      [],
    );
  });

  it("rejects a release command without production ownership", () => {
    assert.deepEqual(
      validateNetlifyReleaseMigrationConfig(
        `[build]\ncommand = "pnpm migrate:production"\n`,
        "templates/example/netlify.toml",
      ),
      [
        "templates/example/netlify.toml: production runs migrate:production but has no [context.production.environment] section",
      ],
    );
  });

  it("rejects a flag scoped to build instead of production functions", () => {
    assert.deepEqual(
      validateNetlifyReleaseMigrationConfig(
        `[build]\ncommand = "pnpm migrate:production"\n\n[build.environment]\nAGENT_NATIVE_RELEASE_MIGRATIONS = "1"\n\n[context.production.environment]\n`,
        "templates/example/netlify.toml",
      ),
      [
        'templates/example/netlify.toml: production runs migrate:production but does not set AGENT_NATIVE_RELEASE_MIGRATIONS = "1" in [context.production.environment]',
      ],
    );
  });

  it("does not require release ownership for previews without a release command", () => {
    assert.deepEqual(
      validateNetlifyReleaseMigrationConfig(
        `[build]\ncommand = "pnpm build"\n`,
        "templates/example/netlify.toml",
      ),
      [],
    );
  });

  it("rejects a published site that never runs its release migration", () => {
    assert.deepEqual(
      validatePublishedNetlifyReleaseMigrationConfig(
        `[build]\ncommand = "pnpm build"\n\n[context.production.environment]\nAGENT_NATIVE_RELEASE_MIGRATIONS = "1"\n`,
        "templates/example/netlify.toml",
        "example",
      ),
      [
        "templates/example/netlify.toml: published production/beta site must run migrate:production in its [build] command",
      ],
    );
  });

  it("requires the beta release condition in published build commands", () => {
    assert.deepEqual(
      validatePublishedNetlifyReleaseMigrationConfig(
        `[build]\ncommand = "pnpm migrate:production"\n\n[context.production.environment]\nAGENT_NATIVE_RELEASE_MIGRATIONS = "1"\n`,
        "templates/example/netlify.toml",
        "example",
      ),
      [
        'templates/example/netlify.toml: beta branch-deploy builds run migrate:production only when AGENT_NATIVE_RUN_RELEASE_MIGRATIONS = "1" is supplied by the prebuilt beta lane',
      ],
    );
  });

  it("leaves Clips beta schema ownership to the prebuilt workflow", () => {
    const source =
      `[build]\ncommand = "if [ \\\"\${agentNativePrebuiltBuild:-}\\\" != \\\"true\\\" ]; then pnpm migrate:production; fi"\n\n` +
      `[context.production.environment]\nAGENT_NATIVE_RELEASE_MIGRATIONS = "1"\n`;
    assert.deepEqual(
      validatePublishedNetlifyReleaseMigrationConfig(
        source,
        "templates/clips/netlify.toml",
        "clips",
      ),
      [],
    );
  });

  it("requires all beta-only runtime flags in the reusable build lane", () => {
    const source = `if [[ "$TARGET" == "beta" ]]; then
  if [[ "$SOURCE_TEMPLATE" != "clips" ]]; then
    export AGENT_NATIVE_RELEASE_MIGRATIONS=1
    export AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1
  else
    export AGENT_NATIVE_BETA_SCHEMA_OWNER=production
  fi
  export AGENT_NATIVE_ENABLE_KEEP_WARM=1
  export AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND=1
  export AGENT_NATIVE_HOSTED_HARNESS=true
fi
if [[ "$SOURCE_TEMPLATE" == "clips" ]]; then`;
    assert.deepEqual(validateBetaPrebuiltReleaseEnvironment(source), []);
    assert.notDeepEqual(
      validateBetaPrebuiltReleaseEnvironment(
        source.replace("export AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1", ""),
      ),
      [],
    );
    assert.notDeepEqual(
      validateBetaPrebuiltReleaseEnvironment(
        source.replace("export AGENT_NATIVE_BETA_SCHEMA_OWNER=production", ""),
      ),
      [],
    );
    assert.notDeepEqual(
      validateBetaPrebuiltReleaseEnvironment(
        source.replace('if [[ "$SOURCE_TEMPLATE" != "clips" ]]; then', ""),
      ),
      [],
    );
  });

  it("passes for every checked repository Netlify project", () => {
    assert.deepEqual(findNetlifyReleaseMigrationIssues(), []);
  });

  it("requires the beta schema owner marker to reach runtime", () => {
    assert.deepEqual(validateBetaSchemaOwnerRuntimeContract(), []);
  });

  it("accepts the config-backed migration consumer without a raw env read", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "netlify-migration-"));
    try {
      for (const relativeFile of [
        "packages/core/src/db/migrations.ts",
        "packages/core/src/vite/client.ts",
        "packages/core/src/deploy/build.ts",
      ]) {
        const file = path.join(repoRoot, relativeFile);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(
          file,
          relativeFile.endsWith("migrations.ts")
            ? 'import { getAppConfig } from "../app-config/index.js";\nreturn getAppConfig().migration.betaSchemaOwner;\n'
            : "process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER\n",
        );
      }

      assert.deepEqual(validateBetaSchemaOwnerRuntimeContract(repoRoot), []);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a migration runtime that stops consuming the config marker", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "netlify-migration-"));
    try {
      for (const relativeFile of [
        "packages/core/src/db/migrations.ts",
        "packages/core/src/vite/client.ts",
        "packages/core/src/deploy/build.ts",
      ]) {
        const file = path.join(repoRoot, relativeFile);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(
          file,
          relativeFile.endsWith("migrations.ts")
            ? "export function runMigrations() {}\n"
            : "process.env.AGENT_NATIVE_BETA_SCHEMA_OWNER\n",
        );
      }

      assert.deepEqual(validateBetaSchemaOwnerRuntimeContract(repoRoot), [
        "packages/core/src/db/migrations.ts: must consume or embed AGENT_NATIVE_BETA_SCHEMA_OWNER instead of treating it as a config-only marker",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
