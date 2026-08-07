import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodeAgentRunnerSubcommand =
  | "run"
  | "approve"
  | "approve-always"
  | "deny";

export interface CodeAgentRunnerInvocationOptions {
  appIsPackaged: boolean;
  resourcesPath: string;
  electronPath: string;
  repoRoot: string;
  environment?: NodeJS.ProcessEnv;
}

export interface CodeAgentRunnerInvocation {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface CodeAgentRunnerSignalProcess {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export async function runCodeAgentRunnerWithSignal<T>(
  processRef: CodeAgentRunnerSignalProcess,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  processRef.once("SIGINT", abort);
  processRef.once("SIGTERM", abort);
  try {
    return await execute(controller.signal);
  } finally {
    processRef.removeListener("SIGINT", abort);
    processRef.removeListener("SIGTERM", abort);
  }
}

export function resolveCodeAgentRunnerInvocation(
  options: CodeAgentRunnerInvocationOptions,
  subcommand: CodeAgentRunnerSubcommand,
  runId: string,
): CodeAgentRunnerInvocation {
  if (options.appIsPackaged) {
    return {
      command: options.electronPath,
      args: [
        path.join(
          options.resourcesPath,
          "app.asar",
          "out",
          "main",
          "code-agent-runner-entry.js",
        ),
        subcommand,
        runId,
      ],
      cwd: options.resourcesPath,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }

  const localCli = path.join(
    options.repoRoot,
    "packages/core/dist/cli/index.js",
  );
  if (fs.existsSync(localCli)) {
    return {
      command: "node",
      args: [
        path.relative(options.repoRoot, localCli),
        "code",
        subcommand,
        runId,
      ],
      cwd: options.repoRoot,
      env: { AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT: "1" },
    };
  }

  const packageManager = resolveExecutable("pnpm", options.environment);
  if (packageManager) {
    return {
      command: packageManager,
      args: [
        "--filter",
        "@agent-native/core",
        "exec",
        "node",
        "dist/cli/index.js",
        "code",
        subcommand,
        runId,
      ],
      cwd: options.repoRoot,
      env: { AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT: "1" },
    };
  }

  const corepack = resolveExecutable("corepack", options.environment);
  if (corepack) {
    return {
      command: corepack,
      args: [
        "pnpm",
        "--filter",
        "@agent-native/core",
        "exec",
        "node",
        "dist/cli/index.js",
        "code",
        subcommand,
        runId,
      ],
      cwd: options.repoRoot,
      env: { AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT: "1" },
    };
  }

  return {
    command: "pnpm",
    args: [
      "--filter",
      "@agent-native/core",
      "exec",
      "node",
      "dist/cli/index.js",
      "code",
      subcommand,
      runId,
    ],
    cwd: options.repoRoot,
    env: { AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT: "1" },
  };
}

function resolveExecutable(
  executable: string,
  environment: NodeJS.ProcessEnv | undefined,
): string | null {
  if (!environment) return null;

  const home = environment.HOME || os.homedir();
  const pathEntries = (environment.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const searchDirectories = [
    ...pathEntries,
    environment.PNPM_HOME,
    home ? path.join(home, ".local", "share", "pnpm") : undefined,
    home ? path.join(home, "Library", "pnpm") : undefined,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter((value): value is string => Boolean(value));

  for (const directory of [...new Set(searchDirectories)]) {
    const candidate = path.join(directory, executable);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // coercion-ok: an unreadable candidate is an expected search miss.
      // Continue through the standard package-manager locations.
    }
  }
  return null;
}
