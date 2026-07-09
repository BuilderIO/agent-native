import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _postProcessStandalone } from "./create.js";

export const STARTER_APP_NAME = "builder-agent-native-starter";
export const CHAT_TEMPLATE = "chat";

/** Toolchain files that must track templates/chat or typecheck/build drift. */
export const STARTER_TOOLCHAIN_SYNC_PATHS = [
  "react-router.config.ts",
  "vite.config.ts",
  "tsconfig.json",
  "ssr-entry.ts",
  "app/vite-env.d.ts",
  "app/routes.ts",
  "server/routes/[...page].get.ts",
  // server/plugins/* are intentionally excluded: starter keeps its own
  // systemPrompt and auth marketing copy; post-process only rewrites appId/title.
  "server/middleware/auth.ts",
  "components.json",
  ".oxfmtrc.json",
  "netlify.toml",
] as const;

const STANDALONE_SNAPSHOT_EXCLUDED_TOP_LEVEL = new Set([
  ".deploy-tmp",
  ".env",
  ".env.local",
  ".generated",
  ".netlify",
  ".output",
  ".react-router",
  "build",
  "data",
  "dist",
  "node_modules",
]);

export type StarterToolchainSyncPath =
  (typeof STARTER_TOOLCHAIN_SYNC_PATHS)[number];

type PackageJson = Record<string, unknown>;

export type StandaloneChatSnapshot = {
  cleanup: () => void;
  dir: string;
  packageJson: PackageJson;
  pnpmWorkspaceYaml: string | null;
  toolchainFiles: Map<StarterToolchainSyncPath, string>;
};

export function listStarterSyncPaths(): string[] {
  return [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ...STARTER_TOOLCHAIN_SYNC_PATHS,
  ];
}

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

export function collectStarterToolchainFiles(
  canonicalDir: string,
): Map<StarterToolchainSyncPath, string> {
  const files = new Map<StarterToolchainSyncPath, string>();
  for (const relativePath of STARTER_TOOLCHAIN_SYNC_PATHS) {
    const absolutePath = path.join(canonicalDir, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    files.set(relativePath, fs.readFileSync(absolutePath, "utf-8"));
  }
  return files;
}

export function createStandaloneChatSnapshot(
  repoRoot?: string,
): StandaloneChatSnapshot {
  const root = repoRoot ?? findAgentNativeRoot();
  const chatTemplateDir = path.join(root, "templates", CHAT_TEMPLATE);
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-builder-starter-sync-"),
  );

  fs.cpSync(chatTemplateDir, tempDir, {
    recursive: true,
    filter: (source) =>
      shouldCopyStandaloneSnapshotPath(source, chatTemplateDir),
  });
  _postProcessStandalone(STARTER_APP_NAME, tempDir, CHAT_TEMPLATE);

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(tempDir, "package.json"), "utf-8"),
  ) as PackageJson;

  const workspacePath = path.join(tempDir, "pnpm-workspace.yaml");
  const pnpmWorkspaceYaml = fs.existsSync(workspacePath)
    ? fs.readFileSync(workspacePath, "utf-8")
    : null;

  return {
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
    dir: tempDir,
    packageJson,
    pnpmWorkspaceYaml,
    toolchainFiles: collectStarterToolchainFiles(tempDir),
  };
}

function shouldCopyStandaloneSnapshotPath(
  source: string,
  root: string,
): boolean {
  const relative = path.relative(root, source);
  if (!relative) return true;
  const topLevel = relative.split(path.sep)[0];
  return !STANDALONE_SNAPSHOT_EXCLUDED_TOP_LEVEL.has(topLevel);
}

export function generateStandaloneChatManifest(repoRoot?: string): {
  packageJson: PackageJson;
  pnpmWorkspaceYaml: string | null;
} {
  const snapshot = createStandaloneChatSnapshot(repoRoot);
  try {
    return {
      packageJson: snapshot.packageJson,
      pnpmWorkspaceYaml: snapshot.pnpmWorkspaceYaml,
    };
  } finally {
    snapshot.cleanup();
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
    ["@agent-native/core", "@agent-native/toolkit"],
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

export type StarterToolchainSyncChange = {
  relativePath: StarterToolchainSyncPath;
  changed: boolean;
};

export function diffStarterToolchainFiles(
  starterDir: string,
  canonicalFiles: Map<StarterToolchainSyncPath, string>,
): StarterToolchainSyncChange[] {
  return STARTER_TOOLCHAIN_SYNC_PATHS.map((relativePath) => {
    const canonicalContent = canonicalFiles.get(relativePath) ?? null;
    const targetPath = path.join(starterDir, relativePath);
    const existingContent = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, "utf-8")
      : null;
    return {
      relativePath,
      changed: existingContent !== canonicalContent,
    };
  });
}

export function applyStarterToolchainSync(
  starterDir: string,
  canonicalFiles: Map<StarterToolchainSyncPath, string>,
): StarterToolchainSyncChange[] {
  const changes: StarterToolchainSyncChange[] = [];
  for (const relativePath of STARTER_TOOLCHAIN_SYNC_PATHS) {
    const canonicalContent = canonicalFiles.get(relativePath) ?? null;
    const targetPath = path.join(starterDir, relativePath);
    const existingContent = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, "utf-8")
      : null;
    const changed = existingContent !== canonicalContent;
    if (changed) {
      if (canonicalContent === null) {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, canonicalContent);
      }
    }
    changes.push({ relativePath, changed });
  }
  return changes;
}

