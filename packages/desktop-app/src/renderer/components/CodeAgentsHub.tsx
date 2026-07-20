import {
  CodeAgentsApp,
  type CodeAgentComputerSetupAction,
  type CodeAgentModelListResult,
  type CodeAgentPermissionMode,
  type CodeAgentTranscriptEvent,
  type CodeAgentTranscriptRequest,
  type CodeAgentsHost,
  type CodeAgentsNewSessionExtension,
} from "@agent-native/code-agents-ui";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { toAppDefinition, type AppConfig } from "@shared/app-registry";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  MultiFrontierIpcEvent,
  MultiFrontierProviderId,
  MultiFrontierRendererState,
} from "../../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../../shared/subscription-status.js";
import AppWebview from "./AppWebview.js";
import {
  initialMultiFrontierRunAutoContinue,
  locksMultiFrontierMode,
  providerOperationFailureNotice,
  readNewerMultiFrontierSnapshot,
} from "./multi-frontier-renderer-state.js";
import {
  multiFrontierFailureCategory,
  trackMultiFrontierLifecycle,
} from "./multi-frontier-telemetry.js";
import {
  MultiFrontierParticipantSettings,
  MultiFrontierWorkspace,
  type MultiFrontierNotice,
  type MultiFrontierSecondaryActionInput,
} from "./MultiFrontierWorkspace.js";

const agentNativeIconUrl = new URL(
  "../assets/agent-native-icon-dark.svg",
  import.meta.url,
).href;
const codeAgentsQueryClient = createAgentNativeQueryClient();
const MULTI_FRONTIER_PROVIDERS: readonly MultiFrontierProviderId[] = [
  "codex",
  "claude",
];
const MULTI_FRONTIER_RUN_MODES = [
  {
    value: "plan",
    label: "Plan",
    description: "Inspect and propose only",
  },
  {
    value: "auto",
    label: "Auto",
    description: "One agent plans and builds",
  },
  {
    value: "multi-frontier",
    label: "Multi-Frontier",
    description: "Codex + Claude plan, cross-review, then one builds",
  },
] as const;

interface CodeAgentsHubProps {
  apps: AppConfig[];
  isActive?: boolean;
  openRequest?: { goalId?: string; runId?: string; nonce: number };
  refreshKey?: number;
  onOpenSettings?: () => void;
}

type CodeAgentTranscriptSubscriptionBatch = {
  status: "ok" | "unavailable";
  runId?: string;
  events: CodeAgentTranscriptEvent[];
  eventFile?: string;
  error?: string;
  subscriptionId?: string;
  reason?: string;
};

interface CodeAgentsHostWithTranscriptSubscription extends CodeAgentsHost {
  subscribeTranscript?(
    request: CodeAgentTranscriptRequest,
    cb: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
  ): () => void;
}

