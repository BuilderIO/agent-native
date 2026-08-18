import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import {
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type {
  SubscriptionProviderId,
  SubscriptionStatus,
} from "../../../shared/subscription-status.js";

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
  const [codexConnecting, setCodexConnecting] = useState(false);
  const [codexRefreshing, setCodexRefreshing] = useState(false);
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

  const handleConnectCodex = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api?.openCodexLogin) {
      setProviderMessage(
        "Open Agent Native Desktop to sign in to your ChatGPT subscription.",
      );
      return;
    }
    setCodexConnecting(true);
    setProviderMessage(
      "Terminal opened. Finish `codex login`, then refresh this status.",
    );
    try {
      const result = await api.openCodexLogin();
      if (!result.ok)
        setProviderMessage(result.error ?? "Terminal was not opened.");
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexConnecting(false);
    }
  }, []);

  const refreshCodexStatus = useCallback(async () => {
    const api = window.electronAPI?.codeAgents;
    if (!api?.getProviderSettings) return;
    setCodexRefreshing(true);
    try {
      const nextSettings = await api.getProviderSettings();
      onSettingsChanged(nextSettings);
      onProvidersChanged?.();
      setProviderMessage(
        nextSettings.providers.find((provider) => provider.id === "codex")
          ?.configured
          ? "ChatGPT subscription is ready on this computer."
          : "Codex is not signed in yet. Finish `codex login` in Terminal.",
      );
    } catch (err) {
      setProviderMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexRefreshing(false);
    }
  }, [onProvidersChanged, onSettingsChanged]);

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
    <div className="space-y-6">
      <SettingsGroup
        title="AI providers"
        description="Choose a provider for agent tasks."
      >
        <SettingsRow
          label="Builder.io"
          description={
            builderConnected
              ? builderProvider?.source === "environment"
                ? "Connected through environment credentials."
                : "Connected for Agent tasks."
              : "Includes a free tier for managed AI - no API key needed."
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => handleConnectBuilder()}
                disabled={builderConnecting}
              >
                {builderConnecting ? (
                  <IconLoader2 size={14} className="settings-update-spin" />
                ) : null}
                {builderConnected ? "Reconnect" : "Connect Builder.io"}
              </button>
              {builderSavedKeys ? (
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost"
                  onClick={() => handleRemoveProvider("builder")}
                  disabled={providerSavingId === "builder"}
                >
                  Remove
                </button>
              ) : null}
            </div>
          }
        />

        <SettingsRow
          label="ChatGPT subscription"
          description={
            codexConnected
              ? "Ready to run Agent tasks on this computer through Codex."
              : codexAvailable
                ? "Use your ChatGPT subscription locally through Codex."
                : "Install the OpenAI Codex CLI to use your ChatGPT subscription locally."
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span
                className={`settings-codex-status${
                  codexConnected ? " settings-codex-status--ok" : ""
                }`}
              >
                {codexConnected
                  ? "Ready"
                  : codexAvailable
                    ? "Not signed in"
                    : "Install"}
              </span>
              {codexAvailable && !codexConnected ? (
                <button
                  type="button"
                  className="settings-btn settings-btn--primary"
                  onClick={() => void handleConnectCodex()}
                  disabled={codexConnecting}
                >
                  {codexConnecting ? (
                    <IconLoader2 size={14} className="settings-update-spin" />
                  ) : null}
                  Sign in
                </button>
              ) : null}
              {codexAvailable ? (
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost"
                  onClick={() => void refreshCodexStatus()}
                  disabled={codexRefreshing}
                >
                  {codexRefreshing ? (
                    <IconLoader2 size={14} className="settings-update-spin" />
                  ) : (
                    <IconRefresh size={14} />
                  )}
                  Refresh
                </button>
              ) : null}
            </div>
          }
        />

        <SettingsRow
          label="Custom keys"
          description="Use your own provider key for direct provider access."
          control={
            <button
              type="button"
              className="settings-btn settings-btn--ghost"
              onClick={() => setShowProviderKeys((value) => !value)}
            >
              {showProviderKeys ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
              {showProviderKeys ? "Hide" : "Manage"}
            </button>
          }
        >
          {showProviderKeys ? (
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
                      {provider?.configured ? (
                        <span className="settings-provider-pill-dot" />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="settings-provider-key-summary">
                <span
                  className={`settings-remote-dot settings-remote-dot--${selectedProviderCopy.tone}`}
                />
                <span>
                  {selectedProviderCopy.label} -{" "}
                  {selectedProviderCopy.description}
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
                        selectedProviderStatus?.configuredKeys.includes(
                          field.key,
                        )
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
                    disabled={
                      providerSavingId === selectedProviderDefinition.id
                    }
                  >
                    {providerSavingId === selectedProviderDefinition.id
                      ? "Saving..."
                      : "Save key"}
                  </button>
                  {selectedProviderHasSavedKeys ? (
                    <button
                      type="button"
                      className="settings-btn settings-btn--ghost"
                      onClick={() =>
                        handleRemoveProvider(selectedProviderDefinition.id)
                      }
                      disabled={
                        providerSavingId === selectedProviderDefinition.id
                      }
                    >
                      Remove saved key
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsGroup>

      <SubscriptionSettings />

      {providerMessage ? (
        <p className="settings-provider-message" role="status">
          {providerMessage}
        </p>
      ) : null}
    </div>
  );
}

const SUBSCRIPTION_PROVIDERS: readonly SubscriptionProviderId[] = [
  "codex",
  "claude",
];

function subscriptionLabel(status: SubscriptionStatus | undefined): {
  label: string;
  description: string;
  connected: boolean;
} {
  if (!status) {
    return {
      label: "Checking…",
      description: "Checking the local CLI status.",
      connected: false,
    };
  }
  if (status.connectionState === "connected") {
    return {
      label: "Connected",
      description: status.plan?.label
        ? `${status.plan.label} subscription detected.`
        : "Subscription login detected.",
      connected: true,
    };
  }
  if (status.connectionState === "needs-sign-in") {
    return {
      label: "Not signed in",
      description: status.connectionMessage ?? "Sign in through the local CLI.",
      connected: false,
    };
  }
  if (status.connectionState === "unavailable") {
    return {
      label: "Not installed",
      description:
        status.connectionMessage ??
        "The local CLI was not found on this computer.",
      connected: false,
    };
  }
  return {
    label: "Could not check",
    description: status.connectionMessage ?? "The local CLI returned an error.",
    connected: false,
  };
}

function SubscriptionSettings() {
  const [statuses, setStatuses] = useState<
    Partial<Record<SubscriptionProviderId, SubscriptionStatus>>
  >({});
  const [busyProvider, setBusyProvider] =
    useState<SubscriptionProviderId | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async (providerId: SubscriptionProviderId) => {
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    setBusyProvider(providerId);
    setSubscriptionError(null);
    try {
      const result = await api.refreshProviderStatus(providerId);
      if (result.status) {
        setStatuses((current) => ({ ...current, [providerId]: result.status }));
      }
      if (result.error?.message) setSubscriptionError(result.error.message);
    } catch (error) {
      setSubscriptionError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyProvider(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    void Promise.all(
      SUBSCRIPTION_PROVIDERS.map(async (providerId) => {
        try {
          const result = await api.getProviderStatus(providerId);
          return [providerId, result.status] as const;
        } catch {
          return [providerId, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setStatuses((current) => {
        const next = { ...current };
        for (const [providerId, status] of entries) {
          if (status) next[providerId] = status;
        }
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, []);

  async function connect(providerId: SubscriptionProviderId) {
    const api = window.electronAPI?.multiFrontier;
    if (!api) return;
    setBusyProvider(providerId);
    setSubscriptionError(null);
    try {
      const result = await api.beginProviderLogin(providerId);
      if (result.status) {
        setStatuses((current) => ({ ...current, [providerId]: result.status }));
      }
      if (result.error?.message) setSubscriptionError(result.error.message);
    } catch (error) {
      setSubscriptionError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyProvider(null);
    }
  }

  const hasSubscriptionBridge = Boolean(window.electronAPI?.multiFrontier);

  return (
    <SettingsGroup
      title="Subscriptions"
      description="Reuse local ChatGPT/Codex and Claude Code logins."
    >
      {SUBSCRIPTION_PROVIDERS.map((providerId) => {
        const label = providerId === "codex" ? "ChatGPT / Codex" : "Claude";
        const status = hasSubscriptionBridge
          ? subscriptionLabel(statuses[providerId])
          : {
              label: "Unavailable",
              description:
                "Subscription detection is unavailable in this desktop build.",
              connected: false,
            };
        const busy = busyProvider === providerId;
        return (
          <SettingsRow
            key={providerId}
            label={label}
            description={status.description}
            status={
              <span
                className={`settings-subscription-status${
                  status.connected ? " settings-subscription-status--ok" : ""
                }`}
              >
                {status.label}
              </span>
            }
            control={
              !status.connected && statuses[providerId] ? (
                <button
                  type="button"
                  className="settings-btn settings-btn--ghost"
                  disabled={busy}
                  onClick={() =>
                    statuses[providerId]?.connectionState === "needs-sign-in"
                      ? void connect(providerId)
                      : void refresh(providerId)
                  }
                >
                  {busy
                    ? "Working…"
                    : status.label === "Not signed in"
                      ? "Sign in"
                      : "Refresh"}
                </button>
              ) : null
            }
          />
        );
      })}
      {subscriptionError ? (
        <p className="settings-provider-message px-5 pb-4" role="alert">
          {subscriptionError}
        </p>
      ) : null}
    </SettingsGroup>
  );
}
