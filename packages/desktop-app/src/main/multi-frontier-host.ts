import { randomUUID } from "node:crypto";

import type {
  MultiFrontierActionResult,
  MultiFrontierCreateIntent,
  MultiFrontierSettings,
  MultiFrontierSubscriptionResult,
} from "../../shared/multi-frontier-channels.js";
import {
  MULTI_FRONTIER_IPC_SCHEMA_VERSION,
  normalizeMultiFrontierCollaborationResult,
  normalizeMultiFrontierIpcEvent,
  normalizeMultiFrontierRendererState,
  sanitizeMultiFrontierSubscriptionStatus,
  type MultiFrontierCollaborationIdRequest,
  type MultiFrontierCollaborationResult,
  type MultiFrontierCreateCollaborationRequest,
  type MultiFrontierIpcEvent,
  type MultiFrontierProviderId,
  type MultiFrontierRendererState,
  type MultiFrontierRoleSwapRequest,
} from "../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../shared/subscription-status.js";
import {
  getClaudeSubscriptionLoginLaunchSpec,
  readClaudeSubscriptionStatus,
} from "./claude-subscription.js";
import {
  getCodexLoginLaunchSpec,
  spawnDetached,
  type DetachedLaunchResult,
} from "./codex-login-launcher.js";
import {
  CodexSubscriptionAdapter,
  type CodexSubscriptionAdapterOptions,
} from "./codex-subscription.js";
import type { MultiFrontierSettingsStore } from "./multi-frontier-settings-store.js";

type CollaborationAction = "start" | "go" | "pause" | "resume" | "cancel";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

