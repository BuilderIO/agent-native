import {
  BrowserControlError,
  BrowserControlService,
  parseNativeRequest,
  ProtocolValidationError,
} from "@agent-native/browser-control-extension-core";
import { assertValidComputerCommandEnvelope } from "@agent-native/core/integrations/computer-supervision";

import { hasCaptureGrant } from "./capture-grants";
import { captureTabContext } from "./capture-tab";
import { resolvePageSession } from "./page-session";

const MAX_RESULT_BYTES = 128_000;
const MAX_CACHED_RESULTS = 128;

interface RelayCommand {
  id: string;
  envelope: Awaited<ReturnType<typeof assertValidComputerCommandEnvelope>>;
}

export class RemoteRelayExecutor {
  private readonly sequences = new Map<string, number>();
  private readonly results = new Map<string, Record<string, unknown>>();

  constructor(private readonly control: BrowserControlService) {}

  async execute(
    rawCommand: unknown,
    relayOwnsControl: boolean,
  ): Promise<{ commandId: string; result: Record<string, unknown> }> {
    const command = await parseRelayCommand(rawCommand);
    const envelope = command.envelope;
    const cached = this.results.get(envelope.idempotencyKey);
    if (cached) return { commandId: command.id, result: cached };
    const lastSequence = this.sequences.get(envelope.runId) ?? -1;
    if (envelope.sequence <= lastSequence) {
      throw new Error("Remote browser command sequence was replayed.");
    }
    if (!relayOwnsControl && envelope.operationClass === "browser.control") {
      throw new Error(
        "The direct relay does not own the browser-control upstream.",
      );
    }
    const bridgeResult = await this.executeAction(envelope);
    const result = boundedResult({
      ok: true,
      taskId: envelope.taskId,
      runId: envelope.runId,
      sequence: envelope.sequence,
      idempotencyKey: envelope.idempotencyKey,
      actionHash: envelope.approval.actionHash,
      operationClass: envelope.operationClass,
      bridgeResult,
    });
    this.sequences.set(envelope.runId, envelope.sequence);
    this.results.set(envelope.idempotencyKey, result);
    while (this.results.size > MAX_CACHED_RESULTS) {
      const oldest = this.results.keys().next().value;
      if (typeof oldest !== "string") break;
      this.results.delete(oldest);
    }
    return { commandId: command.id, result };
  }

  private async executeAction(
    envelope: Awaited<ReturnType<typeof assertValidComputerCommandEnvelope>>,
  ): Promise<unknown> {
    const action = envelope.action;
    const input = optionalRecord(action.input);
    const target = optionalRecord(action.target);
    const taskId = envelope.runId;
    assertOperationClass(action.type, envelope.operationClass);

    if (action.type === "browser.read") {
      const session = await requirePageSession(target.sessionHandle);
      const tab = await chrome.tabs.get(session.tabId);
      if (!tab.active || !tab.url) {
        throw new Error(
          "The shared browser session is no longer the active Chrome tab.",
        );
      }
      if (!(await hasCaptureGrant(session.tabId, tab.url))) {
        throw new Error(
          "Page access expired. Use the extension panel to share this page again.",
        );
      }
      const context = await captureTabContext(session.tabId);
      if (context.outcome.state === "failure") {
        throw new Error(context.outcome.failure.message);
      }
      return { context };
    }

    const command =
      action.type === "browser.attach"
        ? await attachCommand(target.sessionHandle)
        : controlCommand(action.type, input, target);
    return this.control.execute(
      parseNativeRequest({
        id: envelope.idempotencyKey,
        taskId,
        command,
      }),
    );
  }
}

export function relayCapabilities(
  relayOwnsControl: boolean,
  version = chrome.runtime.getManifest().version,
) {
  return {
    browser: {
      observe: true,
      control: relayOwnsControl,
      provider: "agent-native-chrome-extension",
      version,
    },
  };
}

