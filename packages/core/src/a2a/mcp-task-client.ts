import type { H3Event } from "h3";

import { assertServicePrincipalMayRun } from "../org/service-principal-guard.js";
import { getRequestContext } from "../server/request-context.js";
import type { A2AClient } from "./client.js";
import { handleJsonRpcH3 } from "./handlers.js";
import type { A2AConfig, Task } from "./types.js";

export type McpAgentTaskClient = Pick<A2AClient, "send" | "getTask">;

export function createMcpAgentTaskClient(
  config: A2AConfig,
  event: H3Event,
): McpAgentTaskClient {
  async function invokeUnbounded(
    method: "message/send" | "tasks/get",
    params: Record<string, unknown>,
  ): Promise<Task> {
    const caller = getRequestContext();
    const userEmail = caller?.userEmail?.trim();
    if (!userEmail) {
      throw new Error("Local agent tasks require an authenticated MCP user.");
    }
    const admission = await assertServicePrincipalMayRun(
      userEmail,
      caller?.orgId,
    );
    // This is an in-process handoff from admitted MCP context, never an
    // identity assertion accepted from HTTP headers or message metadata.
    const localEvent = Object.create(event);
    Object.defineProperty(localEvent, "context", {
      value: {
        __a2aVerifiedEmail: userEmail,
        __a2aIdentityAssurance: "user",
        ...(caller?.orgId ? { __a2aVerifiedOrgId: caller.orgId } : {}),
        __a2aServicePrincipalAllowedActions: admission.allowedActions,
      },
    });
    const response = await handleJsonRpcH3(
      { jsonrpc: "2.0", id: 1, method, params },
      localEvent,
      config,
    );
    if (response.error) {
      throw new Error(
        `A2A error (${response.error.code}): ${response.error.message}`,
      );
    }
    if (!response.result)
      throw new Error("Local agent task returned no result.");
    return response.result as Task;
  }

  async function invoke(
    method: "message/send" | "tasks/get",
    params: Record<string, unknown>,
    options?: { requestTimeoutMs?: number; deadlineMs?: number },
  ): Promise<Task> {
    const timeoutMs = Math.min(
      options?.requestTimeoutMs ?? 10_000,
      options?.deadlineMs == null ? Infinity : options.deadlineMs - Date.now(),
    );
    if (timeoutMs <= 0) throw new Error("A2A request timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        invokeUnbounded(method, params),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("A2A request timeout")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    send: (message, options) =>
      invoke(
        "message/send",
        {
          message,
          contextId: options?.contextId,
          metadata: options?.metadata,
          idempotencyKey: options?.idempotencyKey,
          async: true,
        },
        options,
      ),
    getTask: (taskId, options) => invoke("tasks/get", { id: taskId }, options),
  };
}
