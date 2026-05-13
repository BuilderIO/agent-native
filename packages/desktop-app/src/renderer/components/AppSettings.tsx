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
  IconWorld,
  IconTerminal2,
} from "@tabler/icons-react";
import type { AppConfig, TemplateMeta } from "@shared/app-registry";
import {
  generateAppId,
  visibleTemplates,
  DEFAULT_APPS,
  templateToAppConfig,
} from "@shared/app-registry";

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
}

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

export default function AppSettings({
  apps,
  onClose,
  onAppsChanged,
  onAddAppClick,
}: AppSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [frameSettings, setFrameSettings] = useState<FrameSettings | null>(
    null,
  );

  // Load frame settings
  useEffect(() => {
    if (window.electronAPI?.frame) {
      window.electronAPI.frame.load().then(setFrameSettings);
    }
  }, []);

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
              {/* Local Dev Frame */}
              {frameSettings && (
                <div className="settings-section">
                  <h3>Code Editing Frame</h3>
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
                </div>
              )}

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
                  className="settings-btn"
                  onClick={() => setShowTemplatePicker(true)}
                >
                  <IconPlus size={15} /> Add First-Party App
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

        {/* Template picker */}
        {showTemplatePicker && (
          <TemplatePicker
            installedIds={new Set(apps.map((a) => a.id))}
            onPick={async (template) => {
              const preset = DEFAULT_APPS.find((a) => a.id === template.name);
              const next: AppConfig = preset
                ? { ...preset, enabled: true }
                : templateToAppConfig(template, {
                    isBuiltIn: false,
                    enabled: true,
                  });
              if (window.electronAPI?.appConfig) {
                const updated = await window.electronAPI.appConfig.add(next);
                onAppsChanged(updated);
              }
              setShowTemplatePicker(false);
            }}
            onCancel={() => setShowTemplatePicker(false)}
          />
        )}

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
  const [mode, setMode] = useState<"prod" | "dev">("prod");
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
            Add a deployed app or a localhost dev server.
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

// ─── Template picker ─────────────────────────────────────────────

function TemplatePicker({
  installedIds,
  onPick,
  onCancel,
}: {
  installedIds: Set<string>;
  onPick: (template: TemplateMeta) => void;
  onCancel: () => void;
}) {
  const available = visibleTemplates().filter((t) => !installedIds.has(t.name));

  return (
    <div className="settings-form-overlay" onClick={onCancel}>
      <div
        className="settings-form"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <h3>Add First-Party App</h3>
        {available.length === 0 ? (
          <p style={{ color: "var(--muted, #6b7280)" }}>
            Every first-party template is already installed. Use "Add App" for
            external apps.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 6,
              maxHeight: 420,
              overflowY: "auto",
            }}
          >
            {available.map((t) => (
              <button
                key={t.name}
                type="button"
                className="settings-app-row"
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 8,
                  padding: 10,
                  background: "transparent",
                  textAlign: "left",
                }}
                onClick={() => onPick(t)}
              >
                <div className="settings-app-info">
                  <span className="settings-app-name">{t.label}</span>
                  <span className="settings-app-url">{t.hint}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="settings-form-actions">
          <button
            type="button"
            className="settings-btn settings-btn--ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
