import type { H3Event } from "h3";

import type { AgentChatEvent } from "../agent/types.js";
import type { EnvKeyConfig } from "../server/create-server.js";

export type IntegrationConversationType =
  | "channel"
  | "private_channel"
  | "dm"
  | "group_dm"
  | "unknown";

export type IntegrationTriggerKind = "mention" | "dm" | "thread_reply";

export interface IntegrationActorTrust {
  memberType: "owner" | "admin" | "member" | "guest" | "external" | "unknown";
  verified: boolean;
}

export interface IntegrationContextMessage {
  senderId?: string;
  senderName?: string;
  text: string;
  timestamp: number;
  sourceUrl?: string;
  reactions?: Array<{ name: string; count: number }>;
  files?: IntegrationFileReference[];
}

export interface IntegrationFileReference {
  id: string;
  name?: string;
  mimetype?: string;
  size?: number;
  permalink?: string;
  downloadUrl?: string;
}

export interface IncomingMessage {
  platform: string;
  externalThreadId: string;
  text: string;
  senderName?: string;
  senderEmail?: string;
  senderId?: string;
  triggerKind?: IntegrationTriggerKind;
  conversationType?: IntegrationConversationType;
  tenantId?: string;
  integrationScopeId?: string;
  actorTrust?: IntegrationActorTrust;
  contextMessages?: IntegrationContextMessage[];
  files?: IntegrationFileReference[];
  approvedToolCalls?: string[];
  /**
   * Whether the platform cryptographically authenticated that the message
   * genuinely came from the claimed sender (e.g. inbound email that passed
   * DKIM, or an aligned SPF pass, for the From domain). Defaults to
   * undefined/false for platforms that don't provide sender authentication.
   *
   * Owner-resolution paths that grant a real user's identity/credentials
   * MUST treat a missing/false value as "unverified" and fail closed —
   * never derive a privileged acting identity from an unverified sender.
   */
  senderVerified?: boolean;
  platformContext: Record<string, unknown>;
  responseContext?: Record<string, unknown>;
  threadRef?: string;
  sourceUrl?: string;
  routingHint?: {
    targetAgent?: string;
    instruction: string;
  };
  identityNote?: string;
  replyRef?: string;
  timestamp: number;
}

export interface OutgoingMessage {
  text: string;
  platformContext: Record<string, unknown>;
}

export interface PlatformDeliveryReceipt {
  status: "delivered";
  messageRefs?: string[];
}

export interface PlatformDeliveryOptions {
  placeholderRef?: string;
  idempotencyKey?: string;
  reconcileAfter?: number;
  signal?: AbortSignal;
  strictTargetRef?: boolean;
}

export interface OutboundTarget {
  destination: string;
  threadRef?: string | null;
  label?: string;
  tenantId?: string;
  installationId?: string;
  installationKey?: string;
}

export interface IntegrationStatus {
  platform: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  details?: Record<string, unknown>;
  error?: string;
  webhookUrl?: string;
  requiredEnvKeys?: import("../server/create-server.js").EnvKeyConfig[];
}

export interface PlatformAdapterCapabilities {
  replyText: boolean;
  proactiveMessages: boolean;
  nativeThreads: boolean;
  contextualReplies: boolean;
  deferredWebhookResponse: boolean;
  interactionOnly?: boolean;
  nativeContextHydration?: boolean;
  liveRunProgress?: boolean;
}

export interface PlatformRunProgress {
  ref?: PlatformRunProgressRef;
  responseTargetRef?: string;
  onEvent(
    event: AgentChatEvent,
    opts?: { signal?: AbortSignal },
  ): Promise<void> | void;
  complete(
    message: OutgoingMessage,
    opts?: { signal?: AbortSignal; idempotencyKey?: string },
  ): Promise<void | PlatformDeliveryReceipt>;
  fail?(message: string, opts?: { signal?: AbortSignal }): Promise<void>;
}

export interface PlatformRunProgressRef {
  kind: string;
  streamTs: string;
}

