import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconTerminal2,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

type ProviderStatusTone = "ok" | "offline";
const PENDING_BUILDER_CONNECT_RELOAD_KEY =
  "agent-native:pending-builder-connect-after-reload";

const EMPTY_PROVIDER_DRAFTS: Record<CodeAgentProviderCredentialKey, string> = {
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  BUILDER_PRIVATE_KEY: "",
  BUILDER_PUBLIC_KEY: "",
};

const CODE_AGENT_PROVIDER_FIELDSETS: Array<{
  id: CodeAgentProviderId;
  label: string;
  fields: Array<{
    key: CodeAgentProviderCredentialKey;
    label: string;
    placeholder: string;
  }>;
}> = [
  {
    id: "builder",
    label: "Builder.io",
    fields: [
      {
        key: "BUILDER_PRIVATE_KEY",
        label: "Private key",
        placeholder: "Paste Builder private key",
      },
      {
        key: "BUILDER_PUBLIC_KEY",
        label: "Public key",
        placeholder: "Paste Builder public key",
      },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    fields: [
      {
        key: "ANTHROPIC_API_KEY",
        label: "API key",
        placeholder: "Paste Anthropic API key",
      },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    fields: [
      {
        key: "OPENAI_API_KEY",
        label: "API key",
        placeholder: "Paste OpenAI API key",
      },
    ],
  },
  {
    id: "google",
    label: "Gemini",
    fields: [
      {
        key: "GOOGLE_GENERATIVE_AI_API_KEY",
        label: "API key",
        placeholder: "Paste Gemini API key",
      },
    ],
  },
];

function providerStatusCopy(provider: CodeAgentProviderStatus | undefined): {
  label: string;
  description: string;
  tone: ProviderStatusTone;
} {
  if (!provider) {
    return {
      label: "Unavailable",
      description: "Provider status is not available.",
      tone: "offline",
    };
  }
  if (provider.configured) {
    const source =
      provider.source === "desktop-settings"
        ? "Desktop settings"
        : provider.source === "environment"
          ? "environment"
          : provider.source === "local-codex"
            ? "local Codex CLI login"
            : "settings and environment";
    return {
      label: "Connected",
      description: `Ready from ${source}.`,
      tone: "ok",
    };
  }
  return {
    label: "Not connected",
    description:
      provider.missingKeys.length > 1
        ? `${provider.missingKeys.length} keys needed.`
        : "Key needed.",
    tone: "offline",
  };
}

function builderConnectErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("ERR_ABORTED") || message.includes("loading 'http")) {
    return "Builder.io connect was opened. Finish the browser flow to continue.";
  }
  if (
    message.includes("No handler registered") ||
    message.includes("code-agents:provider-builder:connect")
  ) {
    return "Restart Agent Native Desktop to finish enabling Builder connect.";
  }
  return message;
}

function markPendingBuilderConnectReload() {
  try {
    window.sessionStorage.setItem(PENDING_BUILDER_CONNECT_RELOAD_KEY, "1");
  } catch {
    // Ignore storage failures; the fallback message below still tells the user.
  }
}

function consumePendingBuilderConnectReload(): boolean {
  try {
    const pending =
      window.sessionStorage.getItem(PENDING_BUILDER_CONNECT_RELOAD_KEY) === "1";
    window.sessionStorage.removeItem(PENDING_BUILDER_CONNECT_RELOAD_KEY);
    return pending;
  } catch {
    return false;
  }
}

interface CodeProviderSettingsProps {
  settings: CodeAgentProviderSettings;
  onSettingsChanged: (settings: CodeAgentProviderSettings) => void;
  onProvidersChanged?: () => void;
}

