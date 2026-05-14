import { describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { nextjsSourceAdapter } from "./adapters/nextjs.js";
import { agentNativeTargetAdapter } from "./adapters/agent-native-target.js";
import { createDefaultVerifiers } from "./verifiers/deterministic.js";
import {
  approveMigrationRun,
  createMigrationRun,
  discoverMigration,
  migrationContext,
  planMigration,
  verifyMigration,
} from "./runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("migration runtime", () => {
  it("runs discover, plan, approve, scaffold, and verify", async () => {
    const sourceRoot = path.join(
      path.resolve(__dirname, "."),
      "__fixtures__/next-pages",
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "an-migrate-"));
    const outputRoot = path.join(tmp, "migrated-app");
    const artifactRoot = path.join(tmp, "artifacts");

    let run = await createMigrationRun({
      sourceRoot,
      outputRoot,
      artifactRoot,
    });
    const discovered = await discoverMigration(run, nextjsSourceAdapter);
    run = discovered.run;
    const planned = await planMigration(run, discovered.ir);
    run = await approveMigrationRun(planned.run);

    const context = migrationContext(run, discovered.ir, planned.tasks);
    const result = await agentNativeTargetAdapter.scaffold(context);
    expect(result.ok).toBe(true);
    expect(result.changedFiles).toContain("package.json");

    const report = await verifyMigration(context, createDefaultVerifiers());
    expect(report.ok).toBe(true);
    await expect(
      fs.stat(path.join(artifactRoot, run.id, "01-assessment.md")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputRoot, "actions/view-screen.ts")),
    ).resolves.toBeTruthy();
  });
});