export interface MultiFrontierCoordinatorBackend {
  list(): Promise<unknown[]> | unknown[];
  create(
    request: MultiFrontierCreateCollaborationRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  start(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  go(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  pause(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  resume(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  cancel(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  roleSwap(
    request: MultiFrontierRoleSwapRequest,
  ): Promise<MultiFrontierCollaborationResult>;
  subscribe(
    collaborationId: string,
    listener: (event: unknown) => void,
  ): () => void;
  dispose?(): Promise<void> | void;
}

export interface MultiFrontierCodexStatusAdapter {
  start(): Promise<SubscriptionStatus>;
  refresh(): Promise<SubscriptionStatus>;
  getStatus(): SubscriptionStatus;
  subscribe(listener: (status: SubscriptionStatus) => void): () => void;
  stop(): void;
}

export interface MultiFrontierWorkspaceResolution {
  workspaceId: string;
}

export interface MultiFrontierHostOptions {
  coordinator: MultiFrontierCoordinatorBackend;
  settingsStore: MultiFrontierSettingsStore;
  resolveWorkspace: (
    requestedCwd: string | undefined,
  ) => Promise<MultiFrontierWorkspaceResolution>;
  loginCwd: string;
  createCodexAdapter?: () => MultiFrontierCodexStatusAdapter;
  readClaudeStatus?: () => Promise<SubscriptionStatus>;
  launchDetached?: (
    command: string,
    args: string[],
    cwd: string,
    options: { waitForExit: boolean },
  ) => Promise<DetachedLaunchResult>;
  platform?: string;
  createId?: () => string;
}

interface CollaborationSubscription {
  listeners: Set<(event: MultiFrontierIpcEvent) => void>;
  unsubscribeBackend: () => void;
}

export class MultiFrontierHost {
  readonly #coordinator: MultiFrontierCoordinatorBackend;
  readonly #settingsStore: MultiFrontierSettingsStore;
  readonly #resolveWorkspace: MultiFrontierHostOptions["resolveWorkspace"];
  readonly #loginCwd: string;
  readonly #readClaudeStatus: () => Promise<SubscriptionStatus>;
  readonly #launchDetached: NonNullable<
    MultiFrontierHostOptions["launchDetached"]
  >;
  readonly #platform: string;
  readonly #createId: () => string;
  readonly #codex: MultiFrontierCodexStatusAdapter;
  readonly #subscriptions = new Map<string, CollaborationSubscription>();
  readonly #sequences = new Map<string, number>();
  #codexStatus: SubscriptionStatus;
  #codexStarted: Promise<SubscriptionStatus> | undefined;
  #unsubscribeCodex: () => void;
  #disposed = false;

  constructor(options: MultiFrontierHostOptions) {
    this.#coordinator = options.coordinator;
    this.#settingsStore = options.settingsStore;
    this.#resolveWorkspace = options.resolveWorkspace;
    this.#loginCwd = options.loginCwd;
    this.#readClaudeStatus =
      options.readClaudeStatus ?? (() => readClaudeSubscriptionStatus());
    this.#launchDetached =
      options.launchDetached ??
      ((command, args, cwd, launchOptions) =>
        spawnDetached(command, args, cwd, undefined, launchOptions));
    this.#platform = options.platform ?? process.platform;
    this.#createId = options.createId ?? randomUUID;
    this.#codex =
      options.createCodexAdapter?.() ??
      new CodexSubscriptionAdapter(
        {} satisfies CodexSubscriptionAdapterOptions,
      );
    this.#codexStatus = sanitizeStatus(this.#codex.getStatus(), "codex");
    this.#unsubscribeCodex = this.#codex.subscribe((status) => {
      this.#codexStatus = sanitizeStatus(status, "codex");
    });
  }

  getSettings(): MultiFrontierSettings {
    return this.#settingsStore.read();
  }

  updateSettings(
    settings: Partial<MultiFrontierSettings>,
  ): MultiFrontierSettings {
    this.#assertUsable();
    return this.#settingsStore.update(settings);
  }

  async getProviderStatus(
    providerId: MultiFrontierProviderId,
  ): Promise<MultiFrontierSubscriptionResult> {
    this.#assertUsable();
    if (providerId === "codex") {
      await this.#ensureCodexStarted();
      return { status: this.#codexStatus };
    }
    return { status: sanitizeStatus(await this.#readClaudeStatus(), "claude") };
  }

  async refreshProviderStatus(
    providerId: MultiFrontierProviderId,
  ): Promise<MultiFrontierSubscriptionResult> {
    this.#assertUsable();
    if (providerId === "codex") {
      await this.#ensureCodexStarted();
      this.#codexStatus = sanitizeStatus(await this.#codex.refresh(), "codex");
      return { status: this.#codexStatus };
    }
    return { status: sanitizeStatus(await this.#readClaudeStatus(), "claude") };
  }

  async beginProviderLogin(
    providerId: MultiFrontierProviderId,
  ): Promise<MultiFrontierSubscriptionResult> {
    this.#assertUsable();
    const spec =
      providerId === "codex"
        ? getCodexLoginLaunchSpec(this.#platform)
        : getClaudeSubscriptionLoginLaunchSpec(this.#platform);
    if (!spec.ok) return { error: { message: spec.error } };
    const launched = await this.#launchDetached(
      spec.command,
      spec.args,
      this.#loginCwd,
      { waitForExit: this.#platform === "darwin" },
    );
    if (!launched.ok) {
      return {
        error: { message: "The provider sign-in terminal did not open." },
      };
    }
    return providerId === "codex"
      ? { status: this.#codexStatus }
      : { status: sanitizeStatus(await this.#readClaudeStatus(), "claude") };
  }

  async list(): Promise<MultiFrontierRendererState[]> {
    this.#assertUsable();
    const values = await this.#coordinator.list();
    return values
      .map(normalizeMultiFrontierRendererState)
      .filter((value): value is MultiFrontierRendererState => value !== null);
  }

  async create(
    intent: MultiFrontierCreateIntent,
  ): Promise<MultiFrontierActionResult> {
    this.#assertUsable();
    const workspace = await this.#resolveWorkspace(intent.cwd);
    if (!SAFE_ID.test(workspace.workspaceId)) {
      return { error: { message: "The selected workspace is unavailable." } };
    }
    const requestId = this.#nextId("request");
    return this.#runBackend(
      this.#coordinator.create({
        schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
        requestId,
        action: "create",
        workspaceId: workspace.workspaceId,
        prompt: intent.prompt,
        autoContinueAfterAgreement: intent.autoContinueAfterAgreement,
        participants: [
          {
            participantId: this.#nextId("codex"),
            providerId: "codex",
          },
          {
            participantId: this.#nextId("claude"),
            providerId: "claude",
          },
        ],
      }),
      requestId,
    );
  }

  start(collaborationId: string): Promise<MultiFrontierActionResult> {
    return this.#runAction("start", collaborationId);
  }

  go(collaborationId: string): Promise<MultiFrontierActionResult> {
    return this.#runAction("go", collaborationId);
  }

  pause(collaborationId: string): Promise<MultiFrontierActionResult> {
    return this.#runAction("pause", collaborationId);
  }

  resume(collaborationId: string): Promise<MultiFrontierActionResult> {
    return this.#runAction("resume", collaborationId);
  }

  cancel(collaborationId: string): Promise<MultiFrontierActionResult> {
    return this.#runAction("cancel", collaborationId);
  }

  roleSwap(
    collaborationId: string,
    nextDriverParticipantId: string,
  ): Promise<MultiFrontierActionResult> {
    this.#assertUsable();
    const requestId = this.#nextId("request");
    return this.#runBackend(
      this.#coordinator.roleSwap({
        schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
        requestId,
        action: "role-swap",
        collaborationId,
        nextDriverParticipantId,
      }),
      requestId,
    );
  }

  subscribe(
    collaborationId: string,
    listener: (event: MultiFrontierIpcEvent) => void,
  ): () => void {
    this.#assertUsable();
    let subscription = this.#subscriptions.get(collaborationId);
    if (!subscription) {
      const listeners = new Set<(event: MultiFrontierIpcEvent) => void>();
      const unsubscribeBackend = this.#coordinator.subscribe(
        collaborationId,
        (event) => this.#publishBackendEvent(collaborationId, event),
      );
      subscription = { listeners, unsubscribeBackend };
      this.#subscriptions.set(collaborationId, subscription);
    }
    subscription.listeners.add(listener);
    return () => {
      const current = this.#subscriptions.get(collaborationId);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size > 0) return;
      current.unsubscribeBackend();
      this.#subscriptions.delete(collaborationId);
    };
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeCodex();
    this.#codex.stop();
    for (const subscription of this.#subscriptions.values()) {
      subscription.unsubscribeBackend();
    }
    this.#subscriptions.clear();
    await this.#coordinator.dispose?.();
  }

  async #runAction(
    action: CollaborationAction,
    collaborationId: string,
  ): Promise<MultiFrontierActionResult> {
    this.#assertUsable();
    const requestId = this.#nextId("request");
    return this.#runBackend(
      this.#coordinator[action]({
        schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
        requestId,
        action,
        collaborationId,
      }),
      requestId,
    );
  }

  async #runBackend(
    pending: Promise<MultiFrontierCollaborationResult>,
    requestId: string,
  ): Promise<MultiFrontierActionResult> {
    const normalized = normalizeMultiFrontierCollaborationResult(await pending);
    if (!normalized || normalized.requestId !== requestId) {
      return {
        error: {
          message: "The collaboration backend returned an invalid result.",
        },
      };
    }
    if (normalized.snapshot) this.#publishSnapshot(normalized.snapshot);
    return {
      ...(normalized.snapshot ? { snapshot: normalized.snapshot } : {}),
      ...(normalized.error
        ? { error: { message: normalized.error.message } }
        : {}),
    };
  }

  async #ensureCodexStarted(): Promise<SubscriptionStatus> {
    if (!this.#codexStarted) {
      this.#codexStarted = this.#codex.start().then((status) => {
        this.#codexStatus = sanitizeStatus(status, "codex");
        return this.#codexStatus;
      });
    }
    return this.#codexStarted;
  }

