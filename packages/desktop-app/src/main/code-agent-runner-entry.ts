import {
  executeApproveAlwaysCodeAgentApproval,
  executeDenyCodeAgentApproval,
  executeExistingCodeAgentRun,
  executePendingCodeAgentApproval,
} from "../../../core/src/cli/code-agent-executor.js";
import { runCodeAgentRunnerWithSignal } from "./code-agent-runner.js";

type RunnerSubcommand = "run" | "approve" | "approve-always" | "deny";

function parseInvocation(argv: string[]): {
  subcommand: RunnerSubcommand;
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

async function run(): Promise<void> {
  const { subcommand, runId } = parseInvocation(process.argv.slice(2));
  await runCodeAgentRunnerWithSignal(process, async (signal) => {
    const options = { stdout: process.stdout, signal };
    if (subcommand === "run") {
      await executeExistingCodeAgentRun(runId, options);
      return;
    }
    if (subcommand === "approve") {
      await executePendingCodeAgentApproval(runId, options);
      return;
    }
    if (subcommand === "approve-always") {
      await executeApproveAlwaysCodeAgentApproval(runId, options);
      return;
    }
    await executeDenyCodeAgentApproval(runId, { stdout: process.stdout });
  });
}

void run().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
