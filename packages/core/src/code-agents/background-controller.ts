import {
  executeExistingCodeAgentRun,
  executePendingCodeAgentApproval,
} from "../cli/code-agent-executor.js";
import {
  appendCodeAgentTranscriptEvent,
  getCodeAgentRunRecord,
  isActiveCodeAgentRun,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
  type CodeAgentFollowUpMode,
  type CodeAgentPermissionMode,
} from "../cli/code-agent-runs.js";
import {
  getBackgroundAgentRun,
  listBackgroundAgentRuns,
  listBackgroundAgentTranscriptEvents,
  toBackgroundAgentRun,
  type BackgroundAgentRun,
  type BackgroundAgentTranscriptEvent,
  type ListBackgroundAgentRunsOptions,
} from "./background-run.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";

export type BackgroundAgentControlCommand =
  | "approve"
  | "resume"
  | "retry"
  | "stop";

export interface BackgroundAgentControlInput {
  runId: string;
  command: BackgroundAgentControlCommand;
  stdout?: NodeJS.WritableStream;
}

export interface BackgroundAgentFollowUpInput {
  runId: string;
  prompt: string;
  mode?: CodeAgentFollowUpMode;
  permissionMode?: CodeAgentPermissionMode;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  source?: string;
  metadata?: Record<string, unknown>;
  stdout?: NodeJS.WritableStream;
}

export interface BackgroundAgentControlResult {
  ok: boolean;
  runId: string;
  run: BackgroundAgentRun | null;
  queued?: boolean;
  message?: string;
  error?: string;
}

export interface BackgroundAgentController {
  list(
    options?: ListBackgroundAgentRunsOptions,
  ): Promise<BackgroundAgentRun[]> | BackgroundAgentRun[];
  get(
    runId: string,
  ): Promise<BackgroundAgentRun | null> | BackgroundAgentRun | null;
  transcript(
    runId: string,
  ):
    | Promise<BackgroundAgentTranscriptEvent[]>
    | BackgroundAgentTranscriptEvent[];
  sendFollowUp(
    input: BackgroundAgentFollowUpInput,
  ): Promise<BackgroundAgentControlResult>;
  control(
    input: BackgroundAgentControlInput,
  ): Promise<BackgroundAgentControlResult>;
}

