import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@agent-native/toolkit/ui/command";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@agent-native/toolkit/ui/toggle-group";
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconDeviceDesktop,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconRoute,
  IconServer2,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  deleteAgentEnginePersonalProviderSettings,
  getAgentEngineProviderKeyStatus,
  saveAgentEngineProviderSettings,
  setAgentEngineProvider,
  type AgentEngineProviderKeyStatus,
} from "../agent-engine-key.js";
import {
  AGENT_PROVIDER_CATALOG,
  getAgentProviderOption,
  type AgentProviderId,
  type AgentProviderOption,
} from "../agent-provider-catalog.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { useT } from "../i18n.js";
import { useOrgRole } from "../org/hooks.js";
import { cn } from "../utils.js";

export interface AgentProviderPickerProps {
  value: AgentProviderId;
  onChange: (provider: AgentProviderId) => void;
  options?: readonly AgentProviderOption[];
  configuredProviders?: ReadonlySet<AgentProviderId>;
  disabled?: boolean;
  className?: string;
  layout?: "compact" | "page";
}

function ProviderIcon({
  option,
  size = 15,
}: {
  option: AgentProviderOption;
  size?: number;
}) {
  if (option.kind === "local") return <IconDeviceDesktop size={size} />;
  if (option.kind === "gateway") return <IconRoute size={size} />;
  return <IconCloud size={size} />;
}

