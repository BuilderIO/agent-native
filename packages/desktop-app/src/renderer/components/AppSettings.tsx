import { useState, useCallback, useEffect } from "react";
import {
  IconX,
  IconPlus,
  IconTrash,
  IconEdit,
  IconRotate,
  IconCheck,
  IconChevronRight,
  IconChevronDown,
  IconDownload,
  IconLoader2,
  IconRefresh,
  IconWorld,
  IconTerminal2,
} from "@tabler/icons-react";
import type { AppConfig } from "@shared/app-registry";
import type { UpdateStatus } from "@shared/ipc-channels";
import { generateAppId } from "@shared/app-registry";
import { CodeProviderSettings } from "./CodeProviderSettings";
import { useUpdateStatus } from "./UpdateIndicator.js";

interface FrameSettings {
  enabled: boolean;
  mode: "dev" | "prod";
  prodUrl?: string;
}

interface AppSettingsProps {
  apps: AppConfig[];
  onClose: () => void;
  onAppsChanged: (apps: AppConfig[]) => void;
  onAddAppClick?: () => void;
  onCodeAgentProvidersChanged?: () => void;
}

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
    return app.devUrl || (app.devPort ? `http://localhost:${app.devPort}` : "");
  }
  return app.url || app.devUrl || "";
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
      description: "Reading remote-control status.",
      tone: "pending",
    };
  }
  if (!status.configured) {
    return {
      label: "Offline",
      description: "Pair this computer with an Agent-Native app.",
      tone: "offline",
    };
  }
  if (!status.enabled) {
    return {
      label: "Off",
      description: "Remote requests are paused on this computer.",
      tone: "offline",
    };
  }
  if (status.state === "error") {
    return {
      label: "Error",
      description: status.error ?? "Remote control needs attention.",
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
        : "Starting remote control.",
      tone: "pending",
    };
  }
  return {
    label: "Offline",
    description: "Remote control is not currently polling.",
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
    <div className={`settings-update-card settings-update-card--${copy.tone}`}>
      <div className="settings-update-row">
        <div className="settings-update-title">
          <span
            className={`settings-update-dot settings-update-dot--${copy.tone}`}
          />
          <div>
            <span className="settings-mode-card-title">Software Updates</span>
            <span className="settings-mode-card-status">
              {copy.label} · {copy.description}
            </span>
          </div>
        </div>
        <div className="settings-update-actions">
          {canInstall ? (
            <button
              type="button"
              className="settings-btn settings-btn--primary settings-update-btn"
              onClick={handleInstall}
            >
              <IconRefresh size={14} />
              Relaunch
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
          )}
        </div>
      </div>
      {status?.state === "downloading" && (
        <div className="settings-update-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(100, status.percent)}%` }} />
        </div>
      )}
      {message && <div className="settings-update-message">{message}</div>}
    </div>
  );
}