export type SyncStarterManifestResult = {
  changed: boolean;
  packageChanged: boolean;
  workspaceChanged: boolean;
  packageJson: PackageJson;
  pnpmWorkspaceYaml: string | null;
  toolchainChanges: StarterToolchainSyncChange[];
  changedToolchainPaths: StarterToolchainSyncPath[];
};

export function resolveStarterPaths(options: {
  starterDir?: string;
  starterPackageJsonPath?: string;
  starterPnpmWorkspacePath?: string;
}): {
  starterDir: string;
  starterPackageJsonPath: string;
  starterPnpmWorkspacePath: string;
} {
  if (options.starterDir) {
    return {
      starterDir: path.resolve(options.starterDir),
      starterPackageJsonPath: path.join(
        path.resolve(options.starterDir),
        "package.json",
      ),
      starterPnpmWorkspacePath: path.join(
        path.resolve(options.starterDir),
        "pnpm-workspace.yaml",
      ),
    };
  }
  if (!options.starterPackageJsonPath) {
    throw new Error("Provide --starter-dir or --starter-package-json.");
  }
  const starterPackageJsonPath = path.resolve(options.starterPackageJsonPath);
  return {
    starterDir: path.dirname(starterPackageJsonPath),
    starterPackageJsonPath,
    starterPnpmWorkspacePath:
      options.starterPnpmWorkspacePath ??
      path.join(path.dirname(starterPackageJsonPath), "pnpm-workspace.yaml"),
  };
}

export function syncStarterManifestFiles(options: {
  starterDir?: string;
  starterPackageJsonPath?: string;
  starterPnpmWorkspacePath?: string;
  repoRoot?: string;
  write?: boolean;
}): SyncStarterManifestResult {
  const { starterDir, starterPackageJsonPath, starterPnpmWorkspacePath } =
    resolveStarterPaths(options);
  const snapshot = createStandaloneChatSnapshot(options.repoRoot);

  try {
    const starterPackageJson = JSON.parse(
      fs.readFileSync(starterPackageJsonPath, "utf-8"),
    ) as PackageJson;
    const mergedPackageJson = mergeStarterManifest(
      starterPackageJson,
      snapshot.packageJson,
    );

    const existingWorkspace = fs.existsSync(starterPnpmWorkspacePath)
      ? fs.readFileSync(starterPnpmWorkspacePath, "utf-8")
      : null;

    const workspaceChanged = workspaceFileSyncChanged(
      existingWorkspace,
      snapshot.pnpmWorkspaceYaml,
    );
    const packageChanged =
      stableJson(starterPackageJson) !== stableJson(mergedPackageJson);
    const toolchainChanges = diffStarterToolchainFiles(
      starterDir,
      snapshot.toolchainFiles,
    );
    const changedToolchainPaths = toolchainChanges
      .filter((change) => change.changed)
      .map((change) => change.relativePath);
    const changed =
      packageChanged || workspaceChanged || changedToolchainPaths.length > 0;

    if (options.write && changed) {
      if (packageChanged) {
        fs.writeFileSync(starterPackageJsonPath, stableJson(mergedPackageJson));
      }
      if (workspaceChanged) {
        applyWorkspaceFileSync(
          starterPnpmWorkspacePath,
          snapshot.pnpmWorkspaceYaml,
        );
      }
      if (changedToolchainPaths.length > 0) {
        applyStarterToolchainSync(starterDir, snapshot.toolchainFiles);
      }
    }

    return {
      changed,
      packageChanged,
      workspaceChanged,
      packageJson: mergedPackageJson,
      pnpmWorkspaceYaml: snapshot.pnpmWorkspaceYaml,
      toolchainChanges,
      changedToolchainPaths,
    };
  } finally {
    snapshot.cleanup();
  }
}

export function parseSyncStarterManifestArgs(argv: string[]): {
  command: "merge" | "generate" | "paths";
  starterDir?: string;
  starterPackageJsonPath?: string;
  starterPnpmWorkspacePath?: string;
  write: boolean;
  repoRoot?: string;
} {
  const [commandRaw, ...rest] = argv;
  const command =
    commandRaw === "generate"
      ? "generate"
      : commandRaw === "paths"
        ? "paths"
        : "merge";
  let starterDir: string | undefined;
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
    if (arg === "--starter-dir") {
      starterDir = rest[++i];
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

  if (command === "merge" && !starterDir && !starterPackageJsonPath) {
    throw new Error(
      "merge requires --starter-dir <path> or --starter-package-json <path> [--starter-pnpm-workspace <path>] [--write] [--repo-root <path>]",
    );
  }

  return {
    command,
    starterDir,
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

  if (args.command === "paths") {
    for (const syncPath of listStarterSyncPaths()) {
      process.stdout.write(`${syncPath}\n`);
    }
    return 0;
  }

  const result = syncStarterManifestFiles({
    starterDir: args.starterDir,
    starterPackageJsonPath: args.starterPackageJsonPath,
    starterPnpmWorkspacePath: args.starterPnpmWorkspacePath,
    repoRoot: args.repoRoot,
    write: args.write,
  });

  if (result.changed) {
    const updatedPaths = [
      ...(result.packageChanged ? ["package.json"] : []),
      ...(result.workspaceChanged ? ["pnpm-workspace.yaml"] : []),
      ...result.changedToolchainPaths,
    ];
    const summary = updatedPaths.length ? ` (${updatedPaths.join(", ")})` : "";
    console.log(
      args.write
        ? `Updated builder-agent-native-starter from templates/chat${summary}.`
        : `builder-agent-native-starter is out of date with templates/chat${summary}.`,
    );
    return args.write ? 0 : 1;
  }

  console.log("builder-agent-native-starter already matches templates/chat.");
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
