import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const netlifyToml = fs.readFileSync(
  path.join(repoRoot, "packages/docs/netlify.toml"),
  "utf-8",
);

function redirectBlockFor(from: string): string | null {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = netlifyToml.match(
    new RegExp(
      String.raw`\[\[redirects\]\]\s+from\s*=\s*"${escaped}"\s+to\s*=\s*"([^"]+)"\s+status\s*=\s*(\d+)\s+force\s*=\s*(true|false)`,
      "m",
    ),
  );
  return match?.[0] ?? null;
}

describe("docs Netlify routing", () => {
  it("deploys the Nitro server function used by framework runtime routes", () => {
    expect(netlifyToml).toContain("NITRO_PRESET=netlify");
    expect(netlifyToml).toContain(
      'functions = "packages/docs/.netlify/functions-internal"',
    );
  });

  it("routes framework endpoints to the docs server function", () => {
    for (const route of ["/_agent-native/*", "/.well-known/*"]) {
      const block = redirectBlockFor(route);
      expect(block, `${route} redirect`).not.toBeNull();
      expect(block).toContain('to = "/.netlify/functions/server"');
      expect(block).toContain("status = 200");
      expect(block).toContain("force = true");
    }
  });
});
