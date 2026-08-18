import {
  MULTI_FRONTIER_CHANNELS,
  type MultiFrontierActionResult,
  type MultiFrontierCreateIntent,
  type MultiFrontierProviderStatusEnvelope,
  type MultiFrontierProviderStatusEvent,
  type MultiFrontierReReviewIntent,
  type MultiFrontierSettings,
  type MultiFrontierSubscriptionEnvelope,
  type MultiFrontierSubscriptionResult,
} from "../../../shared/multi-frontier-channels.js";
import {
  MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES,
  MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
  MULTI_FRONTIER_PROVIDER_IDS,
  normalizeMultiFrontierIpcEvent,
  sanitizeMultiFrontierSubscriptionStatus,
  type MultiFrontierIpcEvent,
  type MultiFrontierProviderId,
  type MultiFrontierRendererState,
} from "../../../shared/multi-frontier-ipc.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const MAX_CWD_BYTES = 4_096;

interface IpcSender {
  id: number;
  send(channel: string, payload: unknown): void;
  once(event: "destroyed", listener: () => void): unknown;
  isDestroyed?(): boolean;
}

interface IpcEvent {
  sender: IpcSender;
}

export interface MultiFrontierIpcMain {
  handle(
    channel: string,
    listener: (event: IpcEvent, input?: unknown) => unknown,
  ): void;
  on(
    channel: string,
    listener: (event: IpcEvent, input?: unknown) => void,
  ): void;
  removeHandler?(channel: string): void;
  removeListener?(
    channel: string,
    listener: (event: IpcEvent, input?: unknown) => void,
  ): void;
}

export interface MultiFrontierIpcHost {
  getSettings(): MultiFrontierSettings;
  updateSettings(
    settings: Partial<MultiFrontierSettings>,
  ): MultiFrontierSettings;
  getProviderStatus(
    providerId: MultiFrontierProviderId,
  ): Promise<MultiFrontierSubscriptionResult>;
  beginProviderLogin(
    providerId: MultiFrontierProviderId,
  ): Promise<MultiFrontierSubscriptionResult>;
  refreshProviderStatus(
    providerId: MultiFrontierProviderId,
  ): Promise<MultiFrontierSubscriptionResult>;
  list(): Promise<MultiFrontierRendererState[]>;
  create(input: MultiFrontierCreateIntent): Promise<MultiFrontierActionResult>;
  start(collaborationId: string): Promise<MultiFrontierActionResult>;
  go(collaborationId: string): Promise<MultiFrontierActionResult>;
  pause(collaborationId: string): Promise<MultiFrontierActionResult>;
  resume(
    collaborationId: string,
    prompt?: string,
  ): Promise<MultiFrontierActionResult>;
  cancel(collaborationId: string): Promise<MultiFrontierActionResult>;
  reReview(
    collaborationId: string,
    input: MultiFrontierReReviewIntent,
  ): Promise<MultiFrontierActionResult>;
  roleSwap(
    collaborationId: string,
    nextDriverParticipantId: string,
  ): Promise<MultiFrontierActionResult>;
  subscribe(
    collaborationId: string,
    listener: (event: MultiFrontierIpcEvent) => void,
  ): () => void;
  subscribeProviderStatus(
    listener: (event: MultiFrontierProviderStatusEvent) => void,
  ): () => void;
}

