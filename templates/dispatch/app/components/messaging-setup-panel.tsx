import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  IconBrandSlack,
  IconBrandTelegram,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconInfoCircle,
  IconLoader2,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EnvStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
}

interface IntegrationStatus {
  platform: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  webhookUrl?: string;
}

interface PlatformDefinition {
  id: "slack" | "telegram";
  label: string;
  icon: typeof IconBrandSlack;
  description: string;
  docsUrl?: string;
  setupSteps: string[];
  envKeys: string[];
}

const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    id: "slack",
    label: "Slack",
    icon: IconBrandSlack,
    description: "Receive mentions and DMs in one workspace-aware dispatch.",
    docsUrl: "https://api.slack.com/apps",
    envKeys: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    setupSteps: [
      "Create or open a Slack app.",
      "Enable Event Subscriptions and paste the webhook URL below.",
      "Subscribe to app_mention and message.im events.",
      "Install the app and save the bot token and signing secret here.",
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: IconBrandTelegram,
    description: "Chat with dispatch through a Telegram bot.",
    envKeys: ["TELEGRAM_BOT_TOKEN"],
    setupSteps: [
      "Create a bot with @BotFather.",
      "Save the bot token here.",
      "Run webhook setup once to connect Telegram to this app.",
    ],
  },
];

function HelpTooltip({ content }: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/60 hover:text-foreground"
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
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [envStatuses, setEnvStatuses] = useState<EnvStatus[]>([]);
  const [envLoading, setEnvLoading] = useState(true);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [savingKeysFor, setSavingKeysFor] = useState<string | null>(null);
  const [togglingPlatform, setTogglingPlatform] = useState<string | null>(null);
  const [setupPlatform, setSetupPlatform] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);

  const refreshStatuses = async () => {
    setLoading(true);
    try {
      const res = await fetch("/_agent-native/integrations/status");
      const rows = res.ok ? await res.json() : [];
      setStatuses(Array.isArray(rows) ? rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/_agent-native/integrations/status")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (active) {
          setStatuses(Array.isArray(rows) ? rows : []);
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
    fetch("/_agent-native/env-status")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (active) {
          setEnvStatuses(Array.isArray(rows) ? rows : []);
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
      const res = await fetch("/_agent-native/env-status");
      const rows = res.ok ? await res.json() : [];
      setEnvStatuses(Array.isArray(rows) ? rows : []);
    } finally {
      setEnvLoading(false);
    }
  };

  const saveEnvKeys = async (platform: PlatformDefinition) => {
    const vars = platform.envKeys
      .map((key) => ({ key, value: envValues[key]?.trim() || "" }))
      .filter((item) => item.value);

    if (vars.length === 0) {
      toast.error("Add the required credentials first.");
      return;
    }

    setSavingKeysFor(platform.id);
    try {
      const res = await fetch("/_agent-native/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to save credentials");
      }

      toast.success(`${platform.label} credentials saved`);
      setEnvValues((current) => {
        const next = { ...current };
        for (const key of platform.envKeys) delete next[key];
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
    platform: PlatformDefinition,
    enabled: boolean,
  ) => {
    setTogglingPlatform(platform.id);
    try {
      const action = enabled ? "disable" : "enable";
      const res = await fetch(
        `/_agent-native/integrations/${platform.id}/${action}`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(
          payload.error || `Failed to ${action} ${platform.label}`,
        );
      }
      toast.success(
        enabled
          ? `${platform.label} disconnected`
          : `${platform.label} connected`,
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

  const runSetup = async (platform: PlatformDefinition) => {
    setSetupPlatform(platform.id);
    try {
      const res = await fetch(
        `/_agent-native/integrations/${platform.id}/setup`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Failed to set up ${platform.label}`);
      }
      toast.success(
        platform.id === "telegram"
          ? "Telegram webhook registered"
          : `${platform.label} setup complete`,
      );
      await refreshStatuses();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to set up ${platform.label}`,
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

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Messaging</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Connect Slack or Telegram here. Once a channel is enabled,
              dispatch can receive inbound messages and respond in the same
              conversation.
            </p>
          </div>
          <HelpTooltip content="Integrations handle inbound messaging. Destinations are separate saved outbound targets for proactive sends, digests, and scheduled jobs." />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {PLATFORM_DEFINITIONS.map((platform) => {
          const status = statusByPlatform.get(platform.id);
          const configured = !!status?.configured;
          const enabled = !!status?.enabled;
          const missingKeys = platform.envKeys.filter(
            (key) => !envStatusByKey.get(key)?.configured,
          );
          const canEnable = configured;

          return (
            <section
              key={platform.id}
              className="rounded-2xl border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/30 text-foreground">
                    <platform.icon size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">
                        {platform.label}
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
                {platform.docsUrl ? (
                  <a
                    href={platform.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Docs
                    <IconExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>

              <div className="mt-5 rounded-xl border bg-muted/20 p-4">
                <div className="text-sm font-medium text-foreground">
                  Setup steps
                </div>
                <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {platform.setupSteps.map((step, index) => (
                    <li key={step} className="flex gap-2">
                      <span className="text-muted-foreground/60">
                        {index + 1}.
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

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
                  {platform.envKeys.map((key) => {
                    const envStatus = envStatusByKey.get(key);
                    const isConfigured = !!envStatus?.configured;
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-medium text-foreground">
                            {envStatus?.label || key}
                          </label>
                          {isConfigured ? (
                            <StatusPill tone="success" label="Saved" />
                          ) : (
                            <StatusPill tone="neutral" label="Missing" />
                          )}
                        </div>
                        {!isConfigured ? (
                          <Input
                            type="password"
                            value={envValues[key] || ""}
                            onChange={(event) =>
                              setEnvValues((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            placeholder={`Enter ${envStatus?.label || key}`}
                            autoComplete="off"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {missingKeys.length > 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => saveEnvKeys(platform)}
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
                      aria-label={`Copy ${platform.label} webhook URL`}
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

              <div className="mt-5 flex flex-wrap gap-2">
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
                <Button
                  onClick={() => togglePlatform(platform, enabled)}
                  disabled={
                    togglingPlatform === platform.id || (!enabled && !canEnable)
                  }
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
              </div>

              {!configured ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Save the required credentials before enabling {platform.label}
                  .
                </p>
              ) : null}
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
