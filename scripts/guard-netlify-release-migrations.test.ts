import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findNetlifyReleaseMigrationIssues,
  validateNetlifyReleaseMigrationConfig,
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

  it("passes for every checked repository Netlify project", () => {
    assert.deepEqual(findNetlifyReleaseMigrationIssues(), []);
  });
});
