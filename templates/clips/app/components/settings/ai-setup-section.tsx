import { agentNativePath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  BUILDER_CREDITS_UPGRADE_URL,
  type BuilderCreditsStatus,
} from "@shared/builder-credits";
import {
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconKey,
  IconLoader2,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SecretStatus } from "@/hooks/use-secret-status";
import { cn } from "@/lib/utils";

import type { BuilderConnection } from "./types";

const BUILDER_CREDITS_FEATURE_LABELS = [
  "builderCredits.featureBackupTranscription",
  "builderCredits.featureCleanup",
  "builderCredits.featureSummaries",
  "builderCredits.featureTitles",
] as const;

const AI_PROVIDER_FIELDS = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    storage: "agent-engine",
    engine: "anthropic",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI",
    placeholder: "sk-...",
    storage: "agent-engine",
    engine: "ai-sdk:openai",
  },
  {
    key: "GEMINI_API_KEY",
    label: "Gemini",
    placeholder: "AI...",
    storage: "secret",
  },
  {
    key: "GROQ_API_KEY",
    label: "Groq",
    placeholder: "gsk_...",
    storage: "secret",
    engine: "ai-sdk:groq",
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    storage: "agent-engine",
    engine: "ai-sdk:openrouter",
  },
] as const;

async function saveAgentEngineApiKey(
  key: string,
  value: string,
): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/agent-engine/api-key"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, scope: "user" }),
    },
  );

  if (!res.ok) {
    // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Save failed (${res.status})`);
  }
}

async function applyAgentEngine(engine: string): Promise<void> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/manage-agent-engine"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", engine }),
    },
  );

  // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    result?: unknown;
  } | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Engine switch failed (${res.status})`);
  }
  const result = body?.result ?? body;
  const text =
    typeof result === "string"
      ? result.trim()
      : result && typeof result === "object"
        ? JSON.stringify(result)
        : "";
  if (/^(Error|Warning):/i.test(text)) {
    throw new Error(text);
  }
}

async function saveRegisteredSecret(key: string, value: string): Promise<void> {
  const res = await fetch(
    agentNativePath(`/_agent-native/secrets/${encodeURIComponent(key)}`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );

  if (!res.ok) {
    // coercion-ok: an error body may not be JSON; the failure is still raised with the status code.
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Save failed (${res.status})`);
  }
}

export interface AiSetupSectionProps {
  builder: BuilderConnection;
  secrets: SecretStatus;
}

