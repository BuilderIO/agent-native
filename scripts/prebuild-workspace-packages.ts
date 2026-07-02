#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

type PrebuildMode = "dev" | "postinstall";

interface PackageTarget {
  id: string;
  name: string;
  dir: string;
  expectedOutputs: string[];
  tsBuildInfoFiles?: string[];
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];

function wildcardDistOutputs(packageDir: string, exportPath: string): string[] {
  const firstStar = exportPath.indexOf("*");
  if (firstStar === -1 || exportPath.indexOf("*", firstStar + 1) !== -1) {
    return [];
  }

  const distPrefix = exportPath.slice(0, firstStar);
  const distSuffix = exportPath.slice(firstStar + 1);
  if (!distPrefix.startsWith("./dist/") || distSuffix !== ".js") return [];

  const sourceDir = path.join(
    packageDir,
    distPrefix.replace("./dist/", "src/"),
  );
  if (!existsSync(sourceDir)) return [];

  const outputs: string[] = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const sourceName = entry.name;
    if (
      sourceName.endsWith(".d.ts") ||
      sourceName.includes(".spec.") ||
      sourceName.includes(".test.")
    ) {
      continue;
    }

    const extension = sourceExtensions.find((candidate) =>
      sourceName.endsWith(candidate),
    );
    if (!extension) continue;

    outputs.push(
      `${distPrefix.slice(2)}${sourceName.slice(0, -extension.length)}${distSuffix}`,
    );
  }

  return outputs;
}

function exportedDistOutputs(packageDir: string): string[] {
  const packageJson = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as {
    exports?: unknown;
  };
  const outputs = new Set<string>();

  function collect(value: unknown): void {
    if (typeof value === "string") {
      if (value.startsWith("./dist/")) {
        if (value.includes("*")) {
          for (const output of wildcardDistOutputs(packageDir, value)) {
            outputs.add(output);
          }
        } else {
          outputs.add(value.slice(2));
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }

    if (value && typeof value === "object") {
      for (const item of Object.values(value)) collect(item);
    }
  }

  collect(packageJson.exports);
  return [...outputs].sort();
}

const targets: PackageTarget[] = [
  {
    id: "shared-app-config",
    name: "@agent-native/shared-app-config",
    dir: "packages/shared-app-config",
    expectedOutputs: exportedDistOutputs("packages/shared-app-config"),
    tsBuildInfoFiles: [
      "node_modules/.cache/tsbuildinfo/shared-app-config.tsbuildinfo",
    ],
  },
  {
    id: "core",
    name: "@agent-native/core",
    dir: "packages/core",
    expectedOutputs: [
      ...exportedDistOutputs("packages/core"),
      "dist/cli/index.js",
    ],
    tsBuildInfoFiles: [
      "node_modules/.cache/tsbuildinfo/core.tsbuildinfo",
      "node_modules/.cache/tsbuildinfo/core-cli.tsbuildinfo",
    ],
  },
  {
    id: "code-agents-ui",
    name: "@agent-native/code-agents-ui",
    dir: "packages/code-agents-ui",
    expectedOutputs: exportedDistOutputs("packages/code-agents-ui"),
    tsBuildInfoFiles: [
      "node_modules/.cache/tsbuildinfo/code-agents-ui.tsbuildinfo",
    ],
  },
  {
    id: "migrate",
    name: "@agent-native/migrate",
    dir: "packages/migrate",
    expectedOutputs: exportedDistOutputs("packages/migrate"),
    tsBuildInfoFiles: ["node_modules/.cache/tsbuildinfo/migrate.tsbuildinfo"],
  },
  {
    id: "pinpoint",
    name: "@agent-native/pinpoint",
    dir: "packages/pinpoint",
    expectedOutputs: exportedDistOutputs("packages/pinpoint"),
  },
  {
    id: "scheduling",
    name: "@agent-native/scheduling",
    dir: "packages/scheduling",
    expectedOutputs: exportedDistOutputs("packages/scheduling"),
    tsBuildInfoFiles: [
      "node_modules/.cache/tsbuildinfo/scheduling.tsbuildinfo",
    ],
  },
  {
    id: "embedding",
    name: "@agent-native/embedding",
    dir: "packages/embedding",
    expectedOutputs: exportedDistOutputs("packages/embedding"),
    tsBuildInfoFiles: ["node_modules/.cache/tsbuildinfo/embedding.tsbuildinfo"],
  },
  {
    id: "dispatch",
    name: "@agent-native/dispatch",
    dir: "packages/dispatch",
    expectedOutputs: exportedDistOutputs("packages/dispatch"),
    tsBuildInfoFiles: ["node_modules/.cache/tsbuildinfo/dispatch.tsbuildinfo"],
  },
];

const modeTargets: Record<PrebuildMode, string[]> = {
  dev: [
    "shared-app-config",
    "core",
    "code-agents-ui",
    "scheduling",
    "dispatch",
    "pinpoint",
  ],
  postinstall: [
    "shared-app-config",
    "core",
    "code-agents-ui",
    "migrate",
    "pinpoint",
    "scheduling",
    "embedding",
    "dispatch",
  ],
};

function readMode(): PrebuildMode {
  const raw = process.argv[2] ?? "dev";
  if (raw === "dev" || raw === "postinstall") return raw;
  console.error(
    `[prebuild-workspace-packages] Unknown mode "${raw}". Use dev or postinstall.`,
  );
  process.exit(1);
}

function pnpmExecutable(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function firstMissingOutput(target: PackageTarget): string | null {
  for (const output of target.expectedOutputs) {
    if (!existsSync(path.join(target.dir, output))) return output;
  }
  return null;
}

function clearStaleBuildInfo(target: PackageTarget): void {
  const missingOutput = firstMissingOutput(target);
  if (!missingOutput) return;

  const removed: string[] = [];
  for (const buildInfo of target.tsBuildInfoFiles ?? []) {
    const buildInfoPath = path.join(target.dir, buildInfo);
    if (!existsSync(buildInfoPath)) continue;
    rmSync(buildInfoPath, { force: true });
    removed.push(path.join(target.dir, buildInfo));
  }

  if (removed.length > 0) {
    console.log(
      `[prebuild-workspace-packages] ${target.name}: ${path.join(
        target.dir,
        missingOutput,
      )} is missing; removed stale ${removed.join(", ")}`,
    );
  }
}

const mode = readMode();
const selectedTargets = modeTargets[mode].map((id) => {
  const target = targets.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown prebuild target: ${id}`);
  return target;
});

for (const target of selectedTargets) {
  clearStaleBuildInfo(target);
}

const filters = selectedTargets.flatMap((target) => ["--filter", target.name]);
console.log(
  `[prebuild-workspace-packages] Building ${selectedTargets
    .map((target) => target.name)
    .join(", ")}`,
);
execFileSync(pnpmExecutable(), [...filters, "run", "build"], {
  cwd: process.cwd(),
  stdio: "inherit",
  // .cmd files on Windows require shell:true to be found by execFileSync.
  shell: process.platform === "win32",
});