export function registerMultiFrontierIpc(options: {
  ipcMain: MultiFrontierIpcMain;
  host: MultiFrontierIpcHost;
}): () => void {
  const { ipcMain, host } = options;
  const subscriptions = new Map<string, () => void>();
  const providerStatusSubscriptions = new Map<string, () => void>();
  const invokeChannels = [
    MULTI_FRONTIER_CHANNELS.settingsGet,
    MULTI_FRONTIER_CHANNELS.settingsUpdate,
    MULTI_FRONTIER_CHANNELS.providerStatus,
    MULTI_FRONTIER_CHANNELS.providerLogin,
    MULTI_FRONTIER_CHANNELS.providerRefresh,
    MULTI_FRONTIER_CHANNELS.list,
    MULTI_FRONTIER_CHANNELS.create,
    MULTI_FRONTIER_CHANNELS.start,
    MULTI_FRONTIER_CHANNELS.go,
    MULTI_FRONTIER_CHANNELS.pause,
    MULTI_FRONTIER_CHANNELS.resume,
    MULTI_FRONTIER_CHANNELS.cancel,
    MULTI_FRONTIER_CHANNELS.reReview,
    MULTI_FRONTIER_CHANNELS.roleSwap,
  ];

  ipcMain.handle(MULTI_FRONTIER_CHANNELS.settingsGet, () => host.getSettings());
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.settingsUpdate, (_event, input) => {
    const settings = parseSettingsPatch(input);
    if (!settings) throw new Error("Invalid multi-frontier settings.");
    return host.updateSettings(settings);
  });
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.providerStatus, (_event, input) => {
    const providerId = parseProviderId(input);
    return providerId
      ? host.getProviderStatus(providerId)
      : invalidSubscriptionResult();
  });
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.providerLogin, (_event, input) => {
    const providerId = parseProviderId(input);
    return providerId
      ? host.beginProviderLogin(providerId)
      : invalidSubscriptionResult();
  });
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.providerRefresh, (_event, input) => {
    const providerId = parseProviderId(input);
    return providerId
      ? host.refreshProviderStatus(providerId)
      : invalidSubscriptionResult();
  });
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.list, () => host.list());
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.create, (_event, input) => {
    const intent = parseCreateIntent(input);
    return intent ? host.create(intent) : invalidActionResult();
  });
  for (const action of ["start", "go", "pause", "resume", "cancel"] as const) {
    ipcMain.handle(MULTI_FRONTIER_CHANNELS[action], (_event, input) => {
      if (action === "resume") {
        const parsed = parseResumeIntent(input);
        return parsed
          ? host.resume(parsed.collaborationId, parsed.prompt)
          : invalidActionResult();
      }
      const collaborationId = parseId(input);
      if (!collaborationId) return invalidActionResult();
      return host[action](collaborationId);
    });
  }
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.reReview, (_event, input) => {
    const intent = parseReReviewIntent(input);
    return intent
      ? host.reReview(intent.collaborationId, {
          reviewArtifactId: intent.reviewArtifactId,
          ...(intent.instruction ? { instruction: intent.instruction } : {}),
        })
      : invalidActionResult();
  });
  ipcMain.handle(MULTI_FRONTIER_CHANNELS.roleSwap, (_event, input) => {
    const record = asBoundedRecord(input);
    const collaborationId = parseId(record?.collaborationId);
    const nextDriverParticipantId = parseId(record?.nextDriverParticipantId);
    return collaborationId && nextDriverParticipantId
      ? host.roleSwap(collaborationId, nextDriverParticipantId)
      : invalidActionResult();
  });

  const removeSubscription = (senderId: number, subscriptionId: string) => {
    const key = subscriptionKey(senderId, subscriptionId);
    subscriptions.get(key)?.();
    subscriptions.delete(key);
  };
  const subscribe = (event: IpcEvent, input?: unknown) => {
    const record = asBoundedRecord(input);
    const subscriptionId = parseId(record?.subscriptionId);
    const collaborationId = parseId(record?.collaborationId);
    if (!subscriptionId || !collaborationId) return;
    removeSubscription(event.sender.id, subscriptionId);
    const unsubscribe = host.subscribe(collaborationId, (nextEvent) => {
      if (event.sender.isDestroyed?.()) {
        removeSubscription(event.sender.id, subscriptionId);
        return;
      }
      const normalizedEvent = normalizeMultiFrontierIpcEvent(nextEvent);
      if (
        !normalizedEvent ||
        normalizedEvent.collaborationId !== collaborationId
      ) {
        return;
      }
      event.sender.send(MULTI_FRONTIER_CHANNELS.events, {
        subscriptionId,
        event: normalizedEvent,
      } satisfies MultiFrontierSubscriptionEnvelope);
    });
    subscriptions.set(
      subscriptionKey(event.sender.id, subscriptionId),
      unsubscribe,
    );
    event.sender.once("destroyed", () =>
      removeSubscription(event.sender.id, subscriptionId),
    );
  };
  const unsubscribe = (event: IpcEvent, input?: unknown) => {
    const record = asBoundedRecord(input);
    const subscriptionId = parseId(record?.subscriptionId);
    if (subscriptionId) removeSubscription(event.sender.id, subscriptionId);
  };
  const removeProviderStatusSubscription = (
    senderId: number,
    subscriptionId: string,
  ) => {
    const key = subscriptionKey(senderId, subscriptionId);
    providerStatusSubscriptions.get(key)?.();
    providerStatusSubscriptions.delete(key);
  };
  const subscribeProviderStatus = (event: IpcEvent, input?: unknown) => {
    const record = asBoundedRecord(input);
    const subscriptionId = parseId(record?.subscriptionId);
    if (!subscriptionId) return;
    removeProviderStatusSubscription(event.sender.id, subscriptionId);
    const dispose = host.subscribeProviderStatus((next) => {
      if (event.sender.isDestroyed?.()) {
        removeProviderStatusSubscription(event.sender.id, subscriptionId);
        return;
      }
      const status = sanitizeProviderStatusEvent(next);
      if (!status) return;
      event.sender.send(MULTI_FRONTIER_CHANNELS.providerStatusEvents, {
        subscriptionId,
        event: status,
      } satisfies MultiFrontierProviderStatusEnvelope);
    });
    providerStatusSubscriptions.set(
      subscriptionKey(event.sender.id, subscriptionId),
      dispose,
    );
    event.sender.once("destroyed", () =>
      removeProviderStatusSubscription(event.sender.id, subscriptionId),
    );
  };
  const unsubscribeProviderStatus = (event: IpcEvent, input?: unknown) => {
    const record = asBoundedRecord(input);
    const subscriptionId = parseId(record?.subscriptionId);
    if (subscriptionId) {
      removeProviderStatusSubscription(event.sender.id, subscriptionId);
    }
  };
  ipcMain.on(MULTI_FRONTIER_CHANNELS.subscribe, subscribe);
  ipcMain.on(MULTI_FRONTIER_CHANNELS.unsubscribe, unsubscribe);
  ipcMain.on(
    MULTI_FRONTIER_CHANNELS.providerStatusSubscribe,
    subscribeProviderStatus,
  );
  ipcMain.on(
    MULTI_FRONTIER_CHANNELS.providerStatusUnsubscribe,
    unsubscribeProviderStatus,
  );

  return () => {
    for (const dispose of subscriptions.values()) dispose();
    subscriptions.clear();
    for (const dispose of providerStatusSubscriptions.values()) dispose();
    providerStatusSubscriptions.clear();
    for (const channel of invokeChannels) ipcMain.removeHandler?.(channel);
    ipcMain.removeListener?.(MULTI_FRONTIER_CHANNELS.subscribe, subscribe);
    ipcMain.removeListener?.(MULTI_FRONTIER_CHANNELS.unsubscribe, unsubscribe);
    ipcMain.removeListener?.(
      MULTI_FRONTIER_CHANNELS.providerStatusSubscribe,
      subscribeProviderStatus,
    );
    ipcMain.removeListener?.(
      MULTI_FRONTIER_CHANNELS.providerStatusUnsubscribe,
      unsubscribeProviderStatus,
    );
  };
}

