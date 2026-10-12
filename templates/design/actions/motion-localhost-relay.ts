import { fail, type ActionRunContext } from "@agent-native/core/action";

import {
  LOCALHOST_BRIDGE_RELAY_MARKER,
  type LocalhostBridgeRelay,
  type LocalhostBridgeRelayResponse,
} from "../shared/visual-edit-bridge-relay.js";

const RELAY_STEP_CONTEXT_KEY = "__agentNativeLocalhostBridgeStep";
const RELAY_RESPONSES_CONTEXT_KEY = "__agentNativeLocalhostBridgeResponses";

type RelayActionContext = ActionRunContext & {
  [RELAY_STEP_CONTEXT_KEY]?: string;
  [RELAY_RESPONSES_CONTEXT_KEY]?: unknown;
};

interface RunnableAction<TArgs, TResult> {
  run: (args: TArgs, context?: ActionRunContext) => TResult | Promise<TResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isLocalhostBridgeRelay(
  value: unknown,
): value is LocalhostBridgeRelay {
  return (
    isRecord(value) &&
    value.__agentNativeLocalhostBridge === LOCALHOST_BRIDGE_RELAY_MARKER &&
    (value.operation === "read-file" ||
      value.operation === "list-files" ||
      value.operation === "write-file" ||
      value.operation === "apply-edit") &&
    typeof value.designId === "string" &&
    typeof value.connectionId === "string"
  );
}

export function localhostBridgeRelayContextWithResponses(
  context: ActionRunContext,
  responses: LocalhostBridgeRelayResponse[],
): ActionRunContext {
  return {
    ...context,
    [RELAY_RESPONSES_CONTEXT_KEY]: responses,
  } as RelayActionContext;
}

export function localhostBridgeRelayStep(
  context: ActionRunContext | undefined,
): string | undefined {
  const step = (context as RelayActionContext | undefined)?.[
    RELAY_STEP_CONTEXT_KEY
  ];
  return typeof step === "string" ? step : undefined;
}

export async function runLocalhostBridgeStep<TArgs, TResult>(args: {
  action: RunnableAction<TArgs, TResult>;
  actionArgs: TArgs;
  context: ActionRunContext | undefined;
  step: string;
  beforeStep?: () => unknown | Promise<unknown>;
}): Promise<TResult | LocalhostBridgeRelay> {
  const context = args.context
    ? ({
        ...args.context,
        [RELAY_STEP_CONTEXT_KEY]: args.step,
      } as RelayActionContext)
    : undefined;
  const pendingResponses = (context as RelayActionContext | undefined)?.[
    RELAY_RESPONSES_CONTEXT_KEY
  ];
  const hasResponseForStep =
    Array.isArray(pendingResponses) &&
    pendingResponses.some(
      (entry) =>
        isRecord(entry) &&
        isLocalhostBridgeRelay(entry.relay) &&
        entry.relay.step === args.step,
    );
  if (!hasResponseForStep) await args.beforeStep?.();

  const result = context
    ? await args.action.run(args.actionArgs, context)
    : await args.action.run(args.actionArgs);

  if (!isLocalhostBridgeRelay(result)) return result as TResult;
  if (result.step !== args.step) {
    return fail(
      "The localhost bridge returned a source operation for an unexpected Motion step.",
      { errorCode: "localhost_bridge_relay_step_mismatch", statusCode: 502 },
    );
  }

  const responses = (context as RelayActionContext | undefined)?.[
    RELAY_RESPONSES_CONTEXT_KEY
  ];
  if (!Array.isArray(responses)) return result;

  const response = responses.find(
    (entry): entry is LocalhostBridgeRelayResponse =>
      isRecord(entry) &&
      isLocalhostBridgeRelay(entry.relay) &&
      entry.relay.step === args.step,
  );
  if (!response) return result;
  if (!sameRelayOperation(response.relay, result)) {
    return fail(
      "The localhost bridge response does not match the current Motion source operation.",
      { errorCode: "localhost_bridge_relay_mismatch", statusCode: 409 },
    );
  }

  if (!isValidBridgeResult(result, response.result)) {
    return fail(
      "The localhost bridge returned an incomplete Motion source result.",
      { errorCode: "localhost_bridge_relay_invalid_result", statusCode: 502 },
    );
  }
  return response.result as TResult;
}

function sameRelayOperation(
  left: LocalhostBridgeRelay,
  right: LocalhostBridgeRelay,
): boolean {
  return (
    left.operation === right.operation &&
    left.designId === right.designId &&
    left.connectionId === right.connectionId &&
    left.step === right.step &&
    left.path === right.path &&
    left.relPath === right.relPath &&
    JSON.stringify(left.payload ?? null) ===
      JSON.stringify(right.payload ?? null)
  );
}

function isValidBridgeResult(
  relay: LocalhostBridgeRelay,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  if (relay.operation === "read-file") {
    return (
      value.designId === relay.designId &&
      value.connectionId === relay.connectionId &&
      value.path === relay.path &&
      typeof value.content === "string" &&
      typeof value.versionHash === "string"
    );
  }
  if (relay.operation === "write-file" || relay.operation === "apply-edit") {
    return (
      value.designId === relay.designId &&
      value.relPath === relay.relPath &&
      value.written === true &&
      typeof value.versionHash === "string" &&
      value.operation === (relay.operation === "write-file" ? "write" : "patch")
    );
  }
  return false;
}