export default function CodeAgentsHub({
  apps,
  isActive = true,
  openRequest,
  refreshKey = 0,
  onOpenSettings,
}: CodeAgentsHubProps) {
  const [multiFrontierMode, setMultiFrontierMode] = useState(false);
  const [multiFrontierState, setMultiFrontierState] =
    useState<MultiFrontierRendererState>();
  const [multiFrontierSubscriptions, setMultiFrontierSubscriptions] = useState<
    Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>
  >({});
  const [multiFrontierDefaultSettings, setMultiFrontierDefaultSettings] =
    useState<MultiFrontierSettings>({ autoContinueAfterAgreement: false });
  const [multiFrontierRunAutoContinue, setMultiFrontierRunAutoContinue] =
    useState(false);
  const [multiFrontierBusy, setMultiFrontierBusy] = useState(false);
  const [multiFrontierNotices, setMultiFrontierNotices] = useState<
    MultiFrontierNotice[]
  >([]);
  const [multiFrontierOpenDetailRequest, setMultiFrontierOpenDetailRequest] =
    useState<{ detailId: string; nonce: number }>();
  const multiFrontierSequence = useRef(-1);
  const multiFrontierSettingsHydrated = useRef(false);
  const multiFrontierDetailNonce = useRef(0);
  const multiFrontierNoticeNonce = useRef(0);
  const multiFrontierActivationTracked = useRef(false);
  const multiFrontierLastPhaseTelemetry = useRef("");
  const multiFrontierLastProviderTelemetry = useRef<
    Partial<Record<MultiFrontierProviderId, string>>
  >({});
  const activeMultiFrontierCollaborationId =
    multiFrontierState?.collaborationId;
  const multiFrontierModeLocked = locksMultiFrontierMode(multiFrontierState);

  const appendMultiFrontierNotice = useCallback(
    (notice: MultiFrontierNotice) => {
      setMultiFrontierNotices((current) =>
        [
          ...current.filter((currentNotice) => currentNotice.id !== notice.id),
          notice,
        ].slice(-8),
      );
    },
    [],
  );

  const appendProviderOperationFailure = useCallback(
    (
      providerId: MultiFrontierProviderId,
      operation: "connect" | "refresh" | "load",
    ) => {
      multiFrontierNoticeNonce.current += 1;
      appendMultiFrontierNotice(
        providerOperationFailureNotice(
          providerId,
          operation,
          `subscription:${providerId}:${operation}:${multiFrontierNoticeNonce.current}`,
        ),
      );
      trackMultiFrontierLifecycle({
        kind: "failure",
        category: operation === "connect" ? "auth" : "provider",
      });
    },
    [appendMultiFrontierNotice],
  );

  const applyMultiFrontierSnapshot = useCallback(
    (snapshot: MultiFrontierRendererState | undefined) => {
      if (!snapshot) return;
      setMultiFrontierState(snapshot);
      setMultiFrontierSubscriptions((current) => ({
        ...current,
        ...snapshot.subscriptions,
      }));
    },
    [],
  );

  const applyMultiFrontierEvent = useCallback(
    (event: MultiFrontierIpcEvent) => {
      const collaborationId = activeMultiFrontierCollaborationId;
      if (!collaborationId) return;
      const next = readNewerMultiFrontierSnapshot(
        collaborationId,
        multiFrontierSequence.current,
        event,
      );
      if (!next) return;
      multiFrontierSequence.current = next.sequence;
      applyMultiFrontierSnapshot(next.snapshot);
      if (next.notice) {
        appendMultiFrontierNotice(next.notice);
      }
    },
    [
      appendMultiFrontierNotice,
      applyMultiFrontierSnapshot,
      activeMultiFrontierCollaborationId,
    ],
  );

  useEffect(() => {
    if (!multiFrontierMode) {
      multiFrontierActivationTracked.current = false;
      return;
    }
    if (multiFrontierActivationTracked.current) return;
    multiFrontierActivationTracked.current = true;
    trackMultiFrontierLifecycle({
      kind: "mode_activation",
      autoContinueAfterAgreement: multiFrontierRunAutoContinue,
    });
  }, [multiFrontierMode, multiFrontierRunAutoContinue]);

  useEffect(() => {
    if (!multiFrontierState) return;
    const checkpointCount = multiFrontierState.artifacts.filter(
      (artifact) => artifact.kind === "checkpoint",
    ).length;
    const reviewCount = multiFrontierState.artifacts.filter(
      (artifact) => artifact.kind === "review",
    ).length;
    const key = [
      multiFrontierState.phase,
      multiFrontierState.round,
      multiFrontierState.approvalState,
      checkpointCount,
      reviewCount,
      multiFrontierState.requiresPlanningPrompt === true,
    ].join(":");
    if (multiFrontierLastPhaseTelemetry.current === key) return;
    multiFrontierLastPhaseTelemetry.current = key;
    trackMultiFrontierLifecycle({
      kind: "phase",
      phase: multiFrontierState.phase,
      round: multiFrontierState.round,
      approvalState: multiFrontierState.approvalState,
      autoContinueAfterAgreement:
        multiFrontierState.autoContinueAfterAgreement ?? false,
      checkpointCount,
      reviewCount,
      requiresPlanningPrompt:
        multiFrontierState.requiresPlanningPrompt === true,
    });
  }, [multiFrontierState]);

  useEffect(() => {
    for (const providerId of MULTI_FRONTIER_PROVIDERS) {
      const status = multiFrontierSubscriptions[providerId];
      if (!status) continue;
      const key = [
        status.connectionState,
        status.telemetry.state,
        status.telemetry.capabilities.rateLimits,
        status.telemetry.capabilities.liveUpdates,
      ].join(":");
      if (multiFrontierLastProviderTelemetry.current[providerId] === key) {
        continue;
      }
      multiFrontierLastProviderTelemetry.current[providerId] = key;
      trackMultiFrontierLifecycle({
        kind: "provider_status",
        providerId,
        connectionState: status.connectionState,
        telemetryState: status.telemetry.state,
        hasRateLimits: status.telemetry.capabilities.rateLimits,
        hasLiveUpdates: status.telemetry.capabilities.liveUpdates,
      });
    }
  }, [multiFrontierSubscriptions]);

  useEffect(() => {
    if (!isActive) return;
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    let disposed = false;
    const unsubscribeProviderStatus = api.subscribeProviderStatus((event) => {
      if (disposed) return;
      setMultiFrontierSubscriptions((current) => ({
        ...current,
        [event.providerId]: event.status,
      }));
    });
    void api
      .getSettings()
      .then((settings) => {
        if (disposed) return;
        setMultiFrontierDefaultSettings(settings);
        if (!multiFrontierSettingsHydrated.current) {
          multiFrontierSettingsHydrated.current = true;
          setMultiFrontierRunAutoContinue(
            initialMultiFrontierRunAutoContinue(settings),
          );
        }
      })
      .catch(() => undefined);
    for (const providerId of MULTI_FRONTIER_PROVIDERS) {
      void api
        .getProviderStatus(providerId)
        .then((result) => {
          if (disposed) return;
          if (result.error || !result.status) {
            appendProviderOperationFailure(providerId, "load");
            return;
          }
          setMultiFrontierSubscriptions((current) => ({
            ...current,
            [providerId]: result.status!,
          }));
        })
        .catch(() => {
          if (!disposed) appendProviderOperationFailure(providerId, "load");
        });
    }
    void api
      .list()
      .then((snapshots) => {
        if (disposed) return;
        const recovered = snapshots.find(
          (snapshot) => snapshot.phase === "paused",
        );
        if (!recovered) return;
        applyMultiFrontierSnapshot(recovered);
        multiFrontierSettingsHydrated.current = true;
        setMultiFrontierRunAutoContinue(
          recovered.autoContinueAfterAgreement ?? false,
        );
        setMultiFrontierMode(true);
        multiFrontierDetailNonce.current += 1;
        setMultiFrontierOpenDetailRequest({
          detailId: recovered.collaborationId,
          nonce: multiFrontierDetailNonce.current,
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribeProviderStatus();
    };
  }, [appendProviderOperationFailure, applyMultiFrontierSnapshot, isActive]);

  useEffect(() => {
    if (!isActive || !activeMultiFrontierCollaborationId) return;
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    multiFrontierSequence.current = -1;
    setMultiFrontierNotices([]);
    return api.subscribe(
      activeMultiFrontierCollaborationId,
      applyMultiFrontierEvent,
    );
  }, [activeMultiFrontierCollaborationId, applyMultiFrontierEvent, isActive]);

  const refreshMultiFrontierSubscription = useCallback(
    async (providerId: MultiFrontierProviderId) => {
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      setMultiFrontierBusy(true);
      try {
        const result = await api.refreshProviderStatus(providerId);
        if (result.error || !result.status) {
          appendProviderOperationFailure(providerId, "refresh");
          return;
        }
        setMultiFrontierSubscriptions((current) => ({
          ...current,
          [providerId]: result.status!,
        }));
      } catch {
        appendProviderOperationFailure(providerId, "refresh");
      } finally {
        setMultiFrontierBusy(false);
      }
    },
    [appendProviderOperationFailure],
  );

  const connectMultiFrontierSubscription = useCallback(
    async (providerId: MultiFrontierProviderId) => {
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      setMultiFrontierBusy(true);
      try {
        const result = await api.beginProviderLogin(providerId);
        if (result.status) {
          setMultiFrontierSubscriptions((current) => ({
            ...current,
            [providerId]: result.status!,
          }));
        }
        if (result.error || !result.status) {
          appendProviderOperationFailure(providerId, "connect");
        }
      } catch {
        appendProviderOperationFailure(providerId, "connect");
      } finally {
        setMultiFrontierBusy(false);
      }
    },
    [appendProviderOperationFailure],
  );

  const updateMultiFrontierDefaultSettings = useCallback(
    async (autoContinueAfterAgreement: boolean) => {
      const previous = multiFrontierDefaultSettings;
      const next = { autoContinueAfterAgreement };
      setMultiFrontierDefaultSettings(next);
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      try {
        setMultiFrontierDefaultSettings(await api.updateSettings(next));
      } catch {
        setMultiFrontierDefaultSettings(previous);
      }
    },
    [multiFrontierDefaultSettings],
  );

  const runMultiFrontierAction = useCallback(
    async (
      action:
        | "start"
        | "go"
        | "pause"
        | "resume"
        | "cancel"
        | "re-review"
        | "role-swap",
      collaborationId: string,
      input: {
        nextDriverParticipantId?: string;
        reviewArtifactId?: string;
        prompt?: string;
      } = {},
    ) => {
      const api = window.electronAPI?.multiFrontier;
      if (!api) return;
      trackMultiFrontierLifecycle({ kind: "action", action });
      setMultiFrontierBusy(true);
      try {
        const result =
          action === "role-swap"
            ? await api.roleSwap(
                collaborationId,
                input.nextDriverParticipantId ?? "",
              )
            : action === "re-review"
              ? await api.reReview(collaborationId, {
                  reviewArtifactId: input.reviewArtifactId ?? "",
                })
              : action === "resume"
                ? await api.resume(collaborationId, input.prompt)
                : await api[action](collaborationId);
        applyMultiFrontierSnapshot(result.snapshot);
        if (result.error) {
          trackMultiFrontierLifecycle({
            kind: "failure",
            category: multiFrontierFailureCategory(result.error.message),
          });
          multiFrontierNoticeNonce.current += 1;
          appendMultiFrontierNotice({
            id: `action:${action}:${multiFrontierNoticeNonce.current}`,
            kind: "failure",
            message: result.error.message,
          });
        }
      } catch {
        trackMultiFrontierLifecycle({
          kind: "failure",
          category: "unknown",
        });
        multiFrontierNoticeNonce.current += 1;
        appendMultiFrontierNotice({
          id: `action:${action}:${multiFrontierNoticeNonce.current}`,
          kind: "failure",
          message:
            "The collaboration could not continue. Check both subscriptions, then retry recovery.",
        });
      } finally {
        setMultiFrontierBusy(false);
      }
    },
    [appendMultiFrontierNotice, applyMultiFrontierSnapshot],
  );

  const multiFrontierExtension = useMemo<CodeAgentsNewSessionExtension>(
    () => ({
      active: multiFrontierMode,
      disabled: multiFrontierBusy,
      renderModeControl({ permissionMode, onPermissionModeChange }) {
        return (
          <MultiFrontierModeControl
            active={multiFrontierMode}
            permissionMode={permissionMode}
            subscriptions={multiFrontierSubscriptions}
            busy={multiFrontierBusy}
            modeLocked={multiFrontierModeLocked}
            autoContinueAfterAgreement={multiFrontierRunAutoContinue}
            defaultAutoContinueAfterAgreement={
              multiFrontierDefaultSettings.autoContinueAfterAgreement
            }
            onModeChange={(mode) => {
              if (mode === "multi-frontier") {
                if (!multiFrontierMode) {
                  setMultiFrontierRunAutoContinue(
                    initialMultiFrontierRunAutoContinue(
                      multiFrontierDefaultSettings,
                    ),
                  );
                }
                setMultiFrontierMode(true);
                return;
              }
              if (multiFrontierModeLocked) return;
              setMultiFrontierMode(false);
              onPermissionModeChange(
                mode === "plan" ? "read-only" : "full-auto",
              );
            }}
            onConnectSubscription={(providerId) =>
              void connectMultiFrontierSubscription(providerId)
            }
            onRefreshSubscription={(providerId) =>
              void refreshMultiFrontierSubscription(providerId)
            }
            onAutoContinueAfterAgreementChange={(value) =>
              setMultiFrontierRunAutoContinue(value)
            }
            onDefaultAutoContinueAfterAgreementChange={(value) =>
              void updateMultiFrontierDefaultSettings(value)
            }
          />
        );
      },
      async submit({ prompt, cwd, attachments }) {
        if (attachments.length > 0) {
          return {
            ok: false,
            message: "Multi-Frontier does not accept attachments yet.",
          };
        }
        const api = window.electronAPI?.multiFrontier;
        if (!api) {
          return {
            ok: false,
            message: "Multi-Frontier is not available in this desktop build.",
          };
        }
        const allConnected = MULTI_FRONTIER_PROVIDERS.every(
          (providerId) =>
            multiFrontierSubscriptions[providerId]?.connectionState ===
            "connected",
        );
        if (!allConnected) {
          return {
            ok: false,
            message: "Connect both subscription participants before starting.",
          };
        }
        setMultiFrontierBusy(true);
        try {
          const result = await api.create({
            prompt,
            ...(cwd ? { cwd } : {}),
            autoContinueAfterAgreement: multiFrontierRunAutoContinue,
          });
          applyMultiFrontierSnapshot(result.snapshot);
          if (!result.snapshot) {
            return {
              ok: false,
              message:
                result.error?.message ?? "Could not start collaboration.",
            };
          }
          return { ok: true, detailId: result.snapshot.collaborationId };
        } finally {
          setMultiFrontierBusy(false);
        }
      },
      renderDetail({ detailId }: { detailId: string }) {
        const state =
          multiFrontierState?.collaborationId === detailId
            ? multiFrontierState
            : undefined;
        return (
          <MultiFrontierWorkspace
            state={state}
            subscriptions={multiFrontierSubscriptions}
            notices={multiFrontierNotices}
            busy={multiFrontierBusy}
            autoContinueAfterAgreement={multiFrontierRunAutoContinue}
            defaultAutoContinueAfterAgreement={
              multiFrontierDefaultSettings.autoContinueAfterAgreement
            }
            onConnectSubscription={(providerId) =>
              void connectMultiFrontierSubscription(providerId)
            }
            onRefreshSubscription={(providerId) =>
              void refreshMultiFrontierSubscription(providerId)
            }
            onAutoContinueAfterAgreementChange={
              state
                ? undefined
                : (value) => setMultiFrontierRunAutoContinue(value)
            }
            onDefaultAutoContinueAfterAgreementChange={(value) =>
              void updateMultiFrontierDefaultSettings(value)
            }
            onStart={(collaborationId) =>
              void runMultiFrontierAction("start", collaborationId)
            }
            onGo={(collaborationId) =>
              void runMultiFrontierAction("go", collaborationId)
            }
            onSecondaryAction={(input: MultiFrontierSecondaryActionInput) =>
              void runMultiFrontierAction(input.action, input.collaborationId, {
                ...(input.nextDriverParticipantId
                  ? { nextDriverParticipantId: input.nextDriverParticipantId }
                  : {}),
                ...(input.reviewArtifactId
                  ? { reviewArtifactId: input.reviewArtifactId }
                  : {}),
                ...(input.prompt ? { prompt: input.prompt } : {}),
              })
            }
          />
        );
      },
    }),
    [
      applyMultiFrontierSnapshot,
      connectMultiFrontierSubscription,
      multiFrontierBusy,
      multiFrontierDefaultSettings.autoContinueAfterAgreement,
      multiFrontierModeLocked,
      multiFrontierMode,
      multiFrontierNotices,
      multiFrontierRunAutoContinue,
      multiFrontierState,
      multiFrontierSubscriptions,
      refreshMultiFrontierSubscription,
      runMultiFrontierAction,
      updateMultiFrontierDefaultSettings,
    ],
  );

  const host = useMemo<CodeAgentsHostWithTranscriptSubscription>(
    () => ({
      async listRuns(goalId?: string) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listRuns) {
          return {
            status: "unavailable",
            goalId,
            runs: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listRuns(goalId);
      },
      async createRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.createRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.createRun(request);
      },
      async listModels() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listModels) {
          return {
            status: "unavailable",
            models: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listModels() as Promise<CodeAgentModelListResult>;
      },
      async getHostMetadata() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.getHostMetadata) {
          return {
            status: "unavailable",
            llmProvider: { configured: false },
            error: "Desktop bridge is not available.",
          };
        }
        return api.getHostMetadata();
      },
      async runComputerSetupAction(action: CodeAgentComputerSetupAction) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.runComputerSetupAction) {
          return {
            ok: false,
            action,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.runComputerSetupAction(action);
      },
      async listCodePacks(cwd?: string) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listCodePacks) {
          return {
            status: "unavailable",
            error: "Desktop bridge is not available.",
          };
        }
        return api.listCodePacks(cwd);
      },
      async listProjects() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.listProjects) {
          return {
            status: "unavailable",
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.listProjects();
      },
      async selectProject(cwd) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.selectProject) {
          return {
            ok: false,
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.selectProject(cwd);
      },
      async chooseProject() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.chooseProject) {
          return {
            ok: false,
            projects: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.chooseProject();
      },
      async readTranscript(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.readTranscript) {
          return {
            status: "unavailable",
            runId: request.runId,
            events: [],
            error: "Desktop bridge is not available.",
          };
        }
        return api.readTranscript(request);
      },
      subscribeTranscript(request, callback) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.subscribeTranscript) return () => {};
        return api.subscribeTranscript(request, callback);
      },
      async appendFollowUp(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.appendFollowUp) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.appendFollowUp(request);
      },
      async updateRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.updateRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.updateRun(request);
      },
      async retryRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.retryRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.retryRun(request);
      },
      async rerunRun(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.rerunRun) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.rerunRun(request);
      },
      async controlRun(goalId, runId, command, permissionMode) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.controlRun) {
          return {
            ok: false,
            command,
            action: "none",
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.controlRun(goalId, runId, command, permissionMode);
      },
      async openTerminal(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.openTerminal) {
          return {
            ok: false,
            cwd:
              request?.cwd ?? request?.outputRoot ?? request?.sourceRoot ?? "",
            error: "Desktop bridge is not available.",
          };
        }
        return api.openTerminal(request);
      },
      async openCodexLogin() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.openCodexLogin) {
          return {
            ok: false,
            cwd: "",
            error: "Desktop bridge is not available.",
          };
        }
        return api.openCodexLogin();
      },
      async getRemoteConnectorStatus() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.getRemoteConnectorStatus) {
          return {
            state: "error",
            enabled: false,
            configured: false,
            configPath: "",
            restartCount: 0,
            error: "Desktop bridge is not available.",
          };
        }
        return api.getRemoteConnectorStatus();
      },
      async setRemoteConnectorEnabled(enabled) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.setRemoteConnectorEnabled) {
          return {
            ok: false,
            status: {
              state: "error",
              enabled: false,
              configured: false,
              configPath: "",
              restartCount: 0,
              error: "Desktop bridge is not available.",
            },
            error: "Desktop bridge is not available.",
          };
        }
        return api.setRemoteConnectorEnabled(enabled);
      },
      async pairRemoteConnector(request) {
        const api = window.electronAPI?.codeAgents;
        if (!api?.pairRemoteConnector) {
          return {
            ok: false,
            status: {
              state: "error",
              enabled: false,
              configured: false,
              configPath: "",
              restartCount: 0,
              error: "Desktop bridge is not available.",
            },
            error: "Desktop bridge is not available.",
          };
        }
        return api.pairRemoteConnector(request);
      },
      async connectBuilderProvider() {
        const api = window.electronAPI?.codeAgents;
        if (!api?.connectBuilderProvider) {
          return {
            ok: false,
            message: "Desktop bridge is not available.",
            error: "Desktop bridge is not available.",
          };
        }
        return api.connectBuilderProvider();
      },
    }),
    [],
  );

  return (
    <QueryClientProvider client={codeAgentsQueryClient}>
      <CodeAgentsApp
        apps={apps}
        host={host}
        isActive={isActive}
        openRequest={openRequest}
        refreshKey={refreshKey}
        brandIconUrl={agentNativeIconUrl}
        onOpenSettings={onOpenSettings}
        newSessionExtension={multiFrontierExtension}
        openDetailRequest={multiFrontierOpenDetailRequest}
        renderAppSurface={({ app, urlParams, refreshKey: appRefreshKey }) => (
          <div className="code-agents-embedded-app-surface">
            <AppWebview
              app={toAppDefinition(app)}
              appConfig={app}
              isActive={isActive}
              urlParams={urlParams}
              refreshKey={appRefreshKey}
            />
          </div>
        )}
      />
    </QueryClientProvider>
  );
}

