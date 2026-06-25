import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _postProcessStandalone } from "./create.js";

export const STARTER_APP_NAME = "builder-agent-native-starter";
export const CHAT_TEMPLATE = "chat";

type PackageJson = Record<string, unknown>;

export function findAgentNativeRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    const chatPackageJson = path.join(
      dir,
      "templates",
      CHAT_TEMPLATE,
      "package.json",
    );
    if (fs.existsSync(chatPackageJson)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Could not find agent-native repo root (expected templates/chat/package.json).",
  );
}

export function generateStandaloneChatManifest(repoRoot?: string): {
  packageJson: PackageJson;
  pnpmWorkspaceYaml: string | null;
} {
  const root = repoRoot ?? findAgentNativeRoot();
  const chatTemplateDir = path.join(root, "templates", CHAT_TEMPLATE);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-builder-starter-sync-"),
  );

  try {
    fs.cpSync(chatTemplateDir, tempDir, { recursive: true });
    _postProcessStandalone(STARTER_APP_NAME, tempDir, CHAT_TEMPLATE);

    const packageJson = JSON.parse(
      fs.readFileSync(path.join(tempDir, "package.json"), "utf-8"),
    ) as PackageJson;

    const workspacePath = path.join(tempDir, "pnpm-workspace.yaml");
    const pnpmWorkspaceYaml = fs.existsSync(workspacePath)
      ? fs.readFileSync(workspacePath, "utf-8")
      : null;

    return { packageJson, pnpmWorkspaceYaml };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function mergePackageJsonRecords(
  canonical: Record<string, string> | undefined,
  starter: Record<string, string> | undefined,
  starterPinnedKeys: string[] = [],
): Record<string, string> {
  const merged = { ...(canonical ?? {}) };
  for (const [key, value] of Object.entries(starter ?? {})) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }
  for (const key of starterPinnedKeys) {
    const pinned = starter?.[key];
    if (pinned) {
      merged[key] = pinned;
    }
  }
  return merged;
}

export function mergeStarterManifest(
  starterPackageJson: PackageJson,
  canonicalPackageJson: PackageJson,
): PackageJson {
  const merged = structuredClone(canonicalPackageJson) as PackageJson;

  merged.name = starterPackageJson.name ?? STARTER_APP_NAME;
  if (typeof starterPackageJson.displayName === "string") {
    merged.displayName = starterPackageJson.displayName;
  }
  if (typeof starterPackageJson.description === "string") {
    merged.description = starterPackageJson.description;
  }
  if (starterPackageJson.private !== undefined) {
    merged.private = starterPackageJson.private;
  }
  if (typeof starterPackageJson.packageManager === "string") {
    merged.packageManager = starterPackageJson.packageManager;
  }

  merged.dependencies = mergePackageJsonRecords(
    canonicalPackageJson.dependencies as Record<string, string> | undefined,
    starterPackageJson.dependencies as Record<string, string> | undefined,
    ["@agent-native/core"],
  );
  merged.devDependencies = mergePackageJsonRecords(
    canonicalPackageJson.devDependencies as Record<string, string> | undefined,
    starterPackageJson.devDependencies as Record<string, string> | undefined,
  );
  merged.scripts = mergePackageJsonRecords(
    canonicalPackageJson.scripts as Record<string, string> | undefined,
    starterPackageJson.scripts as Record<string, string> | undefined,
  );

  return merged;
}

export function workspaceFileSyncChanged(
  existingWorkspace: string | null,
  canonicalWorkspace: string | null,
): boolean {
  if (canonicalWorkspace === null) {
    return existingWorkspace !== null;
  }
  return existingWorkspace !== canonicalWorkspace;
}