function sanitizeProviderStatusEvent(
  value: unknown,
): MultiFrontierProviderStatusEvent | null {
  const input = asBoundedRecord(value);
  const providerId = parseProviderId(input?.providerId);
  const status = sanitizeMultiFrontierSubscriptionStatus(input?.status);
  return status?.providerId === providerId && providerId
    ? { providerId, status }
    : null;
}

function parseSettingsPatch(
  value: unknown,
): Partial<MultiFrontierSettings> | null {
  const input = asBoundedRecord(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "autoContinueAfterAgreement")
  ) {
    return null;
  }
  if (
    input.autoContinueAfterAgreement !== undefined &&
    typeof input.autoContinueAfterAgreement !== "boolean"
  ) {
    return null;
  }
  return input.autoContinueAfterAgreement === undefined
    ? {}
    : { autoContinueAfterAgreement: input.autoContinueAfterAgreement };
}

function parseProviderId(value: unknown): MultiFrontierProviderId | null {
  return typeof value === "string" &&
    MULTI_FRONTIER_PROVIDER_IDS.includes(value as MultiFrontierProviderId)
    ? (value as MultiFrontierProviderId)
    : null;
}

function parseCreateIntent(value: unknown): MultiFrontierCreateIntent | null {
  const input = asBoundedRecord(value);
  if (
    !input ||
    Object.keys(input).some(
      (key) => !["prompt", "cwd", "autoContinueAfterAgreement"].includes(key),
    ) ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    Buffer.byteLength(input.prompt, "utf8") >
      MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES ||
    typeof input.autoContinueAfterAgreement !== "boolean"
  ) {
    return null;
  }
  if (
    input.cwd !== undefined &&
    (typeof input.cwd !== "string" ||
      !input.cwd.trim() ||
      Buffer.byteLength(input.cwd, "utf8") > MAX_CWD_BYTES)
  ) {
    return null;
  }
  return {
    prompt: stripControls(input.prompt),
    ...(typeof input.cwd === "string" ? { cwd: stripControls(input.cwd) } : {}),
    autoContinueAfterAgreement: input.autoContinueAfterAgreement,
  };
}

