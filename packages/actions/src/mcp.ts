import {
  Server,
  createMcpHandler,
  type Tool,
} from "@modelcontextprotocol/server";

import { isActionReadOnly } from "./action.js";
import { isActionError, serializeActionErrorBody } from "./errors.js";
import type { ActionsRegistry, McpHandlerOptions } from "./registry.js";
import { schemaToJsonSchema } from "./schema.js";
import type { ActionMap, ActionMapEntry, JsonSchemaObject } from "./types.js";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMcpErrorText(error: unknown): string {
  const { body } = serializeActionErrorBody(error);
  const parts = [body.error];
  if (body.errorCode && body.errorCode !== "action_failed") {
    parts.push(`(errorCode: ${body.errorCode})`);
  }
  if (body.committed) {
    parts.push("[committed: true — do not blindly retry]");
  }
  if (body.details) {
    const serialized = JSON.stringify(body.details);
    parts.push(
      `Error details: ${serialized.length > 2000 ? `${serialized.slice(0, 1997)}...` : serialized}`,
    );
  }
  return parts.join("\n");
}

function isExposedToMcp(
  name: string,
  action: Pick<ActionMapEntry<never>, "agentTool" | "mcpTool">,
  options: McpHandlerOptions,
): boolean {
  if (action.agentTool === false || action.mcpTool === false) return false;
  if (options.include && !options.include.includes(name)) return false;
  if (options.exclude && options.exclude.includes(name)) return false;
  return true;
}

function buildMcpServerForRequest<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: McpHandlerOptions,
  invocation: {
    request?: Request;
    platform?: unknown;
  },
): Server {
  const server = new Server(
    {
      name: options.name ?? "agent-native-actions",
      version: options.version ?? "0.1.0",
    },
    {
      capabilities: { tools: {} },
      ...(options.instructions ? { instructions: options.instructions } : {}),
    },
  );

  server.setRequestHandler("tools/list", async () => {
    const tools: Tool[] = [];
    for (const [name, action] of Object.entries(registry.actions)) {
      if (!isExposedToMcp(name, action, options)) continue;

      const inputSchema: JsonSchemaObject = schemaToJsonSchema(
        action.schema,
        "input",
        action.toolSchema,
      ) ?? {
        type: "object",
        properties: {},
      };

      const outputSchema: JsonSchemaObject | null =
        action.mcpOutputSchema !== false && action.outputSchema
          ? schemaToJsonSchema(action.outputSchema, "output")
          : null;

      const tool: Tool = {
        name,
        ...(action.title ? { title: action.title } : {}),
        description: action.description,
        inputSchema: inputSchema as Tool["inputSchema"],
        ...(outputSchema && outputSchema["type"] === "object"
          ? { outputSchema: outputSchema as NonNullable<Tool["outputSchema"]> }
          : {}),
        annotations: {
          readOnlyHint: isActionReadOnly(action),
          destructiveHint: Boolean(action.destructive),
          idempotentHint: Boolean(action.retrySafe),
          openWorldHint: false,
        },
      };
      tools.push(tool);
    }
    return { tools };
  });

  server.setRequestHandler("tools/call", async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};
    const action = registry.actions[toolName];

    if (!action || !isExposedToMcp(toolName, action, options)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Action "${toolName}" is not exposed over MCP.\n(errorCode: not_found)`,
          },
        ],
      };
    }

    try {
      const result = invocation.request
        ? await registry.invokeFromRequest(toolName, args, {
            caller: "mcp",
            request: invocation.request,
            ...(invocation.platform !== undefined
              ? { platform: invocation.platform }
              : {}),
          })
        : await registry.invokeFromCliOrStdio(toolName, args, {
            caller: "mcp",
          });

      const structuredContent = isPlainRecord(result)
        ? result
        : Array.isArray(result)
          ? { items: result }
          : undefined;

      const text =
        typeof result === "string"
          ? result
          : JSON.stringify(result ?? null, null, 2);

      return {
        content: [{ type: "text" as const, text }],
        ...(structuredContent ? { structuredContent } : {}),
      };
    } catch (error) {
      const { body } = serializeActionErrorBody(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: formatMcpErrorText(error) }],
        structuredContent: {
          error: {
            message: body.error,
            errorCode: body.errorCode,
            ...(body.committed ? { committed: true } : {}),
            ...(body.details ? { details: body.details } : {}),
          },
        },
      };
    }
  });

  return server;
}

export function createMcpFetchHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: McpHandlerOptions = {},
): (request: Request, override?: { platform?: unknown }) => Promise<Response> {
  return async (request, override) => {
    if (options.authenticate) {
      const allowed = await options.authenticate(request);
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: "Unauthorized MCP request.",
            errorCode: "unauthorized",
          }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        );
      }
    }

    const handler = createMcpHandler(
      () =>
        buildMcpServerForRequest(registry, options, {
          request,
          ...(override?.platform !== undefined
            ? { platform: override.platform }
            : {}),
        }),
      {
        legacy: "stateless",
        responseMode: "auto",
      },
    );

    try {
      return await handler.fetch(request);
    } catch (error) {
      if (isActionError(error)) {
        const { statusCode, body } = serializeActionErrorBody(error);
        return new Response(JSON.stringify(body), {
          status: statusCode,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      throw error;
    }
  };
}

export async function runStdioMcpServer<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: McpHandlerOptions = {},
): Promise<void> {
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
  const stdio = serveStdio(
    () => buildMcpServerForRequest(registry, options, {}),
    { legacy: "serve" },
  );
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await stdio.close();
}
