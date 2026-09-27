import { agentNativePath } from "@agent-native/core/client/api-path";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  useOnboarding,
  type OnboardingMethod,
  type OnboardingStepStatus,
} from "@agent-native/core/client/onboarding";
import {
  useBuilderConnectFlow,
  useBuilderStatus,
} from "@agent-native/core/client/settings";
import { IconLoader2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ImageGenerationConfig = {
  builderEnabled?: boolean;
  builderConnected?: boolean;
  builderLookupFailed?: boolean;
  builderStorageConnected?: boolean;
  geminiConfigured?: boolean;
  openaiConfigured?: boolean;
  objectStorageConfigured?: boolean;
  configured?: boolean;
  lastIssue?: {
    message?: unknown;
    at?: unknown;
  } | null;
};

type FormOnboardingMethod = Extract<OnboardingMethod, { kind: "form" }>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Generation and storage readiness, shared by today's setup card and the
 * redesigned Assets › General groups so both read one answer.
 */
export function useGenerationSetup() {
  const t = useT();
  const queryClient = useQueryClient();
  const onboarding = useOnboarding();
  const { status } = useBuilderStatus();
  const configQuery = useActionQuery("get-image-generation-config", {}) as {
    data?: ImageGenerationConfig;
    isLoading: boolean;
    isError: boolean;
  };
  const configData = configQuery.data;

  const refreshSetup = async () => {
    await Promise.all([
      onboarding.refresh(),
      queryClient.invalidateQueries({
        queryKey: ["action", "get-image-generation-config"],
      }),
    ]);
  };

  const flow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: "assets_settings_connections",
    trackingFlow: "image_generation",
    onConnected: refreshSetup,
  });

  const generationStep = onboarding.steps.find(
    (step) => step.id === "image-generation",
  );
  const storageStep = onboarding.steps.find(
    (step) => step.id === "image-storage",
  );

  const builderEnabled = configData?.builderEnabled ?? true;
  const builderConfigured = flow.hasFetchedStatus
    ? flow.configured
    : !!status?.configured;
  const builderConnected =
    !configData?.builderLookupFailed &&
    (!!configData?.builderConnected || builderConfigured || !!flow.configured);
  const builderStorageConnected =
    !!configData?.builderStorageConnected ||
    builderConfigured ||
    !!flow.configured;
  const generationReady =
    (builderEnabled && builderConnected) ||
    configData?.configured === true ||
    !!configData?.openaiConfigured ||
    !!configData?.geminiConfigured;
  const storageReady =
    builderStorageConnected ||
    !!configData?.objectStorageConfigured ||
    !!storageStep?.complete;
  const setupIssue =
    flow.error ??
    (typeof configData?.lastIssue?.message === "string"
      ? configData.lastIssue.message
      : configData?.builderLookupFailed
        ? t("settings.builderLookupFailed")
        : null);
  const orgName = flow.orgName ?? status?.orgName ?? null;

  return {
    configData,
    configLoading: configQuery.isLoading,
    configFailed: configQuery.isError,
    flow,
    generationStep,
    storageStep,
    builderEnabled,
    builderConnected,
    generationReady,
    storageReady,
    setupIssue,
    orgName,
    refreshSetup,
  };
}

export type GenerationSetup = ReturnType<typeof useGenerationSetup>;

export function builderDescription(setup: GenerationSetup, t: Translate) {
  if (setup.builderConnected) {
    return setup.orgName
      ? t("settings.builderConnectedTo", { orgName: setup.orgName })
      : t("settings.builderDescriptionReady");
  }
  return setup.builderEnabled
    ? t("settings.builderDescriptionManaged")
    : t("settings.builderDescriptionDisabled");
}

export function generationSummary(
  config: ImageGenerationConfig | undefined,
  builderConnected: boolean,
  t: Translate,
) {
  if (builderConnected && config?.builderEnabled !== false) {
    return t("settings.builderManaged");
  }
  const providers = [
    config?.geminiConfigured ? "Gemini" : null,
    config?.openaiConfigured ? "OpenAI" : null,
  ].filter(Boolean);
  if (providers.length) {
    return t("settings.providerConfigured", {
      providers: providers.join(" and "),
    });
  }
  if (config?.builderEnabled === false) {
    return t("settings.addGeminiOrOpenAI");
  }
  return t("settings.addBuilderGeminiOrOpenAI");
}

export function ManualMethodPanel({
  step,
  title,
  description,
  onSaved,
}: {
  step: OnboardingStepStatus;
  title: string;
  description?: string;
  onSaved: () => Promise<void>;
}) {
  return (
    <div className="border-b border-border/70 bg-muted/20 px-5 py-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        <ManualMethodFields step={step} onSaved={onSaved} />
      </div>
    </div>
  );
}

/** The step's form methods: a provider picker when there are several, then its fields. */
export function ManualMethodFields({
  step,
  onSaved,
  showMethodDescription = true,
}: {
  step: OnboardingStepStatus;
  onSaved: () => Promise<void>;
  showMethodDescription?: boolean;
}) {
  const t = useT();
  const methods = useMemo(() => step.methods.filter(isFormMethod), [step]);
  const [selectedId, setSelectedId] = useState(methods[0]?.id ?? "");

  useEffect(() => {
    if (!methods.some((method) => method.id === selectedId)) {
      setSelectedId(methods[0]?.id ?? "");
    }
  }, [methods, selectedId]);

  const selected = methods.find((method) => method.id === selectedId);

  return (
    <div className="space-y-4">
      {methods.length > 1 ? (
        <div className="max-w-xs">
          <Label className="text-xs text-muted-foreground">
            {t("settings.provider")}
          </Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="mt-2">
              <SelectValue placeholder={t("settings.chooseProvider")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {methods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {selected ? (
        <CredentialForm
          key={selected.id}
          method={selected}
          onSaved={onSaved}
          showDescription={showMethodDescription}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("settings.noManualOptions")}
        </p>
      )}
    </div>
  );
}

function CredentialForm({
  method,
  onSaved,
  showDescription,
}: {
  method: FormOnboardingMethod;
  onSaved: () => Promise<void>;
  showDescription: boolean;
}) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = method.payload.fields;
  const submitLabel =
    fields.length > 1 ? t("settings.saveSettings") : t("settings.saveKey");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const vars = fields
        .map((field) => ({
          key: field.key,
          value: (values[field.key] ?? "").trim(),
        }))
        .filter((item) => item.value !== "");

      if (!vars.length) {
        setError(t("settings.enterValueFirst"));
        return;
      }

      const response = await fetch(agentNativePath("/_agent-native/env-vars"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vars,
          scope: method.payload.writeScope ?? "workspace",
        }),
      });

      if (!response.ok) {
        throw new Error(`${t("settings.saveFailed")}: ${response.status}`);
      }

      setValues({});
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {showDescription && method.description ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {method.description}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `${method.id}-${field.key}`;
          return (
            <div
              key={field.key}
              className={cn(fields.length === 1 && "sm:col-span-2")}
            >
              <Label htmlFor={id} className="text-xs text-muted-foreground">
                {field.label}
              </Label>
              <Input
                id={id}
                type={field.secret ? "password" : "text"}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
                className="mt-2"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={saving}>
        {saving ? (
          <>
            <IconLoader2 className="size-3.5 animate-spin" />
            {t("settings.saving")}
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}

function isFormMethod(
  method: OnboardingMethod,
): method is FormOnboardingMethod {
  return method.kind === "form";
}
