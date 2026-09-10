import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findNetlifyReleaseMigrationIssues,
  validateBetaPrebuiltReleaseEnvironment,
  validateFrameworkOnlyReleaseScript,
  validateManagedDrizzleMigrationOwnership,
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

  it("requires all beta-only runtime flags in the reusable build lane", () => {
    const source = `if [[ "$TARGET" == "beta" ]]; then
  export AGENT_NATIVE_RELEASE_MIGRATIONS=1
  export AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1
  export AGENT_NATIVE_ENABLE_KEEP_WARM=1
  export AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND=1
  export AGENT_NATIVE_HOSTED_HARNESS=true
fi
if [[ "$SKIP_BUILD_MIGRATIONS" == "true" ]]; then`;
    assert.deepEqual(validateBetaPrebuiltReleaseEnvironment(source), []);
    assert.notDeepEqual(
      validateBetaPrebuiltReleaseEnvironment(
        source.replace("export AGENT_NATIVE_RUN_RELEASE_MIGRATIONS=1", ""),
      ),
      [],
    );
    assert.notDeepEqual(
      validateBetaPrebuiltReleaseEnvironment(
        source.replace("export AGENT_NATIVE_RELEASE_MIGRATIONS=1", ""),
      ),
      [],
    );
    assert.notDeepEqual(
      validateBetaPrebuiltReleaseEnvironment(
        source.replace("export AGENT_NATIVE_HOSTED_HARNESS=true", ""),
      ),
      [],
    );
  });

  it("passes for every checked repository Netlify project", () => {
    assert.deepEqual(findNetlifyReleaseMigrationIssues(), []);
  });

  it("keeps managed app migrations out of framework release scripts", () => {
    assert.deepEqual(validateManagedDrizzleMigrationOwnership(), []);
  });

  it("rejects any release entrypoint beyond the framework migration", () => {
    const frameworkOnly = `
import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
`;
    assert.deepEqual(
      validateFrameworkOnlyReleaseScript(
        frameworkOnly,
        "migrate-production.ts",
      ),
      [],
    );
    assert.notDeepEqual(
      validateFrameworkOnlyReleaseScript(
        `import { runMigrations } from "../server/plugins/db.ts";\n${frameworkOnly}`,
        "migrate-production.ts",
      ),
      [],
    );
    assert.notDeepEqual(
      validateFrameworkOnlyReleaseScript(
        `${frameworkOnly}\nasync function runAppMigrations() { await main(); }`,
        "migrate-production.ts",
      ),
      [],
    );
  });
});