export default function AppSettings({
  apps,
  onClose,
  onAppsChanged,
  onAddAppClick,
  onCodeAgentProvidersChanged,
}: AppSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [frameSettings, setFrameSettings] = useState<FrameSettings | null>(
    null,
  );
  const [remoteStatus, setRemoteStatus] =
    useState<CodeAgentRemoteConnectorStatus | null>(null);
  const [remotePairUrl, setRemotePairUrl] = useState("");
  const [remotePairing, setRemotePairing] = useState(false);
  const [showRemotePairing, setShowRemotePairing] = useState(false);
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [providerSettings, setProviderSettings] =
    useState<CodeAgentProviderSettings | null>(null);
  const [providerLoadMessage, setProviderLoadMessage] = useState<string | null>(
    null,
  );

  // Load frame settings
  useEffect(() => {
    if (window.electronAPI?.frame) {
      window.electronAPI.frame.load().then(setFrameSettings);
    }
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
      if (!status.configured) setShowRemotePairing(true);
    } catch (err) {
      setRemoteMessage(err instanceof Error ? err.message : String(err));
    }
  }, [apps]);

  useEffect(() => {
    void refreshRemoteStatus();
    const timer = window.setInterval(() => void refreshRemoteStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshRemoteStatus]);

  const handleFrameToggle = useCallback(async (enabled: boolean) => {
    if (window.electronAPI?.frame) {
      const updated = await window.electronAPI.frame.update({ enabled });
      setFrameSettings(updated);
    }
  }, []);

  const handleFrameModeToggle = useCallback(async (mode: "dev" | "prod") => {
    if (window.electronAPI?.frame) {
      const updated = await window.electronAPI.frame.update({ mode });
      setFrameSettings(updated);
    }
  }, []);

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
      });
      setRemoteStatus(result.status);
      setRemoteMessage(result.error ?? result.message ?? null);
      if (result.ok) setShowRemotePairing(false);
    } catch (err) {
      setRemoteMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRemotePairing(false);
    }
  }, [remotePairUrl]);

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
      for (const app of apps) {
        if ((app.mode ?? "prod") !== mode) {
          latest = await window.electronAPI.appConfig.update(app.id, { mode });
        }
      }
      onAppsChanged(latest);
      if (
        window.electronAPI?.frame &&
        frameSettings &&
        frameSettings.mode !== mode
      ) {
        const updated = await window.electronAPI.frame.update({ mode });
        setFrameSettings(updated);
      }
    },
    [apps, frameSettings, onAppsChanged],
  );

  const allMode: "dev" | "prod" | null = (() => {
    if (!frameSettings) return null;
    const modes = new Set<"dev" | "prod">([
      frameSettings.mode,
      ...apps.map((a) => (a.mode ?? "prod") as "dev" | "prod"),
    ]);
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

  const editingApp = editingId ? apps.find((a) => a.id === editingId) : null;
  const remoteCopy = remoteStatusCopy(remoteStatus);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>App Settings</h2>
          <button className="settings-close" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>

        <div className="settings-body">
          {/* Hero: global mode toggle */}
          {frameSettings && (
            <div className="settings-mode-card">
              <div className="settings-mode-card-text">
                <span className="settings-mode-card-title">Mode</span>
                <span className="settings-mode-card-status">
                  {allMode === "dev"
                    ? "All apps run in dev mode"
                    : allMode === "prod"
                      ? "All apps run on production"
                      : "Mixed — some apps overridden"}
                </span>
              </div>
              <div className="settings-mode-toggle settings-mode-toggle--lg">
                <button
                  className={`settings-mode-btn${allMode === "prod" ? " settings-mode-btn--active" : ""}`}
                  onClick={() => handleAllToMode("prod")}
                >
                  Prod
                </button>
                <button
                  className={`settings-mode-btn${allMode === "dev" ? " settings-mode-btn--active" : ""}`}
                  onClick={() => handleAllToMode("dev")}
                >
                  Dev
                </button>
              </div>
            </div>
          )}

          <SoftwareUpdateCard />

          {providerSettings && (
            <CodeProviderSettings
              settings={providerSettings}
              onSettingsChanged={setProviderSettings}
              onProvidersChanged={onCodeAgentProvidersChanged}
            />
          )}
          {!providerSettings && providerLoadMessage && (
            <div className="settings-provider-message">
              {providerLoadMessage}
            </div>
          )}

          <div
            className={`settings-remote-card settings-remote-card--${remoteCopy.tone}`}
          >
            <div className="settings-remote-row">
              <div className="settings-remote-title">
                <span
                  className={`settings-remote-dot settings-remote-dot--${remoteCopy.tone}`}
                />
                <div>
                  <span className="settings-mode-card-title">
                    Remote Control
                  </span>
                  <span className="settings-mode-card-status">
                    {remoteCopy.label} · {remoteCopy.description}
                  </span>
                </div>
              </div>
              <label
                className="settings-toggle"
                title={
                  remoteStatus?.enabled
                    ? "Turn remote control off"
                    : "Turn remote control on"
                }
              >
                <input
                  type="checkbox"
                  checked={Boolean(remoteStatus?.enabled)}
                  onChange={(e) => handleRemoteToggle(e.target.checked)}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>

            {remoteStatus?.relayUrl && (
              <div className="settings-remote-meta">
                <span>{hostForDisplay(remoteStatus.relayUrl)}</span>
                {remoteStatus.pid && <span>PID {remoteStatus.pid}</span>}
                {remoteStatus.restartCount > 0 && (
                  <span>{remoteStatus.restartCount} retries</span>
                )}
              </div>
            )}

            {remoteMessage && (
              <div className="settings-remote-message">{remoteMessage}</div>
            )}

            <button
              type="button"
              className="settings-remote-link"
              onClick={() => setShowRemotePairing((value) => !value)}
            >
              {showRemotePairing ? "Hide pairing" : "Pair or repair"}
            </button>

            {showRemotePairing && (
              <div className="settings-remote-pairing">
                <input
                  type="url"
                  value={remotePairUrl}
                  onChange={(e) => setRemotePairUrl(e.target.value)}
                  placeholder="https://dispatch.agent-native.com"
                />
                <button
                  type="button"
                  className="settings-btn settings-btn--primary"
                  onClick={handleRemotePair}
                  disabled={remotePairing || !remotePairUrl.trim()}
                >
                  {remotePairing ? "Pairing..." : "Pair This Mac"}
                </button>
                <span className="settings-field-hint">
                  Use an app you are signed into inside Desktop.
                </span>
              </div>
            )}
          </div>

          {/* Disclosure */}
          <button
            type="button"
            className="settings-disclosure"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
            <span>Customize per app</span>
          </button>

          {showAdvanced && (
            <>
              {/* App list */}
              <div className="settings-section">
                <h3>Installed Apps</h3>
                {apps.map((app) => (
                  <div key={app.id} className="settings-app-row">
                    <div className="settings-app-info">
                      <span className="settings-app-name">{app.name}</span>
                      <span className="settings-app-url">
                        {app.mode === "dev" && app.devUrl
                          ? app.devUrl
                          : app.url || app.devUrl}
                      </span>
                    </div>
                    <div className="settings-app-actions">
                      <div className="settings-mode-toggle">
                        <button
                          className={`settings-mode-btn${(app.mode ?? "prod") === "prod" ? " settings-mode-btn--active" : ""}`}
                          onClick={() => handleModeToggle(app.id, "prod")}
                        >
                          Prod
                        </button>
                        <button
                          className={`settings-mode-btn${app.mode === "dev" ? " settings-mode-btn--active" : ""}`}
                          onClick={() => handleModeToggle(app.id, "dev")}
                        >
                          Dev
                        </button>
                      </div>
                      <button
                        className="settings-icon-btn"
                        onClick={() => setEditingId(app.id)}
                        title="Edit"
                      >
                        <IconEdit size={14} />
                      </button>
                      {!app.isBuiltIn && (
                        <button
                          className="settings-icon-btn settings-icon-btn--danger"
                          onClick={() => handleRemove(app.id)}
                          title="Remove"
                        >
                          <IconTrash size={14} />
                        </button>
                      )}
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={app.enabled}
                          onChange={(e) =>
                            handleToggle(app.id, e.target.checked)
                          }
                        />
                        <span className="settings-toggle-track" />
                      </label>
                    </div>
                  </div>
                ))}
                {frameSettings && (
                  <div className="settings-app-row">
                    <div className="settings-app-info">
                      <span className="settings-app-name">
                        Code editing frame
                      </span>
                      <span className="settings-app-url">
                        Chat + CLI sidebar for code editing
                      </span>
                    </div>
                    <div className="settings-app-actions">
                      <div className="settings-mode-toggle">
                        <button
                          className={`settings-mode-btn${frameSettings.mode === "prod" ? " settings-mode-btn--active" : ""}`}
                          onClick={() => handleFrameModeToggle("prod")}
                        >
                          Prod
                        </button>
                        <button
                          className={`settings-mode-btn${frameSettings.mode === "dev" ? " settings-mode-btn--active" : ""}`}
                          onClick={() => handleFrameModeToggle("dev")}
                        >
                          Dev
                        </button>
                      </div>
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={frameSettings.enabled}
                          onChange={(e) => handleFrameToggle(e.target.checked)}
                        />
                        <span className="settings-toggle-track" />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Add / Reset */}
              <div className="settings-section">
                <button
                  className="settings-btn settings-btn--primary"
                  onClick={onAddAppClick}
                >
                  <IconPlus size={15} /> Add App
                </button>
                <button
                  className="settings-btn settings-btn--danger"
                  onClick={handleReset}
                >
                  <IconRotate size={14} /> Reset to Defaults
                </button>
              </div>
            </>
          )}
        </div>

        {/* Inline edit form */}
        {editingApp && (
          <AppEditForm
            app={editingApp}
            onSave={handleSave}
            onCancel={() => {
              setEditingId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Add app flow ─────────────────────────────────────────────

export function AddAppDialog({
  onSave,
  onCancel,
}: {
  onSave: (app: AppConfig) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"prod" | "dev">("dev");
  const [name, setName] = useState("");
  const [prodUrl, setProdUrl] = useState("");
  const [devUrl, setDevUrl] = useState("");
  const [devCommand, setDevCommand] = useState("");

  const trimmedName = name.trim();
  const trimmedProdUrl = prodUrl.trim();
  const trimmedDevUrl = devUrl.trim();
  const requiredUrl = mode === "prod" ? trimmedProdUrl : trimmedDevUrl;
  const canSave = Boolean(trimmedName && requiredUrl);

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
          : `Local dev app at ${trimmedDevUrl}`,
      url: trimmedProdUrl,
      devPort: inferPortFromUrl(trimmedDevUrl),
      devUrl: trimmedDevUrl || undefined,
      devCommand: devCommand.trim() || undefined,
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
          <h3>Add App</h3>
          <p className="settings-form-subtitle">
            Add a localhost dev server or a deployed app.
          </p>
        </div>

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
            title="Use this for localhost apps you run with pnpm dev; Desktop loads the dev URL with code tools available."
          >
            <IconTerminal2 size={17} />
            <span>
              <strong>Local dev</strong>
              <small>localhost URL</small>
            </span>
          </button>
        </div>

        <label>
          Name *
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={mode === "prod" ? "Dispatch" : "My local app"}
            required
          />
        </label>

        {mode === "prod" ? (
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
        ) : (
          <>
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
                Use the URL from your local dev server.
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
            <IconCheck size={14} /> Add App
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Inline edit form ─────────────────────────────────────────────

function AppEditForm({
  app,
  onSave,
  onCancel,
}: {
  app?: AppConfig;
  onSave: (app: AppConfig) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(app?.name ?? "");
  const [url, setUrl] = useState(app?.url ?? "");
  const [devUrl, setDevUrl] = useState(app?.devUrl ?? "");
  const [devCommand, setDevCommand] = useState(app?.devCommand ?? "");
  const [description, setDescription] = useState(app?.description ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedDevUrl = devUrl.trim();
    if (!name.trim() || (!trimmedUrl && !trimmedDevUrl)) return;

    onSave({
      id: app?.id ?? generateAppId(),
      name: name.trim(),
      icon: app?.icon ?? "Globe",
      description: description.trim() || name.trim(),
      url: trimmedUrl,
      devPort: app?.devPort || inferPortFromUrl(trimmedDevUrl),
      devUrl: trimmedDevUrl || undefined,
      devCommand: devCommand.trim() || undefined,
      isBuiltIn: app?.isBuiltIn ?? false,
      enabled: app?.enabled ?? true,
      mode: app?.mode ?? (trimmedUrl ? "prod" : "dev"),
    });
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
