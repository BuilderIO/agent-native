import type { ActionEntry } from "../agent/production-agent.js";
import {
  createComputerApprovalRequest,
  decideComputerApproval,
} from "./computer-supervision-store.js";
import {
  computeComputerActionHash,
  computerOperationRequiresApproval,
} from "./computer-supervision.js";
import {
  enqueueComputerCommand,
  getRemoteCommand,
} from "./remote-commands-store.js";
import {
  getRemoteComputerCapabilities,
  listRemoteDevicesForOwner,
} from "./remote-devices-store.js";
import type {
  ComputerCommandAction,
  ComputerCommandEnvelope,
  ComputerOperationClass,
  RemoteCommand,
  RemoteDevice,
} from "./remote-types.js";

const REMOTE_DEVICE_ONLINE_MS = 90_000;
const COMMAND_WAIT_MS = 20_000;
const COMMAND_POLL_MS = 250;
const CONTROL_ACTIONS = new Set([
  "attach",
  "click",
  "type",
  "key",
  "navigate",
  "scroll",
]);
const BROWSER_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
]);
const BROWSER_MODIFIERS = new Set(["alt", "control", "meta", "shift"]);

export interface CreateRemoteBrowserActionEntriesOptions {
  getOwnerEmail: () => string | null | undefined;
  getOrgId?: () => string | null | undefined;
}

interface RemoteBrowserSessionMetadata {
  handle: string;
  origin?: string;
  title?: string;
}

function requireOwner(
  options: CreateRemoteBrowserActionEntriesOptions,
): string {
  const owner = options.getOwnerEmail()?.trim();
  if (!owner) {
    throw new Error(
      "No authenticated user is available for remote browser control",
    );
  }
  return owner;
}

function currentOrg(
  options: CreateRemoteBrowserActionEntriesOptions,
): string | null {
  return options.getOrgId?.() ?? null;
}

function isOnline(device: RemoteDevice): boolean {
  return (
    device.status === "active" &&
    device.lastSeenAt !== null &&
    Date.now() - device.lastSeenAt <= REMOTE_DEVICE_ONLINE_MS
  );
}

function browserSessionMetadata(
  device: RemoteDevice,
): RemoteBrowserSessionMetadata | null {
  const value = device.metadata?.browserSession;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.handle !== "string" || !record.handle.trim()) return null;
  return {
    handle: record.handle.trim(),
    ...(typeof record.origin === "string" && record.origin
      ? { origin: record.origin }
      : {}),
    ...(typeof record.title === "string" && record.title
      ? { title: record.title }
      : {}),
  };
}

async function listBrowserDevices(
  options: CreateRemoteBrowserActionEntriesOptions,
): Promise<RemoteDevice[]> {
  const ownerEmail = requireOwner(options);
  return (
    await listRemoteDevicesForOwner({
      ownerEmail,
      orgId: currentOrg(options),
      status: "active",
    })
  ).filter(
    (device) =>
      isOnline(device) &&
      Boolean(getRemoteComputerCapabilities(device)?.browser?.observe),
  );
}

