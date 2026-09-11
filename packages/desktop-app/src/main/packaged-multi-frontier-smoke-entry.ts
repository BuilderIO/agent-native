import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { readClaudeCodeSubscriptionStatus } from "../../../core/src/cli/claude-code-participant.js";
import { readCodexCliSubscriptionStatus } from "../../../core/src/cli/codex-cli-participant.js";
import {
  getMultiFrontierRun,
  listMultiFrontierArtifacts,
} from "../../../core/src/cli/multi-frontier-runs.js";
import type {
  MultiFrontierCollaborationIdRequest,
  MultiFrontierCreateCollaborationRequest,
} from "../../shared/multi-frontier-ipc.js";
import { captureImmutableWorkspaceSnapshot } from "./multi-frontier-app-integration.js";
import { MultiFrontierManager } from "./multi-frontier-manager.js";

const configuredStoreRoot = process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
if (!configuredStoreRoot) {
  throw new Error(
    "The packaged multi-frontier smoke requires its isolated store.",
  );
}
const storeRoot: string = configuredStoreRoot;

const proofRoot = path.dirname(storeRoot);
const workspace = path.join(proofRoot, "workspace");
const invocationLog = path.join(process.env.HOME ?? proofRoot, "fake-cli.log");

async function main(): Promise<void> {
  prepareWorkspace();
  await assertSubscriptionNativeCliStatus();

  const happy = createManager();
  const happyId = await createAndPlan(happy, "happy");
  await happy.go(action("go-happy", "go", happyId));
  await waitFor(
    () => getMultiFrontierRun(happyId)?.phase === "completed",
    "the packaged collaboration to complete",
  );
  const checkpointRef = assertPrivateCheckpoint(happyId);
  await happy.dispose();

  const canceled = createManager();
  const canceledCreated = await canceled.create(
    request("cancel-create", "Cancellation smoke waits for a live provider."),
  );
  const canceledId = requiredId(canceledCreated.snapshot?.collaborationId);
  const turnsBeforeCancellation = turnCount();
  const planning = canceled.start(action("cancel-start", "start", canceledId));
  await waitFor(
    () => turnCount() > turnsBeforeCancellation,
    "a fake subscription-native provider turn before cancellation",
  );
  await canceled.cancel(action("cancel", "cancel", canceledId));
  await planning.catch(() => undefined);
  if (getMultiFrontierRun(canceledId)?.phase !== "canceled") {
    throw new Error("Cancellation did not settle the packaged collaboration.");
  }

  const beforeRecovery = createManager();
  const recoveryId = await createAndPlan(beforeRecovery, "recovery");
  await beforeRecovery.dispose();
  const pausedRun = getMultiFrontierRun(recoveryId);
  if (
    pausedRun?.phase !== "paused" ||
    pausedRun.recovery?.reason !== "app_quit"
  ) {
    throw new Error(
      "Restart recovery did not durably pause the collaboration.",
    );
  }
  const turnsBeforeResume = turnCount();
  const afterRecovery = createManager();
  await afterRecovery.list();
  await afterRecovery.resume(action("recovery-resume", "resume", recoveryId));
  if (turnCount() !== turnsBeforeResume) {
    throw new Error(
      "Restart recovery replayed a provider turn before explicit GO.",
    );
  }
  await afterRecovery.go(action("recovery-go", "go", recoveryId));
  await waitFor(
    () => getMultiFrontierRun(recoveryId)?.phase === "completed",
    "the recovered packaged collaboration to complete after GO",
  );
  await afterRecovery.dispose();

  process.stdout.write(
    `${JSON.stringify(
      {
        proofRoot,
        workspace,
        happyCollaborationId: happyId,
        canceledCollaborationId: canceledId,
        recoveredCollaborationId: recoveryId,
        checkpointRef,
        providerTurns: turnCount(),
        result:
          "packaged-multi-frontier-start-go-checkpoint-cancel-recovery-ok",
      },
      null,
      2,
    )}\n`,
  );
}

function createManager(): MultiFrontierManager {
  return new MultiFrontierManager({
    resolveWorkspaceCwd: async (workspaceId) =>
      workspaceId === "packaged-workspace" ? workspace : null,
    isSubscriptionConnected: async (providerId) => {
      if (providerId === "codex") {
        const status = await readCodexCliSubscriptionStatus();
        return status.loggedIn && status.authMode === "ChatGPT";
      }
      return (await readClaudeCodeSubscriptionStatus()).loggedIn;
    },
    readRepositoryEvidence: async () => "Hermetic packaged smoke workspace.",
    snapshotWorkspace: (input) =>
      captureImmutableWorkspaceSnapshot({ ...input, storeRoot }),
  });
}