export function AgentProviderPicker({
  value,
  onChange,
  options = AGENT_PROVIDER_CATALOG,
  configuredProviders,
  disabled = false,
  className,
  layout = "compact",
}: AgentProviderPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const active = getAgentProviderOption(value);
  const isPage = layout === "page";

  return (
    <div className={cn("space-y-1.5", className)}>
      <p
        className={cn(
          "font-medium text-foreground",
          isPage ? "text-sm" : "text-[11px]",
        )}
      >
        {t("agentPanel.chooseProvider", {
          defaultValue: "Choose a provider",
        })}
      </p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("agentPanel.chooseProvider", {
              defaultValue: "Choose a provider",
            })}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-border bg-background text-start text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60",
              isPage ? "min-h-10 px-3 text-sm" : "min-h-9 px-2.5 text-[12px]",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/50 text-muted-foreground">
              <ProviderIcon option={active} size={isPage ? 16 : 14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{active.label}</span>
            </span>
            <IconChevronDown
              size={isPage ? 16 : 14}
              className="shrink-0 text-muted-foreground"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[min(390px,calc(100vw-2rem))] p-0"
        >
          <Command
            filter={(candidate, search) =>
              candidate.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput
              placeholder={t("agentPanel.searchProviders", {
                defaultValue: "Search providers...",
              })}
            />
            <CommandList className="max-h-[min(440px,calc(100vh-8rem))]">
              <CommandEmpty>
                {t("agentPanel.noProvidersFound", {
                  defaultValue: "No providers found.",
                })}
              </CommandEmpty>
              <CommandGroup
                heading={t("agentPanel.availableProviders", {
                  defaultValue: "Available providers",
                })}
              >
                {options.map((option) => {
                  const configured = configuredProviders?.has(option.id);
                  return (
                    <CommandItem
                      key={option.id}
                      value={`${option.label} ${option.description} ${option.key ?? "local"}`}
                      onSelect={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      className="items-center gap-2.5 py-2.5"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/50 text-muted-foreground">
                        <ProviderIcon option={option} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">
                            {option.label}
                          </span>
                          {configured ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-primary">
                              <IconCheck size={11} />
                              {t("agentPanel.configured", {
                                defaultValue: "Configured",
                              })}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {option.key
                          ? t("agentPanel.apiKey", {
                              defaultValue: "API key",
                            })
                          : t("agentPanel.localRuntime", {
                              defaultValue: "Local",
                            })}
                      </span>
                      <IconCheck
                        size={15}
                        className={cn(
                          "shrink-0",
                          option.id === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export interface AgentProviderSetupFormProps {
  initialProvider?: AgentProviderId;
  configuredProviders?: ReadonlySet<AgentProviderId>;
  onConnected?: (provider: AgentProviderId) => void;
  scope?: "user" | "org";
  layout?: "compact" | "page";
  showTitle?: boolean;
  className?: string;
}

export function AgentProviderSetupForm({
  initialProvider = "anthropic",
  configuredProviders,
  onConnected,
  scope,
  layout = "compact",
  showTitle = true,
  className,
}: AgentProviderSetupFormProps) {
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const isPage = layout === "page";
  const [provider, setProvider] = useState<AgentProviderId>(initialProvider);
  const [selectedScope, setSelectedScope] = useState<"user" | "org">("user");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [endpointOpen, setEndpointOpen] = useState(
    initialProvider === "ollama",
  );
  const [saving, setSaving] = useState(false);
  const [removingPersonalKey, setRemovingPersonalKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerKeyStatus, setProviderKeyStatus] =
    useState<AgentEngineProviderKeyStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const providerScope = scope ?? selectedScope;
  const active = getAgentProviderOption(provider);

  useEffect(() => {
    if (scope === undefined) setSelectedScope(canManageOrg ? "org" : "user");
  }, [canManageOrg, scope]);

  const refreshProviderKeyStatus = async () => {
    if (!active.key) {
      setProviderKeyStatus(null);
      setStatusError(false);
      return;
    }
    try {
      const status = await getAgentEngineProviderKeyStatus(provider);
      setProviderKeyStatus(status);
      setStatusError(status.status === "unknown");
    } catch {
      setProviderKeyStatus(null);
      setStatusError(true);
    }
  };

  useEffect(() => {
    if (!active.key) {
      setProviderKeyStatus(null);
      setStatusError(false);
      return;
    }
    let cancelled = false;
    void getAgentEngineProviderKeyStatus(provider)
      .then((status) => {
        if (cancelled) return;
        setProviderKeyStatus(status);
        setStatusError(status.status === "unknown");
      })
      .catch(() => {
        if (cancelled) return;
        setProviderKeyStatus(null);
        setStatusError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    setModel(active.defaultModel);
    setApiKey("");
    setEndpoint("");
    setEndpointOpen(provider === "ollama");
    setError(null);
    setSaved(false);
  }, [active.defaultModel, provider]);

  const handleProviderChange = (nextProvider: AgentProviderId) => {
    setProvider(nextProvider);
  };

  const handleSave = async () => {
    if (saving) return;
    if (active.key && !apiKey.trim()) {
      setError(
        t("agentPanel.enterApiKey", {
          defaultValue: `Enter your ${active.label} API key.`,
        }),
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (active.key || endpoint.trim()) {
        await saveAgentEngineProviderSettings({
          provider,
          ...(active.key ? { key: active.key } : {}),
          ...(apiKey.trim() ? { apiKey } : {}),
          ...(endpoint.trim() ? { baseUrl: endpoint } : {}),
          scope: providerScope,
        });
      }
      await setAgentEngineProvider({
        provider,
        model: model.trim() || active.defaultModel,
      });
      setApiKey("");
      setSaved(true);
      void refreshProviderKeyStatus();
      onConnected?.(provider);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("agentPanel.providerSetupFailed", {
              defaultValue: "Could not configure this provider.",
            }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleUseOrganizationKey = async () => {
    if (removingPersonalKey) return;
    setRemovingPersonalKey(true);
    setError(null);
    try {
      await deleteAgentEnginePersonalProviderSettings(provider);
      await refreshProviderKeyStatus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("agentPanel.providerSetupFailed", {
              defaultValue: "Could not configure this provider.",
            }),
      );
    } finally {
      setRemovingPersonalKey(false);
    }
  };

  const isConfigured =
    configuredProviders?.has(provider) ||
    providerKeyStatus?.status === "set" ||
    saved;
  const modelInputVisible = active.supportsCustomModel;
  const endpointVisible = active.supportsEndpoint;

  return (
    <form
      className={cn("space-y-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {showTitle ? (
        <div>
          <div className="flex items-center gap-2">
            <IconKey
              size={isPage ? 16 : 13}
              className="text-muted-foreground"
            />
            <h4
              className={cn(
                "font-medium text-foreground",
                isPage ? "text-sm" : "text-[11px]",
              )}
            >
              {t("agentPanel.addOwnKeys", {
                defaultValue: "Custom keys",
              })}
            </h4>
          </div>
          <p
            className={cn(
              "mt-1 leading-relaxed text-muted-foreground",
              isPage ? "text-xs" : "text-[11px]",
            )}
          >
            {t("agentPanel.configureProviderKeys", {
              defaultValue: "Choose a provider.",
            })}
          </p>
        </div>
      ) : null}

      {canManageOrg && scope === undefined ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-foreground">
            {t("agentPanel.keyScope")}
          </p>
          <ToggleGroup
            type="single"
            value={providerScope}
            onValueChange={(value) => {
              if (value === "user" || value === "org") setSelectedScope(value);
            }}
            disabled={saving}
            aria-label={t("agentPanel.keyScope")}
            className="inline-flex rounded-md border border-border p-0.5"
          >
            <ToggleGroupItem value="user" size="sm">
              {t("agentPanel.personalKeyScope")}
            </ToggleGroupItem>
            <ToggleGroupItem value="org" size="sm">
              {t("agentPanel.organizationKeyScope")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      ) : null}

      {providerKeyStatus?.effectiveScope === "user" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{t("agentPanel.personalKeyInEffect")}</span>
          {providerKeyStatus.organizationKeyPresent ? (
            <button
              type="button"
              disabled={removingPersonalKey || saving}
              onClick={() => void handleUseOrganizationKey()}
              className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              {removingPersonalKey
                ? t("agentPanel.savingProvider", { defaultValue: "Saving..." })
                : t("agentPanel.useOrganizationKey")}
            </button>
          ) : null}
        </div>
      ) : providerKeyStatus?.effectiveScope === "org" ? (
        <p className="text-[11px] text-muted-foreground">
          {t("agentPanel.organizationKeyInEffect")}
        </p>
      ) : providerKeyStatus?.effectiveScope === "workspace" ? (
        <p className="text-[11px] text-muted-foreground">
          {t("agentPanel.sharedKeyInEffect")}
        </p>
      ) : statusError ? (
        <p className="text-[11px] text-muted-foreground">
          {t("agentPanel.keyStatusUnavailable")}
        </p>
      ) : null}

      <AgentProviderPicker
        value={provider}
        onChange={handleProviderChange}
        configuredProviders={configuredProviders}
        disabled={saving}
        layout={layout}
      />

      <div
        className={cn(
          "rounded-md border border-border bg-accent/20",
          isPage ? "space-y-3 p-3.5" : "space-y-2.5 p-2.5",
        )}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            {active.kind === "local" ? (
              <IconDeviceDesktop size={isPage ? 15 : 13} />
            ) : active.kind === "gateway" ? (
              <IconRoute size={isPage ? 15 : 13} />
            ) : (
              <IconBolt size={isPage ? 15 : 13} />
            )}
          </span>
          <div className="min-w-0 flex-1" title={active.description}>
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  "font-medium text-foreground",
                  isPage ? "text-sm" : "text-[12px]",
                )}
              >
                {active.label}
              </p>
              {isConfigured ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                  <IconCheck size={11} />
                  {t("agentPanel.configured", {
                    defaultValue: "Configured",
                  })}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {active.key ? (
          <label className="block space-y-1.5">
            <span
              className={cn(
                "font-medium text-foreground",
                isPage ? "text-xs" : "text-[11px]",
              )}
            >
              {t("agentPanel.apiKey", { defaultValue: "API key" })}
            </span>
            <input
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={active.placeholder}
              disabled={saving}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (error) setError(null);
              }}
              className={cn(
                "w-full rounded-md border border-input bg-background text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background placeholder:text-muted-foreground/50",
                isPage ? "h-10 px-3 text-sm" : "h-8 px-2.5 text-[12px]",
              )}
            />
          </label>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-2">
            <IconServer2
              size={isPage ? 15 : 13}
              className="mt-0.5 shrink-0 text-muted-foreground"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("agentPanel.noApiKeyNeeded", {
                defaultValue: "No API key required.",
              })}
            </p>
          </div>
        )}

        {modelInputVisible ? (
          <label className="block space-y-1.5">
            <span
              className={cn(
                "font-medium text-foreground",
                isPage ? "text-xs" : "text-[11px]",
              )}
            >
              {t("agentPanel.modelId", { defaultValue: "Model ID" })}
            </span>
            <input
              type="text"
              value={model}
              list={`agent-provider-models-${provider}`}
              disabled={saving}
              spellCheck={false}
              autoComplete="off"
              placeholder={active.defaultModel}
              onChange={(event) => setModel(event.target.value)}
              className={cn(
                "w-full rounded-md border border-input bg-background text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background placeholder:text-muted-foreground/50",
                isPage ? "h-10 px-3 text-sm" : "h-8 px-2.5 text-[12px]",
              )}
            />
            <datalist id={`agent-provider-models-${provider}`}>
              {active.supportedModels.map((modelOption) => (
                <option key={modelOption} value={modelOption} />
              ))}
            </datalist>
          </label>
        ) : null}

        {endpointVisible ? (
          <div className="border-t border-border/70 pt-2">
            <button
              type="button"
              onClick={() => setEndpointOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 text-start text-[11px] font-medium text-foreground"
              aria-expanded={endpointOpen}
              title={
                provider === "ollama"
                  ? "Defaults to Ollama at http://localhost:11434."
                  : "Use for LiteLLM or another OpenAI-compatible gateway."
              }
            >
              <span className="inline-flex items-center gap-1.5">
                <IconChevronDown
                  size={13}
                  className={cn(
                    "text-muted-foreground transition-transform",
                    !endpointOpen && "-rotate-90",
                  )}
                />
                {t("agentPanel.endpointUrl", {
                  defaultValue: "Endpoint URL",
                })}
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {t("agentPanel.optional", { defaultValue: "Optional" })}
              </span>
            </button>
            {endpointOpen ? (
              <div className="mt-2 space-y-1.5">
                <input
                  type="url"
                  value={endpoint}
                  disabled={saving}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={active.endpointPlaceholder}
                  onChange={(event) => setEndpoint(event.target.value)}
                  className={cn(
                    "w-full rounded-md border border-input bg-background text-foreground outline-none transition-colors hover:bg-accent/40 focus:ring-1 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background placeholder:text-muted-foreground/50",
                    isPage ? "h-10 px-3 text-sm" : "h-8 px-2.5 text-[12px]",
                  )}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="submit"
            disabled={saving || Boolean(active.key && !apiKey.trim())}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
              isPage ? "h-9 px-3 text-xs" : "h-8 px-3 text-[11px]",
            )}
          >
            {saving ? (
              <>
                <IconLoader2 size={isPage ? 14 : 11} className="animate-spin" />
                {t("agentPanel.savingProvider", {
                  defaultValue: "Saving...",
                })}
              </>
            ) : saved ? (
              <>
                <IconCheck size={isPage ? 14 : 11} />
                {t("agentPanel.providerSaved", {
                  defaultValue: "Connected",
                })}
              </>
            ) : provider === "ollama" ? (
              t("agentPanel.useProvider", {
                provider: active.label,
                defaultValue: `Use ${active.label}`,
              })
            ) : (
              t("agentPanel.saveAndUseProvider", {
                provider: active.label,
                defaultValue: `Save and use ${active.label}`,
              })
            )}
          </button>
          {active.docsUrl ? (
            <a
              href={active.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground no-underline transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {t("agentPanel.getApiKey", { defaultValue: "Get an API key" })}
              <IconExternalLink size={11} />
            </a>
          ) : null}
        </div>
        {error ? (
          <div
            role="alert"
            aria-live="polite"
            className="space-y-1 text-[11px] leading-relaxed text-destructive"
          >
            <p>{error}</p>
            {active.docsUrl ? (
              <a
                href={active.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
              >
                {t("agentPanel.getApiKey", { defaultValue: "Get an API key" })}
                <IconExternalLink size={11} />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}