async function resolveBrowserDevice(
  options: CreateRemoteBrowserActionEntriesOptions,
  args: Record<string, unknown>,
  mode: "observe" | "control",
): Promise<RemoteDevice> {
  const devices = (await listBrowserDevices(options)).filter(
    (device) => getRemoteComputerCapabilities(device)?.browser?.[mode] === true,
  );
  const requestedDeviceId = readString(args, "deviceId");
  const sessionHandle = readString(args, "sessionHandle");
  const matches = devices.filter((device) => {
    if (requestedDeviceId && device.id !== requestedDeviceId) return false;
    if (
      sessionHandle &&
      browserSessionMetadata(device)?.handle !== sessionHandle
    ) {
      return false;
    }
    return true;
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new Error(
      sessionHandle
        ? "That browser session is no longer connected. Re-open the Agent Native side panel on the page."
        : `No online browser device advertises browser.${mode}. Open Agent Native for Chrome and grant page access first.`,
    );
  }
  throw new Error(
    "More than one browser session is connected. Pass the sessionHandle shown by list-remote-browser-devices.",
  );
}

function readString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(
  args: Record<string, unknown>,
  key: string,
  fallback = 0,
): number {
  const value = Number(args[key] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

function requireSessionHandle(args: Record<string, unknown>): string {
  const value = readString(args, "sessionHandle");
  if (!value) throw new Error("sessionHandle is required");
  return value;
}

function requireObservationTarget(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const observationId = readString(args, "observationId");
  const backendNodeId = Number(args.backendNodeId);
  if (
    !observationId ||
    !Number.isSafeInteger(backendNodeId) ||
    backendNodeId < 0
  ) {
    throw new Error(
      "observationId and a non-negative backendNodeId are required",
    );
  }
  return { observationId, backendNodeId };
}

function buildReadAction(args: Record<string, unknown>): ComputerCommandAction {
  const action = readString(args, "action") ?? "read";
  if (action === "read") {
    return {
      type: "browser.read",
      target: { sessionHandle: requireSessionHandle(args) },
      input: {},
    };
  }
  if (action === "observe") {
    return {
      type: "browser.observe",
      target: null,
      input: {
        maxNodes: Math.max(
          1,
          Math.min(Math.trunc(readNumber(args, "maxNodes", 400)), 1_000),
        ),
      },
    };
  }
  throw new Error("Read action must be read or observe");
}

function buildControlAction(
  args: Record<string, unknown>,
): ComputerCommandAction {
  const action = readString(args, "action");
  if (!action || (!CONTROL_ACTIONS.has(action) && action !== "stop")) {
    throw new Error(
      "Control action must be attach, click, type, key, navigate, scroll, or stop",
    );
  }
  if (action === "attach") {
    return {
      type: "browser.attach",
      target: { sessionHandle: requireSessionHandle(args) },
      input: {},
    };
  }
  if (action === "click") {
    return {
      type: "browser.click",
      target: requireObservationTarget(args),
      input: {
        button:
          args.button === "middle" || args.button === "right"
            ? args.button
            : "left",
      },
    };
  }
  if (action === "type") {
    const text = typeof args.text === "string" ? args.text : null;
    if (text === null || text.length > 100_000) {
      throw new Error("text is required and must not exceed 100,000 chars");
    }
    return {
      type: "browser.type",
      target: requireObservationTarget(args),
      input: { text, replace: args.replace === true },
    };
  }
  if (action === "key") {
    const key = readString(args, "key");
    if (!key || !BROWSER_KEYS.has(key)) {
      throw new Error("key must be a supported browser key");
    }
    const modifiers = Array.isArray(args.modifiers)
      ? args.modifiers.filter(
          (value): value is string =>
            typeof value === "string" && BROWSER_MODIFIERS.has(value),
        )
      : [];
    if (
      Array.isArray(args.modifiers) &&
      modifiers.length !== args.modifiers.length
    ) {
      throw new Error("modifiers contains an unsupported browser modifier");
    }
    return {
      type: "browser.key",
      target: null,
      input: { key, modifiers },
    };
  }
  if (action === "navigate") {
    const url = readString(args, "url");
    if (!url) throw new Error("url is required");
    return {
      type: "browser.navigate",
      target: null,
      input: { url },
    };
  }
  if (action === "scroll") {
    return {
      type: "browser.scroll",
      target: null,
      input: {
        deltaX: readNumber(args, "deltaX"),
        deltaY: readNumber(args, "deltaY"),
        ...(args.x === undefined ? {} : { x: readNumber(args, "x") }),
        ...(args.y === undefined ? {} : { y: readNumber(args, "y") }),
      },
    };
  }
  return { type: "browser.stop", target: null, input: {} };
}

function sequenceNumber(): number {
  const random = new Uint16Array(1);
  globalThis.crypto.getRandomValues(random);
  return Date.now() * 1_000 + (random[0]! % 1_000);
}

function actionRunId(
  args: Record<string, unknown>,
  context: Parameters<NonNullable<ActionEntry["run"]>>[1],
): string {
  return (
    context?.threadId ??
    context?.runId ??
    readString(args, "sessionHandle") ??
    `browser-${globalThis.crypto.randomUUID()}`
  ).slice(0, 200);
}

async function createEnvelope(input: {
  args: Record<string, unknown>;
  context: Parameters<NonNullable<ActionEntry["run"]>>[1];
  action: ComputerCommandAction;
  operationClass: ComputerOperationClass;
}): Promise<ComputerCommandEnvelope> {
  const now = Date.now();
  const sequence = sequenceNumber();
  const runId = actionRunId(input.args, input.context);
  const envelope: ComputerCommandEnvelope = {
    version: 1,
    taskId: (
      readString(input.args, "sessionHandle") ??
      input.context?.threadId ??
      runId
    ).slice(0, 200),
    runId,
    sequence,
    idempotencyKey:
      `browser-${sequence}-${globalThis.crypto.randomUUID()}`.slice(0, 200),
    operationClass: input.operationClass,
    action: input.action,
    approval: {
      id: null,
      scope: "once",
      actionHash: "0".repeat(64),
    },
    issuedAt: now,
    leaseExpiresAt: now + 2 * 60_000,
  };
  envelope.approval.actionHash = await computeComputerActionHash(envelope);
  return envelope;
}

async function bindApprovedControl(input: {
  ownerEmail: string;
  orgId: string | null;
  deviceId: string;
  envelope: ComputerCommandEnvelope;
  approvedToolCallKey?: string;
}): Promise<ComputerCommandEnvelope> {
  if (!computerOperationRequiresApproval(input.envelope.operationClass)) {
    return input.envelope;
  }
  if (!input.approvedToolCallKey) {
    throw new Error("Browser control requires human approval");
  }
  const pending = await createComputerApprovalRequest(input);
  const approved = await decideComputerApproval({
    id: pending.id,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    actionHash: input.envelope.approval.actionHash,
    decision: "approved",
    decidedBy: input.ownerEmail,
    result: { source: "agent-tool-approval" },
  });
  if (!approved) throw new Error("Browser control approval expired");
  return {
    ...input.envelope,
    approval: { ...input.envelope.approval, id: approved.id },
  };
}

async function waitForCommand(
  command: RemoteCommand,
  signal?: AbortSignal,
): Promise<RemoteCommand> {
  const deadline = Date.now() + COMMAND_WAIT_MS;
  let current = command;
  while (
    Date.now() < deadline &&
    current.status !== "completed" &&
    current.status !== "failed" &&
    !signal?.aborted
  ) {
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
    current = (await getRemoteCommand(command.id)) ?? current;
  }
  return current;
}

async function enqueueBrowserAction(input: {
  options: CreateRemoteBrowserActionEntriesOptions;
  args: Record<string, unknown>;
  context: Parameters<NonNullable<ActionEntry["run"]>>[1];
  action: ComputerCommandAction;
  operationClass: ComputerOperationClass;
}): Promise<Record<string, unknown>> {
  const mode = input.operationClass.endsWith(".control")
    ? "control"
    : "observe";
  const device = await resolveBrowserDevice(input.options, input.args, mode);
  const ownerEmail = requireOwner(input.options);
  const orgId = currentOrg(input.options);
  let envelope = await createEnvelope(input);
  envelope = await bindApprovedControl({
    ownerEmail,
    orgId,
    deviceId: device.id,
    envelope,
    approvedToolCallKey: input.context?.approvedToolCallKey,
  });
  const command = await enqueueComputerCommand({
    deviceId: device.id,
    ownerEmail,
    orgId,
    envelope,
    platform: "browser",
  });
  const settled = await waitForCommand(command, input.context?.signal);
  return {
    ok: settled.status === "completed",
    commandId: settled.id,
    status: settled.status,
    ...(settled.result === null ? {} : { result: settled.result }),
    ...(settled.errorMessage ? { error: settled.errorMessage } : {}),
  };
}

const deviceSelectorProperties = {
  sessionHandle: {
    type: "string",
    description:
      "Opaque browser session handle staged by the Chrome side panel or returned by list-remote-browser-devices.",
  },
  deviceId: {
    type: "string",
    description:
      "Optional remote device id. Usually omit this and select by sessionHandle.",
  },
} as const;

export function createRemoteBrowserActionEntries(
  options: CreateRemoteBrowserActionEntriesOptions,
): Record<string, ActionEntry> {
  return {
    "list-remote-browser-devices": {
      readOnly: true,
      tool: {
        description:
          "List online Agent Native Chrome sessions. Use the opaque sessionHandle to read or control the page; never ask the user for a Chrome tab id.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      run: async () => ({
        ok: true,
        sessions: (await listBrowserDevices(options)).map((device) => {
          const capabilities = getRemoteComputerCapabilities(device)?.browser;
          const session = browserSessionMetadata(device);
          return {
            deviceId: device.id,
            sessionHandle: session?.handle ?? null,
            title: session?.title ?? null,
            origin: session?.origin ?? null,
            canRead: capabilities?.observe === true,
            canControl: capabilities?.control === true,
            lastSeenAt: device.lastSeenAt,
          };
        }),
      }),
    },
    "read-remote-browser-page": {
      readOnly: true,
      timeoutMs: 30_000,
      tool: {
        description:
          "Read a granted Chrome page or observe the currently attached control lease. Use read for bounded page context; use observe after attach to get interactive targets.",
        parameters: {
          type: "object",
          properties: {
            ...deviceSelectorProperties,
            action: { type: "string", enum: ["read", "observe"] },
            maxNodes: {
              type: "number",
              description: "Maximum accessibility nodes for observe.",
            },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
      run: async (args, context) =>
        enqueueBrowserAction({
          options,
          args,
          context,
          action: buildReadAction(args),
          operationClass: "browser.observe",
        }),
    },
    "control-remote-browser": {
      timeoutMs: 30_000,
      needsApproval: (args) => args.action !== "stop",
      tool: {
        description:
          "Attach to and control a user-granted Chrome page. Attach once per conversation before observing or acting. Targets must come from the latest observation. Control actions require inline user approval.",
        parameters: {
          type: "object",
          properties: {
            ...deviceSelectorProperties,
            action: {
              type: "string",
              enum: [
                "attach",
                "click",
                "type",
                "key",
                "navigate",
                "scroll",
                "stop",
              ],
            },
            observationId: { type: "string" },
            backendNodeId: { type: "number" },
            button: {
              type: "string",
              enum: ["left", "middle", "right"],
            },
            text: { type: "string" },
            replace: { type: "boolean" },
            key: { type: "string", enum: Array.from(BROWSER_KEYS) },
            modifiers: {
              type: "array",
              items: { type: "string", enum: Array.from(BROWSER_MODIFIERS) },
            },
            url: { type: "string" },
            deltaX: { type: "number" },
            deltaY: { type: "number" },
            x: { type: "number" },
            y: { type: "number" },
          },
          required: ["action"],
          additionalProperties: false,
        },
      },
      run: async (args, context) => {
        const action = buildControlAction(args);
        return enqueueBrowserAction({
          options,
          args,
          context,
          action,
          operationClass:
            action.type === "browser.stop"
              ? "browser.observe"
              : "browser.control",
        });
      },
    },
    "get-remote-browser-command": {
      readOnly: true,
      tool: {
        description:
          "Check a queued remote browser command when a previous browser tool returned before the extension completed it.",
        parameters: {
          type: "object",
          properties: {
            commandId: { type: "string" },
          },
          required: ["commandId"],
          additionalProperties: false,
        },
      },
      run: async (args) => {
        const commandId = readString(args, "commandId");
        if (!commandId) throw new Error("commandId is required");
        const command = await getRemoteCommand(commandId);
        const ownerEmail = requireOwner(options);
        const orgId = currentOrg(options);
        if (
          !command ||
          command.ownerEmail !== ownerEmail ||
          command.orgId !== orgId ||
          command.kind !== "computer-operation" ||
          !command.computerOperation?.operationClass.startsWith("browser.")
        ) {
          throw new Error("Remote browser command was not found");
        }
        return {
          ok: command.status === "completed",
          commandId: command.id,
          status: command.status,
          ...(command.result === null ? {} : { result: command.result }),
          ...(command.errorMessage ? { error: command.errorMessage } : {}),
        };
      },
    },
  };
}
