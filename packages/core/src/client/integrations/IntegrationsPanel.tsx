import React, { useState, useCallback } from "react";
import {
  IconPlus,
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandGoogleDrive,
  IconTerminal2,
  IconBuildingSkyscraper,
  IconMessageCircle,
  IconCopy,
  IconCheck,
  IconChevronLeft,
  IconExternalLink,
  IconCircleCheck,
} from "@tabler/icons-react";
import {
  useIntegrationStatus,
  type IntegrationStatus,
} from "./useIntegrationStatus.js";
import { agentNativePath } from "../api-path.js";

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
}

const PLATFORMS: PlatformInfo[] = [
  {
    id: "slack",
    label: "Slack",
    icon: IconBrandSlack,
    description: "Message your agent from any Slack channel or DM.",
    envVars: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    setupSteps: [
      "Create a Slack app at api.slack.com/apps",
      'Enable "Event Subscriptions" and point to your webhook URL',
      "Subscribe to message.im and app_mention events",
      "Install the app to your workspace",
      "Copy the Bot Token and Signing Secret into your environment",
    ],
    docsUrl: "https://api.slack.com/apps",
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
    docsUrl: "https://www.builder.io",
  },
];

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
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

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
        err instanceof Error
          ? err.message
          : "Network error reaching the server",
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

  const isConfigured = serverStatus?.configured ?? false;
  const isEnabled = serverStatus?.enabled ?? false;

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mb-2"
      >
        <IconChevronLeft size={12} />
        Back
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

      {/* Setup steps */}
      <div className="mb-3">
        <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
          Setup
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

      {/* Required secrets */}
      {platform.envVars.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-medium text-muted-foreground mb-1">
            Required secrets
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
              Set these in your .env file or environment to connect.
            </p>
          )}
        </div>
      )}

      {/* Webhook URL */}
      {serverStatus?.webhookUrl && !platform.isClient && (
        <div className="mb-3">
          <div className="text-[10px] font-medium text-muted-foreground mb-1">
            Webhook URL
          </div>
          <div className="flex items-center gap-1">
            <code className="flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
              {serverStatus.webhookUrl}
            </code>
            <button
              onClick={() => handleCopy(serverStatus.webhookUrl!)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/50"
              title="Copy"
            >
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </button>
          </div>
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
          Documentation
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
          {toggling ? "..." : isEnabled ? "Disable" : "Enable"}
        </button>
      )}

      {/* Status for client integrations */}
      {platform.isClient && (
        <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
          This agent's A2A endpoint is automatically available. No configuration
          needed.
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
      {PLATFORMS.filter((p) => !connectedIds.has(p.id)).map((platform) => (
        <button
          key={platform.id}
          onClick={() => onSelect(platform)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/50"
        >
          <platform.icon size={14} className="shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-foreground">
              {platform.label}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {platform.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function IntegrationsPanel() {
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
          <IconChevronLeft size={12} />
          Back
        </button>
        <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
          Add a chat integration
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
            Chat Integrations
          </div>
          <div className="text-[10px] text-muted-foreground">
            Talk to this agent from other platforms
          </div>
        </div>
        <button
          onClick={() => setShowPicker(true)}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
          title="Add integration"
        >
          <IconPlus size={12} />
        </button>
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
            Add integration
          </button>
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
            For a central Slack or Telegram entrypoint that can route work
            across multiple apps, use the{" "}
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
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/50"
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
                          : "bg-gray-400"
                    }`}
                  />
                )}
              </button>
            );
          })}
          <div className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-[10px] text-muted-foreground">
            Need one shared messaging surface for your workspace? Connect Slack
            or Telegram to a dispatch app and let it delegate to other agents
            over A2A.
          </div>
        </div>
      )}
    </div>
  );
}