export function applyWorkspaceFileSync(
  targetPath: string,
  canonicalWorkspace: string | null,
): void {
  if (canonicalWorkspace === null) {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    return;
  }
  fs.writeFileSync(targetPath, canonicalWorkspace);
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export type SyncStarterManifestResult = {
  changed: boolean;
  packageJson: PackageJson;
  pnpmWorkspaceYaml: string | null;
};

export function syncStarterManifestFiles(options: {
  starterPackageJsonPath: string;
  starterPnpmWorkspacePath?: string;
  repoRoot?: string;
  write?: boolean;
}): SyncStarterManifestResult {
  const { packageJson: canonical, pnpmWorkspaceYaml } =
    generateStandaloneChatManifest(options.repoRoot);

  const starterPackageJson = JSON.parse(
    fs.readFileSync(options.starterPackageJsonPath, "utf-8"),
  ) as PackageJson;
  const mergedPackageJson = mergeStarterManifest(starterPackageJson, canonical);

  let workspaceChanged = false;
  const existingWorkspace =
    options.starterPnpmWorkspacePath &&
    fs.existsSync(options.starterPnpmWorkspacePath)
      ? fs.readFileSync(options.starterPnpmWorkspacePath, "utf-8")
      : null;

  workspaceChanged = workspaceFileSyncChanged(
    existingWorkspace,
    pnpmWorkspaceYaml,
  );

  const packageChanged =
    stableJson(starterPackageJson) !== stableJson(mergedPackageJson);
  const changed = packageChanged || workspaceChanged;

  if (options.write && changed) {
    if (packageChanged) {
      fs.writeFileSync(
        options.starterPackageJsonPath,
        stableJson(mergedPackageJson),
      );
    }
    if (workspaceChanged && options.starterPnpmWorkspacePath) {
      applyWorkspaceFileSync(
        options.starterPnpmWorkspacePath,
        pnpmWorkspaceYaml,
      );
    }
  }

  return {
    changed,
    packageJson: mergedPackageJson,
    pnpmWorkspaceYaml,
  };
}

export function parseSyncStarterManifestArgs(argv: string[]): {
  command: "merge" | "generate";
  starterPackageJsonPath?: string;
  starterPnpmWorkspacePath?: string;
  write: boolean;
  repoRoot?: string;
} {
  const [commandRaw, ...rest] = argv;
  const command = commandRaw === "generate" ? "generate" : "merge";
  let starterPackageJsonPath: string | undefined;
  let starterPnpmWorkspacePath: string | undefined;
  let write = false;
  let repoRoot: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--starter-package-json") {
      starterPackageJsonPath = rest[++i];
      continue;
    }
    if (arg === "--starter-pnpm-workspace") {
      starterPnpmWorkspacePath = rest[++i];
      continue;
    }
    if (arg === "--repo-root") {
      repoRoot = rest[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (command === "merge" && !starterPackageJsonPath) {
    throw new Error(
      "merge requires --starter-package-json <path> [--starter-pnpm-workspace <path>] [--write] [--repo-root <path>]",
    );
  }

  return {
    command,
    starterPackageJsonPath,
    starterPnpmWorkspacePath,
    write,
    repoRoot,
  };
}

export function runSyncStarterManifestCli(argv: string[]): number {
  const args = parseSyncStarterManifestArgs(argv);

  if (args.command === "generate") {
    const { packageJson, pnpmWorkspaceYaml } = generateStandaloneChatManifest(
      args.repoRoot,
    );
    process.stdout.write(stableJson(packageJson));
    if (pnpmWorkspaceYaml) {
      process.stdout.write("\n--- pnpm-workspace.yaml ---\n");
      process.stdout.write(pnpmWorkspaceYaml);
    }
    return 0;
  }

  const result = syncStarterManifestFiles({
    starterPackageJsonPath: args.starterPackageJsonPath!,
    starterPnpmWorkspacePath: args.starterPnpmWorkspacePath,
    repoRoot: args.repoRoot,
    write: args.write,
  });

  if (result.changed) {
    console.log(
      args.write
        ? "Updated builder-agent-native-starter manifest from templates/chat."
        : "builder-agent-native-starter manifest is out of date with templates/chat.",
    );
    return args.write ? 0 : 1;
  }

  console.log(
    "builder-agent-native-starter manifest already matches templates/chat.",
  );
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const exitCode = runSyncStarterManifestCli(process.argv.slice(2));
  process.exit(exitCode);
}
