import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const manifest = {
  projectId: "example-project",
  branchId: "br-example-task",
  branchName: "dev/content-search-latency-example",
  endpointHost: "ep-example-pooler.example.neon.tech",
  database: "neondb",
  expiresAt: "2099-01-01T00:00:00.000Z",
  ownerEmail: "owner@example.invalid",
  outsiderEmail: "outsider@example.invalid",
  spaceId: "owner-space",
  outsiderSpaceId: "outsider-space",
  fixturePrefix: "qa-search-example-",
};

function refusal(
  overrides: Partial<typeof manifest>,
  url: string,
  environment: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "content-search-guard-"));
  try {
    const manifestPath = join(directory, "manifest.json");
    const urlPath = join(directory, "url.txt");
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...overrides }));
    writeFileSync(urlPath, url);
    const result = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "../node_modules/tsx/dist/cli.mjs"),
        "benchmarks/benchmark-search.ts",
        "inspect",
        "--manifest",
        manifestPath,
        "--url-file",
        urlPath,
      ],
      {
        cwd: import.meta.dirname.replace(/[/\\]benchmarks$/, ""),
        env: { ...process.env, ...environment },
        encoding: "utf8",
      },
    );
    expect(result.status).not.toBe(0);
    return `${result.stdout}${result.stderr}`;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("search benchmark target guard", () => {
  const targetUrl =
    "postgres://user:password@ep-example-pooler.example.neon.tech/neondb";

  it("refuses a production or default branch before connecting", () => {
    expect(refusal({ branchName: "production" }, targetUrl)).toContain(
      "isolated search branch",
    );
  });

  it("refuses a different endpoint or database before connecting", () => {
    expect(
      refusal(
        {},
        "postgres://user:password@ep-other-pooler.example.neon.tech/neondb",
      ),
    ).toContain("endpoint differs");
    expect(
      refusal(
        {},
        "postgres://user:password@ep-example-pooler.example.neon.tech/otherdb",
      ),
    ).toContain("database differs");
  });

  it("refuses a conflicting higher-precedence database alias", () => {
    expect(
      refusal({}, targetUrl, {
        CONTENT_DATABASE_URL_UNPOOLED:
          "postgres://user:password@ep-other.example.neon.tech/neondb",
      }),
    ).toContain("points outside the pinned task branch");
  });
});
