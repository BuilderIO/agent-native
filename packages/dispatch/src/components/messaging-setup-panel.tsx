import {
  disconnectManagedIntegrationInstallation,
  listManagedIntegrationBudgets,
  listManagedIntegrationInstallations,
  listManagedIntegrationScopes,
  listIntegrationEnvStatuses,
  listIntegrationStatuses,
  managedIntegrationOAuthUrl,
  managedSlackAgentManifestUrl,
  saveIntegrationEnvVars,
  saveManagedIntegrationBudget,
  saveManagedIntegrationScope,
  setIntegrationEnabled,
  setupIntegration,
  testManagedIntegrationInstallation,
  type ClientIntegrationInstallation,
  type ClientIntegrationScope,
  type ClientIntegrationUsageBudget,
  type ClientIntegrationStatus,
  type IntegrationEnvStatus,
  useFormatters,
  useT,
} from "@agent-native/core/client";
import {
  listBuiltInChannelIntegrations,
  type IntegrationCatalogEntry,
  type IntegrationCredentialRequirement,
} from "@agent-native/core/integrations";
import {
  IconBrandDiscord,
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandTeams,
  IconBrandWhatsapp,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconFileDescription,
  IconInfoCircle,
  IconLoader2,
  IconMail,
  IconPlug,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const CHANNELS = listBuiltInChannelIntegrations();

const PLATFORM_ICONS: Partial<Record<string, typeof IconBrandSlack>> = {
  slack: IconBrandSlack,
  "microsoft-teams": IconBrandTeams,
  discord: IconBrandDiscord,
  telegram: IconBrandTelegram,
  whatsapp: IconBrandWhatsapp,
  email: IconMail,
};

function hasMissingRequiredCredentials(
  credentials: readonly IntegrationCredentialRequirement[],
  envStatusByKey: Map<string, IntegrationEnvStatus>,
) {
  const alternatives = new Map<
    string,
    readonly IntegrationCredentialRequirement[]
  >();

  for (const credential of credentials) {
    if (!credential.required) continue;
    if (!credential.alternativeGroup) {
      if (!envStatusByKey.get(credential.key)?.configured) return true;
      continue;
    }
    const group = alternatives.get(credential.alternativeGroup) ?? [];
    alternatives.set(credential.alternativeGroup, [...group, credential]);
  }

  return [...alternatives.values()].some((group) =>
    group.every(
      (credential) => !envStatusByKey.get(credential.key)?.configured,
    ),
  );
}

function HelpTooltip({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/60 hover:text-foreground cursor-pointer"
        >
          <IconInfoCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: "neutral" | "success" | "warning";
  label: string;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-border bg-muted/40 text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}
    >
      {label}
    </span>
  );
}

/** Render a non-secret env value (e.g. EMAIL_AGENT_ADDRESS) as a copyable
 *  text block. We can't read the actual value from the backend (env-status
 *  only reports `configured: true|false`), so we offer a one-click reveal
 *  that hits a server endpoint, falling back to "saved" if the value is
 *  not exposed. For now we just render a "Saved — re-enter to change"
 *  placeholder; a future endpoint can return the actual value. */
function PublicValueReveal({ envKey: _envKey }: { envKey: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      Saved. Re-enter below to change.
    </div>
  );
}

function ConnectionStatus({
  configured,
  enabled,
}: {
  configured: boolean;
  enabled: boolean;
}) {
  if (enabled) {
    return <StatusPill tone="success" label="Connected" />;
  }
  if (configured) {
    return <StatusPill tone="warning" label="Configured, not enabled" />;
  }
  return <StatusPill tone="neutral" label="Not configured" />;
}

