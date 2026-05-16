import {
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
  type AgentNativeActionManifestEntry,
  type AgentNativeHostContext,
  type AgentNativeHostRequestOptions,
  type AgentNativeJsonSchema,
  type BuiltInAgentNativeHostCommand,
} from "./host-bridge.js";

export const AGENT_NATIVE_HOST_TOOL_NAMES = {
  viewHostScreen: "view-host-screen",
  listHostActions: "list-host-actions",
  runHostAction: "run-host-action",
  sendHostCommand: "send-host-command",
} as const;

export type AgentNativeHostToolName =
  (typeof AGENT_NATIVE_HOST_TOOL_NAMES)[keyof typeof AGENT_NATIVE_HOST_TOOL_NAMES];

export type AgentNativeHostToolParameters = AgentNativeJsonSchema & {
  type: "object";
  properties?: Record<string, AgentNativeJsonSchema>;
  required?: string[];
};

export interface AgentNativeHostToolDefinition<
  TInput = unknown,
  TResult = unknown,
> {
  name: AgentNativeHostToolName;
  description: string;
  parameters: AgentNativeHostToolParameters;
  execute(input?: TInput): Promise<TResult>;
}

export interface RunAgentNativeHostActionToolInput {
  name: string;
  args?: unknown;
}

export interface SendAgentNativeHostCommandToolInput {
  /**
   * Built-in or custom host command. Defaults to refreshData so callers can
   * use this tool as a simple host refresh primitive.
   */
  command?: BuiltInAgentNativeHostCommand | string;
  payload?: unknown;
}

export type CreateAgentNativeHostToolsOptions = AgentNativeHostRequestOptions;

export type AgentNativeHostToolSet = {
  [AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen]: AgentNativeHostToolDefinition<
    unknown,
    AgentNativeHostContext
  >;
  [AGENT_NATIVE_HOST_TOOL_NAMES.listHostActions]: AgentNativeHostToolDefinition<
    unknown,
    AgentNativeActionManifestEntry[]
  >;
  [AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction]: AgentNativeHostToolDefinition<
    RunAgentNativeHostActionToolInput,
    unknown
  >;
  [AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand]: AgentNativeHostToolDefinition<
    SendAgentNativeHostCommandToolInput,
    unknown
  >;
};

const EMPTY_PARAMETERS: AgentNativeHostToolParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const RUN_HOST_ACTION_PARAMETERS: AgentNativeHostToolParameters = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "Name of the live host action to run. Use list-host-actions first when you need the current action names and schemas.",
    },
    args: {
      description:
        "JSON-serializable arguments for the host action. Match the action schema returned by list-host-actions.",
    },
  },
  required: ["name"],
  additionalProperties: false,
};

const SEND_HOST_COMMAND_PARAMETERS: AgentNativeHostToolParameters = {
  type: "object",
  properties: {
    command: {
      type: "string",
      description:
        "Built-in or custom host command. Defaults to refreshData when omitted.",
    },
    payload: {
      description:
        "JSON-serializable payload for the host command, such as a route target or refresh query key.",
    },
  },
  additionalProperties: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalRecordInput(
  value: unknown,
  toolName: AgentNativeHostToolName,
): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (isRecord(value)) return value;
  throw new Error(`${toolName} input must be an object`);
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  toolName: AgentNativeHostToolName,
): string {
  const raw = value[key];
  if (typeof raw === "string" && raw.trim()) return raw;
  throw new Error(`${toolName} requires a non-empty ${key}`);
}

export function createAgentNativeHostTools(
  options: CreateAgentNativeHostToolsOptions = {},
): AgentNativeHostToolSet {
  return {
    [AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen]: {
      name: AGENT_NATIVE_HOST_TOOL_NAMES.viewHostScreen,
      description:
        "View the current host app screen and context exposed to the embedded Agent-Native iframe, including route, selection, resource, user, organization, capabilities, and screen snapshot when available.",
      parameters: EMPTY_PARAMETERS,
      execute: async () => requestAgentNativeHostContext(options),
    },
    [AGENT_NATIVE_HOST_TOOL_NAMES.listHostActions]: {
      name: AGENT_NATIVE_HOST_TOOL_NAMES.listHostActions,
      description:
        "List live browser-session actions currently exposed by the host page. These actions may change as the user navigates and only work while the host page is connected.",
      parameters: EMPTY_PARAMETERS,
      execute: async () => requestAgentNativeHostActions(options),
    },
    [AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction]: {
      name: AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction,
      description:
        "Run a live browser-session action exposed by the host page. Use list-host-actions first to discover available action names and argument schemas.",
      parameters: RUN_HOST_ACTION_PARAMETERS,
      execute: async (input) => {
        const record = optionalRecordInput(
          input,
          AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction,
        );
        const name = readRequiredString(
          record,
          "name",
          AGENT_NATIVE_HOST_TOOL_NAMES.runHostAction,
        );
        return runAgentNativeHostAction(name, record.args, options);
      },
    },
    [AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand]: {
      name: AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand,
      description:
        "Send a command to the host app, such as refreshData, navigate, remountView, hardReload, openResource, requestApproval, or an app-specific command. Omit command to request a data refresh.",
      parameters: SEND_HOST_COMMAND_PARAMETERS,
      execute: async (input) => {
        const record = optionalRecordInput(
          input,
          AGENT_NATIVE_HOST_TOOL_NAMES.sendHostCommand,
        );
        const command =
          typeof record.command === "string" && record.command.trim()
            ? record.command
            : "refreshData";
        return sendAgentNativeHostCommand(command, record.payload, options);
      },
    },
  };
}
