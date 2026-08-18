import { ConnectionsTab } from "@agent-native/core/client/agent-chat";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import {
  McpServersApiProvider,
  type McpServersApi,
} from "@agent-native/core/client/resources";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSurfaceProvider,
  SettingsTabsPage,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { Switch } from "@agent-native/toolkit/ui/switch";
import {
  getDesktopVisibleApps,
  generateAppId,
  getDesktopTemplateGatewayAppUrl,
  isDefaultDesktopTemplateDevTarget,
  type AppConfig,
} from "@shared/app-registry";
import {
  formatDesktopShortcutAccelerator,
  normalizeDesktopShortcutAccelerator,
  type DesktopShortcutBehavior,
  type DesktopShortcutBinding,
  type DesktopShortcutRegistration,
  type DesktopShortcutSettings,
  type DesktopShortcutUpsertRequest,
} from "@shared/desktop-shortcuts";
import type { DesktopIdentityStatus, UpdateStatus } from "@shared/ipc-channels";
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconKeyboard,
  IconLoader2,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRotate,
  IconTerminal2,
  IconTrash,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  DESKTOP_TERMINAL_AGENT_OPTIONS,
  useDesktopTerminalPreferences,
  writeDesktopTerminalPreferences,
} from "../lib/desktop-terminal-preferences.js";
import { CodeProviderSettings } from "./CodeProviderSettings";
import { useUpdateStatus } from "./UpdateIndicator.js";

const desktopSettingsQueryClient = createAgentNativeQueryClient();

interface AppSettingsProps {
  apps: AppConfig[];
  onClose: () => void;
  initialTab?: string;
  onAppsChanged: (apps: AppConfig[]) => void;
  onAddAppClick?: () => void;
  onCodeAgentProvidersChanged?: () => void;
}

type WorkspaceSsoAppConfig = AppConfig & {
  /** Explicit opt-in for a non-built-in app that implements Agent Native SSO. */
  workspaceSso?: boolean;
};

type RemoteStatusTone = "ok" | "pending" | "offline" | "error";
type UpdateStatusTone = "ok" | "pending" | "ready" | "offline" | "error";

function inferPortFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    if (parsed.protocol === "http:") return 80;
    if (parsed.protocol === "https:") return 443;
  } catch {
    // URL input validation handles invalid values.
  }
  return 0;
}

function appUrlForRemotePairing(app: AppConfig): string {
  if ((app.mode ?? "prod") === "dev") {
    return (
      effectiveDevUrlForDisplay(app) ||
      (app.devPort ? `http://localhost:${app.devPort}` : "")
    );
  }
  return app.url || app.devUrl || "";
}

function effectiveDevUrlForDisplay(app: AppConfig): string {
  if (isDefaultDesktopTemplateDevTarget(app)) {
    return getDesktopTemplateGatewayAppUrl(app.id) || app.devUrl || "";
  }
  return app.devUrl || "";
}

function defaultRemoteRelayUrl(apps: AppConfig[]): string {
  const app =
    apps.find((item) => item.id === "dispatch" && Boolean(item.url)) ??
    apps.find((item) => Boolean(item.url)) ??
    apps.find((item) => Boolean(item.devUrl || item.devPort)) ??
    apps[0];
  return app ? appUrlForRemotePairing(app) : "";
}

function hostForDisplay(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function remoteStatusCopy(status: CodeAgentRemoteConnectorStatus | null): {
  label: string;
  description: string;
  tone: RemoteStatusTone;
} {
  if (!status) {
    return {
      label: "Checking",
      description: "Reading Portal host status.",
      tone: "pending",
    };
  }
  if (!status.configured) {
    return {
      label: "Offline",
      description: "Pair this computer with the Portal relay.",
      tone: "offline",
    };
  }
  if (!status.enabled) {
    return {
      label: "Off",
      description: "Portal requests are paused on this computer.",
      tone: "offline",
    };
  }
  if (status.state === "error") {
    return {
      label: "Error",
      description: status.error ?? "Portal host needs attention.",
      tone: "error",
    };
  }
  if (status.state === "running") {
    return {
      label: "Polling",
      description: `Connected to ${hostForDisplay(status.relayUrl)}.`,
      tone: "ok",
    };
  }
  if (status.state === "starting") {
    return {
      label: "Connecting",
      description: status.nextRestartAt
        ? "Waiting to retry the remote connector."
        : "Starting Portal host.",
      tone: "pending",
    };
  }
  return {
    label: "Offline",
    description: "Portal host is not currently polling.",
    tone: "offline",
  };
}

function updateStatusCopy(status: UpdateStatus | null): {
  label: string;
  description: string;
  tone: UpdateStatusTone;
} {
  if (!status) {
    return {
      label: "Checking",
      description: "Reading software update status.",
      tone: "pending",
    };
  }

  if (status.state === "unsupported") {
    return {
      label: "Unavailable",
      description: status.reason,
      tone: "offline",
    };
  }

  if (status.state === "checking") {
    return {
      label: "Checking",
      description: "Looking for the newest Agent Native release.",
      tone: "pending",
    };
  }

  if (status.state === "available") {
    return {
      label: "Downloading",
      description: `Version ${status.version} is available and will install after download.`,
      tone: "pending",
    };
  }

  if (status.state === "downloading") {
    return {
      label: "Downloading",
      description: `Update download is ${status.percent}% complete.`,
      tone: "pending",
    };
  }

  if (status.state === "downloaded") {
    return {
      label: "Ready",
      description: `Version ${status.version} is downloaded. Relaunch to install it.`,
      tone: "ready",
    };
  }

  if (status.state === "not-available") {
    return {
      label: "Up to date",
      description: `Agent Native ${status.currentVersion} is the latest available version.`,
      tone: "ok",
    };
  }

  if (status.state === "error") {
    return {
      label: "Needs retry",
      description: status.message,
      tone: "error",
    };
  }

  return {
    label: "Automatic",
    description: "Agent Native checks for updates in the background.",
    tone: "ok",
  };
}

interface ShortcutDraft {
  id?: string;
  accelerator: string;
  app: string;
  view: string;
  behavior: DesktopShortcutBehavior;
  enabled: boolean;
}

function defaultShortcutDraft(apps: AppConfig[]): ShortcutDraft {
  const firstEnabledApp = apps.find((app) => app.enabled !== false) ?? null;
  return {
    accelerator: "",
    app: firstEnabledApp?.id ?? "",
    view: "",
    behavior: "toggle",
    enabled: true,
  };
}

function shortcutDraftFromBinding(
  binding: DesktopShortcutBinding,
): ShortcutDraft {
  return {
    id: binding.id,
    accelerator: binding.accelerator,
    app: binding.app,
    view: binding.view ?? "",
    behavior: binding.behavior,
    enabled: binding.enabled,
  };
}

function shortcutRequestFromDraft(
  draft: ShortcutDraft,
): DesktopShortcutUpsertRequest {
  return {
    id: draft.id,
    accelerator: draft.accelerator,
    app: draft.app,
    view: draft.view.trim() || undefined,
    behavior: draft.behavior,
    enabled: draft.enabled,
  };
}

function shortcutKeyFromEvent(event: ReactKeyboardEvent): {
  accelerator?: string;
  error?: string;
} {
  const modifierKeys = new Set(["Alt", "Control", "Meta", "Shift"]);
  if (modifierKeys.has(event.key)) return {};

  const parts: string[] = [];
  if (event.metaKey) parts.push("Command");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  if (!parts.length) return { error: "Use at least one modifier plus a key." };

  const key = event.key === " " ? "Space" : event.key;
  return normalizeDesktopShortcutAccelerator([...parts, key].join("+"));
}

function ShortcutRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="settings-shortcut-recorder-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={`settings-shortcut-recorder${recording ? " settings-shortcut-recorder--recording" : ""}`}
        onClick={() => {
          setError(null);
          setRecording(true);
          requestAnimationFrame(() => buttonRef.current?.focus());
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            setRecording(false);
            setError(null);
            return;
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            onChange("");
            setRecording(false);
            setError(null);
            return;
          }
          const next = shortcutKeyFromEvent(event);
          if (!next.accelerator) {
            if (next.error) setError(next.error);
            return;
          }
          onChange(next.accelerator);
          setError(null);
          setRecording(false);
        }}
        onKeyUp={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <IconKeyboard size={14} />
        <span>
          {recording
            ? "Press shortcut"
            : value
              ? formatDesktopShortcutAccelerator(
                  value,
                  window.electronAPI?.platform,
                )
              : "Record shortcut"}
        </span>
      </button>
      {error && <span className="settings-shortcut-error">{error}</span>}
    </div>
  );
}

