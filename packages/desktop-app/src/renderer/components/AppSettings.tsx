import { useState, useCallback } from "react";
import {
  X,
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
  Check,
  Terminal,
  type LucideProps,
} from "lucide-react";
import type { AppConfig } from "@shared/app-registry";
import { generateAppId } from "@shared/app-registry";

interface AppSettingsProps {
  apps: AppConfig[];
  onClose: () => void;
  onAppsChanged: (apps: AppConfig[]) => void;
}

const COLOR_PRESETS = [
  "#3B82F6",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#EF4444",
  "#06B6D4",
  "#F97316",
  "#84CC16",
  "#6366F1",
];

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

export default function AppSettings({
  apps,
  onClose,
  onAppsChanged,
}: AppSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

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

  const handleHarnessToggle = useCallback(
    async (id: string, useCliHarness: boolean) => {
      if (window.electronAPI?.appConfig) {
        const updated = await window.electronAPI.appConfig.update(id, {
          useCliHarness,
        });
        onAppsChanged(updated);
      }
    },
    [onAppsChanged],
  );

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
      if (editingId) {
        const updated = await window.electronAPI.appConfig.update(app.id, app);
        onAppsChanged(updated);
        setEditingId(null);
      } else {
        const updated = await window.electronAPI.appConfig.add(app);
        onAppsChanged(updated);
        setShowAddForm(false);
      }
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
            <X size={18} />
          </button>
        </div>

        <div className="settings-body">
          {/* App list */}
          <div className="settings-section">
            <h3>Installed Apps</h3>
            {apps.map((app) => (
              <div key={app.id} className="settings-app-row">
                <div
                  className="settings-app-dot"
                  style={{ backgroundColor: app.color }}
                />
                <div className="settings-app-info">
                  <span className="settings-app-name">{app.name}</span>
                  <span className="settings-app-url">{app.url}</span>
                </div>
                <div className="settings-app-actions">
                  <button
                    className={`settings-icon-btn${app.useCliHarness ? " settings-icon-btn--active" : ""}`}
                    onClick={() =>
                      handleHarnessToggle(app.id, !app.useCliHarness)
                    }
                    title={
                      app.useCliHarness
                        ? "Dev Mode: ON (localhost)"
                        : "Dev Mode: OFF (production)"
                    }
                  >
                    <Terminal size={14} />
                  </button>
                  <button
                    className="settings-icon-btn"
                    onClick={() => setEditingId(app.id)}
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  {!app.isBuiltIn && (
                    <button
                      className="settings-icon-btn settings-icon-btn--danger"
                      onClick={() => handleRemove(app.id)}
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={app.enabled}
                      onChange={(e) => handleToggle(app.id, e.target.checked)}
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
              onClick={() => {
                setEditingId(null);
                setShowAddForm(true);
              }}
            >
              <Plus size={15} /> Add Custom App
            </button>
            <button
              className="settings-btn settings-btn--danger"
              onClick={handleReset}
            >
              <RotateCcw size={14} /> Reset to Defaults
            </button>
          </div>
        </div>

        {/* Inline edit/add form */}
        {(showAddForm || editingApp) && (
          <AppEditForm
            app={editingApp ?? undefined}
            onSave={handleSave}
            onCancel={() => {
              setEditingId(null);
              setShowAddForm(false);
            }}
          />
        )}
      </div>
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
  const [color, setColor] = useState(app?.color ?? COLOR_PRESETS[0]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    onSave({
      id: app?.id ?? generateAppId(),
      name: name.trim(),
      icon: app?.icon ?? "Globe",
      description: description.trim() || name.trim(),
      url: url.trim(),
      devPort: app?.devPort ?? 0,
      devUrl: devUrl.trim() || undefined,
      devCommand: devCommand.trim() || undefined,
      color,
      colorRgb: hexToRgb(color),
      isBuiltIn: app?.isBuiltIn ?? false,
      enabled: app?.enabled ?? true,
      useCliHarness: app?.useCliHarness ?? true,
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
          Production URL *
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://myapp.example.com"
            required
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

        <div className="settings-color-row">
          <span>Color</span>
          <div className="settings-colors">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`settings-color-swatch${c === color ? " settings-color-swatch--active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="settings-form-actions">
          <button
            type="button"
            className="settings-btn settings-btn--ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="settings-btn settings-btn--primary">
            <Check size={14} /> Save
          </button>
        </div>
      </form>
    </div>
  );
}