export function MultiFrontierModeControl({
  active,
  permissionMode,
  subscriptions,
  busy,
  modeLocked,
  autoContinueAfterAgreement,
  defaultAutoContinueAfterAgreement,
  onModeChange,
  onConnectSubscription,
  onRefreshSubscription,
  onAutoContinueAfterAgreementChange,
  onDefaultAutoContinueAfterAgreementChange,
}: {
  active: boolean;
  permissionMode: CodeAgentPermissionMode;
  subscriptions: Partial<Record<MultiFrontierProviderId, SubscriptionStatus>>;
  busy: boolean;
  modeLocked: boolean;
  autoContinueAfterAgreement: boolean;
  defaultAutoContinueAfterAgreement: boolean;
  onModeChange: (mode: "plan" | "auto" | "multi-frontier") => void;
  onConnectSubscription: (providerId: MultiFrontierProviderId) => void;
  onRefreshSubscription: (providerId: MultiFrontierProviderId) => void;
  onAutoContinueAfterAgreementChange: (value: boolean) => void;
  onDefaultAutoContinueAfterAgreementChange: (value: boolean) => void;
}) {
  const value = active
    ? "multi-frontier"
    : permissionMode === "read-only"
      ? "plan"
      : "auto";
  return (
    <div className="code-agents-multi-frontier-control">
      <Select
        value={value}
        disabled={busy || modeLocked}
        onValueChange={onModeChange}
      >
        <SelectTrigger
          className="desktop-select-trigger code-agents-mode-select code-agents-multi-frontier-mode-select"
          aria-label="Run mode"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="code-agents-select-content code-agents-mode-menu code-agents-multi-frontier-mode-menu">
          {MULTI_FRONTIER_RUN_MODES.map((mode) => (
            <SelectItem
              key={mode.value}
              className="code-agents-multi-frontier-mode-menu-item"
              value={mode.value}
            >
              <span className="code-agents-multi-frontier-mode-option">
                <span className="code-agents-multi-frontier-mode-option__label">
                  {mode.label}
                </span>
                <span className="code-agents-multi-frontier-mode-option__description">
                  {mode.description}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MultiFrontierParticipantSettings
        statuses={subscriptions}
        busy={busy}
        autoContinueAfterAgreement={autoContinueAfterAgreement}
        defaultAutoContinueAfterAgreement={defaultAutoContinueAfterAgreement}
        onConnect={onConnectSubscription}
        onRefresh={onRefreshSubscription}
        onAutoContinueAfterAgreementChange={onAutoContinueAfterAgreementChange}
        onDefaultAutoContinueAfterAgreementChange={
          onDefaultAutoContinueAfterAgreementChange
        }
      />
    </div>
  );
}
