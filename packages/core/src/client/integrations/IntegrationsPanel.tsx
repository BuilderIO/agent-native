import {
  IconPlus,
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandGoogleDrive,
  IconTerminal2,
  IconBuildingSkyscraper,
  IconCopy,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconCircleCheck,
  IconInfoCircle,
  IconSearch,
  IconServer,
} from "@tabler/icons-react";
import React, { useState, useCallback, useEffect, useMemo } from "react";

import { agentNativePath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import {
  getDefaultMcpIntegrations,
  type DefaultMcpIntegration,
} from "../resources/mcp-integration-catalog.js";
import { McpIntegrationDialog } from "../resources/McpIntegrationDialog.js";
import {
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpServers,
  type McpServer,
} from "../resources/use-mcp-servers.js";
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
  {
    id: "claude-code",
    label: "Claude Code",
    icon: IconTerminal2,
    description:
      "Let Claude Code call this agent via A2A for data and actions.",
    envVars: [],
    isClient: true,
    setupSteps: [
      "Your agent exposes an A2A endpoint at /.well-known/agent-card.json",
      "In Claude Code, reference your agent's URL when asking for data",
      "Claude Code will discover and call your agent's skills automatically",
    ],
    category: "Agent clients",
  },
  {
    id: "builder",
    label: "Builder.io",
    icon: IconBuildingSkyscraper,
    description:
      "One chat interface that orchestrates all your agents together.",
    envVars: [],
    isClient: true,
    setupSteps: [
      "Connect your agent-native apps in your Builder.io workspace",
      "Builder.io discovers each agent's skills via A2A",
      "Chat with one agent that can trigger actions across all your apps",
    ],
    docsUrl:
      "https://www.builder.io?utm_source=agent-native&utm_medium=product&utm_campaign=integrations&utm_content=integrations_panel",
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

// ─── Add integration picker ──────────────────────────────────────────────────

function AddIntegrationPicker({
  connectedIds,
  onSelect,
}: {
  connectedIds: Set<string>;
  onSelect: (platform: PlatformInfo) => void;
}) {
  return (
    <div className="space-y-1">
      {PLATFORMS.filter((platform) => !connectedIds.has(platform.id)).map(
        (platform) => (
          <button
            key={platform.id}
            type="button"
            onClick={() => onSelect(platform)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent/50"
          >
            <platform.icon
              size={14}
              className="shrink-0 text-muted-foreground"
            />
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-medium text-foreground">
                {platform.label}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {platform.description}
              </span>
            </span>
          </button>
        ),
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function LegacyIntegrationsPanel() {
  const t = useT();
  const { statuses, loading, refetch } = useIntegrationStatus();
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformInfo | null>(
    null,
  );
  const [showPicker, setShowPicker] = useState(false);

  const statusMap = new Map(statuses.map((s) => [s.platform, s]));

  // Show connected (enabled or configured) integrations
  const connectedPlatforms = PLATFORMS.filter((p) => {
    const s = statusMap.get(p.id);
    return s?.configured || s?.enabled;
  });

  const connectedIds = new Set(connectedPlatforms.map((p) => p.id));

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

  if (showPicker) {
    return (
      <div>
        <button
          onClick={() => setShowPicker(false)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-2"
        >
          <IconChevronLeft size={12} className="rtl:-scale-x-100" />
          {t("integrations.back")}
        </button>
        <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
          {t("integrations.addChatIntegration")}
        </div>
        <AddIntegrationPicker
          connectedIds={connectedIds}
          onSelect={(p) => {
            setSelectedPlatform(p);
            setShowPicker(false);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <div className="text-xs font-medium text-foreground">
            {t("integrations.chatIntegrations")}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t("integrations.chatIntegrationsDescription")}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowPicker(true)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                <IconPlus size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("integrations.addIntegration")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <div className="h-6 w-full rounded bg-muted/50 animate-pulse" />
          <div className="h-6 w-3/4 rounded bg-muted/50 animate-pulse" />
        </div>
      ) : connectedPlatforms.length === 0 ? (
        <div className="space-y-2">
          <button
            onClick={() => setShowPicker(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/30"
          >
            <IconPlus size={12} className="shrink-0" />
            {t("integrations.addIntegration")}
          </button>
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
            {t("integrations.dispatchEntrypoint")}{" "}
            <a
              href="https://dispatch.agent-native.com"
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline font-medium text-foreground hover:text-foreground/80"
            >
              dispatch template
            </a>
            .
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {connectedPlatforms.map((platform) => {
            const s = statusMap.get(platform.id);
            return (
              <button
                key={platform.id}
                onClick={() => setSelectedPlatform(platform)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent/50"
              >
                <platform.icon
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="flex-1 text-[11px] font-medium text-foreground truncate">
                  {platform.label}
                </span>
                {s && (
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                      s.enabled && s.configured
                        ? "bg-green-500"
                        : s.configured
                          ? "bg-yellow-500"
                          : "bg-muted-foreground/55"
                    }`}
                  />
                )}
              </button>
            );
          })}
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
            {t("integrations.sharedMessaging")}
          </div>
        </div>
      )}
    </div>
  );
}

function IntegrationGalleryCard({
  platform,
  status,
  onSelect,
}: {
  platform: PlatformInfo;
  status?: IntegrationStatus;
  onSelect: (platform: PlatformInfo) => void;
}) {
  const connected = Boolean(status?.configured || status?.enabled);
  const active = Boolean(status?.enabled && status?.configured);
  const stateLabel = platform.isClient
    ? "Available"
    : active
      ? "Connected"
      : connected
        ? "Ready to enable"
        : "Set up";

  return (
    <button
      type="button"
      onClick={() => onSelect(platform)}
      className="group flex min-h-28 items-start gap-3 rounded-xl border border-border/80 bg-card p-4 text-start transition-colors hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background text-foreground shadow-sm">
        <platform.icon size={21} strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {platform.label}
          </span>
          <span
            className={
              active
                ? "shrink-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                : connected
                  ? "shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                  : "shrink-0 text-[10px] text-muted-foreground"
            }
          >
            {stateLabel}
          </span>
        </span>
        <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">
          {platform.description}
        </span>
        <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-foreground/70 transition-colors group-hover:text-foreground">
          {connected || platform.isClient ? "Manage" : "Connect"}
          <IconChevronRight className="size-3.5 rtl:-scale-x-100" />
        </span>
      </span>
    </button>
  );
}

function compareMcpUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function McpLogo({ integration }: { integration: DefaultMcpIntegration }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-background text-xs font-semibold text-muted-foreground">
      {failed ? (
        integration.name.slice(0, 1)
      ) : (
        <img
          src={integration.logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-7 object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function McpServerStatus({ server }: { server: McpServer }) {
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
      <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        Connection error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      Status unknown
    </span>
  );
}

function McpCatalogItem({
  integration,
  connected,
  onConnect,
}: {
  integration: DefaultMcpIntegration;
  connected: boolean;
  onConnect: (integrationId: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-border/60 py-4 last:border-b-0">
      <McpLogo integration={integration} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {integration.name}
          </span>
          {connected && (
            <span className="shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              Connected
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground">
          {integration.description || integration.useCase}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onConnect(integration.id)}
        className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {connected ? "Manage" : "Connect"}
      </button>
    </div>
  );
}

function McpIntegrationsSection({ query }: { query: string }) {
  const serversQuery = useMcpServers();
  const createServer = useCreateMcpServer();
  const deleteServer = useDeleteMcpServer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialIntegrationId, setInitialIntegrationId] = useState<
    string | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const catalog = useMemo(() => getDefaultMcpIntegrations(), []);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCatalog = useMemo(() => {
    if (!normalizedQuery) return catalog;
    return catalog.filter((integration) =>
      `${integration.name} ${integration.provider} ${integration.description} ${integration.useCase}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [catalog, normalizedQuery]);
  const servers = [
    ...(serversQuery.data?.user ?? []),
    ...(serversQuery.data?.org ?? []),
  ];
  const connectedUrls = new Set(
    servers
      .filter((server) => server.status.state === "connected")
      .map((server) => compareMcpUrl(server.url)),
  );
  const hasOrg = Boolean(serversQuery.data?.orgId);
  const canCreateOrgMcp = Boolean(
    hasOrg &&
    (serversQuery.data?.role === "owner" ||
      serversQuery.data?.role === "admin"),
  );

  const openCatalog = useCallback((integrationId?: string) => {
    setInitialIntegrationId(integrationId ?? null);
    setDialogOpen(true);
  }, []);

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

  return (
    <section data-testid="mcp-integrations" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <IconServer className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              Agent integrations
            </h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Give your agent tools and context from the services you use.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCatalog()}
          className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus className="size-3.5" />
          Add integration
        </button>
      </div>

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
      ) : serversQuery.isLoading ? (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card px-4 py-4">
          <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ) : servers.length > 0 && !normalizedQuery ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Installed</h3>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
            <div className="divide-y divide-border/60 px-4">
              {servers.map((server) => {
                const key = `${server.scope}:${server.id}`;
                const canRemove =
                  server.scope === "user" ||
                  serversQuery.data?.role === "owner" ||
                  serversQuery.data?.role === "admin";
                return (
                  <div key={key} className="flex items-center gap-3 py-3.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
                      <IconServer className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {server.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {server.scope === "user"
                            ? "Personal"
                            : "Organization"}
                        </span>
                      </div>
                      <McpServerStatus server={server} />
                    </div>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => void removeServer(server)}
                        disabled={deleteServer.isPending}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                      >
                        {deleteTarget === key ? "Confirm" : "Remove"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {filteredCatalog.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              Available integrations
            </h3>
            <span className="text-xs text-muted-foreground">
              {filteredCatalog.length} integrations
            </span>
          </div>
          <div className="grid gap-x-8 overflow-hidden rounded-xl border border-border/70 bg-card px-4 sm:grid-cols-2">
            {filteredCatalog.map((integration) => (
              <McpCatalogItem
                key={integration.id}
                integration={integration}
                connected={connectedUrls.has(compareMcpUrl(integration.url))}
                onConnect={openCatalog}
              />
            ))}
          </div>
        </div>
      )}

      {filteredCatalog.length === 0 && normalizedQuery && (
        <p className="border-y border-border/60 py-4 text-xs text-muted-foreground">
          No agent integrations match “{query}”.
        </p>
      )}

      <McpIntegrationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialIntegrationId={initialIntegrationId}
        defaultScope="user"
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={hasOrg}
        onCreateMcpServer={(args) => createServer.mutateAsync(args)}
      />
    </section>
  );
}

export function IntegrationsPanel() {
  const { statuses, loading, refetch } = useIntegrationStatus();
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformInfo | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const statusMap = new Map(statuses.map((s) => [s.platform, s]));
  const connectedPlatforms = PLATFORMS.filter((platform) => {
    const status = statusMap.get(platform.id);
    return status?.configured || status?.enabled;
  });
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlatforms = PLATFORMS.filter((platform) => {
    if (!normalizedQuery) return true;
    return `${platform.label} ${platform.description} ${platform.category}`
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const mcpCatalogMatches = getDefaultMcpIntegrations().some((integration) =>
    normalizedQuery
      ? `${integration.name} ${integration.provider} ${integration.description} ${integration.useCase}`
          .toLowerCase()
          .includes(normalizedQuery)
      : true,
  );

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

  return (
    <div className="w-full space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-foreground">
            Integrations
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
            Connect the tools your agent can use to gather context, take action,
            and meet your team where work already happens.
          </p>
        </div>
        <label className="relative block w-full lg:max-w-xs">
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

      <McpIntegrationsSection query={normalizedQuery} />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-28 animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : (
        <>
          {!normalizedQuery && connectedPlatforms.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Connected
                </h2>
                <span className="text-xs text-muted-foreground">
                  {connectedPlatforms.length} connected
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {connectedPlatforms.map((platform) => (
                  <IntegrationGalleryCard
                    key={platform.id}
                    platform={platform}
                    status={statusMap.get(platform.id)}
                    onSelect={setSelectedPlatform}
                  />
                ))}
              </div>
            </section>
          )}

          {(["Messaging", "Workspace tools", "Agent clients"] as const).map(
            (category) => {
              const platforms = filteredPlatforms.filter(
                (platform) =>
                  platform.category === category &&
                  (!connectedPlatforms.includes(platform) || normalizedQuery),
              );
              if (platforms.length === 0) return null;
              return (
                <section key={category} className="mt-8 space-y-3 first:mt-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {category}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {platforms.map((platform) => (
                      <IntegrationGalleryCard
                        key={platform.id}
                        platform={platform}
                        status={statusMap.get(platform.id)}
                        onSelect={setSelectedPlatform}
                      />
                    ))}
                  </div>
                </section>
              );
            },
          )}

          {filteredPlatforms.length === 0 && !mcpCatalogMatches && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium text-foreground">
                No integrations found
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a different tool or category.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