async function createAndPlan(
  manager: MultiFrontierManager,
  suffix: string,
): Promise<string> {
  const created = await manager.create(
    request(`${suffix}-create`, "Complete the hermetic packaged smoke task."),
  );
  const collaborationId = requiredId(created.snapshot?.collaborationId);
  const started = await manager.start(
    action(`${suffix}-start`, "start", collaborationId),
  );
  if (
    started.error ||
    getMultiFrontierRun(collaborationId)?.phase !== "awaiting_go"
  ) {
    throw new Error("Planning did not converge to the explicit GO gate.");
  }
  return collaborationId;
}

function request(
  requestId: string,
  prompt: string,
): MultiFrontierCreateCollaborationRequest {
  return {
    schemaVersion: 1 as const,
    action: "create" as const,
    requestId,
    workspaceId: "packaged-workspace",
    prompt,
    participants: [
      { participantId: "codex-driver", providerId: "codex" as const },
      { participantId: "claude-watchdog", providerId: "claude" as const },
    ],
    autoContinueAfterAgreement: false,
  };
}

function action(
  requestId: string,
  action: "start" | "go" | "cancel" | "resume",
  collaborationId: string,
): MultiFrontierCollaborationIdRequest {
  return { schemaVersion: 1 as const, requestId, action, collaborationId };
}

function prepareWorkspace(): void {
  fs.mkdirSync(workspace, { recursive: true });
  exec("git", ["init"]);
  exec("git", ["config", "user.email", "smoke@example.invalid"]);
  exec("git", ["config", "user.name", "Packaged Smoke"]);
  fs.writeFileSync(
    path.join(workspace, "tracked.ts"),
    "export const tracked = true;\n",
  );
  exec("git", ["add", "tracked.ts"]);
  exec("git", ["commit", "-m", "initial smoke workspace"]);
  fs.writeFileSync(
    path.join(workspace, "multi-frontier-smoke.ts"),
    "export const checkpointed = true;\n",
  );
}

function exec(command: string, args: string[]): void {
  execFileSync(command, args, {
    cwd: workspace,
    env: process.env,
    stdio: "ignore",
  });
}

async function assertSubscriptionNativeCliStatus(): Promise<void> {
  const [codex, claude] = await Promise.all([
    readCodexCliSubscriptionStatus(),
    readClaudeCodeSubscriptionStatus(),
  ]);
  if (!codex.loggedIn || codex.authMode !== "ChatGPT" || !claude.loggedIn) {
    throw new Error("Fake subscription-native CLI status did not validate.");
  }
}

function assertPrivateCheckpoint(collaborationId: string): string {
  const checkpoint = listMultiFrontierArtifacts(collaborationId).find(
    (artifact) => artifact.orchestration?.kind === "checkpoint",
  );
  const bundle = checkpoint?.orchestration?.metadata?.bundle;
  const contentRef =
    bundle && typeof bundle === "object" && !Array.isArray(bundle)
      ? (bundle as Record<string, unknown>).contentRef
      : undefined;
  if (typeof contentRef !== "string" || !contentRef.startsWith("file:")) {
    throw new Error(
      "The packaged checkpoint did not persist a private file ref.",
    );
  }
  const snapshotPath = contentRef.slice("file:".length);
  if (
    !snapshotPath.startsWith(path.join(storeRoot, "multi-frontier-checkpoints"))
  ) {
    throw new Error(
      "The packaged checkpoint escaped the isolated private store.",
    );
  }
  if (
    !fs.existsSync(snapshotPath) ||
    (fs.statSync(snapshotPath).mode & 0o777) !== 0o600
  ) {
    throw new Error("The packaged checkpoint blob is not a private 0600 file.");
  }
  return contentRef;
}

function turnCount(): number {
  try {
    return fs
      .readFileSync(invocationLog, "utf8")
      .split("\n")
      .filter((line) => /-(?:turn)$/.test(line)).length;
  } catch {
    return 0;
  }
}

function requiredId(value: string | undefined): string {
  if (!value)
    throw new Error("The packaged collaboration did not return an id.");
  return value;
}

async function waitFor(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${description}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
