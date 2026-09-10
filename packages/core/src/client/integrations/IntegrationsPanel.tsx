import {
  IconPlus,
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandGoogleDrive,
  IconTerminal2,
  IconCopy,
  IconCheck,
  IconChevronLeft,
  IconExternalLink,
  IconCircleCheck,
  IconInfoCircle,
  IconSearch,
  IconLoader2,
  IconRefresh,
  IconMail,
  IconBrowser,
} from "@tabler/icons-react";
import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from "react";

import {
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
} from "../../navigation/index.js";
import {
  matchesMcpConnectHost,
  resolveMcpConnectGuideId,
} from "../../shared/mcp-connect-content.js";
import { agentNativePath, appMountedPath, appPath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import {
  getDefaultMcpIntegrations,
  isMcpIntegrationUrl,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import { mcpIntegrationLogo } from "../resources/mcp-integration-logos.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  useReconnectMcpServer,
  type McpServer,
} from "../resources/use-mcp-servers.js";
import { BuilderConnectPopover } from "../settings/BuilderConnectPopover.js";
import { SettingsCrossLinkHint } from "../settings/SettingsCrossLinkHint.js";
import {
  SettingsSection,
  SettingsSurfaceProvider,
} from "../settings/SettingsSection.js";
import type { BuilderConnectFlow } from "../settings/useBuilderStatus.js";
import {
  BuilderConnectCard,
  BuilderConnectionMenu,
} from "../setup-connections/BuilderConnectCard.js";
import { cn } from "../utils.js";
import {
  IntegrationGrid,
  type IntegrationGridItem,
} from "./IntegrationGrid.js";
import {
  useIntegrationStatus,
  type IntegrationStatus,
} from "./useIntegrationStatus.js";
import { isNonPublicWebhookUrl } from "./webhook-url.js";

// ─── Platform config ─────────────────────────────────────────────────────────

interface PlatformInfo {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  description: string;
  envVars: string[];
  setupSteps: string[];
  docsUrl?: string;
  /** If true, this is a "client" integration (user connects TO the agent) rather than a webhook */
  isClient?: boolean;
  category: "Messaging" | "Workspace tools" | "Agent clients";
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: "slack",
    label: "Slack",
    icon: IconBrandSlack,
    description:
      "@mention the agent in a Slack thread or DM it, and it replies in that thread.",
    envVars: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    setupSteps: [
      "At api.slack.com/apps, create an app for your workspace, then under OAuth & Permissions add the bot scopes app_mentions:read, chat:write, channels:history, and im:history",
      "Click Install to Workspace, then copy the Bot User OAuth Token and the Signing Secret (Basic Information → App Credentials) into the two secrets listed below",
      "Under Event Subscriptions, turn events on, paste the webhook URL below as the Request URL, and subscribe to the bot events app_mention and message.im",
      "Invite the bot to a channel, @mention it in a thread, and confirm it replies in that same thread",
      "Running inside a Dispatch workspace instead? Connect Slack from Settings → Messaging there — it stores workspace tokens for you and this page is not needed.",
    ],
    docsUrl: "https://api.slack.com/apps",
    category: "Messaging",
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: IconBrandTelegram,
    description: "Chat with your agent via a Telegram bot.",
    envVars: ["TELEGRAM_BOT_TOKEN"],
    setupSteps: [
      "Message @BotFather on Telegram to create a new bot",
      "Copy the bot token into your environment",
      'Click "Setup webhook" below to register automatically',
    ],
    category: "Messaging",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: IconBrandWhatsapp,
    description: "Connect your agent to WhatsApp Business.",
    envVars: ["WHATSAPP_TOKEN", "WHATSAPP_VERIFY_TOKEN"],
    setupSteps: [
      "Create a Meta Business app at developers.facebook.com",
      "Set up WhatsApp Business API",
      "Configure the webhook URL and verify token",
      "Copy the access token into your environment",
    ],
    docsUrl: "https://developers.facebook.com/docs/whatsapp",
    category: "Messaging",
  },
  {
    id: "google-docs",
    label: "Google Docs",
    icon: IconBrandGoogleDrive,
    description: "Tag the agent in Google Doc comments to get responses.",
    envVars: ["GOOGLE_SERVICE_ACCOUNT_KEY"],
    setupSteps: [
      "Create a Google Cloud service account and download the JSON key",
      "Set GOOGLE_SERVICE_ACCOUNT_KEY in your environment (JSON string or file path)",
      "Share your Google Docs with the service account email",
      'Write a comment containing "@Agent" to trigger the agent',
    ],
    category: "Workspace tools",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    icon: IconTerminal2,
    description: "Access this agent from OpenClaw's unified agent interface.",
    envVars: [],
    isClient: true,
    setupSteps: [
      "Install OpenClaw: npm install -g openclaw",
      "Add this agent's URL as a provider in your OpenClaw config",
      "OpenClaw discovers your agent's capabilities via the A2A protocol",
    ],
    category: "Agent clients",
  },
];

