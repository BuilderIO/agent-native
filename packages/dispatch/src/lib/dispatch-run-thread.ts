import type { AgentRun } from "@agent-native/core/progress/types";

export interface DispatchRunThreadContext {
  parentThreadId: string;
  description: string;
  name: string;
}

export function getDispatchRunThreadContext(
  threadId: string,
  run: AgentRun,
): DispatchRunThreadContext | undefined {
  const metadata = run.metadata ?? {};
  const isAgentTeam =
    metadata.kind === "agent-team" || metadata.source === "agent-teams";
  const parentThreadId =
    typeof metadata.parentThreadId === "string"
      ? metadata.parentThreadId.trim()
      : "";

  if (!isAgentTeam || !parentThreadId || parentThreadId === threadId) {
    return undefined;
  }

  return {
    parentThreadId,
    description:
      typeof metadata.description === "string"
        ? metadata.description
        : run.title,
    name: typeof metadata.name === "string" ? metadata.name : "",
  };
}
