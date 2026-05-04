import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconInfoCircle,
  IconLoader2,
  IconMail,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { agentNativePath } from "@agent-native/core/client";

interface EnvStatus {
  key: string;
  label: string;
  required: boolean;
  configured: boolean;
  helpText?: string;
}

interface RequiredEnvKey {
  key: string;
  label: string;
  required: boolean;
  helpText?: string;
}

interface IntegrationStatus {
  platform: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  webhookUrl?: string;
  requiredEnvKeys?: RequiredEnvKey[];
}

interface PlatformDefinition {
  id: "slack" | "telegram" | "email" | "whatsapp";
  label: string;
  icon: typeof IconBrandSlack;
  description: string;
  /** Our own docs anchor — keep these on /docs/messaging so users land on
   *  the page that explains the platform in plain English. */
  docsUrl: string;
  /** Optional external link (e.g. to the platform's developer console). */
  externalUrl?: string;
  externalLabel?: string;
  setupSteps: string[];
  /** Fallback env keys when the adapter doesn't surface them via
   *  `IntegrationStatus.requiredEnvKeys`. The panel prefers adapter-supplied
   *  keys when present so optional fields (webhook secrets, etc.) appear
   *  automatically. */
  envKeys: string[];
}

const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    id: "slack",
    label: "Slack",
    icon: IconBrandSlack,
    description: "Receive mentions and DMs in one workspace-aware dispatch.",
    docsUrl: "/docs/messaging#slack",
    externalUrl: "https://api.slack.com/apps",
    externalLabel: "Open Slack apps",
    envKeys: ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"],
    setupSteps: [
      "Create or open a Slack app at api.slack.com/apps.",
      "Save the bot token and signing secret below — the webhook URL appears once they're saved.",
      "Back in Slack, enable Event Subscriptions and paste the webhook URL.",
      "Subscribe to app_mention and message.im events, then install the app.",
      "Optional but recommended: Basic Information → Display Information → upload an app icon and pick a background color so the bot has a clean avatar in every channel.",
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: IconBrandTelegram,
    description: "Chat with dispatch through a Telegram bot.",
    docsUrl: "/docs/messaging#telegram",
    externalUrl: "https://t.me/BotFather",
    externalLabel: "Open BotFather",
    envKeys: ["TELEGRAM_BOT_TOKEN"],
    setupSteps: [
      "Open @BotFather in Telegram and send /newbot.",
      "Save the bot token here, then click Set up webhook below.",
      "DM the bot in Telegram to test.",
    ],
  },
  {
    id: "email",
    label: "Email",
    icon: IconMail,
    description:
      "Give your agent an email address. People can email it directly or CC it on threads.",
    docsUrl: "/docs/messaging#email",
    externalUrl: "https://resend.com/webhooks",
    externalLabel: "Open Resend webhooks",
    envKeys: ["EMAIL_AGENT_ADDRESS"],
    setupSteps: [
      "Save your Resend or SendGrid API key (Vault or onboarding).",
      "Pick an email address — the easiest is a free <slug>.resend.app address.",
      "If using your own domain, add MX records pointing to your provider.",
      "Save the address here, then register the webhook URL below in Resend (event: email.received).",
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: IconBrandWhatsapp,
    description:
      "Receive WhatsApp messages and reply through a Meta-managed phone number.",
    docsUrl: "/docs/messaging#whatsapp",
    externalUrl: "https://developers.facebook.com/apps",
    externalLabel: "Open Meta developer console",
    envKeys: [
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_PHONE_NUMBER_ID",
    ],
    setupSteps: [
      "Create a Meta app and add the WhatsApp product.",
      "Save the access token, verify token, and phone number ID below.",
      "In Meta's WhatsApp configuration, paste the webhook URL and your verify token.",
      "Subscribe to the messages field, then enable here.",
    ],
  },
];

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
      const res = await fetch(
        agentNativePath("/_agent-native/integrations/status"),
      );
      const rows = res.ok ? await res.json() : [];
      setStatuses(Array.isArray(rows) ? rows : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch(agentNativePath("/_agent-native/integrations/status"))
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
    fetch(agentNativePath("/_agent-native/env-status"))
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
      const res = await fetch(agentNativePath("/_agent-native/env-status"));
      const rows = res.ok ? await res.json() : [];
      setEnvStatuses(Array.isArray(rows) ? rows : []);
    } finally {
      setEnvLoading(false);
    }
  };

  const saveEnvKeys = async (platform: PlatformDefinition, keys: string[]) => {
    const vars = keys
      .map((key) => ({ key, value: envValues[key]?.trim() || "" }))
      .filter((item) => item.value);

    if (vars.length === 0) {
      toast.error("Add the required credentials first.");
      return;
    }

    setSavingKeysFor(platform.id);
    try {
      const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
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
      <div className="grid gap-4 xl:grid-cols-2">
        {PLATFORM_DEFINITIONS.map((platform) => {
          const status = statusByPlatform.get(platform.id);
          const configured = !!status?.configured;
          const enabled = !!status?.enabled;
          // Prefer adapter-supplied env keys (includes optional fields like
          // webhook secrets); fall back to the static list.
          const adapterKeys = status?.requiredEnvKeys;
          const envKeys: RequiredEnvKey[] =
            adapterKeys && adapterKeys.length > 0
              ? adapterKeys
              : platform.envKeys.map((key) => ({
                  key,
                  label: key,
                  required: true,
                }));
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
                <div className="flex items-center gap-3">
                  <a
                    href={platform.docsUrl}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Docs
                  </a>
                  {platform.externalUrl ? (
                    <a
                      href={platform.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {platform.externalLabel ?? "Open"}
                      <IconExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>

              <Collapsible className="mt-5">
                <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  <IconChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  <span>Setup steps</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded-xl border bg-muted/20 p-4">
                    <ol className="space-y-2 text-sm text-muted-foreground">
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
                  {envKeys.map((envKey) => {
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
                              tone={envKey.required ? "neutral" : "neutral"}
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
                {envKeys.some((k) => !envStatusByKey.get(k.key)?.configured) ? (
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
