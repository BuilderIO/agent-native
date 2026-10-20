import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const contentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedScript = resolve(contentRoot, "scripts/seed-perf-database.mjs");

function defaultManifestPath(email: string, title: string) {
  return execFileSync(
    process.execPath,
    [
      seedScript,
      "--base-url",
      "https://perf.example.test",
      "--email",
      email,
      "--password",
      "test-only",
      "--title",
      title,
      "--manifest-path-only",
    ],
    { cwd: contentRoot, encoding: "utf8" },
  ).trim();
}

describe("performance seeder default manifest path", () => {
  it("distinguishes sanitized email and title collisions while staying stable", () => {
    const first = defaultManifestPath("perf.one@example.test", "Perf/A");

    expect(first).not.toBe(
      defaultManifestPath("perf.one@example.test", "Perf?A"),
    );
    expect(first).not.toBe(
      defaultManifestPath("perf-one@example.test", "Perf/A"),
    );
    expect(first).toBe(defaultManifestPath("perf.one@example.test", "Perf/A"));
  });
});
