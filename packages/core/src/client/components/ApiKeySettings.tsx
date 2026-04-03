import { useState, useEffect, useCallback } from "react";

interface EnvKeyStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

interface ApiKeySettingsProps {
  /** Path to the settings page (used for linking). Default: "/settings" */
  settingsPath?: string;
}

/**
 * Reusable component that shows the status of configured API keys
 * and lets users enter missing ones. Fetches from /_agent-native/env-status
 * and saves via POST /_agent-native/env-vars.
 */
export function ApiKeySettings({
  settingsPath: _settingsPath = "/settings",
}: ApiKeySettingsProps) {
  const [keys, setKeys] = useState<EnvKeyStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/_agent-native/env-status");
      if (!res.ok) {
        throw new Error(`Failed to fetch env status: ${res.status}`);
      }
      const data: EnvKeyStatus[] = await res.json();
      setKeys(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load API key status",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleValueChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaveResult(null);
  };

  const handleSave = async () => {
    const vars = Object.entries(values)
      .filter(([, v]) => v.trim() !== "")
      .map(([key, value]) => ({ key, value: value.trim() }));

    if (vars.length === 0) return;

    setSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed: ${res.status}`);
      }

      const data = await res.json();
      setSaveResult({
        ok: true,
        message: `Saved ${data.saved?.length ?? 0} key(s)`,
      });
      setValues({});
      // Refresh status
      await fetchStatus();
    } catch (err) {
      setSaveResult({
        ok: false,
        message: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = Object.values(values).filter(
    (v) => v.trim() !== "",
  ).length;

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.loadingText}>Loading API key status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <p style={styles.errorText}>{error}</p>
        <button onClick={fetchStatus} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  if (keys.length === 0) {
    return null;
  }

  const configuredKeys = keys.filter((k) => k.configured);
  const unconfiguredKeys = keys.filter((k) => !k.configured);

  return (
    <div style={styles.container}>
      <h3 style={styles.heading}>API Keys</h3>
      <p style={styles.subtitle}>
        {configuredKeys.length} of {keys.length} configured
      </p>

      <div style={styles.keyList}>
        {keys.map((k) => (
          <div key={k.key} style={styles.keyCard}>
            <div style={styles.keyHeader}>
              <span style={styles.keyLabel}>
                {k.configured ? (
                  <span style={styles.checkmark}>&#10003;</span>
                ) : (
                  <span style={styles.unconfiguredDot}>&#9679;</span>
                )}
                {k.label}
                {k.required && (
                  <span style={styles.requiredBadge}>required</span>
                )}
              </span>
              <span style={styles.keyName}>{k.key}</span>
            </div>

            {!k.configured && (
              <input
                type="password"
                placeholder={`Enter ${k.label} key...`}
                value={values[k.key] ?? ""}
                onChange={(e) => handleValueChange(k.key, e.target.value)}
                style={styles.input}
                autoComplete="off"
              />
            )}
          </div>
        ))}
      </div>

      {unconfiguredKeys.length > 0 && (
        <div style={styles.actions}>
          <button
            onClick={handleSave}
            disabled={saving || pendingCount === 0}
            style={{
              ...styles.saveButton,
              opacity: saving || pendingCount === 0 ? 0.5 : 1,
              cursor: saving || pendingCount === 0 ? "default" : "pointer",
            }}
          >
            {saving
              ? "Saving..."
              : `Save ${pendingCount > 0 ? `(${pendingCount})` : ""}`}
          </button>
        </div>
      )}

      {saveResult && (
        <p style={saveResult.ok ? styles.successText : styles.errorText}>
          {saveResult.message}
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "20px",
    maxWidth: "600px",
  },
  heading: {
    fontSize: "16px",
    fontWeight: 600,
    margin: "0 0 4px 0",
  },
  subtitle: {
    fontSize: "13px",
    opacity: 0.6,
    margin: "0 0 16px 0",
  },
  loadingText: {
    fontSize: "13px",
    opacity: 0.5,
  },
  errorText: {
    fontSize: "13px",
    color: "#ef4444",
  },
  successText: {
    fontSize: "13px",
    color: "#22c55e",
    marginTop: "8px",
  },
  retryButton: {
    marginTop: "8px",
    padding: "6px 12px",
    fontSize: "13px",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "6px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  keyList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  keyCard: {
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
  },
  keyHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
  },
  keyLabel: {
    fontSize: "13px",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  keyName: {
    fontSize: "11px",
    opacity: 0.4,
    fontFamily: "monospace",
  },
  checkmark: {
    color: "#22c55e",
    fontSize: "14px",
  },
  unconfiguredDot: {
    color: "rgba(255,255,255,0.25)",
    fontSize: "8px",
  },
  requiredBadge: {
    fontSize: "10px",
    padding: "1px 5px",
    borderRadius: "4px",
    background: "rgba(239,68,68,0.15)",
    color: "#ef4444",
    fontWeight: 500,
  },
  input: {
    width: "100%",
    marginTop: "8px",
    padding: "7px 10px",
    fontSize: "13px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.2)",
    color: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  actions: {
    marginTop: "12px",
    display: "flex",
    justifyContent: "flex-end",
  },
  saveButton: {
    padding: "7px 16px",
    fontSize: "13px",
    fontWeight: 500,
    borderRadius: "6px",
    border: "none",
    background: "#3b82f6",
    color: "#fff",
    cursor: "pointer",
  },
};