function parseResumeIntent(
  value: unknown,
): { collaborationId: string; prompt?: string } | null {
  if (typeof value === "string")
    return { collaborationId: parseId(value) ?? "" };
  const input = asBoundedRecord(value);
  if (
    !input ||
    Object.keys(input).some(
      (key) => !["collaborationId", "prompt"].includes(key),
    )
  ) {
    return null;
  }
  const collaborationId = parseId(input.collaborationId);
  const prompt = parseBoundedText(
    input.prompt,
    MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
  );
  if (!collaborationId || prompt === null) return null;
  return { collaborationId, ...(prompt ? { prompt } : {}) };
}

function parseReReviewIntent(value: unknown): {
  collaborationId: string;
  reviewArtifactId: string;
  instruction?: string;
} | null {
  const input = asBoundedRecord(value);
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        !["collaborationId", "reviewArtifactId", "instruction"].includes(key),
    )
  ) {
    return null;
  }
  const collaborationId = parseId(input.collaborationId);
  const reviewArtifactId = parseId(input.reviewArtifactId);
  const instruction = parseBoundedText(
    input.instruction,
    MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
  );
  if (!collaborationId || !reviewArtifactId || instruction === null)
    return null;
  return {
    collaborationId,
    reviewArtifactId,
    ...(instruction ? { instruction } : {}),
  };
}

function parseBoundedText(
  value: unknown,
  maxBytes: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    return null;
  }
  return stripControls(value);
}

function parseId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function asBoundedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    if (
      Buffer.byteLength(JSON.stringify(value), "utf8") >
      MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return value as Record<string, unknown>;
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function invalidActionResult(): MultiFrontierActionResult {
  return { error: { message: "Invalid multi-frontier request." } };
}

function invalidSubscriptionResult(): MultiFrontierSubscriptionResult {
  return { error: { message: "Invalid subscription provider." } };
}

function subscriptionKey(senderId: number, subscriptionId: string): string {
  return `${senderId}:${subscriptionId}`;
}
