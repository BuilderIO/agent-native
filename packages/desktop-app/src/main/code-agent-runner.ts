import fs from "node:fs";
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
  };
}