export interface ImmediateWebhookResponse {
  status: number;
  body: unknown;
}

export class UnsupportedPlatformCapabilityError extends Error {
  readonly code = "UNSUPPORTED_PLATFORM_CAPABILITY";

  constructor(
    readonly platform: string,
    readonly capability: keyof PlatformAdapterCapabilities,
  ) {
    super(`Platform ${platform} does not support ${capability}`);
    this.name = "UnsupportedPlatformCapabilityError";
  }
}

export interface PlatformAdapter {
  readonly platform: string;
  readonly label: string;
  readonly capabilities?: Partial<PlatformAdapterCapabilities>;

  getRequiredEnvKeys(): EnvKeyConfig[];

  handleVerification(event: H3Event): Promise<{
    handled: boolean;
    response?: unknown;
  }>;

  verifyWebhook(event: H3Event): Promise<boolean>;

  parseIncomingMessage(event: H3Event): Promise<IncomingMessage | null>;

  hydrateIncomingMessage?(incoming: IncomingMessage): Promise<IncomingMessage>;

  hydrateIncomingIdentity?(incoming: IncomingMessage): Promise<IncomingMessage>;

  getImmediateWebhookResponse?(
    incoming: IncomingMessage,
  ): ImmediateWebhookResponse | null;

  getLegacyExternalThreadIds?(incoming: IncomingMessage): string[];

  sendResponse(
    message: OutgoingMessage,
    context: IncomingMessage,
    opts?: PlatformDeliveryOptions,
  ): Promise<void | PlatformDeliveryReceipt>;

  sendSystemNotice?(
    incoming: IncomingMessage,
    text: string,
    opts?: {
      dedupeKey?: string;
      dedupeTtlMs?: number;
    },
  ): Promise<void>;

  postProcessingPlaceholder?(
    incoming: IncomingMessage,
  ): Promise<{ placeholderRef: string } | null>;

  startRunProgress?(
    incoming: IncomingMessage,
  ): Promise<PlatformRunProgress | null>;

  resumeRunProgress?(
    incoming: IncomingMessage,
    ref: PlatformRunProgressRef,
  ): Promise<PlatformRunProgress | null>;

  sendMessageToTarget?(
    message: OutgoingMessage,
    target: OutboundTarget,
  ): Promise<void>;

  formatAgentResponse(
    text: string,
    opts?: { threadDeepLinkUrl?: string },
  ): OutgoingMessage;

  getStatus(baseUrl?: string): Promise<IntegrationStatus>;
}

export function assertPlatformCapability(
  adapter: PlatformAdapter,
  capability: keyof PlatformAdapterCapabilities,
): void {
  if (adapter.capabilities?.[capability] !== true) {
    throw new UnsupportedPlatformCapabilityError(adapter.platform, capability);
  }
}

export interface IntegrationsPluginOptions {
  appId?: string;
  adapters?: PlatformAdapter[];
  adapterOverrides?: PlatformAdapter[];
  systemPrompt?: string;
  actions?: Record<string, import("../agent/production-agent.js").ActionEntry>;
  model?: string;
  apiKey?: string;
  engine?:
    | import("../agent/engine/types.js").AgentEngine
    | string
    | {
        name: string;
        config: Record<string, unknown>;
      };
  resolveOwner?: (incoming: IncomingMessage) => string | Promise<string>;
  resolveExecutionContext?: (
    incoming: IncomingMessage,
  ) => IntegrationExecutionContext | Promise<IntegrationExecutionContext>;
  allowAnonymousOrgScopedSlackDm?: boolean;
  beforeProcess?: (
    incoming: IncomingMessage,
    adapter: PlatformAdapter,
  ) => Promise<
    | {
        handled: true;
        responseText?: string;
      }
    | { handled: false }
  >;
}

export interface IntegrationExecutionContext {
  ownerEmail: string;
  orgId: string | null;
  principalType: "user" | "service";
  installationId?: string;
  scopeId?: string;
  anonymousMember?: boolean;
}
