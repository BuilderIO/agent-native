import type { StandardSchemaV1 } from "@standard-schema/spec";

import { serializeActionErrorBody } from "./errors.js";
import type { ActionsRegistry } from "./registry.js";
import { schemaToJsonSchema } from "./schema.js";
import type { ActionMap, JsonSchemaObject } from "./types.js";

export interface ToolExportOptions<TCtx, TNames extends string = string> {
  /** Pre-resolved context for tool execution (e.g. `{ user: currentUser }`). */
  context: TCtx;
  /** Restrict exported tools to an explicit allowlist of action names. */
  only?: readonly TNames[];
  /** Exclude specific action names from exported tools. */
  exclude?: readonly TNames[];
  /** Optional approval token or verifier override when running inside an agent loop. */
  approvalToken?: string;
}

function selectAgentActions<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: ToolExportOptions<TCtx, Extract<keyof TActions, string>>,
) {
  return Object.entries(registry.actions).filter(([name, action]) => {
    if (action.agentTool === false) return false;
    if (
      options.only &&
      !options.only.includes(name as Extract<keyof TActions, string>)
    ) {
      return false;
    }
    if (
      options.exclude &&
      options.exclude.includes(name as Extract<keyof TActions, string>)
    ) {
      return false;
    }
    return true;
  });
}

function requireToolJsonSchema(
  name: string,
  schema: StandardSchemaV1 | undefined,
  explicitOverride?: JsonSchemaObject,
): JsonSchemaObject {
  const converted = schemaToJsonSchema(schema, "input", explicitOverride);
  if (!converted) {
    throw new Error(
      `Action "${name}" uses a schema without Standard JSON Schema support. Provide a Zod v4 / Standard JSON Schema validator or set \`toolSchema\` on the action.`,
    );
  }
  return converted;
}

export interface AiSdkToolDefinition {
  description: string;
  inputSchema: StandardSchemaV1 | JsonSchemaObject;
  parameters: StandardSchemaV1 | JsonSchemaObject;
  execute: (args: unknown) => Promise<unknown>;
}

/**
 * Export registered actions as tools compatible with Vercel AI SDK (`ai`).
 */
export function toAiSdkTools<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: ToolExportOptions<TCtx, Extract<keyof TActions, string>>,
): Record<string, AiSdkToolDefinition> {
  const tools: Record<string, AiSdkToolDefinition> = {};
  for (const [name, action] of selectAgentActions(registry, options)) {
    const schemaOrJson =
      action.schema ??
      requireToolJsonSchema(name, undefined, action.toolSchema);
    tools[name] = {
      description: action.description,
      inputSchema: schemaOrJson,
      parameters: schemaOrJson,
      execute: async (args: unknown) =>
        registry.invokeWithContext(name, args ?? {}, options.context, {
          caller: "agent",
          ...(options.approvalToken !== undefined
            ? { approvalToken: options.approvalToken }
            : {}),
        }),
    };
  }
  return tools;
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

/**
 * Export registered actions as Anthropic SDK tool definitions + executor.
 */
export function toAnthropicTools<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: ToolExportOptions<TCtx, Extract<keyof TActions, string>>,
): {
  tools: AnthropicToolDefinition[];
  executeToolUse: (toolUse: {
    id: string;
    name: string;
    input: unknown;
  }) => Promise<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: true;
  }>;
} {
  const selected = selectAgentActions(registry, options);
  const allowed = new Set(selected.map(([name]) => name));
  const tools: AnthropicToolDefinition[] = selected.map(([name, action]) => ({
    name,
    description: action.description,
    input_schema: requireToolJsonSchema(name, action.schema, action.toolSchema),
  }));

  return {
    tools,
    executeToolUse: async (toolUse) => {
      if (!allowed.has(toolUse.name)) {
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: JSON.stringify({
            error: `Tool "${toolUse.name}" is not enabled.`,
            errorCode: "not_found",
          }),
        };
      }
      try {
        const result = await registry.invokeWithContext(
          toolUse.name,
          toolUse.input ?? {},
          options.context,
          {
            caller: "agent",
            ...(options.approvalToken !== undefined
              ? { approvalToken: options.approvalToken }
              : {}),
          },
        );
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result ?? null),
        };
      } catch (error) {
        const { body } = serializeActionErrorBody(error);
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: JSON.stringify(body),
        };
      }
    },
  };
}

export interface OpenAiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

/**
 * Export registered actions as OpenAI SDK tool definitions + executor.
 */
export function toOpenAiTools<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: ToolExportOptions<TCtx, Extract<keyof TActions, string>>,
): {
  tools: OpenAiToolDefinition[];
  executeToolCall: (toolCall: {
    id: string;
    function: { name: string; arguments: string };
  }) => Promise<{
    role: "tool";
    tool_call_id: string;
    content: string;
  }>;
} {
  const selected = selectAgentActions(registry, options);
  const allowed = new Set(selected.map(([name]) => name));
  const tools: OpenAiToolDefinition[] = selected.map(([name, action]) => ({
    type: "function",
    function: {
      name,
      description: action.description,
      parameters: requireToolJsonSchema(name, action.schema, action.toolSchema),
    },
  }));

  return {
    tools,
    executeToolCall: async (toolCall) => {
      const name = toolCall.function.name;
      if (!allowed.has(name)) {
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: `Tool "${name}" is not enabled.`,
            errorCode: "not_found",
          }),
        };
      }
      try {
        const parsedArgs: unknown = toolCall.function.arguments.trim()
          ? JSON.parse(toolCall.function.arguments)
          : {};
        const result = await registry.invokeWithContext(
          name,
          parsedArgs,
          options.context,
          {
            caller: "agent",
            ...(options.approvalToken !== undefined
              ? { approvalToken: options.approvalToken }
              : {}),
          },
        );
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result ?? null),
        };
      } catch (error) {
        const { body } = serializeActionErrorBody(error);
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(body),
        };
      }
    },
  };
}
