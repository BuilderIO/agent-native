import {
  agentNativePath,
  useActionQuery,
  useBuilderConnectFlow,
  useBuilderStatus,
} from "@agent-native/core/client";
import {
  useOnboarding,
  type OnboardingMethod,
  type OnboardingStepStatus,
} from "@agent-native/core/client/onboarding";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { PageShell } from "@/components/layout/PageShell";
import { cn } from "@/lib/utils";

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
  const { data } = useActionQuery("list-libraries", { compact: true }) as {
    data?: { count?: number };
  };

  return (
    <PageShell
      title="Settings"
      description="Asset generation, storage, and brand kit access."
      className="max-w-4xl space-y-6"
    >
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Connections</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Keep Assets ready to generate, save, and share brand-safe media.
          Builder is the simplest path; manual keys stay available when you need
          them.
        </p>
      </div>

      <section id="asset-generation-setup" className="scroll-mt-4">
        <AssetsSetupCard libraryCount={data?.count ?? 0} />
      </section>
    </PageShell>
  );
}

function AssetsSetupCard({ libraryCount }: { libraryCount: number }) {
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
            <CardTitle className="text-base">Assets setup</CardTitle>
            <CardDescription className="mt-1 leading-6">
              Two essentials: generation and durable storage.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{readyCount}/2</span>
            ready
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
                : "Connected for managed generation."
              : builderEnabled
                ? "Managed image generation and storage, no provider keys."
                : "Disabled for this deployment."
          }
          status={
            <StatusPill tone={builderConnected ? "ready" : "neutral"}>
              {builderConnected ? "Connected" : "Optional"}
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
                    Connecting
                  </>
                ) : builderConnected ? (
                  <>
                    Reconnect
                    <IconExternalLink className="size-3.5" />
                  </>
                ) : (
                  <>
                    Connect
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
          title="Generation"
          description={generationSummary(configData, builderConnected)}
          status={
            <StatusPill tone={generationReady ? "ready" : "attention"}>
              {generationReady ? "Ready" : "Needs setup"}
            </StatusPill>
          }
          action={
            generationStep ? (
              <DisclosureButton
                open={manualGenerationOpen}
                onClick={() => setManualGenerationOpen((open) => !open)}
              >
                Manual keys
              </DisclosureButton>
            ) : null
          }
        />
        {manualGenerationOpen && generationStep ? (
          <ManualMethodPanel
            step={generationStep}
            title="Manual generation keys"
            description="Add Gemini for video generation, or OpenAI/Gemini as image fallbacks."
            onSaved={refreshSetup}
          />
        ) : null}

        <SettingsRow
          icon={<IconCloudUpload className="size-4" />}
          title="Storage"
          description={
            storageReady
              ? "Originals, thumbnails, videos, and exports have a durable home."
              : "Add S3-compatible storage for production assets and exports."
          }
          status={
            <StatusPill tone={storageReady ? "ready" : "attention"}>
              {storageReady ? "Ready" : "Needs setup"}
            </StatusPill>
          }
          action={
            storageStep ? (
              <DisclosureButton
                open={manualStorageOpen}
                onClick={() => setManualStorageOpen((open) => !open)}
              >
                Configure
              </DisclosureButton>
            ) : null
          }
        />
        {manualStorageOpen && storageStep ? (
          <ManualMethodPanel
            step={storageStep}
            title="Object storage"
            description="Use S3, R2, Spaces, Tigris, MinIO, or another compatible provider."
            onSaved={refreshSetup}
          />
        ) : null}

        <SettingsRow
          icon={<IconLibraryPhoto className="size-4" />}
          title="Brand Kits"
          description={`${libraryCount} accessible ${
            libraryCount === 1 ? "brand kit" : "brand kits"
          }.`}
          status={<StatusPill tone="neutral">Available</StatusPill>}
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
      {action ? <div className="shrink-0 sm:ml-4">{action}</div> : null}
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
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Choose a provider" />
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
            No manual setup options are available for this item.
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = method.payload.fields;
  const submitLabel = fields.length > 1 ? "Save settings" : "Save key";

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
        setError("Enter a value first.");
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
        throw new Error(data.error ?? `Save failed: ${response.status}`);
      }

      setValues({});
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
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
            Saving
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
) {
  if (builderConnected) return "Builder is handling managed image generation.";
  const providers = [
    config?.geminiConfigured ? "Gemini" : null,
    config?.openaiConfigured ? "OpenAI" : null,
  ].filter(Boolean);
  if (providers.length) return `${providers.join(" and ")} configured.`;
  if (config?.builderEnabled === false) {
    return "Add Gemini or OpenAI before generating new assets.";
  }
  return "Add Builder, Gemini, or OpenAI before generating new assets.";
}
