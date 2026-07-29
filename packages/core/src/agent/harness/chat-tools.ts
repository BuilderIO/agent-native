import {
  executeAgentToolCall,
  toolCallCacheKey,
  type ActionEntry,
} from "../production-agent.js";
import type { AgentHarnessHostTool } from "./types.js";

export interface CreateAgentHarnessActionToolsOptions {
  actions: Record<string, ActionEntry>;
  ownerEmail: string;
  orgId?: string | null;
  threadId?: string;
  turnId?: string;
}

export function createAgentHarnessActionTools(
  options: CreateAgentHarnessActionToolsOptions,
): Record<string, AgentHarnessHostTool> {
  return Object.fromEntries(
    Object.entries(options.actions)
      .filter(
        ([, entry]) =>
          entry.agentTool !== false && entry.toolCallable !== false,
      )
      .map(([name, entry]) => [
        name,
        {
          description: entry.tool.description,
          inputSchema: entry.tool.parameters as unknown as Record<
            string,
            unknown
          >,
          readOnly: entry.readOnly === true,
          ...(entry.needsApproval
            ? {
                needsApproval: (input: unknown) =>
                  actionNeedsApproval(entry, input, options),
              }
            : {}),
          execute: async (
            input: unknown,
            context: {
              toolCallId: string;
              abortSignal?: AbortSignal;
              approved?: boolean;
            },
          ) => {
            const needsApproval = await actionNeedsApproval(
              entry,
              input,
              options,
            );
            if (needsApproval && context.approved !== true) {
              throw new Error(
                `Agent Native action ${name} requires human approval.`,
              );
            }
            const result = await executeAgentToolCall({
              actions: options.actions,
              name,
              input,
              callId: context.toolCallId,
              signal: context.abortSignal,
              ownerEmail: options.ownerEmail,
              orgId: options.orgId,
              caller: "tool",
              threadId: options.threadId,
              turnId: options.turnId,
              ...(needsApproval && context.approved === true
                ? { approvedToolCalls: [toolCallCacheKey(name, input)] }
                : {}),
            });
            if (result.status === "completed") return result.output;
            if (result.status === "approval_required") {
              throw new Error(
                `Harness approval did not authorize Agent Native action ${name}.`,
              );
            }
            throw new Error(result.output);
          },
        } satisfies AgentHarnessHostTool,
      ]),
  );
}

async function actionNeedsApproval(
  entry: ActionEntry,
  input: unknown,
  options: CreateAgentHarnessActionToolsOptions,
): Promise<boolean> {
  if (entry.needsApproval === true) return true;
  if (typeof entry.needsApproval !== "function") return false;
  try {
    return Boolean(
      await entry.needsApproval(input, {
        userEmail: options.ownerEmail,
        orgId: options.orgId ?? null,
        caller: "tool",
      }),
    );
  } catch {
    return true;
  }
}