function SoftwareUpdateCard() {
  const status = useUpdateStatus();
  const copy = updateStatusCopy(status);
  const [working, setWorking] = useState<"check" | "download" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const updater = window.electronAPI?.updater;
  const isBusy =
    working !== null ||
    status?.state === "checking" ||
    status?.state === "downloading" ||
    status?.state === "available";
  const canCheck =
    Boolean(updater) &&
    !isBusy &&
    status?.state !== "downloaded" &&
    status?.state !== "unsupported";
  const canDownload = Boolean(updater) && status?.state === "available";
  const canInstall = Boolean(updater) && status?.state === "downloaded";

  const handleCheck = useCallback(async () => {
    if (!updater || !canCheck) return;
    setWorking("check");
    setMessage(null);
    try {
      await updater.check();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }, [canCheck, updater]);

  const handleDownload = useCallback(async () => {
    if (!updater || !canDownload) return;
    setWorking("download");
    setMessage(null);
    try {
      await updater.download();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }, [canDownload, updater]);

  const handleInstall = useCallback(() => {
    if (!updater || !canInstall) return;
    updater.install();
  }, [canInstall, updater]);

  return (
    <SettingsRow
      label="Software updates"
      description={copy.description}
      status={
        <span className="text-xs text-muted-foreground">{copy.label}</span>
      }
      control={
        canInstall ? (
          <button
            type="button"
            className="settings-btn settings-btn--primary settings-update-btn"
            onClick={handleInstall}
          >
            <IconRefresh size={14} />
            Restart to update
          </button>
        ) : canDownload ? (
          <button
            type="button"
            className="settings-btn settings-btn--primary settings-update-btn"
            onClick={handleDownload}
            disabled={working === "download"}
          >
            {working === "download" ? (
              <IconLoader2 size={14} className="settings-update-spin" />
            ) : (
              <IconDownload size={14} />
            )}
            Download
          </button>
        ) : (
          <button
            type="button"
            className="settings-btn settings-btn--ghost settings-update-btn"
            onClick={handleCheck}
            disabled={!canCheck}
          >
            {working === "check" || status?.state === "checking" ? (
              <IconLoader2 size={14} className="settings-update-spin" />
            ) : (
              <IconRefresh size={14} />
            )}
            Check
          </button>
        )
      }
    >
      {status?.state === "downloading" && (
        <div className="settings-update-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, status.percent)}%` }} />
        </div>
      )}
      {message && <div className="settings-update-message">{message}</div>}
    </SettingsRow>
  );
}

export default function AppSettings({
  apps,
  onClose,
  initialTab,
  onAppsChanged,
  onAddAppClick,
  onCodeAgentProvidersChanged,
}: AppSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [identityStatus, setIdentityStatus] =
    useState<DesktopIdentityStatus>("idle");
  const [desktopSsoEnabled, setDesktopSsoEnabled] = useState(false);
  const [remoteStatus, setRemoteStatus] =
    useState<CodeAgentRemoteConnectorStatus | null>(null);
  const [remotePairUrl, setRemotePairUrl] = useState("");
  const [remoteWorkspacePath, setRemoteWorkspacePath] = useState("");
  const [remotePairing, setRemotePairing] = useState(false);
  const [showRemotePairing, setShowRemotePairing] = useState(false);
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [providerSettings, setProviderSettings] =
    useState<CodeAgentProviderSettings | null>(null);
  const [providerLoadMessage, setProviderLoadMessage] = useState<string | null>(
    null,
  );
  const [pluginImportMessage, setPluginImportMessage] = useState<string | null>(
    null,
  );
  const [pluginImporting, setPluginImporting] = useState(false);
  const [shortcutSettings, setShortcutSettings] =
    useState<DesktopShortcutSettings | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft>(() =>
    defaultShortcutDraft(getDesktopVisibleApps(apps)),
  );
  const [shortcutMessage, setShortcutMessage] = useState<string | null>(null);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const terminalPreferences = useDesktopTerminalPreferences();
  const closingTimerRef = useRef<number | null>(null);
  const visibleApps = useMemo(() => getDesktopVisibleApps(apps), [apps]);
  const shortcutTargetApps = useMemo(
    () => visibleApps.filter((app) => app.enabled !== false),
    [visibleApps],
  );
  const visibleShortcutBindings = useMemo(
    () =>
      (shortcutSettings?.bindings ?? []).filter((binding) =>
        visibleApps.some((app) => app.id === binding.app),
      ),
    [shortcutSettings, visibleApps],
  );

  useEffect(
    () => () => {
      if (closingTimerRef.current !== null) {
        window.clearTimeout(closingTimerRef.current);
      }
    },
    [],
  );

  const requestClose = useCallback(
    (afterClose: () => void = onClose) => {
      if (isClosing) return;
      setIsClosing(true);

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        afterClose();
        return;
      }

      closingTimerRef.current = window.setTimeout(afterClose, 160);
    },
    [isClosing, onClose],
  );

  useEffect(() => {
    const identity = window.electronAPI?.identity;
    if (!identity) return;
    let active = true;
    void identity.getSettings().then((settings) => {
      if (active) setDesktopSsoEnabled(settings.ssoEnabled);
    });
    void identity.getStatus().then((status) => {
      if (active) setIdentityStatus(status);
    });
    const unsubscribe = identity.onStatusChange((status) => {
      if (active) setIdentityStatus(status);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const handleDesktopSsoToggle = useCallback(async (enabled: boolean) => {
    const identity = window.electronAPI?.identity;
    if (!identity) return;
    const saved = await identity.setSsoEnabled(enabled);
    if (!saved) return;
    setDesktopSsoEnabled(enabled);
    if (!enabled) {
      setIdentityStatus("idle");
      return;
    }
    setIdentityStatus(await identity.getStatus());
  }, []);

  const handleWorkspaceSignOut = useCallback(async () => {
    const signedOut = await window.electronAPI?.identity?.signOut();
    if (signedOut) setIdentityStatus("sign-in-required");
  }, []);

  const handleWorkspaceSignIn = useCallback(async () => {
    await window.electronAPI?.identity?.signIn();
  }, []);

  const refreshProviderSettings = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api?.getProviderSettings) return;
    try {
      const settings = await api.getProviderSettings();
      setProviderSettings(settings);
      setProviderLoadMessage(null);
    } catch (err) {
      setProviderLoadMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshProviderSettings();
  }, [refreshProviderSettings]);

  const refreshShortcutSettings = useCallback(async () => {
    const api = window.electronAPI?.shortcuts;
    if (!api?.loadBindings) return;
    try {
      const settings = await api.loadBindings();
      setShortcutSettings(settings);
      setShortcutMessage(null);
    } catch (err) {
      setShortcutMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshShortcutSettings();
  }, [refreshShortcutSettings]);

  useEffect(() => {
    setShortcutDraft((current) => {
      if (
        current.app &&
        visibleApps.some(
          (app) => app.id === current.app && app.enabled !== false,
        )
      ) {
        return current;
      }
      return { ...current, app: defaultShortcutDraft(visibleApps).app };
    });
  }, [visibleApps]);

  const refreshRemoteStatus = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api?.getRemoteConnectorStatus) return;
    try {
      const status = await api.getRemoteConnectorStatus();
      setRemoteStatus(status);
      setRemoteMessage(null);
      setRemotePairUrl(
        (current) => current || status.relayUrl || defaultRemoteRelayUrl(apps),
      );
      setRemoteWorkspacePath(
        (current) => current || status.workspacePath || "",
      );
      if (!status.configured) setShowRemotePairing(true);
    } catch (err) {
      setRemoteMessage(err instanceof Error ? err.message : String(err));
    }
  }, [apps]);

  useEffect(() => {
    void refreshRemoteStatus();
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      void refreshRemoteStatus().finally(() => {
        inFlight = false;
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshRemoteStatus]);

  const desktopMcpApi = useMemo<McpServersApi | null>(() => {
    const api = window.electronAPI?.mcpServers;
    if (!api) return null;
    return {
      list: api.list,
      create: api.create,
      delete: api.delete,
      reconnect: api.reconnect,
      test: api.test,
      testExisting: api.testExisting,
    };
  }, []);

  const handlePluginImport = useCallback(async () => {
    const api = window.electronAPI?.mcpServers;
    if (!api?.importPlugin || pluginImporting) return;
    setPluginImporting(true);
    setPluginImportMessage(null);
    try {
      const result = await api.importPlugin();
      if (!result.ok) {
        if (result.error !== "Import cancelled.") {
          setPluginImportMessage(result.error ?? "Plugin import failed.");
        }
        return;
      }
      setPluginImportMessage(
        `Imported ${result.plugin?.name ?? "plugin"}: ${result.skills ?? 0} skill${result.skills === 1 ? "" : "s"}, ${result.mcpServers ?? 0} MCP server${result.mcpServers === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setPluginImportMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setPluginImporting(false);
    }
  }, [pluginImporting]);

  const handleRemoteToggle = useCallback(async (enabled: boolean) => {
    const api = window.electronAPI?.codeAgents;
    if (!api?.setRemoteConnectorEnabled) return;
    const result = await api.setRemoteConnectorEnabled(enabled);
    setRemoteStatus(result.status);
    setRemoteMessage(result.error ?? null);
  }, []);

  const handleRemotePair = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api?.pairRemoteConnector || !remotePairUrl.trim()) return;
    setRemotePairing(true);
    setRemoteMessage(null);
    try {
      const result = await api.pairRemoteConnector({
        relayUrl: remotePairUrl.trim(),
        label: "Agent Native Desktop",
        workspacePath: remoteWorkspacePath.trim() || undefined,
      });
      setRemoteStatus(result.status);
      setRemoteMessage(result.error ?? result.message ?? null);
      if (result.ok) setShowRemotePairing(false);
    } catch (err) {
      setRemoteMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRemotePairing(false);
    }
  }, [remotePairUrl, remoteWorkspacePath]);

  const shortcutRegistrations = useMemo(() => {
    const map = new Map<string, DesktopShortcutRegistration>();
    for (const registration of shortcutSettings?.registrations ?? []) {
      map.set(registration.id, registration);
    }
    return map;
  }, [shortcutSettings]);

  const handleShortcutSave = useCallback(async () => {
    const api = window.electronAPI?.shortcuts;
    if (!api?.upsertBinding) return;
    setShortcutSaving(true);
    setShortcutMessage(null);
    try {
      const result = await api.upsertBinding(
        shortcutRequestFromDraft(shortcutDraft),
      );
      setShortcutSettings(result.settings);
      if (result.ok) {
        setShortcutDraft(defaultShortcutDraft(visibleApps));
      }
      setShortcutMessage(result.error ?? null);
    } catch (err) {
      setShortcutMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setShortcutSaving(false);
    }
  }, [shortcutDraft, visibleApps]);

  const handleShortcutRemove = useCallback(async (id: string) => {
    const api = window.electronAPI?.shortcuts;
    if (!api?.removeBinding) return;
    const result = await api.removeBinding(id);
    setShortcutSettings(result.settings);
    setShortcutMessage(result.error ?? null);
  }, []);

  const handleShortcutToggle = useCallback(
    async (binding: DesktopShortcutBinding, enabled: boolean) => {
      const api = window.electronAPI?.shortcuts;
      if (!api?.upsertBinding) return;
      const result = await api.upsertBinding({ ...binding, enabled });
      setShortcutSettings(result.settings);
      setShortcutMessage(result.error ?? null);
    },
    [],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (window.electronAPI?.appConfig) {
        const updated = await window.electronAPI.appConfig.update(id, {
          enabled,
        });
        onAppsChanged(updated);
      }
    },
    [onAppsChanged],
  );

  const handleModeToggle = useCallback(
    async (id: string, mode: "dev" | "prod") => {
      if (window.electronAPI?.appConfig) {
        const updated = await window.electronAPI.appConfig.update(id, {
          mode,
        });
        onAppsChanged(updated);
      }
    },
    [onAppsChanged],
  );

  const handleAllToMode = useCallback(
    async (mode: "dev" | "prod") => {
      if (!window.electronAPI?.appConfig) return;
      let latest = apps;
      for (const app of visibleApps) {
        if ((app.mode ?? "prod") !== mode) {
          latest = await window.electronAPI.appConfig.update(app.id, { mode });
        }
      }
      onAppsChanged(latest);
    },
    [apps, onAppsChanged, visibleApps],
  );

  const allMode: "dev" | "prod" | null = (() => {
    const modes = new Set<"dev" | "prod">(
      visibleApps.map((a) => (a.mode ?? "prod") as "dev" | "prod"),
    );
    return modes.size === 1 ? (modes.values().next().value ?? null) : null;
  })();

  const handleRemove = useCallback(
    async (id: string) => {
      if (window.electronAPI?.appConfig) {
        const updated = await window.electronAPI.appConfig.remove(id);
        onAppsChanged(updated);
      }
    },
    [onAppsChanged],
  );

  const handleReset = useCallback(async () => {
    if (window.electronAPI?.appConfig) {
      const updated = await window.electronAPI.appConfig.reset();
      onAppsChanged(updated);
    }
  }, [onAppsChanged]);

  const handleSave = useCallback(
    async (app: AppConfig) => {
      if (!window.electronAPI?.appConfig) return;
      if (!editingId) return;
      const updated = await window.electronAPI.appConfig.update(app.id, app);
      onAppsChanged(updated);
      setEditingId(null);
    },
    [editingId, onAppsChanged],
  );

  const editingApp = editingId
    ? visibleApps.find((a) => a.id === editingId)
    : null;
  const remoteCopy = remoteStatusCopy(remoteStatus);
  const normalizedShortcut = normalizeDesktopShortcutAccelerator(
    shortcutDraft.accelerator,
  );
  const shortcutDraftValid =
    Boolean(normalizedShortcut.accelerator) &&
    shortcutTargetApps.some((app) => app.id === shortcutDraft.app);

  const settingsTabs: SettingsTabItem[] = [
    {
      id: "connections",
      label: "Connections",
      icon: IconPlugConnected,
      group: "integrations",
      keywords: "mcp servers plugins agent integrations",
      content: desktopMcpApi ? (
        <div className="w-full max-w-3xl space-y-6">
          <McpServersApiProvider api={desktopMcpApi}>
            <ConnectionsTab />
          </McpServersApiProvider>
          <SettingsGroup
            title="Plugins"
            description="Import an Agent Plugin to add its skills and MCP servers to local coding chats."
          >
            <SettingsRow
              label="Agent Plugin"
              description="Uses the standard agent-plugins.org plugin format."
              control={
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost"
                  onClick={() => void handlePluginImport()}
                  disabled={pluginImporting}
                >
                  {pluginImporting ? "Importing…" : "Import plugin"}
                </button>
              }
            >
              {pluginImportMessage ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {pluginImportMessage}
                </p>
              ) : null}
            </SettingsRow>
          </SettingsGroup>
        </div>
      ) : (
        <div className="w-full max-w-3xl">
          <SettingsGroup
            title="Connections"
            description="Open the desktop app with a signed-in workspace app to manage MCP servers."
          >
            <p className="px-4 py-4 text-sm text-muted-foreground">
              MCP connections are unavailable in this window.
            </p>
          </SettingsGroup>
        </div>
      ),
    },
    {
      id: "providers",
      label: "AI providers",
      icon: IconBrain,
      group: "agent",
      content: (
        <div className="w-full max-w-3xl space-y-8">
          {providerSettings ? (
            <CodeProviderSettings
              settings={providerSettings}
              onSettingsChanged={setProviderSettings}
              onProvidersChanged={onCodeAgentProvidersChanged}
            />
          ) : (
            <SettingsGroup
              title="AI providers"
              description={providerLoadMessage ?? "Loading provider settings…"}
            >
              <SettingsRow
                label="Provider status"
                description="Reading the providers available to this desktop app."
              />
            </SettingsGroup>
          )}
        </div>
      ),
    },
    {
      id: "terminal",
      label: "Terminal tabs",
      icon: IconTerminal2,
      group: "agent",
      content: (
        <div className="w-full max-w-3xl space-y-8">
          <SettingsGroup
            title="Terminal tabs"
            description="Replace the main chat surface with local coding-agent terminals."
          >
            <SettingsRow
              label="Use terminal tabs"
              description="Open each desktop chat surface as a terminal instead of hosted chat."
              control={
                <Switch
                  checked={terminalPreferences.enabled}
                  onCheckedChange={(enabled) =>
                    writeDesktopTerminalPreferences({ enabled })
                  }
                  aria-label="Use terminal tabs"
                />
              }
            />
            <SettingsRow
              label="Terminal agent"
              description="Choose the CLI launched in new terminal tabs."
              control={
                <select
                  className="desktop-terminal-settings-select"
                  value={terminalPreferences.agent}
                  onChange={(event) =>
                    writeDesktopTerminalPreferences({
                      agent: event.target
                        .value as (typeof DESKTOP_TERMINAL_AGENT_OPTIONS)[number]["id"],
                    })
                  }
                  aria-label="Terminal agent"
                >
                  {DESKTOP_TERMINAL_AGENT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              }
            />
          </SettingsGroup>
        </div>
      ),
    },
    {
      id: "workspace",
      label: "Workspace",
      icon: IconFolder,
      group: "workspace",
      content: (
        <div className="w-full max-w-3xl space-y-8">
          <SettingsGroup
            title="Workspace"
            description="Manage apps and Portal hosts for this workspace."
          >
            <SettingsRow
              label="Portal host"
              description={remoteCopy.label + " · " + remoteCopy.description}
              control={
                <Switch
                  checked={Boolean(remoteStatus?.enabled)}
                  onCheckedChange={handleRemoteToggle}
                  aria-label={
                    remoteStatus?.enabled
                      ? "Turn Portal host off"
                      : "Turn Portal host on"
                  }
                />
              }
            >
              <div className="space-y-3">
                {remoteStatus?.relayUrl ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{hostForDisplay(remoteStatus.relayUrl)}</span>
                    {remoteStatus.pid ? (
                      <span>PID {remoteStatus.pid}</span>
                    ) : null}
                    {remoteStatus.restartCount > 0 ? (
                      <span>{remoteStatus.restartCount} retries</span>
                    ) : null}
                  </div>
                ) : null}
                {remoteMessage ? (
                  <div className="text-xs text-muted-foreground" role="status">
                    {remoteMessage}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                  onClick={() => setShowRemotePairing((value) => !value)}
                >
                  {showRemotePairing ? "Hide pairing" : "Pair or repair"}
                </button>
                {showRemotePairing ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      type="url"
                      value={remotePairUrl}
                      onChange={(event) => setRemotePairUrl(event.target.value)}
                      placeholder="https://dispatch.agent-native.com"
                      className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <input
                      type="text"
                      value={remoteWorkspacePath}
                      onChange={(event) =>
                        setRemoteWorkspacePath(event.target.value)
                      }
                      placeholder="/Users/you/Projects/your-repo"
                      aria-label="Portal workspace path"
                      className="h-9 min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 sm:col-span-2"
                    />
                    <button
                      type="button"
                      className="settings-btn settings-btn--primary"
                      onClick={handleRemotePair}
                      disabled={remotePairing || !remotePairUrl.trim()}
                    >
                      {remotePairing ? "Pairing…" : "Pair this computer"}
                    </button>
                    <span className="text-xs text-muted-foreground sm:col-span-2">
                      Use the repository folder that should receive Portal code.
                    </span>
                  </div>
                ) : null}
              </div>
            </SettingsRow>
          </SettingsGroup>

          <div className="space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">
                  Installed apps
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Apps open in production by default. Change every installed app
                  at once when you need local development.
                </p>
              </div>
              <div
                className="inline-flex shrink-0 overflow-hidden rounded-md border border-border bg-background"
                role="group"
                aria-label="Set all installed apps to"
              >
                {(["prod", "dev"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={
                      allMode === mode
                        ? "px-3 py-1.5 text-sm font-medium transition-colors bg-accent text-foreground"
                        : "px-3 py-1.5 text-sm font-medium transition-colors text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    }
                    aria-pressed={allMode === mode}
                    onClick={() => void handleAllToMode(mode)}
                  >
                    {mode === "prod" ? "Prod" : "Dev"}
                  </button>
                ))}
              </div>
            </div>
            <SettingsGroup>
              {visibleApps.map((app) => (
                <SettingsRow
                  key={app.id}
                  label={app.name}
                  description={
                    app.mode === "dev" && app.devUrl
                      ? effectiveDevUrlForDisplay(app)
                      : app.url || app.devUrl || "Local app"
                  }
                  control={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="inline-flex overflow-hidden rounded-md border border-border bg-background">
                        {(["prod", "dev"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={
                              (app.mode ?? "prod") === mode
                                ? "px-2.5 py-1.5 text-xs font-medium transition-colors bg-accent text-foreground"
                                : "px-2.5 py-1.5 text-xs font-medium transition-colors text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                            }
                            aria-pressed={(app.mode ?? "prod") === mode}
                            onClick={() => void handleModeToggle(app.id, mode)}
                          >
                            {mode === "prod" ? "Prod" : "Dev"}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="settings-icon-btn"
                        onClick={() => setEditingId(app.id)}
                        title="Edit app"
                        aria-label={"Edit " + app.name}
                      >
                        <IconEdit size={14} />
                      </button>
                      {!app.isBuiltIn ? (
                        <button
                          type="button"
                          className="settings-icon-btn settings-icon-btn--danger"
                          onClick={() => handleRemove(app.id)}
                          title="Remove app"
                          aria-label={"Remove " + app.name}
                        >
                          <IconTrash size={14} />
                        </button>
                      ) : null}
                      <Switch
                        checked={app.enabled}
                        onCheckedChange={(enabled) =>
                          void handleToggle(app.id, enabled)
                        }
                        aria-label={
                          (app.enabled ? "Disable " : "Enable ") + app.name
                        }
                      />
                    </div>
                  }
                />
              ))}
              <SettingsRow
                label="Add an app"
                description="Create a local agent-native app in your workspace."
                control={
                  <button
                    type="button"
                    className="settings-btn settings-btn--primary"
                    onClick={() => {
                      if (onAddAppClick) requestClose(onAddAppClick);
                    }}
                  >
                    <IconPlus size={15} />
                    Add app
                  </button>
                }
              />
              <SettingsRow
                label="Reset apps"
                description="Restore the default app registry."
                control={
                  <button
                    type="button"
                    className="settings-btn settings-btn--danger"
                    onClick={handleReset}
                  >
                    <IconRotate size={14} />
                    Reset
                  </button>
                }
              />
            </SettingsGroup>
          </div>
        </div>
      ),
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: IconKeyboard,
      group: "workspace",
      content: (
        <div className="w-full max-w-3xl space-y-8">
          <SettingsGroup
            title="Keyboard shortcuts"
            description="Launch enabled workspace apps from anywhere."
          >
            <SettingsRow
              label="Add launch shortcut"
              description="Choose a key combination and the app it should open."
            >
              <div className="settings-shortcut-form">
                <ShortcutRecorder
                  value={shortcutDraft.accelerator}
                  onChange={(accelerator) =>
                    setShortcutDraft((current) => ({
                      ...current,
                      accelerator,
                    }))
                  }
                />
                <select
                  value={shortcutDraft.app}
                  onChange={(event) =>
                    setShortcutDraft((current) => ({
                      ...current,
                      app: event.target.value,
                    }))
                  }
                  aria-label="Shortcut target app"
                >
                  {shortcutTargetApps.length === 0 ? (
                    <option value="" disabled>
                      No enabled apps
                    </option>
                  ) : null}
                  {shortcutTargetApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={shortcutDraft.view}
                  onChange={(event) =>
                    setShortcutDraft((current) => ({
                      ...current,
                      view: event.target.value,
                    }))
                  }
                  placeholder="view, optional"
                  aria-label="Shortcut target view"
                  className="settings-shortcut-view-input"
                />
                <div className="settings-shortcut-behavior-toggle">
                  {(["toggle", "show"] as const).map((behavior) => (
                    <button
                      key={behavior}
                      type="button"
                      className={
                        shortcutDraft.behavior === behavior
                          ? "settings-shortcut-behavior-btn settings-shortcut-behavior-btn--active"
                          : "settings-shortcut-behavior-btn"
                      }
                      onClick={() =>
                        setShortcutDraft((current) => ({
                          ...current,
                          behavior,
                        }))
                      }
                    >
                      {behavior === "toggle" ? "Toggle" : "Show"}
                    </button>
                  ))}
                </div>
                <div className="settings-shortcut-form-actions">
                  <button
                    type="button"
                    className="settings-btn settings-btn--primary settings-shortcut-save"
                    onClick={handleShortcutSave}
                    disabled={!shortcutDraftValid || shortcutSaving}
                  >
                    <IconCheck size={14} />
                    {shortcutDraft.id ? "Save" : "Add"}
                  </button>
                  {shortcutDraft.id ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost settings-shortcut-cancel"
                      onClick={() =>
                        setShortcutDraft(defaultShortcutDraft(visibleApps))
                      }
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
              {shortcutMessage ? (
                <div className="settings-shortcut-message">
                  {shortcutMessage}
                </div>
              ) : null}
            </SettingsRow>
            <SettingsRow
              label="Configured shortcuts"
              description="Enable, edit, or remove shortcuts already registered on this Mac."
            >
              <div className="settings-shortcut-list">
                {visibleShortcutBindings.length === 0 ? (
                  <div className="settings-shortcut-empty">
                    No desktop shortcuts configured.
                  </div>
                ) : (
                  visibleShortcutBindings.map((binding) => {
                    const targetApp = visibleApps.find(
                      (app) => app.id === binding.app,
                    );
                    const registration = shortcutRegistrations.get(binding.id);
                    return (
                      <div key={binding.id} className="settings-shortcut-row">
                        <div className="settings-shortcut-main">
                          <span className="settings-shortcut-keys">
                            {formatDesktopShortcutAccelerator(
                              binding.accelerator,
                              window.electronAPI?.platform,
                            )}
                          </span>
                          <span className="settings-shortcut-target">
                            {targetApp?.name ?? binding.app}
                            {binding.view ? " / " + binding.view : ""}
                          </span>
                          {registration?.error && binding.enabled ? (
                            <span className="settings-shortcut-warning">
                              <IconAlertCircle size={12} />
                              {registration.error}
                            </span>
                          ) : null}
                        </div>
                        <div className="settings-shortcut-actions">
                          <span
                            className={
                              registration?.registered
                                ? "settings-shortcut-status settings-shortcut-status--ok"
                                : "settings-shortcut-status"
                            }
                          >
                            {binding.enabled
                              ? registration?.registered
                                ? "Active"
                                : "Inactive"
                              : "Off"}
                          </span>
                          <button
                            type="button"
                            className="settings-icon-btn"
                            onClick={() =>
                              setShortcutDraft(
                                shortcutDraftFromBinding(binding),
                              )
                            }
                            title="Edit shortcut"
                            aria-label={
                              "Edit shortcut for " +
                              (targetApp?.name ?? binding.app)
                            }
                          >
                            <IconEdit size={14} />
                          </button>
                          <button
                            type="button"
                            className="settings-icon-btn settings-icon-btn--danger"
                            onClick={() => handleShortcutRemove(binding.id)}
                            title="Remove shortcut"
                            aria-label={
                              "Remove shortcut for " +
                              (targetApp?.name ?? binding.app)
                            }
                          >
                            <IconTrash size={14} />
                          </button>
                          <Switch
                            checked={binding.enabled}
                            onCheckedChange={(enabled) =>
                              void handleShortcutToggle(binding, enabled)
                            }
                            aria-label={
                              (binding.enabled ? "Disable " : "Enable ") +
                              "shortcut for " +
                              (targetApp?.name ?? binding.app)
                            }
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </SettingsRow>
          </SettingsGroup>
        </div>
      ),
    },
  ];

  return (
    <QueryClientProvider client={desktopSettingsQueryClient}>
      <div
        className={
          "settings-overlay" + (isClosing ? " settings-overlay--closing" : "")
        }
      >
        <div className="settings-panel settings-panel--page">
          <div className="settings-page-tabs">
            <SettingsSurfaceProvider surface="page">
              <SettingsTabsPage
                general={
                  <div className="w-full max-w-3xl space-y-8">
                    <SettingsGroup
                      title="Workspace account"
                      description="One Agent Native identity across first-party desktop apps. Provider connections remain separate."
                    >
                      <SettingsRow
                        label="Shared app sign-in"
                        description={
                          desktopSsoEnabled
                            ? "Show the parent sign-in once, then open eligible apps automatically."
                            : "Off by default while shared app sign-in is being tested on this device."
                        }
                        control={
                          <Switch
                            checked={desktopSsoEnabled}
                            onCheckedChange={(enabled) =>
                              void handleDesktopSsoToggle(enabled)
                            }
                            aria-label="Enable shared app sign-in"
                          />
                        }
                      />
                      {desktopSsoEnabled && identityStatus !== "idle" ? (
                        <SettingsRow
                          label="Agent Native workspace"
                          description={
                            identityStatus === "signed-in"
                              ? "Signed in across eligible apps on this desktop."
                              : identityStatus === "signing-in"
                                ? "Finishing workspace sign-in…"
                                : identityStatus === "failed"
                                  ? "Workspace sign-in needs attention in an app."
                                  : "Choose workspace sign-in for the active app. Ordinary app sign-in remains separate."
                          }
                          control={
                            identityStatus === "signed-in" ? (
                              <button
                                type="button"
                                className="settings-btn settings-btn--ghost"
                                onClick={() => void handleWorkspaceSignOut()}
                              >
                                Sign out
                              </button>
                            ) : identityStatus === "signing-in" ? undefined : (
                              <button
                                type="button"
                                className="settings-btn settings-btn--ghost"
                                onClick={() => void handleWorkspaceSignIn()}
                              >
                                Sign in
                              </button>
                            )
                          }
                        />
                      ) : null}
                    </SettingsGroup>
                    <SettingsGroup
                      title="Software updates"
                      description="Keep Agent Native current."
                    >
                      <SoftwareUpdateCard />
                    </SettingsGroup>
                  </div>
                }
                extraTabs={settingsTabs}
                enableSearch
                searchPlaceholder="Search settings…"
                defaultTab={initialTab}
                className="h-full"
                navClassName="settings-page-tabs-nav"
                navHeader={
                  <button
                    type="button"
                    className="settings-page-back settings-page-back--nav"
                    onClick={() => requestClose()}
                  >
                    <IconArrowLeft size={15} aria-hidden="true" />
                    Back to app
                  </button>
                }
                contentClassName="settings-page-tabs-content"
              />
            </SettingsSurfaceProvider>
          </div>
          {editingApp ? (
            <AppEditForm
              app={editingApp}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
            />
          ) : null}
        </div>
      </div>
    </QueryClientProvider>
  );
}

// ─── Add app flow ─────────────────────────────────────────────

export function AddAppDialog({
  onSave,
  onCreated,
  onCancel,
}: {
  onSave: (app: AppConfig) => void | Promise<void>;
  onCreated: (result: DesktopCreateAppResult) => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [appsRoot, setAppsRoot] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mode, setMode] = useState<"prod" | "dev">("dev");
  const [name, setName] = useState("");
  const [prodUrl, setProdUrl] = useState("");
  const [devUrl, setDevUrl] = useState("");
  const [devCommand, setDevCommand] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [folderWarning, setFolderWarning] = useState("");
  const [folderError, setFolderError] = useState("");
  const [choosingFolder, setChoosingFolder] = useState(false);

  const trimmedName = name.trim();
  const trimmedProdUrl = prodUrl.trim();
  const trimmedDevUrl = devUrl.trim();
  const requiredUrl = mode === "prod" ? trimmedProdUrl : trimmedDevUrl;
  const canSave = Boolean(trimmedName && requiredUrl);

  useEffect(() => {
    window.electronAPI?.appConfig
      ?.getCreationSettings()
      .then((settings) => setAppsRoot(settings.appsRoot))
      .catch(() => {});
  }, []);

  async function saveAppsRoot(nextRoot: string) {
    const trimmed = nextRoot.trim();
    if (!trimmed) return;
    const settings =
      await window.electronAPI?.appConfig?.updateCreationSettings({
        appsRoot: trimmed,
      });
    if (settings?.appsRoot) setAppsRoot(settings.appsRoot);
  }

  async function chooseAppsRoot() {
    setBuildError("");
    try {
      const result = await window.electronAPI?.appConfig?.chooseLocalFolder();
      if (!result?.ok || !result.folder) return;
      setAppsRoot(result.folder.path);
      await saveAppsRoot(result.folder.path);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBuild() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || building) return;
    setBuilding(true);
    setBuildError("");
    try {
      const result = await window.electronAPI?.appConfig?.createFromPrompt({
        prompt: trimmedPrompt,
        appsRoot: appsRoot.trim() || undefined,
      });
      if (!result) {
        setBuildError("App creation is only available in Desktop.");
      } else if (!result.ok || !result.app) {
        setBuildError(result.error || result.message);
      } else {
        onCreated(result);
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  }

  async function chooseLocalFolder() {
    setChoosingFolder(true);
    setFolderError("");
    setFolderWarning("");
    try {
      const picker = window.electronAPI?.appConfig?.chooseLocalFolder;
      if (!picker) {
        setFolderError("Folder picker is only available in Desktop.");
        return;
      }
      const result = await picker();
      if (!result?.ok || !result.folder) {
        if (result?.error && result.error !== "No folder selected.") {
          setFolderError(result.error);
        }
        return;
      }
      const folder = result.folder;
      setLocalPath(folder.path);
      setName((current) => current || folder.name);
      setDevUrl(folder.devUrl);
      setDevCommand(folder.devCommand);
      if (folder.warning) setFolderWarning(folder.warning);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setChoosingFolder(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    await onSave({
      id: generateAppId(),
      name: trimmedName,
      icon: "Globe",
      description:
        mode === "prod"
          ? `Production app at ${trimmedProdUrl}`
          : localPath
            ? `Local dev app in ${localPath}`
            : `Local dev app at ${trimmedDevUrl}`,
      url: trimmedProdUrl,
      devPort: inferPortFromUrl(trimmedDevUrl),
      devUrl: trimmedDevUrl || undefined,
      devCommand: devCommand.trim() || undefined,
      localPath: mode === "dev" ? localPath || undefined : undefined,
      isBuiltIn: false,
      enabled: true,
      mode,
    });
  }

  return (
    <div className="settings-form-overlay" onClick={onCancel}>
      <form
        className="settings-form settings-add-form"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-form-header">
          <h3>New App</h3>
          <p className="settings-form-subtitle">
            Describe what you want. The coding agent will build it and add it to
            your workspace.
          </p>
        </div>

        <textarea
          className="settings-create-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !building
            ) {
              event.preventDefault();
              void handleBuild();
            }
          }}
          placeholder="Build me a lightweight CRM for tracking investor conversations, with follow-ups and a clean pipeline view…"
          rows={5}
          autoFocus
        />

        <div className="settings-create-location">
          <IconFolder size={13} strokeWidth={1.8} />
          <span>Creates in</span>
          <input
            value={appsRoot}
            onChange={(event) => setAppsRoot(event.target.value)}
            onBlur={() => void saveAppsRoot(appsRoot)}
            aria-label="Folder for new apps"
            spellCheck={false}
          />
          <button
            type="button"
            className="settings-create-location-button"
            onClick={() => void chooseAppsRoot()}
            title="Choose folder"
            aria-label="Choose folder for new apps"
          >
            <IconFolderPlus size={14} strokeWidth={1.8} />
          </button>
        </div>

        {buildError && (
          <p className="settings-folder-message settings-folder-message--error">
            <IconAlertCircle size={13} strokeWidth={1.8} />
            {buildError}
          </p>
        )}

        <div className="settings-form-actions settings-create-actions">
          <button
            type="button"
            className="settings-btn settings-btn--ghost"
            onClick={onCancel}
            disabled={building}
          >
            Cancel
          </button>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={() => void handleBuild()}
            disabled={!prompt.trim() || building}
          >
            {building ? (
              <IconLoader2 size={14} className="settings-spinner" />
            ) : (
              <IconPlus size={14} />
            )}
            {building ? "Starting agent…" : "Build App"}
          </button>
        </div>

        <button
          type="button"
          className="settings-advanced-trigger"
          onClick={() => setAdvancedOpen((current) => !current)}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
          Add an existing app
        </button>

        {advancedOpen && (
          <>
            <div className="settings-choice-grid" aria-label="App target">
              <button
                type="button"
                className={`settings-choice-btn${mode === "prod" ? " settings-choice-btn--active" : ""}`}
                onClick={() => setMode("prod")}
                aria-pressed={mode === "prod"}
              >
                <IconWorld size={17} />
                <span>
                  <strong>Production</strong>
                  <small>Hosted URL</small>
                </span>
              </button>
              <button
                type="button"
                className={`settings-choice-btn${mode === "dev" ? " settings-choice-btn--active" : ""}`}
                onClick={() => setMode("dev")}
                aria-pressed={mode === "dev"}
                title="Use this for a cloned local app folder; Desktop opens the inferred localhost URL."
              >
                <IconTerminal2 size={17} />
                <span>
                  <strong>Local dev</strong>
                  <small>Choose folder</small>
                </span>
              </button>
            </div>

            {mode === "prod" ? (
              <>
                <label>
                  Name *
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dispatch"
                    required
                  />
                </label>

                <label>
                  Production URL *
                  <input
                    type="url"
                    value={prodUrl}
                    onChange={(e) => setProdUrl(e.target.value)}
                    placeholder="https://dispatch.agent-native.com"
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <div className="settings-folder-picker">
                  <div className="settings-folder-picker__label">
                    <span>Local Folder</span>
                    {localPath && <small>Selected</small>}
                  </div>
                  <button
                    type="button"
                    className={`settings-folder-btn${localPath ? " settings-folder-btn--selected" : ""}`}
                    onClick={chooseLocalFolder}
                    disabled={choosingFolder}
                  >
                    {localPath ? (
                      <IconFolder size={16} strokeWidth={1.8} />
                    ) : (
                      <IconFolderPlus size={16} strokeWidth={1.8} />
                    )}
                    <span>
                      <strong>
                        {localPath
                          ? localPath.split(/[\\/]/).filter(Boolean).at(-1)
                          : "Choose app folder"}
                      </strong>
                      <small>
                        {localPath ||
                          "Select the folder you cloned or created."}
                      </small>
                    </span>
                    {choosingFolder && (
                      <IconLoader2
                        size={14}
                        strokeWidth={1.8}
                        className="settings-spinner"
                      />
                    )}
                  </button>
                  {folderError && (
                    <p className="settings-folder-message settings-folder-message--error">
                      <IconAlertCircle size={13} strokeWidth={1.8} />
                      {folderError}
                    </p>
                  )}
                  {folderWarning && (
                    <p className="settings-folder-message">
                      <IconAlertCircle size={13} strokeWidth={1.8} />
                      {folderWarning}
                    </p>
                  )}
                </div>

                <label>
                  Name *
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My local app"
                    required
                  />
                </label>

                <label>
                  Dev URL *
                  <input
                    type="url"
                    value={devUrl}
                    onChange={(e) => setDevUrl(e.target.value)}
                    placeholder="http://localhost:3000"
                    required
                  />
                  <span className="settings-field-hint">
                    Auto-filled from the folder when possible. You can still
                    edit it manually.
                  </span>
                </label>

                <label>
                  Dev Command
                  <input
                    type="text"
                    value={devCommand}
                    onChange={(e) => setDevCommand(e.target.value)}
                    placeholder="pnpm dev"
                  />
                </label>
              </>
            )}

            <div className="settings-form-actions">
              <button
                type="button"
                className="settings-btn settings-btn--ghost"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="settings-btn settings-btn--primary"
                disabled={!canSave}
              >
                <IconCheck size={14} />{" "}
                {mode === "dev" ? "Open App" : "Add App"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ─── Inline edit form ─────────────────────────────────────────────

export function AppEditForm({
  app,
  onSave,
  onCancel,
}: {
  app?: AppConfig;
  onSave: (app: AppConfig) => void;
  onCancel: () => void;
}) {
  const workspaceSsoApp = app as WorkspaceSsoAppConfig | undefined;
  const [name, setName] = useState(app?.name ?? "");
  const [url, setUrl] = useState(app?.url ?? "");
  const [devUrl, setDevUrl] = useState(app?.devUrl ?? "");
  const [devCommand, setDevCommand] = useState(app?.devCommand ?? "");
  const [description, setDescription] = useState(app?.description ?? "");
  const [workspaceSso, setWorkspaceSso] = useState(
    workspaceSsoApp?.workspaceSso === true,
  );
  const canUseWorkspaceSso = (() => {
    try {
      return app?.mode !== "dev" && new URL(url.trim()).protocol === "https:";
    } catch (error) {
      void error;
      return false;
    }
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedDevUrl = devUrl.trim();
    if (!name.trim() || (!trimmedUrl && !trimmedDevUrl)) return;

    const nextApp: WorkspaceSsoAppConfig = {
      id: app?.id ?? generateAppId(),
      name: name.trim(),
      icon: app?.icon ?? "Globe",
      description: description.trim() || name.trim(),
      url: trimmedUrl,
      devPort: app?.devPort || inferPortFromUrl(trimmedDevUrl),
      devUrl: trimmedDevUrl || undefined,
      devCommand: devCommand.trim() || undefined,
      localPath: app?.localPath,
      isBuiltIn: app?.isBuiltIn ?? false,
      enabled: app?.enabled ?? true,
      mode: app?.mode ?? (trimmedUrl ? "prod" : "dev"),
      ...(app?.isBuiltIn ? {} : { workspaceSso }),
    };
    onSave(nextApp);
  }

  return (
    <div className="settings-form-overlay" onClick={onCancel}>
      <form
        className="settings-form"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{app ? "Edit App" : "Add App"}</h3>

        <label>
          Name *
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My App"
            required
          />
        </label>

        <label>
          Production URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://myapp.example.com"
          />
        </label>

        <label>
          Dev URL
          <input
            type="url"
            value={devUrl}
            onChange={(e) => setDevUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </label>

        <label>
          Dev Command
          <input
            type="text"
            value={devCommand}
            onChange={(e) => setDevCommand(e.target.value)}
            placeholder="pnpm dev"
          />
        </label>

        <label>
          Description
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this app do?"
          />
        </label>

        {!app?.isBuiltIn ? (
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.3px] text-muted-foreground">
                Workspace sign-in
              </div>
              <div className="settings-field-hint">
                {canUseWorkspaceSso
                  ? "Use only for an app that implements the Agent Native identity endpoints. Arbitrary sites stay isolated."
                  : "Set this app to Prod with an HTTPS production URL first."}
              </div>
            </div>
            <Switch
              checked={workspaceSso}
              onCheckedChange={setWorkspaceSso}
              disabled={!canUseWorkspaceSso}
              aria-label="Enable workspace sign-in for this app"
            />
          </div>
        ) : null}

        <div className="settings-form-actions">
          <button
            type="button"
            className="settings-btn settings-btn--ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="settings-btn settings-btn--primary">
            <IconCheck size={14} /> Save
          </button>
        </div>
      </form>
    </div>
  );
}