export function AiSetupSection({ builder, secrets }: AiSetupSectionProps) {
  const t = useT();
  const creditStatus = useActionQuery<BuilderCreditsStatus>(
    "get-builder-credit-status",
    undefined,
    { retry: false },
  );
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const configuredCount = AI_PROVIDER_FIELDS.filter(
    (field) => secrets.configured[field.key],
  ).length;
  const creditsPaused = creditStatus.data?.exhausted === true;
  const upgradeUrl =
    creditStatus.data?.upgradeUrl ?? BUILDER_CREDITS_UPGRADE_URL;

  async function handleSaveApiKey(key: string) {
    const value = (values[key] ?? "").trim();
    if (!value) {
      toast.error(t("settings.pasteProviderKey"));
      return;
    }

    setSavingKey(key);
    try {
      const field = AI_PROVIDER_FIELDS.find((item) => item.key === key);
      if (field?.storage === "secret") {
        await saveRegisteredSecret(key, value);
      } else {
        await saveAgentEngineApiKey(key, value);
      }
      if (field && "engine" in field) {
        await applyAgentEngine(field.engine);
      }
      setValues((current) => ({ ...current, [key]: "" }));
      window.dispatchEvent(new CustomEvent("agent-engine:configured-changed"));
      await secrets.refresh();
      toast.success(t("settings.apiKeySaved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.apiKeyFailed"),
      );
    } finally {
      setSavingKey(null);
    }
  }

  function openProviderSetup() {
    setExpanded(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById("ai-provider-keys")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstEmptyField =
        AI_PROVIDER_FIELDS.find((field) => !secrets.configured[field.key]) ??
        AI_PROVIDER_FIELDS[0];
      window.setTimeout(() => {
        document.getElementById(firstEmptyField.key)?.focus();
      }, 150);
    });
  }

  return (
    <Card id="ai-providers" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <IconBrain className="size-4 text-primary" />
          {t("settings.apiSetup")}
        </CardTitle>
        <CardDescription>{t("settings.apiSetupDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            "flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
            builder.connected
              ? "border-border bg-muted/20"
              : "border-border bg-accent/30",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              {builder.connected ? (
                <IconCheck className="h-4 w-4 text-primary" />
              ) : (
                <IconKey className="h-4 w-4 text-muted-foreground" />
              )}
              {builder.loading
                ? t("settings.checkingBuilder")
                : builder.connected
                  ? t("settings.builderAiAvailable")
                  : t("settings.builderEasySetup")}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {builder.connected
                ? t("settings.apiSetupDescription")
                : t("settings.builderAiDescription")}
            </p>
          </div>
          {!builder.connected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() =>
                builder.start({
                  trackingSource: "clips_settings_ai_setup",
                  trackingFlow: "connect_llm",
                })
              }
              disabled={builder.connecting || builder.loading}
            >
              {builder.connecting ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconExternalLink className="h-4 w-4" />
              )}
              {t("settings.connectBuilder")}
            </Button>
          ) : null}
        </div>

        {creditsPaused ? (
          <div className="rounded-md border border-amber-300/70 bg-amber-50/80 p-3 text-amber-950 shadow-sm dark:border-amber-400/30 dark:bg-amber-950/25 dark:text-amber-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="rounded-md bg-amber-100 p-1 dark:bg-amber-400/15">
                    <IconBolt className="h-4 w-4 text-amber-700 dark:text-amber-200" />
                  </span>
                  {t("builderCredits.pausedTitle")}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/80">
                  {t("builderCredits.settingsDescription")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BUILDER_CREDITS_FEATURE_LABELS.map((key) => (
                    <span
                      key={key}
                      className="rounded-full border border-amber-300/70 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100"
                    >
                      {t(key)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild size="sm" className="h-8">
                  <a
                    href={upgradeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <IconExternalLink className="h-4 w-4" />
                    {t("builderCredits.upgrade")}
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-amber-300/80 bg-background/70 text-amber-950 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  onClick={openProviderSetup}
                >
                  {t("builderCredits.openAiSetup")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <div className="rounded-md border border-border">
            <CollapsibleTrigger asChild>
              <button
                id="ai-provider-keys"
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-start"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconKey className="h-4 w-4 text-muted-foreground" />
                    {t("settings.providerKeyTitle")}
                    {configuredCount > 0 ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {t("settings.providerKeysSet", {
                          count: configuredCount,
                        })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings.providerKeyDescription")}
                  </p>
                </div>
                <IconChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 border-t border-border px-3 py-4">
                {secrets.loading ? (
                  <div className="text-xs text-muted-foreground">
                    {t("settings.checkingProviderKeys")}
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  {AI_PROVIDER_FIELDS.map((field) => {
                    const configured = Boolean(secrets.configured[field.key]);
                    const savingThisKey = savingKey === field.key;
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label htmlFor={field.key}>{field.label}</Label>
                          {configured ? (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
                              <IconCheck className="h-3 w-3" />
                              {t("settings.keySet")}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id={field.key}
                            type="password"
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                void handleSaveApiKey(field.key);
                              }
                            }}
                            placeholder={
                              configured
                                ? t("settings.replaceKey")
                                : field.placeholder
                            }
                            autoComplete="off"
                            disabled={savingThisKey}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => handleSaveApiKey(field.key)}
                            disabled={
                              savingThisKey || !(values[field.key] ?? "").trim()
                            }
                          >
                            {savingThisKey ? (
                              <IconLoader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              t("common.save")
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
