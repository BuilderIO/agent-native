import type {
  MultiFrontierCollaborationResult,
  MultiFrontierIpcEvent,
  MultiFrontierProviderId,
  MultiFrontierRendererState,
} from "./multi-frontier-ipc.js";
import type { SubscriptionStatus } from "./subscription-status.js";

export const MULTI_FRONTIER_CHANNELS = {
  settingsGet: "multi-frontier:settings:get",
  settingsUpdate: "multi-frontier:settings:update",
  providerStatus: "multi-frontier:provider:status",
  providerLogin: "multi-frontier:provider:login",
  providerRefresh: "multi-frontier:provider:refresh",
  list: "multi-frontier:list",
  create: "multi-frontier:create",
  start: "multi-frontier:start",
  go: "multi-frontier:go",
  pause: "multi-frontier:pause",
  resume: "multi-frontier:resume",
  cancel: "multi-frontier:cancel",
  roleSwap: "multi-frontier:role-swap",
  subscribe: "multi-frontier:subscribe",
  unsubscribe: "multi-frontier:unsubscribe",
  events: "multi-frontier:events",
} as const;

export interface MultiFrontierSettings {
  autoContinueAfterAgreement: boolean;
}

export interface MultiFrontierCreateIntent {
  prompt: string;
  cwd?: string;
  autoContinueAfterAgreement: boolean;
}

export interface MultiFrontierActionResult {
  snapshot?: MultiFrontierRendererState;
  error?: { message: string };
}

export interface MultiFrontierSubscriptionResult {
  status?: SubscriptionStatus;
  error?: { message: string };
}

export interface MultiFrontierSubscriptionEnvelope {
  subscriptionId: string;
  event: MultiFrontierIpcEvent;
}

export interface MultiFrontierRendererApi {
  getSettings(): Promise<MultiFrontierSettings>;
  updateSettings(
    settings: Partial<MultiFrontierSettings>,
  ): Promise<MultiFrontierSettings>;
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
  resume(collaborationId: string): Promise<MultiFrontierActionResult>;
  cancel(collaborationId: string): Promise<MultiFrontierActionResult>;
  roleSwap(
    collaborationId: string,
    nextDriverParticipantId: string,
  ): Promise<MultiFrontierActionResult>;
  subscribe(
    collaborationId: string,
    callback: (event: MultiFrontierIpcEvent) => void,
  ): () => void;
}

export type MultiFrontierHostActionResult = MultiFrontierCollaborationResult;
