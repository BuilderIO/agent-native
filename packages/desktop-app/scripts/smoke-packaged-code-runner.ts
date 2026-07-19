import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
} from "../../core/src/cli/code-agent-runs.js";

const packagedApp = path.resolve(
  process.argv[2] ??
    path.join(process.cwd(), "dist", "mac-arm64", "Agent Native.app"),
);
if (!fs.existsSync(packagedApp)) {
  throw new Error(`Packaged app not found: ${packagedApp}`);
}

const proofRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "agent-native-packaged-runner-proof-"),
);
const isolatedApp = path.join(proofRoot, "Agent Native.app");
const storeRoot = path.join(proofRoot, "store");
const workspace = path.join(proofRoot, "workspace");
const fakeBin = path.join(proofRoot, "bin");
fs.cpSync(packagedApp, isolatedApp, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(fakeBin, { recursive: true });

process.env.AGENT_NATIVE_CODE_AGENTS_HOME = storeRoot; // guard:allow-env-mutation — standalone smoke process isolates packaged runner state
delete process.env.AGENT_NATIVE_FRAMEWORK_ROOT; // guard:allow-env-mutation — standalone smoke process isolates packaged runner state

async function main(): Promise<void> {
  const success = createRun("Packaged runner success", "fake-code-agent");
  await runPackagedRunner(success.id, {
    AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE: "PACKAGED_RUNNER_OK",
    PATH: "/usr/bin:/bin",
  });
  assertRun(success.id, "completed", "PACKAGED_RUNNER_OK");

  const startedFile = path.join(proofRoot, "codex-started");
  const stoppedFile = path.join(proofRoot, "codex-stopped");
  const fakeCodex = path.join(fakeBin, "codex");
  fs.writeFileSync(
    fakeCodex,
    `#!/bin/sh
if [ "$FAKE_CODEX_MODE" = "complete" ]; then
  previous=""
  output=""
  for argument in "$@"; do
    if [ "$previous" = "--output-last-message" ]; then output="$argument"; fi
    previous="$argument"
  done
  printf RESUMED_OK > "$output"
  exit 0
fi
printf started > "$CODEX_STARTED_FILE"
trap 'printf stopped > "$CODEX_STOPPED_FILE"; exit 143' TERM INT
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );

  const interrupted = createRun("Packaged runner cancellation", "codex-cli");
  const running = runPackagedRunner(interrupted.id, {
    PATH: `${fakeBin}:/usr/bin:/bin`,
    CODEX_STARTED_FILE: startedFile,
    CODEX_STOPPED_FILE: stoppedFile,
  });
  await waitForFile(startedFile);
  running.kill("SIGTERM");
  await running.result;
  assertRun(interrupted.id, "paused", "Codex CLI run paused.");
  if (!fs.existsSync(stoppedFile)) {
    throw new Error("Packaged runner did not stop its Codex child process.");
  }

  await runPackagedRunner(interrupted.id, {
    PATH: `${fakeBin}:/usr/bin:/bin`,
    FAKE_CODEX_MODE: "complete",
  });
  assertRun(interrupted.id, "completed", "RESUMED_OK");

  process.stdout.write(
    `${JSON.stringify(
      {
        proofRoot,
        app: isolatedApp,
        successRunId: success.id,
        resumedRunId: interrupted.id,
        result: "start-cancel-resume-ok",
      },
      null,
      2,
    )}\n`,
  );
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

function createRun(title: string, engine: string) {
  const run = createCodeAgentRunRecord({
    goalId: "task",
    title,
    status: "queued",
    cwd: workspace,
    permissionMode: "full-auto",
    metadata: { engine },
  });
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "user",
    message: title,
  });
  return run;
}

function runPackagedRunner(
  runId: string,
  environment: NodeJS.ProcessEnv,
): {
  kill(signal: NodeJS.Signals): void;
  result: Promise<void>;
} & PromiseLike<void> {
  const executable = path.join(
    isolatedApp,
    "Contents",
    "MacOS",
    "Agent Native",
  );
  const resources = path.join(isolatedApp, "Contents", "Resources");
  const entry = path.join(
    resources,
    "app.asar",
    "out",
    "main",
    "code-agent-runner-entry.js",
  );
  const child = spawn(executable, [entry, "run", runId], {
    cwd: resources,
    env: {
      ...environment,
      AGENT_NATIVE_CODE_AGENTS_HOME: storeRoot,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const result = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM" || code === 143) resolve();
      else
        reject(
          new Error(`Packaged runner exited ${signal ?? code}: ${output}`),
        );
    });
  });
  const execution = Object.assign(result, {
    kill: (signal: NodeJS.Signals) => child.kill(signal),
    result,
  });
  return execution;
}

function assertRun(runId: string, status: string, expectedMessage: string) {
  const run = getCodeAgentRunRecord(runId);
  if (run?.status !== status) {
    throw new Error(
      `Expected ${runId} to be ${status}, received ${run?.status}.`,
    );
  }
  if (
    !listCodeAgentTranscriptEvents(runId).some((event) =>
      event.message.includes(expectedMessage),
    )
  ) {
    throw new Error(
      `Expected ${runId} transcript to include ${expectedMessage}.`,
    );
  }
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${filePath}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
