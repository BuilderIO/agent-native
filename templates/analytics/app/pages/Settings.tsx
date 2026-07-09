import {
  agentNativePath,
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useAgentSettingsTabs,
  useBuilderConnectFlow,
  useBuilderStatus,
  useT,
  type SettingsSearchEntry,
  type SettingsTabItem,
} from "@agent-native/core/client";
import { TeamPage } from "@agent-native/core/client/org";
import {
  IconBell,
  IconCheck,
  IconChevronDown,
  IconCloud,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconServer,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/AuthProvider";
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
import { useReplayStorageStatus } from "@/hooks/use-replay-storage-status";
import { cn } from "@/lib/utils";

import changelog from "../../CHANGELOG.md?raw";
import { AlertRulesSettingsCard } from "./settings/AlertRulesSettingsCard";

const S3_STORAGE_FIELDS = [
  {
    key: "S3_ENDPOINT",
    labelKey: "settings.s3EndpointLabel",
    placeholder: "https://s3.us-east-1.amazonaws.com",
    required: true,
  },
  {
    key: "S3_BUCKET",
    labelKey: "settings.s3BucketLabel",
    placeholder: "my-replays-bucket",
    required: true,
  },
  {
    key: "S3_ACCESS_KEY_ID",
    labelKey: "settings.s3AccessKeyLabel",
    placeholder: "AKIA...",
    required: true,
  },
  {
    key: "S3_SECRET_ACCESS_KEY",
    labelKey: "settings.s3SecretAccessKeyLabel",
    placeholder: "••••••••",
    required: true,
    secret: true,
  },
  {
    key: "S3_REGION",
    labelKey: "settings.s3RegionLabel",
    placeholder: "us-east-1",
  },
  {
    key: "S3_PUBLIC_BASE_URL",
    labelKey: "settings.s3PublicBaseUrlLabel",
    placeholder: "https://cdn.example.com",
  },
] as const;

async function saveS3StorageSettings(
  values: Record<string, string>,
): Promise<void> {
  const vars = S3_STORAGE_FIELDS.map((field) => ({
    key: field.key,
    value: (values[field.key] ?? "").trim(),
  })).filter((entry) => entry.value.length > 0);

  if (vars.length === 0) {
    throw new Error("Enter at least one storage value.");
  }

  for (const { key, value } of vars) {
    const res = await fetch(agentNativePath("/_agent-native/secrets/adhoc"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: key,
        value,
        scope: "workspace",
        description: "Analytics S3-compatible replay storage", // i18n-ignore -- secret metadata description, not visible UI
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? `Save failed (${res.status})`);
    }
  }
}

export default function Settings() {
  const { auth } = useAuth();
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();

  const storageStatus = useReplayStorageStatus();
  const builderStatus = useBuilderStatus();
  const builderConnect = useBuilderConnectFlow({
    popupUrl:
      builderStatus.status?.cliAuthUrl ?? builderStatus.status?.connectUrl,
    trackingSource: "analytics_settings",
    trackingFlow: "replay_storage",
    onConnected: async () => {
      await Promise.all([storageStatus.refetch(), builderStatus.refetch()]);
      toast.success(t("settings.builderConnectedToast"));
    },
  });

  const [savingStorage, setSavingStorage] = useState(false);
  const [s3Values, setS3Values] = useState<Record<string, string>>({});
  const [s3Expanded, setS3Expanded] = useState(false);

  const storageConfigured = !!storageStatus.data?.configured;
  const activeProviderName = storageStatus.data?.activeProvider?.name ?? null;
  const activeProviderId = storageStatus.data?.activeProvider?.id ?? null;
  const builderConnected = Boolean(
    builderConnect.configured ||
    builderStatus.status?.configured ||
    storageStatus.data?.builderConfigured ||
    activeProviderId === "builder",
  );
  const builderOrgName =
    builderConnect.orgName ?? builderStatus.status?.orgName ?? null;
  const builderStatusLoading =
    storageStatus.isLoading ||
    builderStatus.loading ||
    !builderConnect.hasFetchedStatus;
  const s3Configured = activeProviderId === "s3";
  const s3Collapsed = builderConnected && !s3Expanded;

  async function handleSaveS3Storage() {
    const missing = s3Configured
      ? []
      : S3_STORAGE_FIELDS.filter(
          (field) =>
            "required" in field &&
            field.required &&
            !(s3Values[field.key] ?? "").trim(),
        );
    if (missing.length > 0) {
      toast.error(t("settings.storageRequired"));
      return;
    }

    setSavingStorage(true);
    try {
      await saveS3StorageSettings(s3Values);
      setS3Values((current) => ({
        ...current,
        S3_SECRET_ACCESS_KEY: "",
      }));
      await storageStatus.refetch();
      toast.success(t("settings.storageSaved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("settings.storageSaveFailed"),
      );
    } finally {
      setSavingStorage(false);
    }
  }

  const extraTabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "alerts",
        label: t("settings.alertsTitle"),
        icon: IconBell,
        keywords: "alerts rules notifications thresholds triggers monitoring",
        content: (
          <div className="mx-auto w-full max-w-5xl">
            <AlertRulesSettingsCard />
          </div>
        ),
      },
      ...agentSettingsTabs,
    ],
    [agentSettingsTabs, t],
  );

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "analytics-account",
        label: t("settings.account"),
        keywords: "profile email signed in identity",
        hash: "account",
      },
      {
        id: "analytics-credentials",
        label: t("settings.credentials"),
        keywords: "data sources api keys manage credentials",
        hash: "credentials",
      },
      {
        id: "analytics-replay-storage",
        label: t("settings.replayStorage"),
        keywords: "storage s3 builder replay bucket cloud",
        hash: "replay-storage",
      },
      {
        id: "analytics-dashboard-templates",
        label: t("settings.dashboardTemplates"),
        keywords: "templates catalog dashboards",
        hash: "dashboard-templates",
      },
      {
        id: "analytics-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
      {
        id: "analytics-about",
        label: t("settings.about"),
        keywords: "about version info usage",
        hash: "about",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      teamLabel={t("navigation.team")}
      whatsNewLabel={t("root.whatsNew")}
      extraTabs={extraTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Card id="account" className="bg-card border-border/50 scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.account")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {auth && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t("settings.signedInAs")}
                  </span>
                  <span className="text-sm font-medium">{auth.email}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card
            id="credentials"
            className="bg-card border-border/50 scroll-mt-16"
          >
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.credentials")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {t("settings.credentialsDescription")}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/data-sources">
                  {t("settings.manageDataSources")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card
            id="replay-storage"
            className="bg-card border-border/50 scroll-mt-16"
          >
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <IconCloud className="size-4 text-primary" />
                {t("settings.replayStorage")}
              </CardTitle>
              <CardDescription>
                {t("settings.replayStorageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn(
                  "flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between",
                  builderConnected
                    ? "border-primary/35 bg-primary/5"
                    : "border-border bg-accent/30",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {builderConnected ? (
                      <IconCheck className="h-4 w-4 text-primary" />
                    ) : (
                      <IconKey className="h-4 w-4 text-muted-foreground" />
                    )}
                    {builderStatusLoading
                      ? t("settings.checkingBuilder")
                      : builderConnected
                        ? t("settings.builderConnected")
                        : t("settings.connectBuilder")}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {builderConnected
                      ? builderOrgName
                        ? t("settings.builderConnectedFor", {
                            orgName: builderOrgName,
                          })
                        : t("settings.builderConnectedGeneric")
                      : t("settings.builderIncludes")}
                  </p>
                </div>
                {builderConnected ? (
                  <Badge variant="secondary" className="shrink-0">
                    {t("settings.connected")}
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      builderConnect.start({
                        trackingSource: "analytics_settings_replay_storage",
                        trackingFlow: "replay_storage",
                      })
                    }
                    disabled={builderConnect.connecting || builderStatusLoading}
                  >
                    {builderConnect.connecting ? (
                      <IconLoader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <IconExternalLink className="h-4 w-4" />
                    )}
                    {t("settings.connectBuilder")}
                  </Button>
                )}
              </div>

              <Collapsible
                open={builderConnected ? !s3Collapsed : true}
                onOpenChange={(open) => setS3Expanded(open)}
              >
                <div className="rounded-md border border-border">
                  <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <IconServer className="h-4 w-4 text-muted-foreground" />
                        {t("settings.s3Title")}
                        <Badge variant="outline" className="text-[10px]">
                          {t("settings.secondary")}
                        </Badge>
                        {s3Configured ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {t("settings.active")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {builderConnected
                          ? t("settings.s3BuilderConnectedDescription")
                          : storageConfigured && activeProviderName
                            ? t("settings.s3CurrentProvider", {
                                providerName: activeProviderName,
                              })
                            : t("settings.s3OwnBucketDescription")}
                      </p>
                    </div>
                    {builderConnected ? (
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                        >
                          {s3Collapsed
                            ? t("settings.configureS3")
                            : t("settings.hideS3")}
                          <IconChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform",
                              !s3Collapsed && "rotate-180",
                            )}
                          />
                        </Button>
                      </CollapsibleTrigger>
                    ) : null}
                  </div>

                  <CollapsibleContent>
                    <div className="space-y-4 border-t border-border px-3 py-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        {S3_STORAGE_FIELDS.map((field) => (
                          <div key={field.key} className="space-y-1.5">
                            <Label htmlFor={field.key}>
                              {t(field.labelKey)}
                            </Label>
                            <Input
                              id={field.key}
                              type={
                                "secret" in field && field.secret
                                  ? "password"
                                  : "text"
                              }
                              value={s3Values[field.key] ?? ""}
                              onChange={(event) =>
                                setS3Values((current) => ({
                                  ...current,
                                  [field.key]: event.target.value,
                                }))
                              }
                              placeholder={field.placeholder}
                              autoComplete="off"
                              disabled={savingStorage}
                            />
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-end">
                        <Button
                          onClick={handleSaveS3Storage}
                          disabled={savingStorage || storageStatus.isLoading}
                        >
                          {savingStorage && (
                            <IconLoader2 className="h-4 w-4 animate-spin" />
                          )}
                          {t("settings.saveStorage")}
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            </CardContent>
          </Card>

          <Card
            id="dashboard-templates"
            className="bg-card border-border/50 scroll-mt-16"
          >
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.dashboardTemplates")}
              </CardTitle>
              <CardDescription>
                {t("settings.dashboardTemplatesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link to="/catalog">
                  {t("settings.openDashboardTemplates")}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card id="language" className="bg-card border-border/50 scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.languageTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="max-w-xs space-y-1.5">
              <Label>{t("settings.languageLabel")}</Label>
              <LanguagePicker label={t("settings.languageLabel")} />
            </CardContent>
          </Card>

          <Card id="about" className="bg-card border-border/50 scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">{t("settings.about")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{t("settings.aboutDescription")}</p>
              <p>{t("settings.aboutUsage")}</p>
            </CardContent>
          </Card>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-5xl">
          <TeamPage
            showTitle={false}
            createOrgDescription="Set up a team to share dashboards and data sources with your colleagues."
            className="max-w-5xl"
          />
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