  #publishSnapshot(snapshot: MultiFrontierRendererState): void {
    this.#publishBackendEvent(snapshot.collaborationId, {
      schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
      type: "snapshot",
      collaborationId: snapshot.collaborationId,
      sequence: 0,
      snapshot,
    });
  }

  #publishBackendEvent(collaborationId: string, value: unknown): void {
    const input = value && typeof value === "object" ? value : {};
    const sequence = (this.#sequences.get(collaborationId) ?? -1) + 1;
    const normalized = normalizeMultiFrontierIpcEvent({
      ...(input as Record<string, unknown>),
      schemaVersion: MULTI_FRONTIER_IPC_SCHEMA_VERSION,
      collaborationId,
      sequence,
    });
    if (!normalized) return;
    this.#sequences.set(collaborationId, sequence);
    const subscription = this.#subscriptions.get(collaborationId);
    if (!subscription) return;
    for (const listener of subscription.listeners) listener(normalized);
  }

  #nextId(kind: string): string {
    return `mf-${kind}-${this.#createId()}`;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("The multi-frontier host is disposed.");
  }
}

function sanitizeStatus(
  value: unknown,
  expectedProvider: MultiFrontierProviderId,
): SubscriptionStatus {
  const status = sanitizeMultiFrontierSubscriptionStatus(value);
  if (!status || status.providerId !== expectedProvider) {
    return {
      schemaVersion: 1,
      providerId: expectedProvider,
      connectionState: "unavailable",
      telemetry: {
        state: "unavailable",
        source: "connection-only",
        capabilities: {
          account: false,
          plan: false,
          rateLimits: false,
          modelTierRateLimits: false,
          contextWindow: false,
          credits: false,
          liveUpdates: false,
        },
        meters: [],
      },
    };
  }
  return status;
}
