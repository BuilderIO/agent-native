import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { PR_VISUAL_RECAP_WORKFLOW_YML } from "./pr-visual-recap-workflow.js";
import { buildReusableCallerWorkflow } from "./recap.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("the recap installer workflow", () => {
  it("keeps Bash semantics on configurable runners", () => {
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "    defaults:\n      run:\n        shell: bash",
    );
  });

  it("wakes label-gated recaps when a PR label is applied", () => {
    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toContain(
      "types: [opened, synchronize, reopened, ready_for_review, labeled, closed]",
    );
  });

  it("forwards label gates from reusable callers", () => {
    expect(buildReusableCallerWorkflow()).toContain(
      "required-labels: ${{ vars.VISUAL_RECAP_REQUIRED_LABELS || '' }}",
    );
  });

  it("wakes labeled events when reusable callers configure labels directly", () => {
    const workflow = buildReusableCallerWorkflow({
      requiredLabels: "visual recap",
    });

    expect(workflow).toContain("if: github.event.action != 'labeled' || true");
    expect(workflow).toContain('required-labels: "visual recap"');
  });

  it("bundles the canonical workflow byte for byte", () => {
    const source = readFileSync(
      path.join(repoRoot, ".github/workflows/pr-visual-recap.yml"),
      "utf8",
    );

    expect(PR_VISUAL_RECAP_WORKFLOW_YML).toBe(source);
  });

  it("embeds the workflow in the published runtime module", () => {
    const source = readFileSync(
      path.join(
        repoRoot,
        "packages/recap-cli/dist/pr-visual-recap-workflow.js",
      ),
      "utf8",
    );

    expect(source).toBe(
      `export const PR_VISUAL_RECAP_WORKFLOW_YML = ${JSON.stringify(PR_VISUAL_RECAP_WORKFLOW_YML)};\n`,
    );
  });
});

const RECAP_WORKFLOW_PATHS = [
  ".github/workflows/pr-visual-recap.yml",
  ".github/workflows/pr-visual-recap-reusable.yml",
  ".github/workflows/pr-visual-recap-fork.yml",
];

function publishedRecapCliInstallScript(workflowPath: string): string {
  const workflow = parse(readFileSync(workflowPath, "utf8")) as {
    jobs?: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
  };
  const steps = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.name === "Install published recap CLI");

  if (steps.length !== 1 || typeof steps[0]?.run !== "string") {
    throw new Error(
      `Expected one "Install published recap CLI" run step in ${workflowPath}`,
    );
  }
  return steps[0].run;
}

function runPublishedRecapCliInstall(
  script: string,
  bins: readonly string[],
): { status: number | null; env: string; runnerTemp: string; stderr: string } {
  const root = mkdtempSync(path.join(tmpdir(), "recap-cli-install-"));
  const stubBinDir = path.join(root, "stub-bin");
  const runnerTemp = path.join(root, "runner-temp");
  const envFile = path.join(root, "github-env");
  mkdirSync(stubBinDir);
  mkdirSync(runnerTemp);

  const npm = path.join(stubBinDir, "npm");
  writeFileSync(
    npm,
    [
      "#!/bin/sh",
      "set -eu",
      'if [ "${1:-}" = "view" ]; then echo "0.5.58"; exit 0; fi',
      "prefix=",
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "--prefix" ]; then prefix="$2"; shift; fi',
      "  shift",
      "done",
      '[ -n "$prefix" ] || exit 0',
      'mkdir -p "$prefix/node_modules/.bin"',
      "for bin in ${STUB_RECAP_BINS:-}; do",
      "  printf '#!/bin/sh\\nexit 0\\n' > \"$prefix/node_modules/.bin/$bin\"",
      '  chmod +x "$prefix/node_modules/.bin/$bin"',
      "done",
      "",
    ].join("\n"),
  );
  chmodSync(npm, 0o755);

  const result = spawnSync("bash", ["-c", script], {
    env: {
      ...process.env,
      PATH: `${stubBinDir}:${process.env.PATH ?? ""}`,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: envFile,
      RECAP_CLI_VERSION: "0.5.58",
      STUB_RECAP_BINS: bins.join(" "),
    },
    encoding: "utf8",
  });
  const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  rmSync(root, { recursive: true, force: true });

  return { status: result.status, env, runnerTemp, stderr: result.stderr };
}

describe.each(RECAP_WORKFLOW_PATHS)(
  "published recap CLI install in %s",
  (relativePath) => {
    const script = publishedRecapCliInstallScript(
      path.join(repoRoot, relativePath),
    );

    it.each([
      ["only the modern bin", ["agent-native-recap"], "agent-native-recap"],
      ["only the legacy bin", ["agent-native"], "agent-native"],
      [
        "both bins, preferring modern",
        ["agent-native-recap", "agent-native"],
        "agent-native-recap",
      ],
    ] as const)("selects when %s is installed", (_label, bins, bin) => {
      const result = runPublishedRecapCliInstall(script, bins);

      expect(result.status, result.stderr).toBe(0);
      expect(result.env).toContain(
        `RECAP_CLI=${path.join(
          result.runnerTemp,
          "recap-cli",
          "node_modules",
          ".bin",
          bin,
        )}`,
      );
    });

    it("fails before exporting RECAP_CLI when no bin is installed", () => {
      const result = runPublishedRecapCliInstall(script, []);

      expect(result.status).not.toBe(0);
      expect(result.env).not.toMatch(/^RECAP_CLI=/m);
    });
  },
);
