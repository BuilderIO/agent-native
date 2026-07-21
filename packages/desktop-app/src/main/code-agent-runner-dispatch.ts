export type CodeAgentRunnerSubcommand =
  | "run"
  | "approve"
  | "approve-always"
  | "deny";

export interface CodeAgentRunnerExecutionOptions {
  stdout: NodeJS.WritableStream;
  signal: AbortSignal;
}

export interface CodeAgentRunnerExecutors {
  run(
    runId: string,
    options: CodeAgentRunnerExecutionOptions,
  ): Promise<unknown>;
  approve(
    runId: string,
    options: CodeAgentRunnerExecutionOptions,
  ): Promise<unknown>;
  approveAlways(
    runId: string,
    options: CodeAgentRunnerExecutionOptions,
  ): Promise<unknown>;
  deny(
    runId: string,
    options: CodeAgentRunnerExecutionOptions,
  ): Promise<unknown>;
}

export function parseCodeAgentRunnerInvocation(argv: string[]): {
  subcommand: CodeAgentRunnerSubcommand;
  runId: string;
} {
  const [subcommand, runId] = argv;
  if (
    (subcommand !== "run" &&
      subcommand !== "approve" &&
      subcommand !== "approve-always" &&
      subcommand !== "deny") ||
    !runId
  ) {
    throw new Error("Usage: code-agent-runner-entry <command> <run-id>");
  }
  return { subcommand, runId };
}

export async function dispatchCodeAgentRunnerCommand(
  argv: string[],
  options: CodeAgentRunnerExecutionOptions,
  executors: CodeAgentRunnerExecutors,
): Promise<void> {
  const { subcommand, runId } = parseCodeAgentRunnerInvocation(argv);
  if (subcommand === "run") {
    await executors.run(runId, options);
    return;
  }
  if (subcommand === "approve") {
    await executors.approve(runId, options);
    return;
  }
  if (subcommand === "approve-always") {
    await executors.approveAlways(runId, options);
    return;
  }
  await executors.deny(runId, options);
}
