import { Toaster as ToastToaster } from "@agent-native/toolkit/ui/toaster";
import {
  DESKTOP_DEFAULT_APPS,
  getDesktopVisibleApps,
  isDesktopAppVisible,
  type AppConfig,
} from "@shared/app-registry";
import {
  CODE_AGENTS_SURFACE_ID,
  MIGRATION_APP_ID,
  getCodeAgentGoal,
} from "@shared/code-agents";
import { isDesktopSettingsShortcut } from "@shared/desktop-shortcuts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";

import type {
  DesktopPrepareLocalCodeChangeResult,
  DesktopIdentityStatus,
  DesktopWorkspaceAppListResult,
} from "../../shared/ipc-channels.js";
import AppSettings, { AddAppDialog } from "./components/AppSettings.js";
import {
  rememberDesktopEnvironmentLane,
  rememberDesktopIdentityStatus,
} from "./components/AppWebview.js";
import CodeAgentsHub from "./components/CodeAgentsHub.js";
import DesktopIdentityGate from "./components/DesktopIdentityGate.js";
import WindowControls, {
  CollapsedMacWindowControls,
} from "./components/WindowControls.js";

function safeDesktopOpenPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  if (trimmed.startsWith("/\\")) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  return trimmed;
}

export default function App() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [workspaceAppList, setWorkspaceAppList] =
    useState<DesktopWorkspaceAppListResult>();
  const [loading, setLoading] = useState(true);
  const [desktopIdentityStatus, setDesktopIdentityStatus] = useState<
    DesktopIdentityStatus | "checking"
  >(() => (window.electronAPI?.identity ? "checking" : "idle"));
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [showAddApp, setShowAddApp] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const runtimeStatusByAppRef = useRef(
    new Map<string, DesktopAppRuntimeStatus["state"]>(),
  );
  const [activeChatFirstAppId, setActiveChatFirstAppId] = useState("");
  const [codeAgentsOpenRequest, setCodeAgentsOpenRequest] = useState<{
    goalId?: string;
    runId?: string;
    nonce: number;
  }>();
  const [chatFirstPreviewRequest, setChatFirstPreviewRequest] = useState<{
    appId: string;
    nonce: number;
  }>();
  const [chatFirstPreviewStatus, setChatFirstPreviewStatus] = useState<{
    appId: string;
    state: "starting" | "ready" | "error";
    message?: string;
  }>();
  const [chatFirstAppOpenRequest, setChatFirstAppOpenRequest] = useState<{
    appId: string;
    path?: string;
    nonce: number;
    focusNonce?: number;
  }>();
  const [pendingDesktopOpenRequest, setPendingDesktopOpenRequest] =
    useState<DesktopOpenRequest | null>(null);
  const [
    pendingDesktopShortcutActivation,
    setPendingDesktopShortcutActivation,
  ] = useState<DesktopShortcutActivationRequest | null>(null);

  const refreshWorkspaceAppList = useCallback(async () => {
    const loader = window.electronAPI?.appConfig
      ? () => window.electronAPI!.appConfig!.loadWorkspace!()
      : undefined;
    if (!loader) {
      setWorkspaceAppList(undefined);
      return;
    }
    try {
      const result = await loader();
      if (!result.unavailable) setWorkspaceAppList(result);
    } catch (error) {
      // Keep the last usable inventory visible when a refresh is transiently
      // unavailable. The main process applies the same rule to deep-link
      // resolution.
      console.debug("[desktop] workspace app inventory refresh unavailable", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }, []);

  // The lane depends on the verified email, so it is only known once identity
  // has resolved. A change has to remount webviews — they are already pointed
  // at the previous origin.
  const refreshEnvironmentLane = useCallback(async () => {
    const getLane = window.electronAPI?.identity
      ? () => window.electronAPI!.identity!.getEnvironmentLane()
      : undefined;
    if (!getLane) return;
    try {
      const state = await getLane();
      if (rememberDesktopEnvironmentLane(state.lane)) {
        setRefreshKey((current) => current + 1);
      }
    } catch (error) {
      // coercion-ok: the lane keeps its last known value, which is the same
      // origin every webview is already pointed at. A failed read must not
      // move a signed-in user between lanes.
      console.debug("[desktop-environment] lane read failed", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  }, []);

  useEffect(() => {
    async function load() {
      const loaded = window.electronAPI?.appConfig
        ? await window.electronAPI.appConfig.load()
        : DESKTOP_DEFAULT_APPS;
      // Resolve the lane before clearing the loading state: mounting first
      // would load production and then remount onto beta, which is the extra
      // document and session load this is meant to remove.
      await refreshEnvironmentLane();
      setApps(loaded);
      setLoading(false);
    }
    void load();
  }, [refreshEnvironmentLane]);

  useEffect(() => {
    void refreshWorkspaceAppList();
    const identity = window.electronAPI?.identity;
    if (!identity) {
      setDesktopIdentityStatus("idle");
      return;
    }
    let mounted = true;
    const handleStatusChange = (status: DesktopIdentityStatus) => {
      if (!mounted) return;
      setDesktopIdentityStatus(status);
      // App is the shell-level subscriber, so sign-out invalidates the
      // renderer cache even while every individual app webview is inactive.
      rememberDesktopIdentityStatus(status);
      void refreshWorkspaceAppList();
      void refreshEnvironmentLane();
    };
    const unsubscribe = identity.onStatusChange(handleStatusChange);
    void identity
      .getStatus()
      .then(handleStatusChange)
      .catch(() => {
        if (mounted) setDesktopIdentityStatus("failed");
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refreshWorkspaceAppList, refreshEnvironmentLane]);

  const visibleEnabledApps = getDesktopVisibleApps(
    apps.filter((app) => app.enabled),
  );

  const handleAppsChanged = useCallback((nextApps: AppConfig[]) => {
    setApps(nextApps);
  }, []);

  const handleOpenSettings = useCallback((tab?: string) => {
    setSettingsTab(tab ?? "general");
    setShowSettings(true);
  }, []);

  useEffect(() => {
    const onKeydown = window.electronAPI?.shortcuts
      ? (
          callback: Parameters<
            typeof window.electronAPI.shortcuts.onKeydown
          >[0],
        ) => window.electronAPI!.shortcuts!.onKeydown(callback)
      : undefined;
    if (!onKeydown) return;
    return onKeydown((input) => {
      if (
        !isDesktopSettingsShortcut({
          key: input.key,
          code: input.code,
          shift: input.shiftKey,
          alt: input.altKey,
        })
      ) {
        return;
      }
      handleOpenSettings();
    });
  }, [handleOpenSettings]);

  const handleChatFirstAppSelectionChange = useCallback((appId?: string) => {
    setActiveChatFirstAppId(appId ?? "");
    if (appId) window.electronAPI?.setActiveApp?.(appId);
  }, []);

  const handleChatFirstAppCreated = useCallback(
    (result: DesktopCreateAppResult) => {
      if (!result.app) return;
      setApps(result.apps);
      setChatFirstPreviewRequest({ appId: result.app.id, nonce: Date.now() });
      setChatFirstPreviewStatus({
        appId: result.app.id,
        state: "starting",
        message: "The coding agent is preparing the local preview.",
      });
      setRefreshKey((current) => current + 1);
      setShowSettings(false);
      setShowAddApp(false);
      if (result.run) {
        setCodeAgentsOpenRequest({
          goalId: result.run.goalId,
          runId: result.run.id,
          nonce: Date.now(),
        });
      }
      toast(`Building ${result.app.name}`, {
        description: "New chat started. Preview opens on the right.",
        duration: 5000,
      });
    },
    [],
  );

  const handleLocalCodeChangeStarted = useCallback(
    (result: DesktopPrepareLocalCodeChangeResult) => {
      if (!result.app) return;
      setApps(result.apps);
      setRefreshKey((current) => current + 1);
      toast(`Preparing ${result.app.name} locally`, {
        description:
          "The production app stays unchanged. Desktop will open the local preview when it is ready.",
        duration: 5000,
      });
    },
    [],
  );

  const handleAddApp = useCallback(async (app: AppConfig) => {
    if (window.electronAPI?.appConfig) {
      setApps(await window.electronAPI.appConfig.add(app));
    } else {
      setApps((current) => [...current, app]);
    }
    setShowAddApp(false);
  }, []);

  const handlePromptAppCreated = useCallback(
    (result: DesktopCreateAppResult) => {
      handleChatFirstAppCreated(result);
    },
    [handleChatFirstAppCreated],
  );

  const handleAppRemoval = useCallback(
    async (appId: string) => {
      const api = window.electronAPI?.appConfig;
      const app = apps.find((candidate) => candidate.id === appId);
      if (!api || !app) return;

      try {
        const updated = app.isBuiltIn
          ? await api.update(appId, { enabled: false })
          : await api.remove(appId);
        setApps(updated);
        setActiveChatFirstAppId((current) =>
          current === appId ? "" : current,
        );
        setChatFirstPreviewRequest((current) =>
          current?.appId === appId ? undefined : current,
        );
        setChatFirstPreviewStatus((current) =>
          current?.appId === appId ? undefined : current,
        );
      } catch {
        // The main process failed to persist the change (e.g. userData is
        // unwritable), so local state must stay untouched and the failure
        // must be visible instead of leaving a silently-reverted rail.
        toast.error(`Couldn't remove ${app.name}`, {
          description: "Please try again.",
        });
      }
    },
    [apps],
  );

  const handleDesktopOpenRequest = useCallback(
    (request: DesktopOpenRequest): boolean => {
      const goal = getCodeAgentGoal(request.goalId);
      if (
        goal ||
        request.app === MIGRATION_APP_ID ||
        request.app === CODE_AGENTS_SURFACE_ID
      ) {
        setCodeAgentsOpenRequest({
          goalId:
            goal?.id ??
            (request.app === MIGRATION_APP_ID ? "migrate" : undefined),
          runId: request.runId,
          nonce: Date.now(),
        });
        setShowSettings(false);
        setShowAddApp(false);
        return true;
      }

      const appId = request.app?.trim();
      if (!appId) return true;
      const targetApp = visibleEnabledApps.find((app) => app.id === appId);
      if (!targetApp) {
        const configuredApp = apps.find((app) => app.id === appId);
        if (configuredApp && !isDesktopAppVisible(configuredApp)) return false;
        return false;
      }

      const path = safeDesktopOpenPath(request.path);
      const nonce = Date.now();
      setChatFirstAppOpenRequest({
        appId,
        nonce,
        ...(path ? { path } : {}),
        ...("requestId" in request ? { focusNonce: nonce } : {}),
      });
      setShowSettings(false);
      setShowAddApp(false);
      return true;
    },
    [apps, loading, visibleEnabledApps],
  );

  useEffect(() => {
    const bridge = {
      getActiveAppId: () => activeChatFirstAppId || CODE_AGENTS_SURFACE_ID,
      activate: (
        request: DesktopShortcutActivationRequest,
      ): DesktopShortcutActivationResult => {
        const handled = handleDesktopOpenRequest(request);
        const appId = handled ? request.app : undefined;
        if (appId) window.electronAPI?.setActiveApp?.(appId);
        return {
          handled,
          appId,
          activeAppId:
            (appId ?? activeChatFirstAppId) || CODE_AGENTS_SURFACE_ID,
        };
      },
    };
    window.__agentNativeDesktopShortcutBridge = bridge;
    return () => {
      if (window.__agentNativeDesktopShortcutBridge === bridge) {
        delete window.__agentNativeDesktopShortcutBridge;
      }
    };
  }, [activeChatFirstAppId, handleDesktopOpenRequest]);

  useEffect(() => {
    window.electronAPI?.setActiveApp?.(
      activeChatFirstAppId || CODE_AGENTS_SURFACE_ID,
    );
  }, [activeChatFirstAppId]);

  useEffect(() => {
    if (!window.electronAPI?.codeAgents?.onOpenRequest) return;
    return window.electronAPI.codeAgents.onOpenRequest((request) => {
      setPendingDesktopOpenRequest(request);
    });
  }, []);

  useEffect(() => {
    const shortcutApi = window.electronAPI?.shortcuts;
    if (!shortcutApi?.onActivate) return;
    return shortcutApi.onActivate((request) => {
      setPendingDesktopShortcutActivation(request);
    });
  }, []);

  useEffect(() => {
    if (!pendingDesktopOpenRequest) return;
    if (handleDesktopOpenRequest(pendingDesktopOpenRequest)) {
      setPendingDesktopOpenRequest(null);
    }
  }, [handleDesktopOpenRequest, pendingDesktopOpenRequest]);

  useEffect(() => {
    if (!pendingDesktopShortcutActivation) return;
    const handled = handleDesktopOpenRequest(pendingDesktopShortcutActivation);
    if (!handled) return;
    const appId = pendingDesktopShortcutActivation.app;
    if (appId) window.electronAPI?.setActiveApp?.(appId);
    window.electronAPI?.shortcuts?.ackActivation(
      pendingDesktopShortcutActivation.requestId,
      appId,
    );
    setPendingDesktopShortcutActivation(null);
  }, [handleDesktopOpenRequest, pendingDesktopShortcutActivation]);

  useEffect(() => {
    const appConfigApi = window.electronAPI?.appConfig;
    if (!appConfigApi?.onRuntimeStatus) return;
    return appConfigApi.onRuntimeStatus((status) => {
      const isPreview = status.appId === chatFirstPreviewRequest?.appId;
      const previousState = runtimeStatusByAppRef.current.get(status.appId);
      runtimeStatusByAppRef.current.set(status.appId, status.state);
      if (
        status.state === "running" &&
        previousState !== "running" &&
        (status.appId === activeChatFirstAppId || isPreview)
      ) {
        setRefreshKey((key) => key + 1);
      }
      if (!isPreview) return;
      if (status.state === "waiting" || status.state === "starting") {
        setChatFirstPreviewStatus({
          appId: status.appId,
          state: "starting",
          ...(status.message ? { message: status.message } : {}),
        });
        return;
      }
      if (status.state === "running") {
        setChatFirstPreviewStatus({
          appId: status.appId,
          state: "ready",
          ...(status.message ? { message: status.message } : {}),
        });
        return;
      }
      setChatFirstPreviewStatus({
        appId: status.appId,
        state: "error",
        message:
          status.message ?? "The local preview stopped before it was ready.",
      });
    });
  }, [activeChatFirstAppId, chatFirstPreviewRequest?.appId]);

  if (loading) {
    return (
      <div
        className="shell"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <p style={{ color: "#666" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <WindowControls className="win-controls desktop-chat-first-window-controls" />
      {window.electronAPI?.platform === "darwin" ? (
        <CollapsedMacWindowControls className="desktop-chat-first-mac-window-controls" />
      ) : null}
      <div className="shell-body">
        <div className="content-area content-area--chat-first">
          <div className="code-agents-shell-surface">
            <CodeAgentsHub
              apps={apps}
              workspaceAppList={workspaceAppList}
              isActive
              openRequest={codeAgentsOpenRequest}
              chatFirstAppOpenRequest={chatFirstAppOpenRequest}
              chatFirstPreviewRequest={chatFirstPreviewRequest}
              chatFirstPreviewStatus={chatFirstPreviewStatus?.state}
              chatFirstPreviewStatusMessage={chatFirstPreviewStatus?.message}
              refreshKey={refreshKey}
              onOpenSettings={handleOpenSettings}
              onCreateApp={() => setShowAddApp(true)}
              onChatFirstAppCreated={handleChatFirstAppCreated}
              onLocalCodeChangeStarted={handleLocalCodeChangeStarted}
              onChatFirstAppRemove={(app) => {
                void handleAppRemoval(app.id);
              }}
              onChatFirstAppSelectionChange={handleChatFirstAppSelectionChange}
              onDesktopIdentityStatusChange={(status) => {
                if (status === "failed" || status === "sign-in-required") {
                  setDesktopIdentityStatus(status);
                }
              }}
            />
          </div>
        </div>
        <DesktopIdentityGate
          appName="Agent-Native Desktop"
          status={desktopIdentityStatus}
          onSignIn={() => window.electronAPI?.identity?.signIn() ?? false}
          onAuthenticate={(request) =>
            window.electronAPI?.identity?.authenticate(request) ??
            Promise.resolve({
              ok: false,
              error: "The desktop identity surface is unavailable.",
            })
          }
          onMagicLink={(request) =>
            window.electronAPI?.identity?.requestMagicLink(request) ??
            Promise.resolve({
              ok: false,
              error: "The desktop identity surface is unavailable.",
            })
          }
        />
      </div>

      {showSettings ? (
        <AppSettings
          key={settingsTab}
          apps={apps}
          initialTab={settingsTab}
          onClose={() => {
            setShowSettings(false);
            setSettingsTab("general");
          }}
          onAppsChanged={handleAppsChanged}
          onCodeAgentProvidersChanged={() => setRefreshKey((n) => n + 1)}
          onAddAppClick={() => {
            setShowSettings(false);
            setShowAddApp(true);
          }}
        />
      ) : null}

      {showAddApp ? (
        <AddAppDialog
          onSave={handleAddApp}
          onCreated={handlePromptAppCreated}
          onCancel={() => setShowAddApp(false)}
        />
      ) : null}

      <Toaster
        theme="system"
        position="bottom-center"
        offset={20}
        closeButton
        visibleToasts={1}
      />
      <ToastToaster />
    </div>
  );
}
