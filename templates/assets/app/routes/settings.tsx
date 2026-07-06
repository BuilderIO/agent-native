import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  agentNativePath,
  openAgentSettings,
  useActionQuery,
  useBuilderConnectFlow,
  useBuilderStatus,
  useT,
} from "@agent-native/core/client";
import {
  useOnboarding,
  type OnboardingMethod,
  type OnboardingStepStatus,
} from "@agent-native/core/client/onboarding";
import { TeamPage } from "@agent-native/core/client/org";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/toolkit/ui/card";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconCloudUpload,
  IconExternalLink,
  IconKey,
  IconLibraryPhoto,
  IconLoader2,
  IconPhoto,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { PageShell } from "@/components/layout/PageShell";
import { cn } from "@/lib/utils";

import changelog from "../../CHANGELOG.md?raw";

type ImageGenerationConfig = {
  builderEnabled?: boolean;
  builderConnected?: boolean;
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

export default function SettingsPage() {
  const t = useT();
  const { data } = useActionQuery("list-libraries", { compact: true }) as {
    data?: { count?: number };
  };

  return (
    <PageShell
      title={t("settings.title")}
      description={t("settings.description")}
      className="max-w-5xl"
    >
      <SettingsTabsPage
        teamLabel={t("team.title")}
        general={
          <div className="mx-auto w-full max-w-2xl space-y-6">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("settings.connections")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("settings.connectionsDescription")}
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("settings.languageTitle")}
                </CardTitle>
                <CardDescription>
                  {t("settings.languageDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="max-w-xs space-y-1.5">
                <Label>{t("settings.languageLabel")}</Label>
                <LanguagePicker label={t("settings.languageLabel")} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("settings.agentTitle")}
                </CardTitle>
                <CardDescription>
                  {t("settings.agentDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => openAgentSettings()}>
                  {t("settings.openAgentSettings")}
                </Button>
              </CardContent>
            </Card>

            <section id="asset-generation-setup" className="scroll-mt-4">
              <AssetsSetupCard libraryCount={data?.count ?? 0} />
            </section>
          </div>
        }
        team={
          <div className="mx-auto w-full max-w-2xl">
            <TeamPage
              showTitle={false}
              createOrgDescription={t("team.createOrgDescription")}
            />
          </div>
        }
        whatsNew={
          <div className="mx-auto w-full max-w-2xl">
            <ChangelogSettingsCard markdown={changelog} />
          </div>
        }
      />
    </PageShell>
  );
}

function AssetsSetupCard({ libraryCount }: { libraryCount: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const onboarding = useOnboarding();
  const { status } = useBuilderStatus();
  const [manualGenerationOpen, setManualGenerationOpen] = useState(false);
  const [manualStorageOpen, setManualStorageOpen] = useState(false);
  const { data: configData } = useActionQuery(
    "get-image-generation-config",
    {},
  ) as { data?: ImageGenerationConfig };

  const refreshSetup = async () => {
    await Promise.all([
      onboarding.refresh(),
      queryClient.invalidateQueries({
        queryKey: ["action", "get-image-generation-config"],
      }),
    ]);
  };

  const flow = useBuilderConnectFlow({
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
    builderEnabled &&
    (!!configData?.builderConnected || builderConfigured || !!flow.configured);
  const generationReady =
    builderConnected ||
    configData?.configured === true ||
    !!configData?.openaiConfigured ||
    !!configData?.geminiConfigured ||
    !!generationStep?.complete;
  const storageReady =
    builderConnected ||
    !!configData?.objectStorageConfigured ||
    !!storageStep?.complete;
  const setupIssue =
    flow.error ??
    (typeof configData?.lastIssue?.message === "string"
      ? configData.lastIssue.message
      : null);
  const orgName = flow.orgName ?? status?.orgName ?? null;
  const readyCount = [generationReady, storageReady].filter(Boolean).length;

  return (
    <Card className="overflow-hidden border-border/80 bg-card/80 shadow-sm">
      <CardHeader className="border-b border-border/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {t("settings.setupTitle")}
            </CardTitle>
            <CardDescription className="mt-1 leading-6">
              {t("settings.setupDescription")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{readyCount}/2</span>
            {t("settings.setupReady")}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <SettingsRow
          icon={<IconKey className="size-4" />}
          title="Builder"
          description={
            builderConnected
              ? orgName
                ? `Connected to ${orgName}.`
                : t("settings.builderDescriptionReady")
              : builderEnabled
                ? t("settings.builderDescriptionManaged")
                : t("settings.builderDescriptionDisabled")
          }
          status={
            <StatusPill tone={builderConnected ? "ready" : "neutral"}>
              {builderConnected
                ? t("settings.connected")
                : t("settings.optional")}
            </StatusPill>
          }
          action={
            builderEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => flow.start()}
                disabled={flow.connecting}
                className="shrink-0"
              >
                {flow.connecting ? (
                  <>
                    <IconLoader2 className="size-3.5 animate-spin" />
                    {t("settings.connecting")}
                  </>
                ) : builderConnected ? (
                  <>
                    {t("settings.reconnect")}
                    <IconExternalLink className="size-3.5" />
                  </>
                ) : (
                  <>
                    {t("settings.connect")}
                    <IconExternalLink className="size-3.5" />
                  </>
                )}
              </Button>
            ) : null
          }
        />

        {setupIssue ? <SetupIssueCallout message={setupIssue} /> : null}

        <SettingsRow
          icon={<IconPhoto className="size-4" />}
          title={t("settings.generation")}
          description={generationSummary(configData, builderConnected, t)}
          status={
            <StatusPill tone={generationReady ? "ready" : "attention"}>
              {generationReady
                ? t("settings.generationReady")
                : t("settings.generationNeedsSetup")}
            </StatusPill>
          }
          action={
            generationStep ? (
              <DisclosureButton
                open={manualGenerationOpen}
                onClick={() => setManualGenerationOpen((open) => !open)}
              >
                {t("settings.manualKeys")}
              </DisclosureButton>
            ) : null
          }
        />
        {manualGenerationOpen && generationStep ? (
          <ManualMethodPanel
            step={generationStep}
            title={t("settings.manualGenerationKeys")}
            description={t("settings.manualGenerationDescription")}
            onSaved={refreshSetup}
          />
        ) : null}

        <SettingsRow
          icon={<IconCloudUpload className="size-4" />}
          title={t("settings.storage")}
          description={
            storageReady
              ? t("settings.storageReady")
              : t("settings.storageNeedsSetup")
          }
          status={
            <StatusPill tone={storageReady ? "ready" : "attention"}>
              {storageReady
                ? t("settings.generationReady")
                : t("settings.generationNeedsSetup")}
            </StatusPill>
          }
          action={
            storageStep ? (
              <DisclosureButton
                open={manualStorageOpen}
                onClick={() => setManualStorageOpen((open) => !open)}
              >
                {t("settings.configure")}
              </DisclosureButton>
            ) : null
          }
        />
        {manualStorageOpen && storageStep ? (
          <ManualMethodPanel
            step={storageStep}
            title={t("settings.objectStorage")}
            description={t("settings.objectStorageDescription")}
            onSaved={refreshSetup}
          />
        ) : null}

        <SettingsRow
          icon={<IconLibraryPhoto className="size-4" />}
          title={t("settings.brandKits")}
          description={`${libraryCount} accessible ${
            libraryCount === 1 ? "brand kit" : "brand kits"
          }.`}
          status={
            <StatusPill tone="neutral">{t("settings.available")}</StatusPill>
          }
        />
      </CardContent>
    </Card>
  );
}

function SettingsRow({
  icon,
  title,
  description,
  status,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{title}</h3>
            {status}
          </div>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0 sm:ms-4">{action}</div> : null}
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "ready" | "attention" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium",
        tone === "ready" &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "attention" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {tone === "ready" ? <IconCheck className="size-3" /> : null}
      {children}
    </span>
  );
}

function DisclosureButton({
  children,
  open,
  onClick,
}: {
  children: ReactNode;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground"
      aria-expanded={open}
    >
      {children}
      <IconChevronDown
        className={cn("size-3.5 transition-transform", open && "rotate-180")}
      />
    </Button>
  );
}

function ManualMethodPanel({
  step,
  title,
  description,
  onSaved,
}: {
  step: OnboardingStepStatus;
  title: string;
  description: string;
  onSaved: () => Promise<void>;
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
    <div className="border-b border-border/70 bg-muted/20 px-5 py-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>

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
          <CredentialForm method={selected} onSaved={onSaved} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("settings.noManualOptions")}
          </p>
        )}
      </div>
    </div>
  );
}

function CredentialForm({
  method,
  onSaved,
}: {
  method: FormOnboardingMethod;
  onSaved: () => Promise<void>;
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
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
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
      {method.description ? (
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

function SetupIssueCallout({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-b border-border/70 bg-amber-500/5 px-5 py-3"
    >
      <div className="flex gap-2 text-sm leading-6 text-amber-700 dark:text-amber-300">
        <IconAlertCircle className="mt-1 size-4 shrink-0" />
        <p>{message}</p>
      </div>
    </div>
  );
}

function isFormMethod(
  method: OnboardingMethod,
): method is FormOnboardingMethod {
  return method.kind === "form";
}

function generationSummary(
  config: ImageGenerationConfig | undefined,
  builderConnected: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (builderConnected) return t("settings.builderManaged");
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