export function MessagingSetupPanel() {
  const t = useT();
  const { formatDate } = useFormatters();
  const [statuses, setStatuses] = useState<ClientIntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [envStatuses, setEnvStatuses] = useState<IntegrationEnvStatus[]>([]);
  const [envLoading, setEnvLoading] = useState(true);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [savingKeysFor, setSavingKeysFor] = useState<string | null>(null);
  const [togglingPlatform, setTogglingPlatform] = useState<string | null>(null);
  const [setupPlatform, setSetupPlatform] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);
  const [installations, setInstallations] = useState<
    ClientIntegrationInstallation[]
  >([]);
  const [installationAction, setInstallationAction] = useState<string | null>(
    null,
  );
  const [scopes, setScopes] = useState<ClientIntegrationScope[]>([]);
  const [budgets, setBudgets] = useState<ClientIntegrationUsageBudget[]>([]);
  const [scopeBudget, setScopeBudget] = useState<Record<string, string>>({});
  const [savingScope, setSavingScope] = useState<string | null>(null);

  const refreshStatuses = async () => {
    setLoading(true);
    try {
      setStatuses(await listIntegrationStatuses());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    listIntegrationStatuses()
      .then((rows) => {
        if (active) {
          setStatuses(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    listManagedIntegrationInstallations("slack")
      .then((rows) => {
        if (active) setInstallations(rows);
      })
      .catch(() => {});
    listManagedIntegrationScopes("slack")
      .then((rows) => {
        if (active) setScopes(rows);
      })
      .catch(() => {});
    listManagedIntegrationBudgets()
      .then((rows) => {
        if (active) setBudgets(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    listIntegrationEnvStatuses()
      .then((rows) => {
        if (active) {
          setEnvStatuses(rows);
          setEnvLoading(false);
        }
      })
      .catch(() => {
        if (active) setEnvLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const envStatusByKey = useMemo(
    () => new Map(envStatuses.map((status) => [status.key, status])),
    [envStatuses],
  );
  const statusByPlatform = useMemo(
    () => new Map(statuses.map((status) => [status.platform, status])),
    [statuses],
  );

  const refreshEnvStatus = async () => {
    setEnvLoading(true);
    try {
      setEnvStatuses(await listIntegrationEnvStatuses());
    } finally {
      setEnvLoading(false);
    }
  };

  const saveEnvKeys = async (
    platform: IntegrationCatalogEntry,
    keys: string[],
  ) => {
    const vars = keys
      .map((key) => ({ key, value: envValues[key]?.trim() || "" }))
      .filter((item) => item.value);

    if (vars.length === 0) {
      toast.error("Add the required credentials first.");
      return;
    }

    setSavingKeysFor(platform.id);
    try {
      await saveIntegrationEnvVars(vars);

      toast.success(`${platform.name} credentials saved`);
      setEnvValues((current) => {
        const next = { ...current };
        for (const key of keys) delete next[key];
        return next;
      });
      await refreshEnvStatus();
      await refreshStatuses();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save credentials",
      );
    } finally {
      setSavingKeysFor(null);
    }
  };

  const togglePlatform = async (
    platform: IntegrationCatalogEntry,
    enabled: boolean,
  ) => {
    setTogglingPlatform(platform.id);
    try {
      await setIntegrationEnabled(platform.id, !enabled);
      toast.success(
        enabled
          ? `${platform.name} disconnected`
          : `${platform.name} connected`,
      );
      await refreshStatuses();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update integration",
      );
    } finally {
      setTogglingPlatform(null);
    }
  };

  const runSetup = async (platform: IntegrationCatalogEntry) => {
    setSetupPlatform(platform.id);
    try {
      await setupIntegration(platform.id);
      toast.success(
        platform.id === "telegram"
          ? "Telegram webhook registered"
          : `${platform.name} setup complete`,
      );
      await refreshStatuses();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to set up ${platform.name}`,
      );
    } finally {
      setSetupPlatform(null);
    }
  };

  const copyWebhook = async (webhookUrl: string) => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(webhookUrl);
    toast.success("Webhook URL copied");
    setTimeout(() => setCopiedWebhook(null), 1500);
  };

  const runInstallationAction = async (
    installation: ClientIntegrationInstallation,
    action: "test" | "disconnect",
  ) => {
    setInstallationAction(`${action}:${installation.id}`);
    try {
      await (action === "test"
        ? testManagedIntegrationInstallation(installation.id)
        : disconnectManagedIntegrationInstallation(installation.id));
      setInstallations(await listManagedIntegrationInstallations("slack"));
      toast.success(
        action === "test"
          ? t("messaging.managed.connectionChecked")
          : t("messaging.managed.workspaceDisconnected"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("messaging.managed.actionFailed"),
      );
    } finally {
      setInstallationAction(null);
    }
  };

  const updateScopePolicy = async (
    scope: ClientIntegrationScope,
    policy: Partial<ClientIntegrationScope["policy"]>,
  ) => {
    setSavingScope(scope.id);
    try {
      await saveManagedIntegrationScope({
        platform: scope.platform,
        tenantId: scope.tenantId,
        conversationId: scope.conversationId,
        conversationType: scope.conversationType,
        trust: scope.trust,
        orgId: scope.orgId,
        serviceOwnerEmail: scope.serviceOwnerEmail,
        defaultModel: scope.defaultModel,
        policy: { ...scope.policy, ...policy },
      });
      setScopes(await listManagedIntegrationScopes("slack"));
      toast.success(t("messaging.managed.channelPolicyUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("messaging.managed.policyUpdateFailed"),
      );
    } finally {
      setSavingScope(null);
    }
  };

  const saveScopeBudget = async (scope: ClientIntegrationScope) => {
    const dollars = Number(scopeBudget[scope.id]);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error(t("messaging.managed.positiveMonthlyBudget"));
      return;
    }
    setSavingScope(`budget:${scope.id}`);
    try {
      await saveManagedIntegrationBudget({
        subject: {
          type: "scope",
          scope: {
            platform: scope.platform,
            tenantId: scope.tenantId,
            conversationId: scope.conversationId,
          },
        },
        period: "month",
        limitMicros: Math.round(dollars * 1_000_000),
      });
      setBudgets(await listManagedIntegrationBudgets());
      toast.success(t("messaging.managed.channelBudgetSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("messaging.managed.budgetSaveFailed"),
      );
    } finally {
      setSavingScope(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {CHANNELS.map((platform) => {
          const status = statusByPlatform.get(platform.id);
          const configured =
            !!status?.configured ||
            (platform.id === "slack" &&
              installations.some(
                (installation) => installation.status === "connected",
              ));
          const enabled = !!status?.enabled;
          const envKeys = platform.credentialRequirements;
          const primaryEnvKeys = envKeys.filter(
            (envKey) => envKey.key !== "SLACK_BOT_TOKEN",
          );
          const legacyEnvKeys = envKeys.filter(
            (envKey) => envKey.key === "SLACK_BOT_TOKEN",
          );
          const missingRequiredCredentials = hasMissingRequiredCredentials(
            envKeys,
            envStatusByKey,
          );
          const Icon = PLATFORM_ICONS[platform.iconKey] ?? IconPlug;

          return (
            <section
              key={platform.id}
              className="rounded-2xl border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/30 text-foreground">
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">
                        {platform.name}
                      </h3>
                      <ConnectionStatus
                        configured={configured}
                        enabled={enabled}
                      />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {platform.description}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                  >
                    <a
                      href={platform.documentation.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Docs
                      <IconExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                  {platform.documentation.externalHref ? (
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                    >
                      <a
                        href={platform.documentation.externalHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {platform.documentation.externalLabel ?? "Open"}
                        <IconExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>

              {platform.id === "slack" ? (
                <div className="mt-5 space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {t("messaging.managed.title")}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("messaging.managed.description")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("messaging.managed.agentManifestDescription")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline" size="sm">
                          <a href={managedSlackAgentManifestUrl()}>
                            <IconFileDescription className="mr-2 h-4 w-4" />
                            {t("messaging.managed.agentManifest")}
                          </a>
                        </Button>
                        {missingRequiredCredentials ? (
                          <Button size="sm" disabled>
                            <IconBrandSlack className="mr-2 h-4 w-4" />
                            {t("messaging.managed.addToSlack")}
                          </Button>
                        ) : (
                          <Button asChild size="sm">
                            <a href={managedIntegrationOAuthUrl("slack")}>
                              <IconBrandSlack className="mr-2 h-4 w-4" />
                              {t("messaging.managed.addToSlack")}
                            </a>
                          </Button>
                        )}
                      </div>
                      {missingRequiredCredentials ? (
                        <p className="max-w-72 text-xs text-amber-700 dark:text-amber-300">
                          {t("messaging.managed.requiredCredentials")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {installations.length ? (
                    <div className="space-y-2">
                      {installations.map((installation) => (
                        <div
                          key={installation.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2"
                        >
                          <div>
                            <div className="text-sm font-medium text-foreground">
                              {installation.teamName ||
                                installation.enterpriseName ||
                                installation.teamId ||
                                t("messaging.managed.workspaceFallback")}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {t("messaging.managed.scopesUpdated", {
                                count: installation.scopes.length,
                                date: formatDate(installation.updatedAt, {
                                  dateStyle: "medium",
                                }),
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill
                              tone={
                                installation.health === "healthy"
                                  ? "success"
                                  : installation.health === "degraded" ||
                                      installation.health === "revoked"
                                    ? "warning"
                                    : "neutral"
                              }
                              label={t(
                                `messaging.managed.health.${installation.health}`,
                              )}
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                runInstallationAction(installation, "test")
                              }
                              disabled={
                                installationAction === `test:${installation.id}`
                              }
                            >
                              {t("messaging.managed.test")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                runInstallationAction(
                                  installation,
                                  "disconnect",
                                )
                              }
                              disabled={
                                installationAction ===
                                `disconnect:${installation.id}`
                              }
                            >
                              {t("messaging.managed.disconnect")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("messaging.managed.empty")}
                    </p>
                  )}
                </div>
              ) : null}

              {platform.id === "slack" && scopes.length ? (
                <div className="mt-4 space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {t("messaging.managed.channelAccessTitle")}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("messaging.managed.channelAccessDescription")}
                    </p>
                  </div>
                  {scopes.map((scope) => {
                    const subjectId = JSON.stringify([
                      scope.platform,
                      scope.tenantId,
                      scope.conversationId,
                    ]);
                    const budget = budgets.find(
                      (item) =>
                        item.subjectType === "scope" &&
                        item.subjectId === subjectId &&
                        item.period === "month",
                    );
                    return (
                      <div
                        key={scope.id}
                        className="space-y-3 rounded-lg border bg-background/60 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-mono text-xs text-foreground">
                              {scope.conversationId}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {t("messaging.managed.isolatedIdentity", {
                                trust: t(
                                  `messaging.managed.trust.${scope.trust}`,
                                ),
                              })}
                            </div>
                          </div>
                          <StatusPill
                            tone={
                              scope.trust === "trusted" ? "success" : "warning"
                            }
                            label={t(`messaging.managed.trust.${scope.trust}`)}
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            [
                              "requireMention",
                              t("messaging.managed.requireMention"),
                            ],
                            ["allowGuests", t("messaging.managed.allowGuests")],
                            [
                              "allowExternalShared",
                              t("messaging.managed.allowSlackConnect"),
                            ],
                          ].map(([key, label]) => (
                            <label
                              key={key}
                              className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs"
                            >
                              {label}
                              <Switch
                                checked={
                                  scope.policy[
                                    key as keyof ClientIntegrationScope["policy"]
                                  ]
                                }
                                disabled={savingScope === scope.id}
                                onCheckedChange={(checked) =>
                                  updateScopePolicy(scope, { [key]: checked })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-40 flex-1 space-y-1">
                            <label className="text-xs font-medium text-foreground">
                              {t("messaging.managed.monthlyBudgetUsd")}
                            </label>
                            <Input
                              inputMode="decimal"
                              value={
                                scopeBudget[scope.id] ??
                                (budget
                                  ? String(budget.limitMicros / 1_000_000)
                                  : "")
                              }
                              onChange={(event) =>
                                setScopeBudget((current) => ({
                                  ...current,
                                  [scope.id]: event.target.value,
                                }))
                              }
                              placeholder="25"
                            />
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => saveScopeBudget(scope)}
                            disabled={savingScope === `budget:${scope.id}`}
                          >
                            {t("messaging.managed.saveBudget")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <Collapsible className="mt-5">
                <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <IconChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  <span>Setup steps</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded-xl border bg-muted/20 p-4">
                    <ol className="space-y-2 text-sm text-muted-foreground">
                      {platform.setup.steps.map((step, index) => (
                        <li key={step} className="flex gap-2">
                          <span className="text-muted-foreground/60">
                            {index + 1}.
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-foreground">
                    Credentials
                  </div>
                  {envLoading ? (
                    <span className="text-xs text-muted-foreground">
                      Checking...
                    </span>
                  ) : null}
                </div>
                <div className="space-y-3">
                  {primaryEnvKeys.map((envKey) => {
                    const envStatus = envStatusByKey.get(envKey.key);
                    const isConfigured = !!envStatus?.configured;
                    const helpText = envKey.helpText ?? envStatus?.helpText;
                    const label =
                      envKey.label || envStatus?.label || envKey.key;
                    // Email agent address is not a secret — show it plainly
                    // so users can copy and share it.
                    const isPublicValue = envKey.key === "EMAIL_AGENT_ADDRESS";
                    return (
                      <div key={envKey.key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <label className="text-xs font-medium text-foreground">
                              {label}
                              {!envKey.required ? (
                                <span className="ml-1 text-muted-foreground">
                                  (optional)
                                </span>
                              ) : null}
                            </label>
                            {helpText ? (
                              <HelpTooltip content={helpText} />
                            ) : null}
                          </div>
                          {isConfigured ? (
                            <StatusPill tone="success" label="Saved" />
                          ) : (
                            <StatusPill
                              tone="neutral"
                              label={envKey.required ? "Missing" : "Not set"}
                            />
                          )}
                        </div>
                        {isConfigured && isPublicValue ? (
                          <PublicValueReveal envKey={envKey.key} />
                        ) : !isConfigured ? (
                          <Input
                            type={isPublicValue ? "text" : "password"}
                            value={envValues[envKey.key] || ""}
                            onChange={(event) =>
                              setEnvValues((current) => ({
                                ...current,
                                [envKey.key]: event.target.value,
                              }))
                            }
                            placeholder={
                              isPublicValue
                                ? "agent@yourcompany.com"
                                : `Enter ${label}`
                            }
                            autoComplete="off"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {legacyEnvKeys.length ? (
                  <Collapsible>
                    <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                      <IconChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                      <span>{legacyEnvKeys[0]?.label}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                        <p className="text-xs text-muted-foreground">
                          {legacyEnvKeys[0]?.helpText}
                        </p>
                        {legacyEnvKeys.map((envKey) => {
                          const envStatus = envStatusByKey.get(envKey.key);
                          const isConfigured = !!envStatus?.configured;
                          const helpText =
                            envKey.helpText ?? envStatus?.helpText;
                          const label =
                            envKey.label || envStatus?.label || envKey.key;
                          return (
                            <div key={envKey.key} className="space-y-1.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5">
                                  <label className="text-xs font-medium text-foreground">
                                    {label}
                                  </label>
                                  {helpText ? (
                                    <HelpTooltip content={helpText} />
                                  ) : null}
                                </div>
                                <StatusPill
                                  tone={isConfigured ? "success" : "neutral"}
                                  label={isConfigured ? "Saved" : "Not set"}
                                />
                              </div>
                              {!isConfigured ? (
                                <Input
                                  type="password"
                                  value={envValues[envKey.key] || ""}
                                  onChange={(event) =>
                                    setEnvValues((current) => ({
                                      ...current,
                                      [envKey.key]: event.target.value,
                                    }))
                                  }
                                  placeholder={`Enter ${label}`}
                                  autoComplete="off"
                                />
                              ) : null}
                            </div>
                          );
                        })}
                        {legacyEnvKeys.some(
                          (envKey) =>
                            !envStatusByKey.get(envKey.key)?.configured,
                        ) ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              saveEnvKeys(
                                platform,
                                legacyEnvKeys.map((envKey) => envKey.key),
                              )
                            }
                            disabled={savingKeysFor === platform.id}
                          >
                            {savingKeysFor === platform.id
                              ? "Saving..."
                              : "Save credentials"}
                          </Button>
                        ) : null}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
                {missingRequiredCredentials ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      saveEnvKeys(
                        platform,
                        envKeys.map((k) => k.key),
                      )
                    }
                    disabled={savingKeysFor === platform.id}
                  >
                    {savingKeysFor === platform.id ? (
                      <>
                        <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save credentials"
                    )}
                  </Button>
                ) : null}
              </div>

              {status?.webhookUrl ? (
                <div className="mt-4 space-y-2">
                  <div className="text-sm font-medium text-foreground">
                    Webhook URL
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border bg-muted/30 px-3 py-2 text-xs text-foreground">
                      {status.webhookUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => copyWebhook(status.webhookUrl!)}
                      aria-label={`Copy ${platform.name} webhook URL`}
                    >
                      {copiedWebhook === status.webhookUrl ? (
                        <IconCheck className="h-4 w-4" />
                      ) : (
                        <IconCopy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                {platform.id === "telegram" && configured ? (
                  <Button
                    variant="outline"
                    onClick={() => runSetup(platform)}
                    disabled={setupPlatform === platform.id}
                  >
                    {setupPlatform === platform.id ? (
                      <>
                        <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                        Setting up...
                      </>
                    ) : (
                      "Set up webhook"
                    )}
                  </Button>
                ) : null}
                {!configured && !enabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button disabled>Enable</Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Save the required credentials first.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    onClick={() => togglePlatform(platform, enabled)}
                    disabled={togglingPlatform === platform.id}
                  >
                    {togglingPlatform === platform.id ? (
                      <>
                        <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : enabled ? (
                      "Disable"
                    ) : (
                      "Enable"
                    )}
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Loading messaging status...
        </div>
      ) : null}
    </div>
  );
}