export function CodeProviderSettings({
  settings,
  onSettingsChanged,
  onProvidersChanged,
}: CodeProviderSettingsProps) {
  const [providerDrafts, setProviderDrafts] = useState<
    Record<CodeAgentProviderCredentialKey, string>
  >({ ...EMPTY_PROVIDER_DRAFTS });
  const [showProviderKeys, setShowProviderKeys] = useState(false);
  const [selectedProviderId, setSelectedProviderId] =
    useState<CodeAgentProviderId>("anthropic");
  const [providerSavingId, setProviderSavingId] =
    useState<CodeAgentProviderId | null>(null);
  const [builderConnecting, setBuilderConnecting] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);

  const builderProvider = settings.providers.find(
    (provider) => provider.id === "builder",
  );
  const codexProvider = settings.providers.find(
    (provider) => provider.id === "codex",
  );
  const builderConnected = Boolean(builderProvider?.configured);
  const codexAvailable = Boolean(codexProvider);
  const codexConnected = Boolean(codexProvider?.configured);
  const builderSavedKeys = Boolean(builderProvider?.savedKeys.length);
  const selectedProviderDefinition =
    CODE_AGENT_PROVIDER_FIELDSETS.find(
      (provider) => provider.id === selectedProviderId,
    ) ?? CODE_AGENT_PROVIDER_FIELDSETS[0];
  const selectedProviderStatus = settings.providers.find(
    (provider) => provider.id === selectedProviderDefinition.id,
  );
  const selectedProviderCopy = providerStatusCopy(selectedProviderStatus);
  const selectedProviderHasSavedKeys = Boolean(
    selectedProviderStatus?.savedKeys.length,
  );

  const updateProviderDraft = useCallback(
    (key: CodeAgentProviderCredentialKey, value: string) => {
      setProviderDrafts((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const clearProviderDrafts = useCallback(
    (fields: Array<{ key: CodeAgentProviderCredentialKey }>) => {
      setProviderDrafts((current) => {
        const next = { ...current };
        for (const field of fields) next[field.key] = "";
        return next;
      });
    },
    [],
  );

  const handleConnectBuilder = useCallback(
    async (allowShellReload = true) => {
      const api = window.electronAPI?.codeAgents;
      setProviderMessage(null);
      if (!api?.connectBuilderProvider) {
        if (allowShellReload) {
          markPendingBuilderConnectReload();
          setProviderMessage("Refreshing Agent Native Desktop...");
          window.setTimeout(() => window.location.reload(), 50);
          return;
        }
        setProviderMessage(
          "Restart Agent Native Desktop to finish enabling Builder connect.",
        );
        return;
      }
      setBuilderConnecting(true);
      setProviderMessage(
        "Opened Builder.io in your browser. Finish the flow there to continue.",
      );
      try {
        const result = await api.connectBuilderProvider();
        onSettingsChanged(result.settings);
        setProviderMessage(
          result.error
            ? builderConnectErrorMessage(result.error)
            : result.message,
        );
        onProvidersChanged?.();
      } catch (err) {
        setProviderMessage(builderConnectErrorMessage(err));
      } finally {
        setBuilderConnecting(false);
      }
    },
    [onProvidersChanged, onSettingsChanged],
  );

  useEffect(() => {
    if (!consumePendingBuilderConnectReload()) return;
    void handleConnectBuilder(false);
  }, [handleConnectBuilder]);

  const handleSaveProvider = useCallback(
    async (providerId: CodeAgentProviderId) => {
      const api = window.electronAPI?.codeAgents;
      if (!api?.updateProviderSettings) return;
      const definition = CODE_AGENT_PROVIDER_FIELDSETS.find(
        (provider) => provider.id === providerId,
      );
      if (!definition) return;
      const updates: CodeAgentProviderSettingsUpdate = {};
      for (const field of definition.fields) {
        const value = providerDrafts[field.key].trim();
        if (value) updates[field.key] = value;
      }
      if (Object.keys(updates).length === 0) {
        setProviderMessage("Paste a key to save.");
        return;
      }
      setProviderSavingId(providerId);
      setProviderMessage(null);
      try {
        const result = await api.updateProviderSettings(updates);
        onSettingsChanged(result.settings);
        setProviderMessage(result.error ?? result.message);
        clearProviderDrafts(definition.fields);
        onProvidersChanged?.();
      } catch (err) {
        setProviderMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setProviderSavingId(null);
      }
    },
    [
      clearProviderDrafts,
      onProvidersChanged,
      onSettingsChanged,
      providerDrafts,
    ],
  );

  const handleRemoveProvider = useCallback(
    async (providerId: CodeAgentProviderId) => {
      const api = window.electronAPI?.codeAgents;
      if (!api?.updateProviderSettings) return;
      const definition = CODE_AGENT_PROVIDER_FIELDSETS.find(
        (provider) => provider.id === providerId,
      );
      if (!definition) return;
      const updates: CodeAgentProviderSettingsUpdate = {};
      for (const field of definition.fields) updates[field.key] = null;
      setProviderSavingId(providerId);
      setProviderMessage(null);
      try {
        const result = await api.updateProviderSettings(updates);
        onSettingsChanged(result.settings);
        setProviderMessage(result.error ?? result.message);
        clearProviderDrafts(definition.fields);
        onProvidersChanged?.();
      } catch (err) {
        setProviderMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setProviderSavingId(null);
      }
    },
    [clearProviderDrafts, onProvidersChanged, onSettingsChanged],
  );

  return (
    <div className="settings-provider-card">
      <div className="settings-provider-card-header">
        <div>
          <span className="settings-mode-card-title">Agent runtimes</span>
          <span className="settings-mode-card-status">
            {settings.configured
              ? `${settings.configuredProviders.join(", ")} ready`
              : "Connect Builder.io, run codex login, or add an API key before chatting."}
          </span>
        </div>
      </div>

      <div
        className={`settings-builder-connect-card${
          builderConnected ? " settings-builder-connect-card--ok" : ""
        }`}
      >
        <div className="settings-builder-connect-copy">
          <span className="settings-builder-title">Builder.io</span>
          <span className="settings-builder-description">
            {builderConnected
              ? builderProvider?.source === "environment"
                ? "Connected through environment credentials."
                : "Connected for Agent tasks."
              : "Free credits to start - no API key needed."}
          </span>
        </div>
        <div className="settings-builder-actions">
          <button
            type="button"
            className="settings-builder-connect-button"
            onClick={() => handleConnectBuilder()}
            disabled={builderConnecting}
          >
            {builderConnecting ? (
              <>
                <IconLoader2
                  size={13}
                  className="settings-builder-connect-spinner"
                />
                Waiting...
              </>
            ) : (
              <>
                {builderConnected ? "Reconnect" : "Connect Builder.io"}
                <IconExternalLink size={13} />
              </>
            )}
          </button>
          {builderSavedKeys && (
            <button
              type="button"
              className="settings-provider-text-button"
              onClick={() => handleRemoveProvider("builder")}
              disabled={providerSavingId === "builder"}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div
        className={`settings-builder-connect-card${
          codexConnected ? " settings-builder-connect-card--ok" : ""
        }`}
      >
        <div className="settings-builder-connect-copy">
          <span className="settings-builder-title">Codex CLI</span>
          <span className="settings-builder-description">
            {codexConnected
              ? `Using ${codexProvider?.label ?? "Codex CLI"} for Agent tasks.`
              : codexAvailable
                ? "Run codex login in Terminal; Desktop will pick up the local session."
                : "Install the OpenAI Codex CLI, then run codex login in Terminal."}
          </span>
        </div>
        <span
          className={`settings-codex-status${
            codexConnected ? " settings-codex-status--ok" : ""
          }`}
        >
          <IconTerminal2 size={13} />
          {codexConnected ? "Ready" : codexAvailable ? "Sign in" : "Install"}
        </span>
      </div>

      <button
        type="button"
        className="settings-provider-advanced-toggle"
        onClick={() => setShowProviderKeys((value) => !value)}
      >
        {showProviderKeys ? (
          <IconChevronDown size={14} />
        ) : (
          <IconChevronRight size={14} />
        )}
        <span>Or add an API key</span>
      </button>

      {showProviderKeys && (
        <div className="settings-provider-key-panel">
          <div className="settings-provider-picker">
            {CODE_AGENT_PROVIDER_FIELDSETS.map((definition) => {
              const provider = settings.providers.find(
                (item) => item.id === definition.id,
              );
              return (
                <button
                  key={definition.id}
                  type="button"
                  className={`settings-provider-pill${
                    selectedProviderDefinition.id === definition.id
                      ? " settings-provider-pill--active"
                      : ""
                  }`}
                  onClick={() => setSelectedProviderId(definition.id)}
                >
                  {definition.label}
                  {provider?.configured && (
                    <span className="settings-provider-pill-dot" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="settings-provider-key-summary">
            <span
              className={`settings-remote-dot settings-remote-dot--${selectedProviderCopy.tone}`}
            />
            <span>
              {selectedProviderCopy.label} - {selectedProviderCopy.description}
            </span>
          </div>

          <div className="settings-provider-form">
            {selectedProviderDefinition.fields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type="password"
                  value={providerDrafts[field.key]}
                  onChange={(e) =>
                    updateProviderDraft(field.key, e.target.value)
                  }
                  placeholder={
                    selectedProviderStatus?.configuredKeys.includes(field.key)
                      ? "Leave blank to keep existing key"
                      : field.placeholder
                  }
                  autoComplete="off"
                />
              </label>
            ))}
            <div className="settings-provider-actions">
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() =>
                  handleSaveProvider(selectedProviderDefinition.id)
                }
                disabled={providerSavingId === selectedProviderDefinition.id}
              >
                {providerSavingId === selectedProviderDefinition.id
                  ? "Saving..."
                  : "Save key"}
              </button>
              {selectedProviderHasSavedKeys && (
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost"
                  onClick={() =>
                    handleRemoveProvider(selectedProviderDefinition.id)
                  }
                  disabled={providerSavingId === selectedProviderDefinition.id}
                >
                  Remove saved key
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {providerMessage && (
        <div className="settings-provider-message">{providerMessage}</div>
      )}
    </div>
  );
}
