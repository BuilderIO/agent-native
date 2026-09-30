import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parse } from "yaml";

test("explicit CI builds after a no-scripts install build package dependencies first", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const workflow = parse(
    readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8"),
  );
  let checkedJobs = 0;
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    const { steps } = job as {
      steps: Array<{
        uses?: string;
        with?: { install?: string };
        run?: string;
      }>;
    };
    if (
      !steps.some(
        (step) =>
          step.uses === "./.github/actions/setup-pnpm" &&
          step.with?.install === "no-scripts",
      )
    ) {
      continue;
    }
    const built = new Set<string>();
    for (const step of steps) {
      for (const match of (step.run ?? "").matchAll(
        /pnpm --filter (@agent-native\/[\w-]+) build/g,
      )) {
        const packageName = match[1]!;
        const manifest = JSON.parse(
          readFileSync(
            path.join(
              repoRoot,
              "packages",
              packageName.split("/")[1]!,
              "package.json",
            ),
            "utf8",
          ),
        );
        const required = new Set([
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}).filter(
            (name) => !manifest.peerDependenciesMeta?.[name]?.optional,
          ),
        ]);
        for (const dependency of required) {
          if (!dependency.startsWith("@agent-native/")) continue;
          assert.ok(
            built.has(dependency),
            `${jobName}: ${packageName} builds before required ${dependency}`,
          );
        }
        built.add(packageName);
      }
    }
    if (built.size > 0) checkedJobs++;
  }
  assert.ok(
    checkedJobs > 0,
    "No explicit no-scripts CI package builds checked",
  );
});
