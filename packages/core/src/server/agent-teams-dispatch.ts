import {
  AGENT_BACKGROUND_PROCESSOR_AGENT_TEAM,
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_TEAM_PROCESS_RUN_PATH,
  dispatchPathTargetsNetlifyBackgroundFunction,
  isAgentChatDurableBackgroundEnabled,
  resolveDurableBackgroundDispatchPath,
} from "../agent/durable-background.js";
import { fireInternalDispatch } from "./self-dispatch.js";

export async function dispatchAgentTeamRun(options: {
  event?: any;
  taskId: string;
  body?: Record<string, unknown>;
}): Promise<void> {
  const backgroundPath = resolveDurableBackgroundDispatchPath(
    AGENT_TEAM_PROCESS_RUN_PATH,
  );
  const useBackgroundWorker =
    isAgentChatDurableBackgroundEnabled() &&
    dispatchPathTargetsNetlifyBackgroundFunction(backgroundPath);

  if (!useBackgroundWorker) {
    await fireInternalDispatch({
      ...options,
      path: AGENT_TEAM_PROCESS_RUN_PATH,
    });
    return;
  }

  try {
    await fireInternalDispatch({
      ...options,
      path: backgroundPath,
      body: {
        ...(options.body ?? {}),
        [AGENT_BACKGROUND_PROCESSOR_FIELD]:
          AGENT_BACKGROUND_PROCESSOR_AGENT_TEAM,
      },
      awaitResponse: true,
    });
  } catch (backgroundError) {
    console.error(
      "[agent-teams] Durable background dispatch failed; falling back to portable processor:",
      backgroundError,
    );
    await fireInternalDispatch({
      ...options,
      path: AGENT_TEAM_PROCESS_RUN_PATH,
    });
  }
}
