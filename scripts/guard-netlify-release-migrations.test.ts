import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findNetlifyReleaseMigrationIssues,
  validateBetaPrebuiltReleaseEnvironment,
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

  it("makes the masked Clips prebuilt schema owner explicit", () => {
    const source =
      `[build]\ncommand = "if [ \\\"\${agentNativePrebuiltBuild:-}\\\" != \\\"true\\\" ]; then pnpm migrate:production; fi"\n\n` +
      `[context.production.environment]\nAGENT_NATIVE_RELEASE_MIGRATIONS = "1"\n`;
    assert.deepEqual(
      validatePublishedNetlifyReleaseMigrationConfig(
        source,
        "templates/clips/netlify.toml",
        "clips",
      ),
      [
        'templates/clips/netlify.toml: Clips prebuilt builds skip release migration; declare AGENT_NATIVE_BETA_SCHEMA_OWNER = "production" for the beta lane',
      ],
    );
    assert.deepEqual(
      validatePublishedNetlifyReleaseMigrationConfig(
        `${source}\n[context.branch-deploy.environment]\nAGENT_NATIVE_BETA_SCHEMA_OWNER = "production"\n`,
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
        source.replace('if [[ "$SOURCE_TEMPLATE" != "clips" ]]; then', ""),
      ),
      [],
    );
  });

  it("passes for every checked repository Netlify project", () => {
    assert.deepEqual(findNetlifyReleaseMigrationIssues(), []);
  });
});