export function readRelayPollCommand(value: unknown): unknown | null {
  if (!isRecord(value)) return null;
  return isRecord(value.command) ? value.command : null;
}

export function relayErrorResult(error: unknown): Record<string, unknown> {
  const message =
    error instanceof Error ? error.message : "Remote browser operation failed.";
  const code =
    error instanceof BrowserControlError ||
    error instanceof ProtocolValidationError
      ? error.code
      : "REMOTE_BROWSER_OPERATION_FAILED";
  return { ok: false, error: message.slice(0, 2_048), code };
}

async function parseRelayCommand(value: unknown): Promise<RelayCommand> {
  if (!isRecord(value)) throw new Error("Remote command must be an object.");
  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    value.id.length > 256 ||
    value.kind !== "computer-operation"
  ) {
    throw new Error("Remote command identity or kind is invalid.");
  }
  const params = requiredRecord(value.params, "Remote command params");
  return {
    id: value.id,
    envelope: await assertValidComputerCommandEnvelope(params.envelope),
  };
}

export async function attachCommand(sessionHandle: unknown) {
  const session = await requirePageSession(sessionHandle);
  const tab = await chrome.tabs.get(session.tabId);
  if (!tab.active || !tab.url) {
    throw new Error(
      "The shared browser session is no longer the active Chrome tab.",
    );
  }
  if (!(await hasCaptureGrant(session.tabId, tab.url))) {
    throw new Error(
      "Page access expired. Use the extension panel to share this page again.",
    );
  }
  return {
    type: "attach" as const,
    tabId: session.tabId,
    allowedOrigins: [session.origin],
  };
}

export function controlCommand(
  actionType: string,
  input: Record<string, unknown>,
  target: Record<string, unknown>,
): Record<string, unknown> {
  switch (actionType) {
    case "browser.observe":
      return {
        type: "observe",
        includeScreenshot: false,
        ...(input.maxNodes === undefined ? {} : { maxNodes: input.maxNodes }),
      };
    case "browser.click":
      return { type: "click", target, button: input.button };
    case "browser.type":
      return {
        type: "type",
        target,
        text: input.text,
        replace: input.replace,
      };
    case "browser.key":
      return { type: "key", key: input.key, modifiers: input.modifiers };
    case "browser.navigate":
      return { type: "navigate", url: input.url };
    case "browser.scroll":
      return {
        type: "scroll",
        deltaX: input.deltaX,
        deltaY: input.deltaY,
        x: input.x,
        y: input.y,
      };
    case "browser.stop":
      return { type: "stop" };
    default:
      throw new Error(`Unsupported remote browser action: ${actionType}`);
  }
}

function assertOperationClass(
  actionType: string,
  operationClass: string,
): void {
  const expected = relayOperationClass(actionType);
  if (!expected)
    throw new Error(`Unsupported remote browser action: ${actionType}`);
  if (operationClass !== expected) {
    throw new Error(
      `${actionType} cannot run as operation class ${operationClass}.`,
    );
  }
}

export function relayOperationClass(
  actionType: string,
): "browser.observe" | "browser.control" | null {
  if (
    actionType === "browser.read" ||
    actionType === "browser.observe" ||
    actionType === "browser.stop"
  ) {
    return "browser.observe";
  }
  return [
    "browser.attach",
    "browser.click",
    "browser.type",
    "browser.key",
    "browser.navigate",
    "browser.scroll",
  ].includes(actionType)
    ? "browser.control"
    : null;
}

async function requirePageSession(handle: unknown) {
  const session = await resolvePageSession(handle);
  if (!session) {
    throw new Error(
      "The browser session expired. Share the current page from the extension again.",
    );
  }
  return session;
}

function boundedResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_RESULT_BYTES) {
    throw new Error("Remote browser result exceeds the 128 KB safety limit.");
  }
  return JSON.parse(encoded) as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requiredRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
