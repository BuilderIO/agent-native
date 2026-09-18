import fs from "fs/promises";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { createSkeletonProjectIR } from "../adapters/agent-introspection.js";
import { createMigrationRun, migrationContext } from "../runtime.js";
import { createBrowserVerifier } from "./browser.js";

describe("browser verifier", () => {
  it("falls back to deterministic fetch checks when Playwright is unavailable", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "an-browser-"));
    const run = await createMigrationRun({
      sourceRoot: "https://example.test/dashboard",
      inputKind: "url",
      outputRoot: path.join(tmp, "out"),
      artifactRoot: path.join(tmp, "artifacts"),
      id: "mig_browser",
    });
    const ir = createSkeletonProjectIR({
      sourceRoot: run.sourceRoot,
      inputKind: run.inputKind,
      inputDescription: run.inputDescription,
    });
    const context = migrationContext(run, ir, []);
    const fetchImpl: typeof fetch = async () =>
      new Response("<html><title>ok</title></html>", { status: 200 });

    const verifier = createBrowserVerifier({
      baseUrl: "https://example.test",
      fetchImpl,
      loadPlaywright: async () => null,
    });
    const result = await verifier.run(context);

    expect(result).toMatchObject({
      id: "browser-smoke",
      ok: true,
      severity: "info",
    });
    expect(result.summary).toContain("Fetch fallback");

    const artifact = JSON.parse(
      await fs.readFile(
        path.join(run.artifactDir, "browser-smoke.json"),
        "utf-8",
      ),
    );
    expect(artifact).toMatchObject({
      mode: "fetch-fallback",
      checks: [{ route: "/dashboard", status: 200, ok: true }],
    });
  });

  it("returns a structured skip result instead of crashing without a browser target", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "an-browser-skip-"));
    const run = await createMigrationRun({
      sourceRoot: "A marketing site",
      inputKind: "description",
      outputRoot: path.join(tmp, "out"),
      artifactRoot: path.join(tmp, "artifacts"),
      id: "mig_browser_skip",
    });
    const ir = createSkeletonProjectIR({
      sourceRoot: run.sourceRoot,
      inputKind: run.inputKind,
      inputDescription: run.inputDescription,
    });
    const context = migrationContext(run, ir, []);

    const result = await createBrowserVerifier({
      loadPlaywright: async () => null,
    }).run(context);

    expect(result).toMatchObject({
      id: "browser-smoke",
      ok: true,
      severity: "info",
    });
    expect(result.summary).toContain("skipped");
  });
});
