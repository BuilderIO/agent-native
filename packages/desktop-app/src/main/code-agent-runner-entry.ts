import {
  executeApproveAlwaysCodeAgentApproval,
  executeDenyCodeAgentApproval,
  executeExistingCodeAgentRun,
  executePendingCodeAgentApproval,
} from "../../../core/src/cli/code-agent-executor.js";
import { dispatchCodeAgentRunnerCommand } from "./code-agent-runner-dispatch.js";
import { runCodeAgentRunnerWithSignal } from "./code-agent-runner.js";

async function run(): Promise<void> {
  await runCodeAgentRunnerWithSignal(process, async (signal) => {
    await dispatchCodeAgentRunnerCommand(
      process.argv.slice(2),
      { stdout: process.stdout, signal },
      {
        run: executeExistingCodeAgentRun,
        approve: executePendingCodeAgentApproval,
        approveAlways: executeApproveAlwaysCodeAgentApproval,
        deny: executeDenyCodeAgentApproval,
      },
    );
  });
}

void run().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