export function createCompositeBackgroundAgentController(
  controllers: BackgroundAgentController[],
): BackgroundAgentController {
  const resolveControllerForRun = async (
    runId: string,
  ): Promise<{
    controller: BackgroundAgentController;
    run: BackgroundAgentRun;
  } | null> => {
    for (const controller of controllers) {
      const run = await Promise.resolve(controller.get(runId));
      if (run) return { controller, run };
    }
    return null;
  };

  return {
    async list(options?: ListBackgroundAgentRunsOptions) {
      const groups = await Promise.all(
        controllers.map((controller) =>
          Promise.resolve(controller.list(options)).catch(() => []),
        ),
      );
      return groups
        .flat()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(runId: string) {
      return (await resolveControllerForRun(runId))?.run ?? null;
    },
    async transcript(runId: string) {
      const match = await resolveControllerForRun(runId);
      if (!match) return [];
      return Promise.resolve(match.controller.transcript(runId));
    },
    async sendFollowUp(input: BackgroundAgentFollowUpInput) {
      const match = await resolveControllerForRun(input.runId);
      if (!match) return missingRunResult(input.runId);
      return match.controller.sendFollowUp(input);
    },
    async control(input: BackgroundAgentControlInput) {
      const match = await resolveControllerForRun(input.runId);
      if (!match) return missingRunResult(input.runId);
      return match.controller.control(input);
    },
  };
}

export function createLocalCodeBackgroundAgentController(): BackgroundAgentController {
  return {
    list: listBackgroundAgentRuns,
    get: getBackgroundAgentRun,
    transcript: listBackgroundAgentTranscriptEvents,
    sendFollowUp: sendLocalCodeBackgroundAgentFollowUp,
    control: controlLocalCodeBackgroundAgentRun,
  };
}

export const localCodeBackgroundAgentController =
  createLocalCodeBackgroundAgentController();

async function sendLocalCodeBackgroundAgentFollowUp(
  input: BackgroundAgentFollowUpInput,
): Promise<BackgroundAgentControlResult> {
  const run = getCodeAgentRunRecord(input.runId);
  if (!run) {
    return missingRunResult(input.runId);
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return {
      ok: false,
      runId: input.runId,
      run: toBackgroundAgentRun(run),
      error: "Follow-up prompt is required.",
    };
  }

  const activeRun = input.permissionMode
    ? (updateCodeAgentRunRecord(run.id, {
        permissionMode: input.permissionMode,
      }) ?? run)
    : run;
  const mode = input.mode ?? "immediate";
  const shouldQueue =
    activeRun.status === "queued" || isActiveCodeAgentRun(activeRun);
  const event = appendCodeAgentTranscriptEvent({
    runId: activeRun.id,
    kind: "user",
    message: prompt,
    metadata: {
      ...(input.metadata ?? {}),
      source: input.source ?? "background-agent-controller",
      permissionMode: input.permissionMode,
      followUpMode: mode,
      delivery: shouldQueue ? mode : "run-now",
    },
  });

  if (shouldQueue) {
    queueCodeAgentFollowUp({
      runId: activeRun.id,
      prompt,
      mode,
      eventId: event.id,
      permissionMode: input.permissionMode,
      source: input.source ?? "background-agent-controller",
      createdAt: event.createdAt,
    });
    return {
      ok: true,
      runId: activeRun.id,
      run: currentBackgroundRun(activeRun.id),
      queued: true,
      message: "Follow-up queued for the active Agent-Native Code run.",
    };
  }

  const updated = await executeExistingCodeAgentRun(activeRun.id, {
    prompt,
    appendUserEvent: false,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    stdout: input.stdout,
  });
  return {
    ok: Boolean(updated),
    runId: activeRun.id,
    run: updated
      ? toBackgroundAgentRun(updated)
      : currentBackgroundRun(activeRun.id),
    queued: false,
    message: updated
      ? "Follow-up executed for the Agent-Native Code run."
      : undefined,
    error: updated ? undefined : `Run not found: ${activeRun.id}`,
  };
}

async function controlLocalCodeBackgroundAgentRun(
  input: BackgroundAgentControlInput,
): Promise<BackgroundAgentControlResult> {
  const run = getCodeAgentRunRecord(input.runId);
  if (!run) {
    return missingRunResult(input.runId);
  }

  switch (input.command) {
    case "approve": {
      const approved = await executePendingCodeAgentApproval(run.id, {
        stdout: input.stdout,
      });
      return {
        ok: Boolean(approved),
        runId: run.id,
        run: approved
          ? toBackgroundAgentRun(approved)
          : currentBackgroundRun(run.id),
        message: approved
          ? "Pending approval executed for the Agent-Native Code run."
          : undefined,
        error: approved ? undefined : `Run not found: ${run.id}`,
      };
    }
    case "resume": {
      const resumed = await executeExistingCodeAgentRun(run.id, {
        stdout: input.stdout,
      });
      return {
        ok: Boolean(resumed),
        runId: run.id,
        run: resumed
          ? toBackgroundAgentRun(resumed)
          : currentBackgroundRun(run.id),
        message: resumed ? "Agent-Native Code run resumed." : undefined,
        error: resumed ? undefined : `Run not found: ${run.id}`,
      };
    }
    case "retry": {
      const retried = await executeExistingCodeAgentRun(run.id, {
        stdout: input.stdout,
      });
      return {
        ok: Boolean(retried),
        runId: run.id,
        run: retried
          ? toBackgroundAgentRun(retried)
          : currentBackgroundRun(run.id),
        message: retried ? "Agent-Native Code run retried." : undefined,
        error: retried ? undefined : `Run not found: ${run.id}`,
      };
    }
    case "stop":
      return stopLocalCodeBackgroundAgentRun(run.id);
  }
}

function stopLocalCodeBackgroundAgentRun(
  runId: string,
): BackgroundAgentControlResult {
  const run = getCodeAgentRunRecord(runId);
  if (!run) {
    return missingRunResult(runId);
  }

  if (run.status === "completed" || run.status === "errored") {
    return {
      ok: true,
      runId,
      run: toBackgroundAgentRun(run),
      message: "Agent-Native Code run is already finished.",
    };
  }

  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message:
      "Stop requested for Agent-Native Code run. No process signal was sent.",
    metadata: {
      source: "background-agent-controller",
      stoppedWithoutSignal: true,
    },
  });
  const updated = updateCodeAgentRunRecord(runId, {
    status: "paused",
    phase: "stopped",
    progress: {
      label: "Stopped",
      completed: 0,
      total: 1,
      percent: 0,
    },
    metadata: {
      runnerState: "stopped",
      stoppedAt: new Date().toISOString(),
      stoppedBy: "background-agent-controller",
      stopSignalSent: false,
    },
  });

  return {
    ok: Boolean(updated),
    runId,
    run: updated ? toBackgroundAgentRun(updated) : null,
    message: updated
      ? "Agent-Native Code run marked stopped without signaling a process."
      : undefined,
    error: updated ? undefined : `Run not found: ${runId}`,
  };
}

function currentBackgroundRun(runId: string): BackgroundAgentRun | null {
  const run = getCodeAgentRunRecord(runId);
  return run ? toBackgroundAgentRun(run) : null;
}

function missingRunResult(runId: string): BackgroundAgentControlResult {
  return {
    ok: false,
    runId,
    run: null,
    error: `Run not found: ${runId}`,
  };
}
