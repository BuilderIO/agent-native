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
import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";

import AppSettings, { AddAppDialog } from "./components/AppSettings.js";
import CodeAgentsHub from "./components/CodeAgentsHub.js";
import UpdatePrompt from "./components/UpdatePrompt.js";
import WindowControls from "./components/WindowControls.js";

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
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddApp, setShowAddApp] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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
  }>();
  const [pendingDesktopOpenRequest, setPendingDesktopOpenRequest] =
    useState<DesktopOpenRequest | null>(null);
  const [
    pendingDesktopShortcutActivation,
    setPendingDesktopShortcutActivation,
  ] = useState<DesktopShortcutActivationRequest | null>(null);

  useEffect(() => {
    async function load() {
      if (window.electronAPI?.appConfig) {
        setApps(await window.electronAPI.appConfig.load());
      } else {
        setApps(DESKTOP_DEFAULT_APPS);
      }
      setLoading(false);
    }
    void load();
  }, []);

  const visibleEnabledApps = getDesktopVisibleApps(
    apps.filter((app) => app.enabled),
  );

  const handleAppsChanged = useCallback((nextApps: AppConfig[]) => {
    setApps(nextApps);
  }, []);

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

      const updated = app.isBuiltIn
        ? await api.update(appId, { enabled: false })
        : await api.remove(appId);
      setApps(updated);
      setActiveChatFirstAppId((current) => (current === appId ? "" : current));
      setChatFirstPreviewRequest((current) =>
        current?.appId === appId ? undefined : current,
      );
      setChatFirstPreviewStatus((current) =>
        current?.appId === appId ? undefined : current,
      );
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
        return !loading;
      }

      const path = safeDesktopOpenPath(request.path);
      setChatFirstAppOpenRequest({
        appId,
        nonce: Date.now(),
        ...(path ? { path } : {}),
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
      if (
        status.state === "running" &&
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
      <div className="shell-body">
        <div className="content-area content-area--chat-first">
          <div className="code-agents-shell-surface">
            <CodeAgentsHub
              apps={apps}
              isActive
              openRequest={codeAgentsOpenRequest}
              chatFirstAppOpenRequest={chatFirstAppOpenRequest}
              chatFirstPreviewRequest={chatFirstPreviewRequest}
              chatFirstPreviewStatus={chatFirstPreviewStatus?.state}
              chatFirstPreviewStatusMessage={chatFirstPreviewStatus?.message}
              refreshKey={refreshKey}
              onOpenSettings={() => setShowSettings(true)}
              onCreateApp={() => setShowAddApp(true)}
              onChatFirstAppCreated={handleChatFirstAppCreated}
              onChatFirstAppRemove={(app) => {
                void handleAppRemoval(app.id);
              }}
              onChatFirstAppSelectionChange={handleChatFirstAppSelectionChange}
            />
          </div>
        </div>
      </div>

      {showSettings ? (
        <AppSettings
          apps={apps}
          onClose={() => setShowSettings(false)}
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

      <UpdatePrompt />
      <Toaster
        className="shell-snackbar-toaster"
        theme="system"
        position="bottom-center"
        offset={20}
        closeButton
        visibleToasts={1}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: "shell-snackbar",
            title: "shell-snackbar-title",
          },
        }}
      />
    </div>
  );
}