function useAgentEngineConfigured() {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);

  const refresh = useCallback(() => {
    fetch(agentNativePath("/_agent-native/agent-engine/status"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (typeof data?.configured === "boolean") {
          setConfigured(data.configured);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () =>
      window.removeEventListener("agent-engine:configured-changed", refresh);
  }, [refresh]);

  return configured;
}

// ─── Integration detail view ─────────────────────────────────────────────────

function IntegrationDetail({
  platform,
  serverStatus,
  onBack,
  onRefresh,
}: {
  platform: PlatformInfo;
  serverStatus?: IntegrationStatus;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const agentEngineConfigured = useAgentEngineConfigured();

  const handleToggle = useCallback(async () => {
    setToggling(true);
    setToggleError(null);
    try {
      const action = serverStatus?.enabled ? "disable" : "enable";
      const res = await fetch(
        agentNativePath(`/_agent-native/integrations/${platform.id}/${action}`),
        { method: "POST" },
      );
      if (res.ok) {
        onRefresh();
        return;
      }
      // Surface the real reason instead of silently doing nothing.
      // The endpoint returns `{ error }` for known failures (admin gating,
      // missing secrets, etc.); fall back to status text otherwise.
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setToggleError(
        data?.error ||
          res.statusText ||
          `Couldn't ${action} ${platform.label} (HTTP ${res.status})`,
      );
    } catch (err) {
      setToggleError(
        err instanceof Error ? err.message : t("integrations.networkError"),
      );
    } finally {
      setToggling(false);
    }
  }, [platform.id, platform.label, serverStatus?.enabled, onRefresh]);

  const handleCopy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleOpenLlmSettings = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: { section: "llm" },
      }),
    );
  }, []);

  const isConfigured = serverStatus?.configured ?? false;
  const isEnabled = serverStatus?.enabled ?? false;
  const showAgentEnginePrereq =
    !platform.isClient && agentEngineConfigured === false;
  const serviceAccountEmail =
    typeof serverStatus?.details?.serviceAccountEmail === "string"
      ? serverStatus.details.serviceAccountEmail
      : null;

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-2"
      >
        <IconChevronLeft size={12} className="rtl:-scale-x-100" />
        {t("integrations.back")}
      </button>

      <div className="flex items-center gap-2 mb-2">
        <platform.icon size={18} className="text-foreground shrink-0" />
        <div>
          <div className="text-xs font-medium text-foreground">
            {platform.label}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {platform.description}
          </div>
        </div>
      </div>

      {showAgentEnginePrereq && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-foreground">
                {t("integrations.agentEngineRequired")}
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                {t("integrations.agentEngineDescription", {
                  platform: platform.label,
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenLlmSettings}
              className="shrink-0 rounded border border-border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {t("integrations.openLlm")}
            </button>
          </div>
        </div>
      )}

      {/* Setup steps */}
      <div className="mb-3">
        <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
          {t("integrations.setup")}
        </div>
        <ol className="space-y-1">
          {platform.setupSteps.map((step, i) => (
            <li
              key={i}
              className="flex gap-1.5 text-[10px] text-muted-foreground leading-relaxed"
            >
              <span className="shrink-0 text-muted-foreground/50">
                {i + 1}.
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {serviceAccountEmail && (
        <div className="mb-3">
          <div className="text-[10px] font-medium text-muted-foreground mb-1">
            {t("integrations.shareDocumentsWith")}
          </div>
          <div className="flex items-center gap-1">
            <code className="flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
              {serviceAccountEmail}
            </code>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleCopy(serviceAccountEmail)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                >
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t("integrations.copyServiceAccountEmail")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Required secrets */}
      {platform.envVars.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-medium text-muted-foreground mb-1">
            {t("integrations.requiredSecrets")}
          </div>
          <div className="space-y-0.5">
            {platform.envVars.map((v) => (
              <div key={v} className="flex items-center gap-1">
                <code className="text-[10px] text-foreground bg-muted px-1 py-0.5 rounded">
                  {v}
                </code>
                {isConfigured && (
                  <IconCircleCheck
                    size={11}
                    className="text-green-500 shrink-0"
                  />
                )}
              </div>
            ))}
          </div>
          {!isConfigured && (
            <p className="text-[10px] text-amber-500 mt-1">
              {t("integrations.envHelp")}
            </p>
          )}
        </div>
      )}

      {/* Webhook URL */}
      {serverStatus?.webhookUrl && !platform.isClient && (
        <div className="mb-3">
          <div className="text-[10px] font-medium text-muted-foreground mb-1">
            {t("integrations.webhookUrl")}
          </div>
          {isNonPublicWebhookUrl(serverStatus.webhookUrl) ? (
            <div className="flex gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <IconInfoCircle size={12} className="mt-px shrink-0" />
              <span>
                {t("integrations.webhookUrlLocalOnly", {
                  platform: platform.label,
                  url: serverStatus.webhookUrl,
                })}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <code className="flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                {serverStatus.webhookUrl}
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleCopy(serverStatus.webhookUrl!)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  >
                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("integrations.copy")}</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      )}

      {/* Docs link */}
      {platform.docsUrl && (
        <a
          href={platform.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 mb-3"
        >
          {t("integrations.documentation")}
          <IconExternalLink size={10} />
        </a>
      )}

      {/* Enable/disable for server integrations */}
      {serverStatus && !platform.isClient && isConfigured && (
        <button
          onClick={handleToggle}
          disabled={toggling}
          className={`w-full rounded-md border px-2 py-1.5 text-[11px] font-medium disabled:opacity-50 ${
            isEnabled
              ? "border-border text-foreground hover:bg-accent/50"
              : "border-green-600/50 text-green-400 hover:bg-green-900/20"
          }`}
        >
          {toggling
            ? t("integrations.toggling")
            : isEnabled
              ? t("integrations.disable")
              : t("integrations.enable")}
        </button>
      )}

      {/* Status for client integrations */}
      {platform.isClient && (
        <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
          {t("integrations.clientAvailable")}
        </div>
      )}

      {serverStatus?.error && (
        <p className="text-[10px] text-destructive mt-2">
          {serverStatus.error}
        </p>
      )}

      {toggleError && (
        <p className="text-[10px] text-destructive mt-2">{toggleError}</p>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

function startMcpOAuthReconnect(server: McpServer): void {
  const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams({
    serverId: server.id,
    scope: server.scope,
    return: returnUrl,
  });
  window.location.assign(
    agentNativePath(`/_agent-native/mcp/servers/oauth/start?${params}`),
  );
}

function McpServerStatus({
  server,
  onReconnect,
  reconnecting = false,
  reconnectError,
}: {
  server: McpServer;
  onReconnect?: () => void;
  reconnecting?: boolean;
  reconnectError?: string;
}) {
  const t = useT();

  if (server.status.state === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Connected · {server.status.toolCount} tool
        {server.status.toolCount === 1 ? "" : "s"}
      </span>
    );
  }
  if (server.status.state === "error") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            {t("mcpIntegrations.connectionError")}
          </div>
          <p className="mt-1 max-w-3xl break-words text-xs leading-5 text-destructive/85">
            {t("mcpIntegrations.connectionErrorReason", {
              reason: server.status.error,
            })}
          </p>
          {reconnectError && (
            <p className="mt-1 break-words text-xs leading-5 text-destructive">
              {t("mcpIntegrations.reconnectFailed", {
                error: reconnectError,
              })}
            </p>
          )}
        </div>
        {onReconnect && (
          <button
            type="button"
            onClick={onReconnect}
            disabled={reconnecting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
          >
            {reconnecting ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconRefresh className="size-3.5" />
            )}
            {reconnecting
              ? t("mcpIntegrations.reconnecting")
              : t("mcpIntegrations.reconnect")}
          </button>
        )}
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      Status unknown
    </span>
  );
}

/**
 * Shared "installed MCP server" list used by both the merged Integrations
 * panel and McpIntegrationsSection's own Connected/Installed block. Healthy
 * servers render as compact plugin-page rows; a server in an error state
 * keeps the richer diagnostic card (reason + reconnect) since that detail
 * doesn't fit a one-line row.
 */
function McpServerRows({
  servers,
  role,
  deleteTarget,
  deletePending,
  reconnectingKey,
  reconnectError,
  onRemove,
  onReconnect,
}: {
  servers: McpServer[];
  role?: string | null;
  deleteTarget: string | null;
  deletePending: boolean;
  reconnectingKey: string | null;
  reconnectError: { key: string; message: string } | null;
  onRemove: (server: McpServer) => void;
  onReconnect: (server: McpServer) => void;
}) {
  const t = useT();
  const canRemove = (server: McpServer) =>
    server.scope === "user" || role === "owner" || role === "admin";
  const healthy = servers.filter((server) => server.status.state !== "error");
  const errored = servers.filter((server) => server.status.state === "error");

  const removeButton = (server: McpServer, key: string) => (
    <button
      type="button"
      onClick={() => onRemove(server)}
      disabled={deletePending}
      className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
    >
      {deleteTarget === key ? "Confirm" : "Remove"}
    </button>
  );

  return (
    <>
      {healthy.length > 0 && (
        <IntegrationGrid
          variant="rows"
          items={healthy.map((server) => {
            const key = `${server.scope}:${server.id}`;
            const remove = canRemove(server);
            return {
              id: key,
              name: server.name,
              description:
                server.scope === "user"
                  ? t("mcpIntegrations.personal")
                  : t("mcpIntegrations.sharedWithWorkspace"),
              logo: (
                <McpIntegrationLogo
                  name={server.name}
                  logoUrl=""
                  integrationId={server.name.toLowerCase()}
                />
              ),
              status:
                server.status.state === "connected"
                  ? `Connected · ${server.status.toolCount} tool${server.status.toolCount === 1 ? "" : "s"}`
                  : undefined,
              statusClassName: "text-emerald-600 dark:text-emerald-400",
              actionKind: "manage",
              actionLabel: remove ? "Remove" : "Manage",
              action: remove ? removeButton(server, key) : undefined,
            };
          })}
        />
      )}
      {errored.map((server) => {
        const key = `${server.scope}:${server.id}`;
        const remove = canRemove(server);
        return (
          <div
            key={key}
            className="flex min-w-0 items-start gap-3 rounded-2xl bg-card px-4 py-4"
          >
            <McpIntegrationLogo
              name={server.name}
              logoUrl=""
              integrationId={server.name.toLowerCase()}
              className="mt-0.5 size-9"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {server.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {server.scope === "user"
                    ? t("mcpIntegrations.personal")
                    : t("mcpIntegrations.sharedWithWorkspace")}
                </span>
              </div>
              <McpServerStatus
                server={server}
                onReconnect={() => onReconnect(server)}
                reconnecting={reconnectingKey === key}
                reconnectError={
                  reconnectError?.key === key
                    ? reconnectError.message
                    : undefined
                }
              />
            </div>
            {remove && removeButton(server, key)}
          </div>
        );
      })}
    </>
  );
}

function BrowserAutomationSection({
  builderFlow,
}: {
  builderFlow: BuilderConnectFlow;
}) {
  const connected = builderFlow.configured;
  return (
    <SettingsSurfaceProvider surface="page">
      <SettingsSection
        id="browser"
        icon={<IconBrowser size={14} />}
        title="Browser Automation"
        subtitle="Let agents control a real browser for web tasks."
        flat
        connected={connected}
      >
        {connected ? (
          <div className="rounded-md border border-border bg-accent/30 px-3.5 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">
                Builder.io
              </div>
              <span className="flex items-center gap-1 text-xs text-green-500">
                <IconCircleCheck size={14} />
                Connected
              </span>
            </div>
            {builderFlow.orgName && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {builderFlow.orgName}
              </p>
            )}
            {builderFlow.credentialSource !== "env" && (
              <div className="mt-2.5 flex items-center justify-end">
                <BuilderConnectionMenu
                  flow={builderFlow}
                  credentialSource={builderFlow.credentialSource}
                  trackingSource="browser_settings"
                  trackingFlow="browser_automation"
                />
              </div>
            )}
          </div>
        ) : (
          <BuilderConnectPopover
            flow={builderFlow}
            onConnect={(provisionAccount) =>
              builderFlow.start({
                trackingSource: "browser_settings",
                trackingFlow: "browser_automation",
                provisionAccount,
              })
            }
          >
            <button
              type="button"
              disabled={builderFlow.connecting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
            >
              {builderFlow.connecting ? "Connecting…" : "Connect Builder.io"}
              {builderFlow.connecting && (
                <IconLoader2 size={14} className="animate-spin" />
              )}
            </button>
          </BuilderConnectPopover>
        )}
        {builderFlow.error && (
          <p className="mt-2 text-xs text-destructive">{builderFlow.error}</p>
        )}
      </SettingsSection>
    </SettingsSurfaceProvider>
  );
}

function useMcpIntegrationsController({
  integrations: integrationOptions,
}: {
  integrations?: DefaultMcpIntegration[];
} = {}) {
  const serversQuery = useMcpServers();
  const createServer = useCreateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const reconnectServer = useReconnectMcpServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialIntegrationId, setInitialIntegrationId] = useState<
    string | null
  >(null);
  const [connectIntegrationId, setConnectIntegrationId] = useState<
    string | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reconnectingKey, setReconnectingKey] = useState<string | null>(null);
  const [reconnectError, setReconnectError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const catalog = useMemo(
    () => integrationOptions ?? getDefaultMcpIntegrations(),
    [integrationOptions],
  );
  const servers = [
    ...(serversQuery.data?.user ?? []),
    ...(serversQuery.data?.org ?? []),
  ];
  const connectedServers = servers.filter(
    (server) => server.status.state === "connected",
  );
  const hasOrg = Boolean(serversQuery.data?.orgId);
  const canCreateOrgMcp = Boolean(
    hasOrg &&
    (serversQuery.data?.role === "owner" ||
      serversQuery.data?.role === "admin"),
  );

  const openCatalog = useCallback((integrationId?: string) => {
    setInitialIntegrationId(integrationId ?? null);
    setConnectIntegrationId(null);
    setDialogOpen(true);
  }, []);

  const openQuickConnect = useCallback((integrationId: string) => {
    setInitialIntegrationId(null);
    setConnectIntegrationId(integrationId);
    setDialogOpen(true);
  }, []);

  const openConnection = useCallback(
    (integrationId: string, connected: boolean) => {
      if (connected) {
        openCatalog(integrationId);
        return;
      }

      const integration = catalog.find((item) => item.id === integrationId);
      const requiresSetup = Boolean(
        integration &&
        !integration.managedOAuth &&
        (integration.connectionMode === "manual" ||
          integration.availability === "provider-setup" ||
          integration.availability === "client-restricted" ||
          integration.authMode === "headers"),
      );
      if (requiresSetup) {
        openCatalog(integrationId);
      } else {
        openQuickConnect(integrationId);
      }
    },
    [catalog, openCatalog, openQuickConnect],
  );

  const removeServer = useCallback(
    async (server: McpServer) => {
      const key = `${server.scope}:${server.id}`;
      if (deleteTarget !== key) {
        setDeleteTarget(key);
        return;
      }
      setDeleteError(null);
      try {
        await deleteServer.mutateAsync({ id: server.id, scope: server.scope });
        setDeleteTarget(null);
      } catch (error) {
        setDeleteError(
          error instanceof Error
            ? error.message
            : "Could not remove agent integration.",
        );
      }
    },
    [deleteServer, deleteTarget],
  );

  const reconnect = useCallback(
    async (server: McpServer) => {
      const key = `${server.scope}:${server.id}`;
      setReconnectingKey(key);
      setReconnectError(null);
      try {
        await reconnectServer.mutateAsync({
          id: server.id,
          scope: server.scope,
        });
      } catch (error) {
        setReconnectError({
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setReconnectingKey(null);
      }
    },
    [reconnectServer],
  );

  return {
    serversQuery,
    createServer,
    deleteServer,
    dialogOpen,
    setDialogOpen,
    initialIntegrationId,
    setInitialIntegrationId,
    connectIntegrationId,
    setConnectIntegrationId,
    deleteTarget,
    deleteError,
    reconnectingKey,
    reconnectError,
    catalog,
    servers,
    connectedServers,
    hasOrg,
    canCreateOrgMcp,
    openCatalog,
    openQuickConnect,
    openConnection,
    removeServer,
    reconnect,
  };
}

export interface McpIntegrationsSectionProps {
  query?: string;
  title?: string;
  description?: string;
  showTitle?: boolean;
  showDescription?: boolean;
  showHeader?: boolean;
  className?: string;
  integrations?: DefaultMcpIntegration[];
  onOAuthStart?: (url: string) => void | Promise<void>;
  oauthReady?: boolean;
  oauthReturnPath?: string;
  showEmptyState?: boolean;
}

export function McpIntegrationsSection({
  query,
  title,
  description,
  showTitle = true,
  showDescription = true,
  showHeader = true,
  className,
  integrations: integrationOptions,
  onOAuthStart,
  oauthReady,
  oauthReturnPath,
  showEmptyState = true,
}: McpIntegrationsSectionProps) {
  const t = useT();
  const [localQuery, setLocalQuery] = useState("");
  const {
    serversQuery,
    createServer,
    dialogOpen,
    setDialogOpen,
    initialIntegrationId,
    setInitialIntegrationId,
    connectIntegrationId,
    setConnectIntegrationId,
    deleteTarget,
    deleteError,
    deleteServer,
    reconnectingKey,
    reconnectError,
    catalog,
    servers,
    connectedServers,
    hasOrg,
    canCreateOrgMcp,
    openCatalog,
    openConnection,
    removeServer,
    reconnect,
  } = useMcpIntegrationsController({ integrations: integrationOptions });
  const activeQuery = query ?? localQuery;
  const normalizedQuery = activeQuery.trim().toLowerCase();
  const filteredCatalog = useMemo(() => {
    if (!normalizedQuery) return catalog;
    return catalog.filter((integration) =>
      `${integration.name} ${integration.provider} ${integration.description} ${integration.useCase}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [catalog, normalizedQuery]);

  return (
    <section
      data-testid="mcp-integrations"
      className={cn("space-y-5", className)}
    >
      {showHeader ? (
        <div className="space-y-4">
          {showTitle || showDescription ? (
            <div>
              {showTitle ? (
                <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
                  {title ?? t("mcpIntegrations.menuLabel")}
                </h1>
              ) : null}
              {showDescription ? (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {description ?? t("mcpIntegrations.menuDescription")}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <label className="relative block min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={activeQuery}
                onChange={(event) => setLocalQuery(event.target.value)}
                placeholder={t("mcpIntegrations.searchPlaceholder")}
                aria-label={t("mcpIntegrations.searchPlaceholder")}
                className="h-9 w-full rounded-lg border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
              />
            </label>
            <button
              type="button"
              onClick={() => openCatalog()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconPlus className="size-3.5" />
              {t("integrations.addIntegration")}
            </button>
          </div>
        </div>
      ) : null}

      {deleteError && (
        <p className="border-y border-destructive/20 bg-destructive/5 py-3 text-xs text-destructive">
          {deleteError}
        </p>
      )}

      {serversQuery.isError ? (
        <p className="border-y border-destructive/20 bg-destructive/5 py-3 text-xs text-destructive">
          Could not load connected agent integrations. The catalog is still
          available.
        </p>
      ) : servers.length > 0 && !normalizedQuery ? (
        <section className="space-y-2">
          <h3 className="border-b border-border/60 pb-2 text-sm font-semibold text-foreground">
            Installed
          </h3>
          <McpServerRows
            servers={servers}
            role={serversQuery.data?.role}
            deleteTarget={deleteTarget}
            deletePending={deleteServer.isPending}
            reconnectingKey={reconnectingKey}
            reconnectError={reconnectError}
            onRemove={(server) => void removeServer(server)}
            onReconnect={(server) =>
              server.authMode === "oauth"
                ? startMcpOAuthReconnect(server)
                : void reconnect(server)
            }
          />
        </section>
      ) : null}

      {filteredCatalog.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
            <h3 className="text-sm font-semibold text-foreground">
              Available integrations
            </h3>
            <span className="text-xs text-muted-foreground">
              {filteredCatalog.length} integrations
            </span>
          </div>
          <IntegrationGrid
            variant="rows"
            items={filteredCatalog.map((integration) => {
              const connected = connectedServers.some((server) =>
                isMcpIntegrationUrl(integration, server.url),
              );
              return {
                id: integration.id,
                name: integration.name,
                description: integration.description || integration.useCase,
                logo: (
                  <McpIntegrationLogo
                    name={integration.name}
                    logoUrl={integration.logoUrl}
                    integrationId={integration.id}
                  />
                ),
                status: connected ? t("mcpIntegrations.connected") : undefined,
                statusClassName: "text-emerald-600 dark:text-emerald-400",
                actionKind: connected ? "manage" : "connect",
                actionLabel: connected
                  ? "Manage"
                  : t("mcpIntegrations.connect"),
                onAction: () => openConnection(integration.id, connected),
              };
            })}
          />
        </div>
      )}

      {showEmptyState && filteredCatalog.length === 0 && normalizedQuery && (
        <p className="border-y border-border/60 py-4 text-xs text-muted-foreground">
          No agent integrations match “{activeQuery}”.
        </p>
      )}

      <McpIntegrationDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setInitialIntegrationId(null);
            setConnectIntegrationId(null);
          }
        }}
        initialIntegrationId={initialIntegrationId}
        connectIntegrationId={connectIntegrationId}
        defaultScope="user"
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={hasOrg}
        onCreateMcpServer={(args) => createServer.mutateAsync(args)}
        onOAuthStart={onOAuthStart}
        oauthReady={oauthReady}
        oauthReturnPath={oauthReturnPath}
      />
    </section>
  );
}

export interface McpIntegrationsLandingProps extends Omit<
  McpIntegrationsSectionProps,
  "query" | "showHeader"
> {}

export function McpIntegrationsLanding({
  title,
  description,
  ...props
}: McpIntegrationsLandingProps) {
  return (
    <McpIntegrationsSection
      {...props}
      title={title}
      description={description}
      showHeader
    />
  );
}

const PLATFORM_CATEGORY_META: Record<PlatformInfo["category"], string> = {
  Messaging: "Messaging",
  "Workspace tools": "Workspace tools",
  "Agent clients": "Agent client",
};

function platformDisplayName(platform: PlatformInfo): string {
  return platform.id === "slack"
    ? `${platform.label} (agent in channels)`
    : platform.label;
}

function mcpDisplayName(integration: DefaultMcpIntegration): string {
  return integration.id === "slack"
    ? `${integration.name} (MCP tools)`
    : integration.name;
}

// ponytail: polls /env-status directly rather than a shared status endpoint —
// a network hiccup just leaves Email showing "not configured" until the next mount.
function useEmailProviderConfigured(): boolean {
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    fetch(agentNativePath("/_agent-native/env-status"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Array<{ key: string; configured: boolean }>) => {
        const keys = Array.isArray(data) ? data : [];
        const resend = keys.find((k) => k.key === "RESEND_API_KEY")?.configured;
        const sendgrid = keys.find(
          (k) => k.key === "SENDGRID_API_KEY",
        )?.configured;
        setConfigured(Boolean(resend || sendgrid));
      })
      .catch(() => {});
  }, []);
  return configured;
}

const EMAIL_ROW_DESCRIPTION = "Send from the agent with Resend or SendGrid.";
const BUILDER_ROW_DESCRIPTION =
  "Model access, browser automation, file storage, and workspace identity. Free tier available.";

/** A 40px "app icon" well for logos that are plain tabler icons rather than
 * an McpIntegrationLogo image — matches McpIntegrationLogo's own default
 * bordered-square treatment so every row's logo reads consistently. */
function PlainIntegrationIcon({
  icon: Icon,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
      <Icon size={18} strokeWidth={1.8} />
    </span>
  );
}

// Lazy: SettingsPanel.js is a large module (it also lazy-loads this panel),
// so the reverse reference stays dynamic to avoid a circular static import.
const LazyEmailSectionInner = lazy(() =>
  import("../settings/SettingsPanel.js").then((m) => ({
    default: m.EmailSectionInner,
  })),
);

function EmailIntegrationDetail({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-2"
      >
        <IconChevronLeft size={12} className="rtl:-scale-x-100" />
        {t("integrations.back")}
      </button>
      <Suspense fallback={null}>
        <SettingsSurfaceProvider surface="page">
          <LazyEmailSectionInner open onToggle={() => {}} />
        </SettingsSurfaceProvider>
      </Suspense>
    </div>
  );
}

export function IntegrationsPanel() {
  const t = useT();
  const { statuses, refetch } = useIntegrationStatus();
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformInfo | null>(
    null,
  );
  const [showEmailDetail, setShowEmailDetail] = useState(false);
  const [query, setQuery] = useState("");
  const emailConfigured = useEmailProviderConfigured();
  const statusMap = new Map(statuses.map((s) => [s.platform, s]));
  const normalizedQuery = query.trim().toLowerCase();
  const externalHostMatches =
    normalizedQuery.length > 0 && matchesMcpConnectHost(normalizedQuery);
  const externalHostGuide = resolveMcpConnectGuideId(normalizedQuery);
  const mcpIntegrations = useMemo(
    () =>
      getDefaultMcpIntegrations().filter(
        (integration) => integration.id !== "builder-cms",
      ),
    [],
  );
  const mcp = useMcpIntegrationsController({ integrations: mcpIntegrations });

  const filteredMcpCatalog = useMemo(
    () =>
      mcp.catalog.filter(
        (integration) =>
          !normalizedQuery ||
          `${integration.name} ${integration.provider} ${integration.description} ${integration.useCase}`
            .toLowerCase()
            .includes(normalizedQuery),
      ),
    [mcp.catalog, normalizedQuery],
  );
  const filteredPlatforms = PLATFORMS.filter((platform) => {
    if (!normalizedQuery) return true;
    return `${platform.label} ${platform.description} ${platform.category}`
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const emailMatchesQuery =
    !normalizedQuery ||
    "email send transactional resend sendgrid".includes(normalizedQuery);

  const availableItems: IntegrationGridItem[] = [
    ...filteredMcpCatalog
      .filter(
        (integration) =>
          !mcp.connectedServers.some((server) =>
            isMcpIntegrationUrl(integration, server.url),
          ),
      )
      .map((integration) => ({
        id: `mcp:${integration.id}`,
        name: mcpDisplayName(integration),
        description: integration.description || integration.useCase,
        logo: (
          <McpIntegrationLogo
            name={integration.name}
            logoUrl={integration.logoUrl}
            integrationId={integration.id}
          />
        ),
        actionKind: "connect" as const,
        actionLabel: t("mcpIntegrations.connect"),
        onAction: () => mcp.openConnection(integration.id, false),
      })),
    ...filteredPlatforms
      .filter((platform) => {
        const status = statusMap.get(platform.id);
        return !(status?.configured || status?.enabled);
      })
      .map((platform) => ({
        id: `platform:${platform.id}`,
        name: platformDisplayName(platform),
        description: platform.description,
        logo: <PlainIntegrationIcon icon={platform.icon} />,
        status: PLATFORM_CATEGORY_META[platform.category],
        actionKind: "connect" as const,
        actionLabel: "Connect",
        onAction: () => setSelectedPlatform(platform),
      })),
    ...(!emailConfigured && emailMatchesQuery
      ? [
          {
            id: "email",
            name: "Email",
            description: EMAIL_ROW_DESCRIPTION,
            logo: <PlainIntegrationIcon icon={IconMail} />,
            actionKind: "connect" as const,
            actionLabel: "Connect",
            onAction: () => setShowEmailDetail(true),
          },
        ]
      : []),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const connectedPlatformAndEmailItems: IntegrationGridItem[] = [
    ...PLATFORMS.filter((platform) => {
      const status = statusMap.get(platform.id);
      return status?.configured || status?.enabled;
    }).map((platform) => {
      const status = statusMap.get(platform.id);
      return {
        id: `platform:${platform.id}`,
        name: platformDisplayName(platform),
        description: platform.description,
        logo: <PlainIntegrationIcon icon={platform.icon} />,
        status: platform.isClient
          ? "Available"
          : status?.enabled && status.configured
            ? "Connected"
            : "Ready to enable",
        statusClassName:
          status?.enabled && status.configured
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400",
        actionKind: "manage" as const,
        actionLabel: "Manage",
        onAction: () => setSelectedPlatform(platform),
      };
    }),
    ...(emailConfigured
      ? [
          {
            id: "email",
            name: "Email",
            description: EMAIL_ROW_DESCRIPTION,
            logo: <PlainIntegrationIcon icon={IconMail} />,
            status: "Configured",
            statusClassName: "text-emerald-600 dark:text-emerald-400",
            actionKind: "manage" as const,
            actionLabel: "Manage",
            onAction: () => setShowEmailDetail(true),
          },
        ]
      : []),
  ].sort((a, b) => a.name.localeCompare(b.name));

  if (selectedPlatform) {
    return (
      <IntegrationDetail
        platform={selectedPlatform}
        serverStatus={statusMap.get(selectedPlatform.id)}
        onBack={() => setSelectedPlatform(null)}
        onRefresh={refetch}
      />
    );
  }

  if (showEmailDetail) {
    return <EmailIntegrationDetail onBack={() => setShowEmailDetail(false)} />;
  }

  return (
    <div className="w-full space-y-8">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Integrations
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("integrations.subtitle")}
          </p>
        </div>
        <label className="relative block w-full">
          <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations"
            aria-label="Search integrations"
            className="h-9 w-full rounded-lg border border-border bg-background ps-9 pe-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
          />
        </label>
      </div>

      <BuilderConnectCard
        trackingSource="settings_connections"
        description={BUILDER_ROW_DESCRIPTION}
        render={({ viewModel }) => {
          const builderConnected = viewModel.status.kind === "connected";
          const builderItem: IntegrationGridItem = {
            id: "builder-cms",
            name: "Builder.io",
            fullWidth: true,
            badge: t("integrations.recommended"),
            description: viewModel.description,
            logo: (
              <McpIntegrationLogo
                name="Builder.io"
                logoUrl={mcpIntegrationLogo("builder-cms")}
                integrationId="builder-cms"
              />
            ),
            status: viewModel.status.label,
            statusClassName: builderConnected
              ? "text-emerald-600 dark:text-emerald-400"
              : undefined,
            actionKind: builderConnected ? "manage" : "connect",
            actionLabel: builderConnected ? "Manage" : "Connect",
            action:
              viewModel.configured && viewModel.connectFlow ? (
                <BuilderConnectionMenu
                  flow={viewModel.connectFlow}
                  trackingSource="settings_connections"
                  variant="text"
                />
              ) : viewModel.connectFlow && viewModel.action ? (
                <BuilderConnectPopover
                  flow={viewModel.connectFlow}
                  onConnect={viewModel.action.onPress}
                >
                  <button
                    type="button"
                    disabled={viewModel.action.disabled}
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {viewModel.action.label}
                  </button>
                </BuilderConnectPopover>
              ) : null,
          };
          const connectedItems = builderConnected
            ? [builderItem, ...connectedPlatformAndEmailItems]
            : connectedPlatformAndEmailItems;
          const availableItemsWithBuilder = builderConnected
            ? availableItems
            : [builderItem, ...availableItems];
          const matchingMcpServers = normalizedQuery
            ? mcp.servers.filter((server) =>
                `${server.name} ${server.scope} ${server.status.state}`
                  .toLowerCase()
                  .includes(normalizedQuery),
              )
            : mcp.servers;
          const matchingConnectedItems = normalizedQuery
            ? connectedItems.filter((item) =>
                `${item.name} ${item.description ?? ""} ${item.status ?? ""}`
                  .toLowerCase()
                  .includes(normalizedQuery),
              )
            : connectedItems;
          const hasConnectedMatches =
            matchingMcpServers.length > 0 || matchingConnectedItems.length > 0;

          return (
            <>
              {viewModel.error && (
                <p className="text-xs text-destructive">{viewModel.error}</p>
              )}

              {viewModel.connectFlow && (
                <BrowserAutomationSection builderFlow={viewModel.connectFlow} />
              )}

              {mcp.deleteError && (
                <p className="border-y border-destructive/20 bg-destructive/5 py-3 text-xs text-destructive">
                  {mcp.deleteError}
                </p>
              )}

              {hasConnectedMatches && (
                <section className="space-y-3">
                  <h2 className="border-b border-border/60 pb-2 text-sm font-semibold text-foreground">
                    Connected
                  </h2>
                  {matchingMcpServers.length > 0 && (
                    <McpServerRows
                      servers={matchingMcpServers}
                      role={mcp.serversQuery.data?.role}
                      deleteTarget={mcp.deleteTarget}
                      deletePending={mcp.deleteServer.isPending}
                      reconnectingKey={mcp.reconnectingKey}
                      reconnectError={mcp.reconnectError}
                      onRemove={(server) => void mcp.removeServer(server)}
                      onReconnect={(server) =>
                        server.authMode === "oauth"
                          ? startMcpOAuthReconnect(server)
                          : void mcp.reconnect(server)
                      }
                    />
                  )}
                  {matchingConnectedItems.length > 0 && (
                    <IntegrationGrid
                      variant="rows"
                      items={matchingConnectedItems}
                    />
                  )}
                </section>
              )}

              {externalHostMatches && (
                <section>
                  <IntegrationGrid
                    variant="rows"
                    items={[
                      {
                        id: "external-ai-host",
                        name: t("settings.mcpClientSetup"),
                        description: t("settings.mcpClientSetupDescription"),
                        logo: <PlainIntegrationIcon icon={IconTerminal2} />,
                        actionKind: "connect",
                        actionLabel: t("mcpIntegrations.connect"),
                        onAction: () => {
                          const route = appPath(
                            `${buildSettingsRoute("mcp")}?guide=${encodeURIComponent(externalHostGuide)}`,
                          );
                          window.history.pushState(null, "", route);
                          window.dispatchEvent(new PopStateEvent("popstate"));
                        },
                      },
                    ]}
                  />
                </section>
              )}

              {availableItemsWithBuilder.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      Available integrations
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {availableItemsWithBuilder.length} integrations
                      </span>
                      <SettingsCrossLinkHint
                        text={t("integrations.lookingForApiKeys")}
                        linkText={t("integrations.goToApiKeys")}
                        href={appMountedPath(
                          buildSettingsRoute("keys"),
                          STANDARD_APP_ROUTES.settings,
                        )}
                      />
                    </div>
                  </div>
                  <IntegrationGrid
                    variant="rows"
                    items={availableItemsWithBuilder}
                  />
                </div>
              ) : (
                normalizedQuery &&
                !externalHostMatches &&
                !hasConnectedMatches && (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <p className="text-sm font-medium text-foreground">
                      No integrations found
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Try a different tool or category.
                    </p>
                  </div>
                )
              )}

              <McpIntegrationDialog
                open={mcp.dialogOpen}
                onOpenChange={(open) => {
                  mcp.setDialogOpen(open);
                  if (!open) {
                    mcp.setInitialIntegrationId(null);
                    mcp.setConnectIntegrationId(null);
                  }
                }}
                initialIntegrationId={mcp.initialIntegrationId}
                connectIntegrationId={mcp.connectIntegrationId}
                defaultScope="user"
                canCreateOrgMcp={mcp.canCreateOrgMcp}
                hasOrg={mcp.hasOrg}
                onCreateMcpServer={(args) => mcp.createServer.mutateAsync(args)}
              />
            </>
          );
        }}
      />
    </div>
  );
}
