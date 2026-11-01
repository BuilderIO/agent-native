import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Reads the monorepo's `templates/`, which Stryker's Core-only sandbox lacks, so
// this stays out of provider-schema-conformance.spec.ts, the spec mutation runs.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

describe("template conformance inventory", () => {
  const templates = fs
    .readdirSync(path.join(repoRoot, "templates"))
    .filter((app) =>
      fs.existsSync(path.join(repoRoot, "templates", app, "actions")),
    );

  it("finds the action-bearing templates", () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  it.each(templates)("%s runs the provider-schema spec", (app) => {
    const server = path.join(repoRoot, "templates", app, "server");
    expect(
      ["mcp-provider-schemas.spec.ts", "mcp-provider-schemas.test.ts"].some(
        (file) => fs.existsSync(path.join(server, file)),
      ),
      `templates/${app}/server/mcp-provider-schemas.spec.ts is missing`,
    ).toBe(true);
  });
});
