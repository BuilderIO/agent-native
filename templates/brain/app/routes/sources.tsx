import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconArchive,
  IconBrandGithub,
  IconBrandSlack,
  IconChecks,
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconDatabaseImport,
  IconDotsVertical,
  IconExternalLink,
  IconFileSearch,
  IconFileText,
  IconLoader2,
  IconNotes,
  IconPlayerPlay,
  IconRefresh,
  IconReportAnalytics,
  IconSend,
  IconSettings2,
  IconShieldCheck,
  IconVideo,
  IconWebhook,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import {
  EmptyActionState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from "@/components/brain/Surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type BrainConnectionProvider,
  type BrainHealthResponse,
  type BrainCaptureReviewStatus,
  type BrainCaptureReviewItem,
  type EnqueueCapturesDistillationResponse,
  type CapturesResponse,
  type BrainSource,
  type BrainWorkspaceConnectionGrantState,
  type BrainWorkspaceConnectionStatus,
  type BrainWorkspaceCredentialRef,
  type ConnectionProvidersResponse,
  type SourcesResponse,
  formatPercent,
  sourceAutoSync,
  sourceDescription,
  sourceEnabled,
  sourceHealth,
  sourceLastSync,
  sourceName,
  sourceRetryAfter,
  sourceReviewRequired,
  sourceType,
} from "@/lib/brain";

type Provider = "manual" | "generic" | "clips" | "slack" | "granola" | "github";
type CaptureStatusFilter = BrainCaptureReviewStatus | "all";
type BrainT = ReturnType<typeof useT>;

interface SourceFormState {
  title: string;
  provider: Provider;
  channelRefs: string;
  historyLimit: string;
  granolaPageSize: string;
  granolaUpdatedAfter: string;
  githubRepos: string;
  githubLimit: string;
  githubState: "open" | "closed" | "all";
  githubIncludeIssues: boolean;
  githubIncludePullRequests: boolean;
  workspaceConnectionId: string;
  pollMinutes: string;
  sourceKey: string;
  autoSync: boolean;
  reviewRequired: boolean;
}

const providers: Array<{
  value: Provider;
  label: string;
  detail: string;
  icon: typeof IconDatabaseImport;
}> = [
  {
    value: "slack",
    label: "Slack",
    detail: "Approved public/private channels only",
    icon: IconBrandSlack,
  },
  {
    value: "granola",
    label: "Granola",
    detail: "Enterprise API Team-space notes",
    icon: IconNotes,
  },
  {
    value: "github",
    label: "GitHub",
    detail: "Approved repository issues and PRs",
    icon: IconBrandGithub,
  },
  {
    value: "clips",
    label: "Clips",
    detail: "Recordings exported into Brain",
    icon: IconVideo,
  },
  {
    value: "generic",
    label: "Webhook",
    detail: "Signed transcript and capture imports",
    icon: IconWebhook,
  },
  {
    value: "manual",
    label: "Manual",
    detail: "Agent/UI imports without remote sync",
    icon: IconFileText,
  },
];

function defaultTitle(provider: Provider, t?: ReturnType<typeof useT>) {
  switch (provider) {
    case "slack":
      return t?.("sources.defaultTitle.slack") ?? "Slack knowledge channels";
    case "granola":
      return t?.("sources.defaultTitle.granola") ?? "Granola team notes";
    case "github":
      return t?.("sources.defaultTitle.github") ?? "GitHub product repos";
    case "clips":
      return t?.("sources.defaultTitle.clips") ?? "Clips exports";
    case "generic":
      return (
        t?.("sources.defaultTitle.generic") ?? "Generic transcript webhook"
      );
    case "manual":
    default:
      return t?.("sources.defaultTitle.manual") ?? "Manual imports";
  }
}

function defaultForm(
  provider: Provider,
  t?: ReturnType<typeof useT>,
): SourceFormState {
  return {
    title: defaultTitle(provider, t),
    provider,
    channelRefs: "",
    historyLimit: "15",
    granolaPageSize: "10",
    granolaUpdatedAfter: "",
    githubRepos: "",
    githubLimit: "25",
    githubState: "all",
    githubIncludeIssues: true,
    githubIncludePullRequests: true,
    workspaceConnectionId: "",
    pollMinutes: "60",
    sourceKey: provider === "generic" || provider === "clips" ? provider : "",
    autoSync:
      provider === "slack" || provider === "granola" || provider === "github",
    reviewRequired: true,
  };
}

function listValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return typeof value === "string" ? value : "";
}

function formFromSource(source: BrainSource): SourceFormState {
  const provider = (source.provider ?? "generic") as Provider;
  const config = source.config ?? {};
  return {
    ...defaultForm(provider),
    title: sourceName(source),
    channelRefs: listValue(
      config.channelIds ?? config.channels ?? config.allowedChannels,
    ),
    historyLimit:
      typeof config.historyLimit === "number" ||
      typeof config.historyLimit === "string"
        ? String(config.historyLimit)
        : "15",
    granolaPageSize:
      typeof config.pageSize === "number" || typeof config.pageSize === "string"
        ? String(config.pageSize)
        : "10",
    granolaUpdatedAfter:
      typeof config.updatedAfter === "string" ? config.updatedAfter : "",
    githubRepos: listValue(config.repositories ?? config.repos),
    githubLimit:
      typeof config.limit === "number" || typeof config.limit === "string"
        ? String(config.limit)
        : "25",
    githubState:
      config.state === "open" || config.state === "closed"
        ? config.state
        : "all",
    githubIncludeIssues: config.includeIssues !== false,
    githubIncludePullRequests: config.includePullRequests !== false,
    workspaceConnectionId:
      typeof config.workspaceConnectionId === "string"
        ? config.workspaceConnectionId
        : "",
    pollMinutes:
      typeof config.pollMinutes === "number" ||
      typeof config.pollMinutes === "string"
        ? String(config.pollMinutes)
        : "60",
    sourceKey: "",
    autoSync: sourceAutoSync(source),
    reviewRequired: sourceReviewRequired(source),
  };
}

function splitLines(value: string) {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function numberValue(
  value: string,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function buildConfig(form: SourceFormState) {
  const config: Record<string, unknown> = {
    reviewRequired: form.reviewRequired,
    autoSync: form.autoSync,
    pollMinutes: numberValue(form.pollMinutes, 60, 5, 1440),
  };
  if (form.provider === "slack") {
    config.channelIds = splitLines(form.channelRefs);
    config.historyLimit = numberValue(form.historyLimit, 15, 1, 15);
  }
  if (form.provider === "granola") {
    config.pageSize = numberValue(form.granolaPageSize, 10, 1, 30);
    if (form.granolaUpdatedAfter.trim()) {
      config.updatedAfter = form.granolaUpdatedAfter.trim();
    }
  }
  if (form.provider === "github") {
    config.repositories = splitLines(form.githubRepos);
    config.state = form.githubState;
    config.limit = numberValue(form.githubLimit, 25, 1, 100);
    config.includeIssues = form.githubIncludeIssues;
    config.includePullRequests = form.githubIncludePullRequests;
  }
  config.workspaceConnectionId = form.workspaceConnectionId.trim();
  if (form.sourceKey.trim()) config.sourceKey = form.sourceKey.trim();
  return config;
}

function sourceProviderIcon(provider?: string) {
  return (
    providers.find((item) => item.value === provider)?.icon ?? IconFileText
  );
}

function shortDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function syncDetail(source: BrainSource, t: BrainT) {
  const retry = sourceRetryAfter(source);
  if (retry)
    return t("sources.retryAfter", { date: shortDate(retry) ?? retry });
  if (source.lastError) return source.lastError;
  if (source.latestRun?.status === "error") {
    return source.latestRun.error ?? t("sources.lastSyncFailed");
  }
  if (source.nextSyncAt)
    return t("sources.nextSync", {
      date: shortDate(source.nextSyncAt) ?? source.nextSyncAt,
    });
  return sourceAutoSync(source)
    ? t("sources.waitingForFirstSync")
    : t("sources.manualSync");
}

const captureStatusOptions: CaptureStatusFilter[] = [
  "queued",
  "distilling",
  "distilled",
  "ignored",
  "all",
];

function captureStatusLabel(status: CaptureStatusFilter, t: BrainT) {
  switch (status) {
    case "queued":
      return t("sources.captureStatus.queued");
    case "distilling":
      return t("sources.captureStatus.distilling");
    case "distilled":
      return t("sources.captureStatus.distilled");
    case "ignored":
      return t("sources.captureStatus.ignored");
    case "all":
    default:
      return t("sources.captureStatus.all");
  }
}

function queueStatusLabel(status: string, t: BrainT) {
  switch (status) {
    case "processing":
      return t("sources.queueStatus.processing");
    case "done":
      return t("sources.queueStatus.done");
    case "failed":
      return t("sources.queueStatus.failed");
    case "queued":
    default:
      return t("sources.queueStatus.queued");
  }
}

function queueActionLabel(
  queue: NonNullable<CapturesResponse["captures"]>[number]["distillationQueue"],
  t: BrainT,
) {
  if (!queue) return t("sources.queueDistill");
  if (queue.status === "failed") return t("sources.retryDistill");
  if (queue.status === "done") return t("sources.captureStatus.distilled");
  return t("sources.queueStatus.queued");
}

function captureCanQueue(capture: BrainCaptureReviewItem) {
  const queue = capture.distillationQueue;
  const terminal =
    capture.status === "distilled" || capture.status === "ignored";
  return !terminal && (!queue || queue.status === "failed");
}

function isSourceProvider(providerId: string): providerId is Provider {
  return providers.some((provider) => provider.value === providerId);
}

function dispatchIntegrationsHref(providerId: string) {
  const params = new URLSearchParams({ provider: providerId, appId: "brain" });
  return `/dispatch/integrations?${params.toString()}`;
}

function grantStateLabel(state: BrainWorkspaceConnectionGrantState, t: BrainT) {
  switch (state) {
    case "connected":
      return t("sources.grantState.connected");
    case "granted":
      return t("sources.grantState.granted");
    case "needs_grant":
      return t("sources.grantState.needsGrant");
    case "not_connected":
    default:
      return t("sources.grantState.notConnected");
  }
}

function grantStateDetail(
  provider: BrainConnectionProvider,
  state: BrainWorkspaceConnectionGrantState,
  t: BrainT,
) {
  const workspace = provider.workspaceConnection;
  if (workspace?.grantAvailabilityMessage) {
    return workspace.grantAvailabilityMessage;
  }
  const sourceCount = provider.configuredSourceCount.toLocaleString();
  switch (state) {
    case "connected":
      return t("sources.grantDetail.connected", {
        count: (workspace?.activeConnectionCount ?? 0).toLocaleString(),
      });
    case "granted":
      return t("sources.grantDetail.granted", {
        count: (workspace?.grantedConnectionCount ?? 0).toLocaleString(),
      });
    case "needs_grant":
      return t("sources.grantDetail.needsGrant");
    case "not_connected":
    default:
      return provider.hasConfiguredSources
        ? t("sources.grantDetail.configuredSources", {
            count: sourceCount,
          })
        : t("sources.grantDetail.noSharedConnection");
  }
}

type ReadinessTone = "ready" | "attention" | "danger" | "muted";

type ProviderReadinessItem = {
  label: string;
  value: string;
  detail: string;
  tone: ReadinessTone;
  icon: typeof IconDatabaseImport;
};

function readinessToneClass(tone: ReadinessTone) {
  switch (tone) {
    case "ready":
      return "border-border bg-secondary text-secondary-foreground";
    case "attention":
      return "border-border bg-accent text-accent-foreground";
    case "danger":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "muted":
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function providerHealthLabel(provider: BrainConnectionProvider, t: BrainT) {
  switch (provider.providerHealth?.status) {
    case "ready":
      return t("sources.providerHealth.ready");
    case "needs_grant":
      return t("sources.providerHealth.grantNeeded");
    case "unhealthy":
      return t("sources.providerHealth.needsRepair");
    case "missing_credentials":
      return t("sources.providerHealth.missingKeys");
    case "unsupported":
      return t("sources.providerHealth.metadataOnly");
    default:
      return t("sources.providerHealth.unknown");
  }
}

function providerHealthClass(provider: BrainConnectionProvider) {
  switch (provider.providerHealth?.status) {
    case "ready":
      return readinessToneClass("ready");
    case "needs_grant":
    case "unhealthy":
      return readinessToneClass("attention");
    case "missing_credentials":
      return readinessToneClass("danger");
    case "unsupported":
    default:
      return readinessToneClass("muted");
  }
}

function grantStateClass(state: BrainWorkspaceConnectionGrantState) {
  switch (state) {
    case "connected":
      return readinessToneClass("ready");
    case "granted":
      return readinessToneClass("attention");
    case "needs_grant":
      return readinessToneClass("attention");
    case "not_connected":
    default:
      return readinessToneClass("muted");
  }
}

type BrainWorkspaceSummaryConnection = NonNullable<
  BrainConnectionProvider["workspaceConnection"]
>["connections"][number];

function appAccessLabel(
  access: BrainWorkspaceSummaryConnection["appAccess"],
  t: BrainT,
) {
  switch (access?.mode) {
    case "all-apps":
      return t("sources.appAccess.allApps");
    case "allowed-app":
      return t("sources.appAccess.brainAllowList");
    case "explicit-grant":
      return t("sources.appAccess.brainGrant");
    case "unavailable":
    default:
      return t("sources.appAccess.needsBrainGrant");
  }
}

function appAccessClass(access: BrainWorkspaceSummaryConnection["appAccess"]) {
  return access?.available
    ? readinessToneClass("muted")
    : grantStateClass("needs_grant");
}

function workspaceStatusLabel(
  status: BrainWorkspaceConnectionStatus,
  t: BrainT,
) {
  switch (status) {
    case "connected":
      return t("sources.workspaceStatus.connected");
    case "checking":
      return t("sources.workspaceStatus.checking");
    case "needs_reauth":
      return t("sources.workspaceStatus.needsReauth");
    case "error":
      return t("sources.workspaceStatus.error");
    case "disabled":
    default:
      return t("sources.workspaceStatus.disabled");
  }
}

function workspaceStatusClass(status: BrainWorkspaceConnectionStatus) {
  switch (status) {
    case "connected":
      return readinessToneClass("ready");
    case "checking":
      return readinessToneClass("attention");
    case "needs_reauth":
      return readinessToneClass("attention");
    case "error":
      return readinessToneClass("danger");
    case "disabled":
    default:
      return readinessToneClass("muted");
  }
}

function supportsWorkspaceConnectionBinding(provider: Provider) {
  return (
    provider === "slack" || provider === "granola" || provider === "github"
  );
}

function providerMetadataForSource(
  providers: BrainConnectionProvider[],
  provider: Provider,
) {
  return providers.find((entry) => entry.id === provider);
}

function grantedWorkspaceConnections(provider?: BrainConnectionProvider) {
  return (provider?.workspaceConnection?.connections ?? []).filter(
    (connection) => connection.appAccess?.available,
  );
}

function grantStateIcon(state: BrainWorkspaceConnectionGrantState) {
  switch (state) {
    case "connected":
      return IconCircleCheck;
    case "granted":
      return IconShieldCheck;
    case "needs_grant":
      return IconAlertTriangle;
    case "not_connected":
    default:
      return IconCircleDashed;
  }
}

function refLabel(ref: BrainWorkspaceCredentialRef) {
  return `${ref.key}${ref.scope ? `:${ref.scope}` : ""}`;
}

function providerWorkspaceCredentialRefs(provider: BrainConnectionProvider) {
  const refs = new Map<string, BrainWorkspaceCredentialRef>();
  for (const connection of provider.workspaceConnection?.connections ?? []) {
    for (const ref of connection.credentialRefs) {
      refs.set(`${connection.id}:connection:${refLabel(ref)}`, ref);
    }
    for (const ref of connection.explicitGrant?.credentialRefs ?? []) {
      refs.set(`${connection.id}:grant:${refLabel(ref)}`, ref);
    }
  }
  return Array.from(refs.values());
}

function availableCredentialDetails(provider: BrainConnectionProvider) {
  return (
    provider.credentialHealth?.details.filter((detail) => detail.available) ??
    []
  );
}

function credentialCount(
  provider: BrainConnectionProvider,
  source: "workspace_connection" | "brain_local" | "registered_secret",
) {
  return availableCredentialDetails(provider).filter(
    (detail) => detail.provenance?.source === source,
  ).length;
}

function scopedCredentialCount(provider: BrainConnectionProvider) {
  return (
    credentialCount(provider, "brain_local") +
    credentialCount(provider, "registered_secret")
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function sharedConnectionReadiness(
  provider: BrainConnectionProvider,
  t: BrainT,
): ProviderReadinessItem {
  const workspace = provider.workspaceConnection;
  if (!workspace) {
    return {
      label: t("sources.sharedConnection"),
      value: t("sources.workspaceStatus.checking"),
      detail: t("sources.readiness.workspaceNotLoaded"),
      tone: "muted",
      icon: IconCircleDashed,
    };
  }
  if (workspace.hasActiveWorkspaceConnection) {
    return {
      label: t("sources.sharedConnection"),
      value: t("sources.workspaceStatus.connected"),
      detail: t("sources.readiness.activeConnections", {
        count: workspace.activeConnectionCount.toLocaleString(),
      }),
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  if (workspace.hasGrantedWorkspaceConnection) {
    return {
      label: t("sources.sharedConnection"),
      value: t("sources.readiness.repair"),
      detail: t("sources.readiness.grantNeedsAttention"),
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (workspace.hasWorkspaceConnection) {
    return {
      label: t("sources.sharedConnection"),
      value: t("sources.readiness.grantable"),
      detail: t("sources.readiness.workspaceConnectionGrantable"),
      tone: "attention",
      icon: IconShieldCheck,
    };
  }
  return {
    label: t("sources.sharedConnection"),
    value: t("sources.grantState.notConnected"),
    detail: scopedCredentialCount(provider)
      ? t("sources.readiness.scopedLocalCredentialRefs")
      : t("sources.readiness.addReusableConnection"),
    tone: "muted",
    icon: IconCircleDashed,
  };
}

function appGrantReadiness(
  provider: BrainConnectionProvider,
  t: BrainT,
): ProviderReadinessItem {
  const workspace = provider.workspaceConnection;
  const grantState = workspace?.grantState ?? "not_connected";
  if (grantState === "connected" || grantState === "granted") {
    return {
      label: t("sources.brainAppGrant"),
      value:
        grantState === "connected"
          ? t("sources.grantState.granted")
          : t("sources.readiness.grantedRepair"),
      detail:
        grantState === "connected"
          ? t("sources.readiness.brainCanUseSharedConnection")
          : t("sources.readiness.accessGrantedConnectionInactive"),
      tone: grantState === "connected" ? "ready" : "attention",
      icon: grantStateIcon(grantState),
    };
  }
  if (grantState === "needs_grant") {
    return {
      label: t("sources.brainAppGrant"),
      value: t("sources.readiness.needed"),
      detail: t("sources.readiness.grantExistingConnection"),
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  return {
    label: t("sources.brainAppGrant"),
    value: scopedCredentialCount(provider)
      ? t("sources.readiness.notNeeded")
      : t("sources.readiness.noGrant"),
    detail: scopedCredentialCount(provider)
      ? t("sources.readiness.scopedCredentialsAvailable")
      : t("sources.readiness.grantAppearsAfterConnection"),
    tone: "muted",
    icon: IconCircleDashed,
  };
}

function credentialPathReadiness(
  provider: BrainConnectionProvider,
  t: BrainT,
): ProviderReadinessItem {
  const health = provider.credentialHealth;
  if (!health) {
    return {
      label: t("sources.credentialPath"),
      value: t("sources.workspaceStatus.checking"),
      detail: t("sources.readiness.credentialNotLoaded"),
      tone: "muted",
      icon: IconCircleDashed,
    };
  }
  if (health.status === "not_required") {
    return {
      label: t("sources.credentialPath"),
      value: t("sources.notRequired"),
      detail: t("sources.readiness.noCredentialKeyRequired"),
      tone: "ready",
      icon: IconCircleCheck,
    };
  }

  const available = availableCredentialDetails(provider)[0];
  if (available?.provenance?.source === "workspace_connection") {
    return {
      label: t("sources.credentialPath"),
      value: t("sources.readiness.shared"),
      detail: t("sources.readiness.usingWorkspaceCredentialRefs"),
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (available?.provenance?.source === "brain_local") {
    return {
      label: t("sources.credentialPath"),
      value: t("sources.readiness.brainLocal"),
      detail: t("sources.readiness.scopedCredentialRefsConfigured"),
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (available?.provenance?.source === "registered_secret") {
    return {
      label: t("sources.credentialPath"),
      value: t("sources.readiness.vault"),
      detail: t("sources.readiness.registeredCredentialRefAvailable"),
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (health.available) {
    return {
      label: t("sources.credentialPath"),
      value: t("sources.readiness.available"),
      detail: t("sources.readiness.requiredCredentialRefsAvailable"),
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  return {
    label: t("sources.credentialPath"),
    value: t("sources.readiness.missing"),
    detail:
      health.missingMessages[0] ??
      t("sources.readiness.addSharedOrScopedCredential"),
    tone: "danger",
    icon: IconAlertTriangle,
  };
}

function providerConnectionReadiness(
  provider: BrainConnectionProvider,
  t: BrainT,
): ProviderReadinessItem {
  const workspace = provider.workspaceConnection;
  const health = provider.providerHealth?.status;
  if (!provider.sourceProviderSupported) {
    return {
      label: t("sources.providerConnection"),
      value: t("sources.providerHealth.metadataOnly"),
      detail: t("sources.readiness.sourceSetupNotImplemented"),
      tone: "muted",
      icon: IconCircleDashed,
    };
  }
  if (health === "ready") {
    return {
      label: t("sources.providerConnection"),
      value: t("sources.providerHealth.ready"),
      detail: workspace?.hasActiveWorkspaceConnection
        ? t("sources.readiness.readyThroughSharedConnection")
        : scopedCredentialCount(provider)
          ? t("sources.readiness.readyThroughScopedRefs")
          : t("sources.readiness.readyForSourceSetup"),
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  if (health === "needs_grant") {
    return {
      label: t("sources.providerConnection"),
      value: t("sources.providerHealth.grantNeeded"),
      detail: t("sources.readiness.providerNeedsAppAccess"),
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (health === "unhealthy") {
    return {
      label: t("sources.providerConnection"),
      value: t("sources.readiness.repair"),
      detail: t("sources.readiness.reauthorizeProviderConnection"),
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (health === "missing_credentials" && !workspace?.hasWorkspaceConnection) {
    return {
      label: t("sources.providerConnection"),
      value: t("sources.connectProvider"),
      detail: t("sources.readiness.addSharedOrScopedCredential"),
      tone: "danger",
      icon: IconAlertTriangle,
    };
  }
  return {
    label: t("sources.providerConnection"),
    value: providerHealthLabel(provider, t),
    detail:
      provider.providerHealth?.message ??
      t("sources.readiness.providerUnknown"),
    tone: health === "missing_credentials" ? "danger" : "muted",
    icon:
      health === "missing_credentials" ? IconAlertTriangle : IconCircleDashed,
  };
}

function providerReadinessItems(provider: BrainConnectionProvider, t: BrainT) {
  return [
    sharedConnectionReadiness(provider, t),
    appGrantReadiness(provider, t),
    providerConnectionReadiness(provider, t),
    credentialPathReadiness(provider, t),
  ];
}

function providerReadinessCallout(
  provider: BrainConnectionProvider,
  t: BrainT,
): ProviderReadinessItem & { title: string } {
  const workspace = provider.workspaceConnection;
  if (!provider.sourceProviderSupported) {
    return {
      ...providerConnectionReadiness(provider, t),
      title: t("sources.connectionMetadataOnly"),
    };
  }
  if (workspace?.hasActiveWorkspaceConnection) {
    return {
      label: t("sources.readinessLabel"),
      value: t("sources.readiness.shared"),
      title: t("sources.sharedWorkspaceConnectionReady"),
      detail: t("sources.readiness.reuseProviderConnection"),
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  if (workspace?.grantState === "needs_grant") {
    return {
      label: t("sources.readinessLabel"),
      value: t("sources.providerHealth.grantNeeded"),
      title: t("sources.grantBrainAccess"),
      detail: t("sources.readiness.approveBrainAccess"),
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (scopedCredentialCount(provider)) {
    return {
      label: t("sources.readinessLabel"),
      value: t("sources.readiness.local"),
      title: t("sources.scopedCredentialsReady"),
      detail: t("sources.readiness.localCredentialRefsAvailable"),
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (provider.credentialHealth?.status === "not_required") {
    return {
      label: t("sources.readinessLabel"),
      value: t("sources.providerHealth.ready"),
      title: t("sources.noCredentialRequired"),
      detail: t("sources.readiness.providerNoCredential"),
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  return {
    label: t("sources.readinessLabel"),
    value: t("sources.readiness.connect"),
    title: t("sources.connectTheProvider"),
    detail: t("sources.readiness.addSharedOrScopedCredential"),
    tone: "danger",
    icon: IconAlertTriangle,
  };
}

function ProviderReadinessCell({ item }: { item: ProviderReadinessItem }) {
  const Icon = item.icon;
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-background/60 p-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {item.label}
            </p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {item.detail}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`${readinessToneClass(item.tone)} shrink-0`}
        >
          {item.value}
        </Badge>
      </div>
    </div>
  );
}

function provenanceLabel(
  provenance: NonNullable<
    NonNullable<
      BrainConnectionProvider["credentialHealth"]
    >["details"][number]["provenance"]
  >,
  t: BrainT,
) {
  switch (provenance.source) {
    case "workspace_connection":
      return [
        provenance.connectionLabel ?? t("sources.workspaceConnection"),
        provenance.appAccessMode === "explicit-grant"
          ? t("sources.provenance.explicitBrainGrant")
          : provenance.appAccessMode === "all-apps"
            ? t("sources.appAccess.allApps")
            : provenance.appAccessMode === "allowed-app"
              ? t("sources.appAccess.brainAllowList")
              : null,
      ]
        .filter(Boolean)
        .join(" - ");
    case "brain_local":
      return t("sources.provenance.brainLocalCredential");
    case "registered_secret":
      return t("sources.provenance.credentialVault");
    default:
      return t("sources.provenance.credentialSource");
  }
}

function ProviderCatalog({
  providers: connectionProviders,
  loading,
  workspaceError,
  onAddSource,
}: {
  providers: BrainConnectionProvider[];
  loading: boolean;
  workspaceError?: string | null;
  onAddSource: (provider: Provider) => void;
}) {
  const t = useT();
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(
    null,
  );

  return (
    <section className="grid gap-3 lg:col-span-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <IconDatabaseImport className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">
              {t("sources.connectionProviders")}
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("sources.connectionProvidersDescription")}
          </p>
        </div>
        <Badge variant="outline" className="w-fit max-w-full">
          {loading
            ? t("sources.loading")
            : t("sources.providerCount", {
                count: connectionProviders.length.toLocaleString(),
              })}
        </Badge>
      </div>

      {loading ? (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <IconLoader2 className="size-4 animate-spin" />
            {t("sources.loadingProviderCatalog")}
          </div>
        </div>
      ) : connectionProviders.length ? (
        <div className="brain-provider-catalog-grid grid gap-3">
          {connectionProviders.map((provider) => {
            const workspace = provider.workspaceConnection;
            const grantState = workspace?.grantState ?? "not_connected";
            const GrantIcon = grantStateIcon(grantState);
            const credentialRefs = providerWorkspaceCredentialRefs(provider);
            const missingCredentialMessage =
              provider.credentialHealth?.missingMessages[0] ?? null;
            const credentialBadges = credentialRefs.length
              ? credentialRefs.map((ref, index) => ({
                  key: `${refLabel(ref)}-${index}`,
                  label: refLabel(ref),
                }))
              : provider.credentialKeys.map((credential) => ({
                  key: credential.key,
                  label: credential.key,
                }));
            const sourceProvider = isSourceProvider(provider.id)
              ? provider.id
              : null;
            const Icon = sourceProvider
              ? sourceProviderIcon(sourceProvider)
              : IconDatabaseImport;
            const expanded = expandedProviderId === provider.id;
            const readinessCallout = providerReadinessCallout(provider, t);
            const ReadinessIcon = readinessCallout.icon;
            const readinessItems = providerReadinessItems(provider, t);
            return (
              <div
                key={provider.id}
                className="grid gap-3 rounded-md border border-border bg-card p-4 shadow-none"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                      <Icon className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{provider.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {provider.hasConfiguredSources
                          ? `${provider.configuredSourceCount.toLocaleString()} configured`
                          : t("sources.noBrainSourcesYet")}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`${grantStateClass(grantState)} w-fit max-w-full`}
                  >
                    <GrantIcon className="me-1 size-3" />
                    {grantStateLabel(grantState, t)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`${providerHealthClass(provider)} w-fit max-w-full`}
                  >
                    {providerHealthLabel(provider, t)}
                  </Badge>
                </div>

                <p className="text-xs leading-5 text-muted-foreground">
                  {provider.providerHealth?.message ??
                    grantStateDetail(provider, grantState, t)}
                </p>

                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <ReadinessIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {readinessCallout.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {readinessCallout.detail}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`${readinessToneClass(
                        readinessCallout.tone,
                      )} shrink-0`}
                    >
                      {readinessCallout.value}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {provider.capabilities.map((capability) => (
                    <Badge key={capability} variant="outline">
                      {capability}
                    </Badge>
                  ))}
                </div>

                {expanded ? (
                  <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 text-sm">
                    <p className="leading-6 text-muted-foreground">
                      {provider.description}
                    </p>
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("sources.connectionReadiness")}
                        </p>
                        <span className="truncate text-xs text-muted-foreground">
                          {t("sources.valuesHidden")}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {readinessItems.map((item) => (
                          <ProviderReadinessCell
                            key={`${provider.id}-${item.label}`}
                            item={item}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {credentialRefs.length
                          ? t("sources.credentialRefs")
                          : t("sources.catalogKeys")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {credentialBadges.length ? (
                          credentialBadges.map((credential) => (
                            <Badge key={credential.key} variant="outline">
                              {credential.label}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("sources.noCredentialKeysRequired")}
                          </span>
                        )}
                      </div>
                      {missingCredentialMessage ? (
                        <p className="mt-2 text-xs leading-5 text-destructive">
                          {missingCredentialMessage}
                        </p>
                      ) : null}
                    </div>
                    {provider.id === "slack" ? (
                      <div className="grid gap-2 rounded-md border border-border bg-card p-3">
                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <IconBrandSlack className="size-4" />
                          {t("sources.slackSetupGuide")}
                        </div>
                        <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
                          <p>{t("sources.slackSetupAllowList")}</p>
                          <p>{t("sources.slackSetupScopes")}</p>
                          <p>{t("sources.slackSetupPrivateChannels")}</p>
                        </div>
                      </div>
                    ) : null}
                    {provider.credentialKeys.length ? (
                      <div className="grid gap-2">
                        {provider.credentialKeys.map((credential) => (
                          <div key={credential.key}>
                            <p className="font-medium">
                              {credential.label}
                              {credential.required ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  {t("sources.required")}
                                </span>
                              ) : null}
                            </p>
                            {credential.description ? (
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {credential.description}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {provider.credentialHealth?.details.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("sources.credentialProvenance")}
                        </p>
                        {provider.credentialHealth.details.map((detail) => (
                          <div
                            key={`${provider.id}-${detail.key}`}
                            className="rounded-md border border-border bg-card p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium">{detail.key}</p>
                              <Badge
                                variant="outline"
                                className={
                                  detail.available
                                    ? readinessToneClass("ready")
                                    : readinessToneClass("danger")
                                }
                              >
                                {detail.available
                                  ? t("sources.readiness.available")
                                  : t("sources.readiness.missing")}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {detail.provenance
                                ? provenanceLabel(detail.provenance, t)
                                : detail.missingMessage}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {workspace?.connections.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("sources.workspaceConnections")}
                        </p>
                        {workspace.connections.map((connection) => {
                          const refs = [
                            ...connection.credentialRefs,
                            ...(connection.explicitGrant?.credentialRefs ?? []),
                          ];
                          return (
                            <div
                              key={connection.id}
                              className="grid gap-2 rounded-md border border-border bg-card p-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">
                                    {connection.label}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {connection.accountLabel ??
                                      connection.accountId ??
                                      provider.label}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <Badge
                                    variant="outline"
                                    className={workspaceStatusClass(
                                      connection.status,
                                    )}
                                  >
                                    {workspaceStatusLabel(connection.status, t)}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={appAccessClass(
                                      connection.appAccess,
                                    )}
                                  >
                                    {appAccessLabel(connection.appAccess, t)}
                                  </Badge>
                                </div>
                              </div>
                              {refs.length ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {refs.map((ref, index) => (
                                    <Badge
                                      key={`${connection.id}-${refLabel(ref)}-${index}`}
                                      variant="outline"
                                    >
                                      {refLabel(ref)}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {t("sources.noCredentialRefs")}
                                </p>
                              )}
                              {connection.lastError ? (
                                <p className="text-xs leading-5 text-destructive">
                                  {connection.lastError}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs leading-5 text-muted-foreground">
                        {t("sources.noSharedWorkspaceConnection")}
                      </p>
                    )}
                    {!provider.sourceProviderSupported ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        {t("sources.connectionMetadataOnlyDetail")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedProviderId((current) =>
                        current === provider.id ? null : provider.id,
                      )
                    }
                  >
                    <IconSettings2 className="size-4" />
                    {expanded ? t("sources.hideDetails") : t("sources.details")}
                  </Button>
                  {grantState === "needs_grant" ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={dispatchIntegrationsHref(provider.id)}>
                        <IconExternalLink className="size-4" />
                        {t("sources.grantInDispatch")}
                      </a>
                    </Button>
                  ) : null}
                  {sourceProvider ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAddSource(sourceProvider)}
                    >
                      <IconDatabaseImport className="size-4" />
                      {t("sources.addSource")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("sources.noConnectionProviders")}
        </div>
      )}
      {workspaceError ? (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("sources.workspaceStatusUnavailable", { error: workspaceError })}
        </div>
      ) : null}
    </section>
  );
}

function BrainHealthStrip({
  health,
  loading,
}: {
  health?: BrainHealthResponse;
  loading: boolean;
}) {
  const t = useT();
  const attention =
    (health?.sources.needsSetup ?? 0) +
    (health?.sources.needsSync ?? 0) +
    (health?.sources.stale ?? 0) +
    (health?.sources.error ?? 0);
  const lastEval = health?.retrieval.lastEval;
  const nextStep = health?.setup.nextSteps[0];

  return (
    <section className="grid gap-3 rounded-md border border-border bg-card p-4 shadow-none lg:col-span-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <IconReportAnalytics className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">{t("sources.brainHealth")}</h2>
            {loading ? (
              <Badge variant="outline" className="gap-1.5">
                <IconLoader2 className="size-3 animate-spin" />
                {t("sources.workspaceStatus.checking")}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {nextStep ?? t("sources.healthReady")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-max">
          <Badge variant="outline" className="justify-center gap-1.5">
            <IconCircleCheck className="size-3" />
            {t("sources.healthHealthy", {
              healthy: (health?.sources.healthy ?? 0).toLocaleString(),
              total: (health?.sources.total ?? 0).toLocaleString(),
            })}
          </Badge>
          {attention ? (
            <Badge variant="outline" className="justify-center gap-1.5">
              <IconAlertTriangle className="size-3" />
              {t("sources.healthAttention", {
                count: attention.toLocaleString(),
              })}
            </Badge>
          ) : null}
          <Badge variant="outline" className="justify-center gap-1.5">
            <IconClock className="size-3" />
            {health?.sources.lastSyncedAt
              ? t("sources.lastSyncWithDate", {
                  date: shortDate(health.sources.lastSyncedAt),
                })
              : t("sources.noSyncYet")}
          </Badge>
          {lastEval ? (
            <Badge variant="outline" className="justify-center gap-1.5">
              {t("sources.evalScore", {
                score: Math.round(lastEval.score * 100).toLocaleString(),
              })}
            </Badge>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SourceFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

function SourceListItem({
  source,
  syncPending,
  onReview,
  onSync,
  onTune,
}: {
  source: BrainSource;
  syncPending: boolean;
  onReview: () => void;
  onSync: () => void;
  onTune: () => void;
}) {
  const t = useT();
  const Icon = sourceProviderIcon(source.provider);
  const retry = sourceRetryAfter(source);
  const hasSyncNotice = Boolean(
    source.lastError || retry || source.latestRun?.status === "error",
  );
  const nextSync = source.nextSyncAt
    ? (shortDate(source.nextSyncAt) ?? source.nextSyncAt)
    : null;
  const coverage =
    typeof source.coverage === "number" ? formatPercent(source.coverage) : null;

  return (
    <Card className="overflow-hidden shadow-none">
      <CardContent className="p-4">
        <div className="brain-source-card-grid grid gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35">
              <Icon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-medium text-foreground">
                  {sourceName(source)}
                </h2>
                <StatusBadge status={sourceHealth(source)} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="max-w-full capitalize">
                  {sourceType(source)}
                </Badge>
                {nextSync ? (
                  <span className="text-xs text-muted-foreground">
                    {t("sources.nextSync", { date: nextSync })}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {sourceDescription(source)}
              </p>
            </div>
          </div>

          <div
            className={
              coverage
                ? "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:min-w-80"
                : "grid grid-cols-2 gap-4 xl:min-w-64"
            }
          >
            <SourceFact
              label={t("sources.captures")}
              value={(source.recordCount ?? 0).toLocaleString()}
            />
            <SourceFact
              label={t("sources.lastSync")}
              value={shortDate(sourceLastSync(source)) ?? t("sources.never")}
            />
            {coverage ? (
              <SourceFact label={t("sources.coverage")} value={coverage} />
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onReview}>
              <IconFileSearch className="size-4" />
              {t("sources.captures")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  aria-label={t("sources.moreActionsFor", {
                    source: sourceName(source),
                  })}
                >
                  <IconDotsVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem disabled={syncPending} onSelect={onSync}>
                  <IconRefresh className="size-4" />
                  {t("sources.syncNow")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onTune}>
                  <IconSettings2 className="size-4" />
                  {t("sources.tuneSource")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {coverage ? (
          <Progress
            value={(source.coverage ?? 0) * 100}
            className="mt-4 h-1.5 bg-muted"
          />
        ) : null}

        {hasSyncNotice ? (
          <div className="mt-3 flex gap-2 rounded-md border border-border bg-muted/25 px-3 py-2 text-sm">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="min-w-0 truncate text-muted-foreground">
              {syncDetail(source, t)}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function SourcesRoute() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "all";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<BrainSource | null>(null);
  const [reviewSource, setReviewSource] = useState<BrainSource | null>(null);
  const [captureStatus, setCaptureStatus] =
    useState<CaptureStatusFilter>("queued");
  const [showCapturePreview, setShowCapturePreview] = useState(false);
  const [selectedCaptureIds, setSelectedCaptureIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkResult, setBulkResult] =
    useState<EnqueueCapturesDistillationResponse | null>(null);
  const [form, setForm] = useState<SourceFormState>(() =>
    defaultForm("slack", t),
  );

  const sourcesQuery = useActionQuery<SourcesResponse>(
    "list-sources" as any,
    {
      provider: type === "all" ? undefined : type,
      includeArchived: false,
    } as any,
  );
  const connectionProvidersQuery = useActionQuery<ConnectionProvidersResponse>(
    "list-connection-providers" as any,
    {} as any,
  );
  const healthQuery = useActionQuery<BrainHealthResponse>(
    "get-brain-health" as any,
    {} as any,
  );
  const updateSource = useActionMutation<
    unknown,
    {
      id: string;
      title?: string;
      status?: "active" | "paused";
      config?: Record<string, unknown>;
    }
  >("update-source" as any);
  const createSource = useActionMutation<
    unknown,
    {
      title: string;
      provider: Provider;
      visibility: "org";
      config: Record<string, unknown>;
      sourceKey?: string;
    }
  >("create-source" as any);
  const syncSource = useActionMutation<unknown, { sourceId: string }>(
    "sync-source" as any,
  );
  const syncDueSources = useActionMutation<unknown, { limit: number }>(
    "sync-due-sources" as any,
  );
  const capturesQuery = useActionQuery<CapturesResponse>(
    "list-captures" as any,
    {
      sourceId: reviewSource?.id,
      status: captureStatus === "all" ? undefined : captureStatus,
      includePreview: showCapturePreview,
      limit: 25,
    } as any,
    { enabled: Boolean(reviewSource?.id), retry: false },
  );
  const enqueueDistillation = useActionMutation<
    unknown,
    { captureId: string; priority?: number }
  >("enqueue-distillation" as any);
  const enqueueCapturesDistillation = useActionMutation<
    EnqueueCapturesDistillationResponse,
    { captureIds: string[]; priority?: number }
  >("enqueue-captures-distillation" as any);
  const markCaptureDistilled = useActionMutation<
    unknown,
    { captureId: string; status: "ignored" }
  >("mark-capture-distilled" as any);

  const sources = sourcesQuery.data?.sources ?? [];
  const connectionProviders = connectionProvidersQuery.data?.providers ?? [];
  const formProviderMetadata = providerMetadataForSource(
    connectionProviders,
    form.provider,
  );
  const formWorkspaceConnections = [
    ...new Map(
      [
        ...grantedWorkspaceConnections(formProviderMetadata),
        ...(
          formProviderMetadata?.workspaceConnection?.connections ?? []
        ).filter((connection) => connection.id === form.workspaceConnectionId),
      ].map((connection) => [connection.id, connection]),
    ).values(),
  ];
  const selectedWorkspaceConnection = formWorkspaceConnections.find(
    (connection) => connection.id === form.workspaceConnectionId,
  );
  const captures = capturesQuery.data?.captures ?? [];
  const queueableCaptures = captures.filter(captureCanQueue);
  const queueableCaptureIds = new Set(
    queueableCaptures.map((capture) => capture.id),
  );
  const selectedQueueableIds = Array.from(selectedCaptureIds).filter((id) =>
    queueableCaptureIds.has(id),
  );
  const allQueueableSelected =
    queueableCaptures.length > 0 &&
    queueableCaptures.every((capture) => selectedCaptureIds.has(capture.id));
  const selectedSourceId = params.get("sourceId");
  const sourceTypes = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set([
          ...providers.map((provider) => provider.value),
          ...sources.map((source) => sourceType(source)),
        ]),
      ),
    ],
    [sources],
  );
  const visibleSources = sources.filter((source) =>
    type === "all" ? true : sourceType(source) === type,
  );

  useEffect(() => {
    if (!selectedSourceId) {
      setReviewSource(null);
      return;
    }
    const selected = sources.find((source) => source.id === selectedSourceId);
    if (selected) setReviewSource(selected);
  }, [selectedSourceId, sources]);

  function updateType(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("type");
    else next.set("type", value);
    setParams(next, { replace: true });
  }

  function openCreate(provider?: Provider) {
    const selected =
      provider ??
      (type === "slack" ||
      type === "granola" ||
      type === "github" ||
      type === "clips" ||
      type === "manual" ||
      type === "generic"
        ? (type as Provider)
        : "slack");
    setEditingSource(null);
    setForm(defaultForm(selected, t));
    setSetupOpen(true);
  }

  function openEdit(source: BrainSource) {
    setEditingSource(source);
    setForm(formFromSource(source));
    setSetupOpen(true);
  }

  function openCaptureReview(source: BrainSource) {
    setCaptureStatus("queued");
    setShowCapturePreview(false);
    setSelectedCaptureIds(new Set());
    setBulkResult(null);
    const next = new URLSearchParams(params);
    next.set("sourceId", source.id);
    setParams(next, { replace: true });
  }

  function closeCaptureReview() {
    const next = new URLSearchParams(params);
    next.delete("sourceId");
    setParams(next, { replace: true });
    setReviewSource(null);
    setSelectedCaptureIds(new Set());
    setBulkResult(null);
  }

  function updateForm(patch: Partial<SourceFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function submitSource() {
    const config = buildConfig(form);
    if (editingSource) {
      updateSource.mutate({
        id: editingSource.id,
        title: form.title.trim() || defaultTitle(form.provider, t),
        status:
          form.autoSync || sourceEnabled(editingSource) ? "active" : "paused",
        config,
      });
    } else {
      createSource.mutate({
        title: form.title.trim() || defaultTitle(form.provider, t),
        provider: form.provider,
        visibility: "org",
        config,
        sourceKey: form.sourceKey.trim() || undefined,
      });
    }
    setSetupOpen(false);
  }

  function toggleCaptureSelection(captureId: string, checked: boolean) {
    setSelectedCaptureIds((current) => {
      const next = new Set(current);
      if (checked) next.add(captureId);
      else next.delete(captureId);
      return next;
    });
  }

  function toggleAllQueueableCaptures() {
    setSelectedCaptureIds((current) => {
      const next = new Set(current);
      if (allQueueableSelected) {
        queueableCaptures.forEach((capture) => next.delete(capture.id));
      } else {
        queueableCaptures.forEach((capture) => next.add(capture.id));
      }
      return next;
    });
  }

  async function queueSelectedCaptures() {
    if (!selectedQueueableIds.length) return;
    const result = await enqueueCapturesDistillation.mutateAsync({
      captureIds: selectedQueueableIds,
      priority: 60,
    });
    setBulkResult(result);
    setSelectedCaptureIds(new Set());
  }

  return (
    <div className="min-h-full bg-muted/20">
      <PageHeader
        eyebrow={t("sources.eyebrow")}
        title={t("sources.title")}
        description={t("sources.description")}
        actions={
          <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col sm:auto-cols-max sm:justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAdvancedOpen(true)}
            >
              <IconSettings2 className="size-4" />
              {t("sources.advanced")}
            </Button>
            <Button
              size="sm"
              disabled={createSource.isPending}
              onClick={() => openCreate()}
            >
              <IconDatabaseImport className="size-4" />
              {t("sources.addSource")}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 p-4 sm:p-5 lg:p-7">
        {sourcesQuery.isLoading ? (
          <div>
            <LoadingRows rows={3} />
          </div>
        ) : visibleSources.length ? (
          visibleSources.map((source) => (
            <SourceListItem
              key={source.id}
              source={source}
              syncPending={syncSource.isPending}
              onReview={() => openCaptureReview(source)}
              onSync={() => syncSource.mutate({ sourceId: source.id })}
              onTune={() => openEdit(source)}
            />
          ))
        ) : (
          <div>
            <EmptyActionState
              title={t("sources.emptyTitle")}
              detail={t("sources.emptyDetail")}
            />
          </div>
        )}

        {sourcesQuery.isError ||
        connectionProvidersQuery.isError ||
        updateSource.isError ||
        createSource.isError ||
        syncSource.isError ||
        syncDueSources.isError ||
        enqueueCapturesDistillation.isError ? (
          <div>
            <EmptyActionState
              title={t("sources.actionFailedTitle")}
              detail={t("sources.actionFailedDetail")}
            />
          </div>
        ) : null}
      </div>

      <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{t("sources.advancedTitle")}</SheetTitle>
            <SheetDescription>
              {t("sources.advancedDescription")}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-5">
            <section className="grid gap-3 rounded-md border border-border bg-card p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="grid gap-2">
                  <Label htmlFor="source-type-filter">
                    {t("sources.sourceType")}
                  </Label>
                  <Select value={type} onValueChange={updateType}>
                    <SelectTrigger id="source-type-filter">
                      <SelectValue placeholder={t("sources.sourceType")} />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceTypes.map((sourceType) => (
                        <SelectItem key={sourceType} value={sourceType}>
                          {sourceType === "all"
                            ? t("sources.allSources")
                            : sourceType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={syncDueSources.isPending}
                  onClick={() => syncDueSources.mutate({ limit: 5 })}
                >
                  <IconPlayerPlay className="size-4" />
                  {t("sources.runDueSyncs")}
                </Button>
              </div>
            </section>

            <BrainHealthStrip
              health={healthQuery.data}
              loading={healthQuery.isLoading}
            />

            <ProviderCatalog
              providers={connectionProviders}
              loading={connectionProvidersQuery.isLoading}
              workspaceError={
                connectionProvidersQuery.data?.workspaceConnections?.error ??
                null
              }
              onAddSource={(provider) => {
                setAdvancedOpen(false);
                openCreate(provider);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(reviewSource)}
        onOpenChange={(open) => {
          if (!open) closeCaptureReview();
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("sources.reviewRawCaptures")}</SheetTitle>
            <SheetDescription>
              {reviewSource
                ? t("sources.captureInventoryDescription", {
                    source: sourceName(reviewSource),
                  })
                : t("sources.reviewRawCapturesDescription")}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-4">
            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="grid gap-2 sm:max-w-56">
                <Label htmlFor="capture-status-filter">
                  {t("sources.status")}
                </Label>
                <Select
                  value={captureStatus}
                  onValueChange={(value) => {
                    setCaptureStatus(value as CaptureStatusFilter);
                    setSelectedCaptureIds(new Set());
                    setBulkResult(null);
                  }}
                >
                  <SelectTrigger id="capture-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {captureStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {captureStatusLabel(status, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {t("sources.previews")}
                  <span className="block text-xs text-muted-foreground">
                    {t("sources.previewsDescription")}
                  </span>
                </span>
                <Switch
                  checked={showCapturePreview}
                  onCheckedChange={setShowCapturePreview}
                />
              </label>
            </div>

            {(captures.length || bulkResult) && (
              <div className="grid gap-3 rounded-md border border-border bg-card p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {t("sources.batchDistillation")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t("sources.batchDistillationDescription")}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!queueableCaptures.length}
                      onClick={toggleAllQueueableCaptures}
                    >
                      <IconChecks className="size-4" />
                      {allQueueableSelected
                        ? t("sources.unselectAll")
                        : t("sources.selectAll")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !selectedQueueableIds.length ||
                        enqueueCapturesDistillation.isPending
                      }
                      onClick={() => void queueSelectedCaptures()}
                    >
                      {enqueueCapturesDistillation.isPending ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        <IconSend className="size-4 rtl:-scale-x-100" />
                      )}
                      {t("sources.queueSelected")}
                    </Button>
                    {selectedCaptureIds.size ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedCaptureIds(new Set())}
                      >
                        {t("sources.clear")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {t("sources.selectedCount", {
                      count: selectedQueueableIds.length.toLocaleString(),
                    })}
                  </Badge>
                  <Badge variant="outline">
                    {t("sources.queueableCount", {
                      count: queueableCaptures.length.toLocaleString(),
                    })}
                  </Badge>
                  {bulkResult ? (
                    <Badge
                      variant={bulkResult.errors ? "destructive" : "secondary"}
                    >
                      {t("sources.bulkResult", {
                        queued: bulkResult.queued.toLocaleString(),
                        existing: bulkResult.existing.toLocaleString(),
                        errors: bulkResult.errors.toLocaleString(),
                      })}
                    </Badge>
                  ) : null}
                </div>
              </div>
            )}

            {capturesQuery.isLoading ? (
              <LoadingRows rows={3} />
            ) : capturesQuery.isError ? (
              <EmptyActionState
                title={t("sources.captureInventoryFailedTitle")}
                detail={t("sources.captureInventoryFailedDetail")}
              />
            ) : (capturesQuery.data?.captures ?? []).length ? (
              <div className="grid gap-3">
                {captures.map((capture) => {
                  const queue = capture.distillationQueue;
                  const queueIsActive =
                    queue?.status === "queued" ||
                    queue?.status === "processing";
                  const canQueue = captureCanQueue(capture);
                  const isMutating =
                    enqueueDistillation.isPending ||
                    enqueueCapturesDistillation.isPending ||
                    markCaptureDistilled.isPending;
                  const selected = selectedCaptureIds.has(capture.id);
                  return (
                    <div
                      key={capture.id}
                      className="grid gap-3 rounded-md border border-border bg-card p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0 rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                            checked={selected}
                            disabled={!canQueue || isMutating}
                            aria-label={t("sources.selectCapture", {
                              title: capture.title,
                            })}
                            onChange={(event) =>
                              toggleCaptureSelection(
                                capture.id,
                                event.target.checked,
                              )
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">{capture.kind}</Badge>
                              <StatusBadge status={capture.status} />
                              <span className="text-xs text-muted-foreground">
                                {shortDate(capture.capturedAt) ??
                                  capture.capturedAt}
                              </span>
                            </div>
                            <p className="mt-2 truncate text-sm font-medium">
                              {capture.title}
                            </p>
                            {capture.preview ? (
                              <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                                {capture.preview}
                              </p>
                            ) : (
                              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                {t("sources.rawContentHidden")}
                              </p>
                            )}
                            {queue ? (
                              <div className="mt-3 rounded-md border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant={
                                      queue.status === "failed"
                                        ? "destructive"
                                        : "outline"
                                    }
                                  >
                                    {t("sources.distillation")}{" "}
                                    {queueStatusLabel(queue.status, t)}
                                  </Badge>
                                  {queue.attempts ? (
                                    <span>
                                      {queue.attempts}{" "}
                                      {queue.attempts === 1
                                        ? t("sources.attempt")
                                        : t("sources.attempts")}
                                    </span>
                                  ) : null}
                                  {queue.runAfter ? (
                                    <span>
                                      {t("sources.nextCheck")}{" "}
                                      {shortDate(queue.runAfter) ??
                                        queue.runAfter}
                                    </span>
                                  ) : null}
                                </div>
                                {queue.error ? (
                                  <p className="mt-2">{queue.error}</p>
                                ) : queueIsActive ? (
                                  <p className="mt-2">
                                    {t("sources.waitingForWorker")}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap justify-end gap-2">
                        {capture.sourceUrl ? (
                          <Button asChild size="sm" variant="outline">
                            <a
                              href={capture.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <IconExternalLink className="size-4" />
                              {t("sources.source")}
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canQueue || isMutating}
                          onClick={() =>
                            enqueueDistillation.mutate({
                              captureId: capture.id,
                              priority: 60,
                            })
                          }
                        >
                          {enqueueDistillation.isPending ? (
                            <IconLoader2 className="size-4 animate-spin" />
                          ) : (
                            <IconSend className="size-4 rtl:-scale-x-100" />
                          )}
                          {queueActionLabel(queue, t)}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canQueue || isMutating}
                          onClick={() =>
                            markCaptureDistilled.mutate({
                              captureId: capture.id,
                              status: "ignored",
                            })
                          }
                        >
                          <IconArchive className="size-4" />
                          {t("sources.ignore")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyActionState
                title={t("sources.noCapturesTitle")}
                detail={t("sources.noCapturesDetail")}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={setupOpen} onOpenChange={setSetupOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingSource ? t("sources.tuneSource") : t("sources.addSource")}
            </SheetTitle>
            <SheetDescription>{t("sources.setupDescription")}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="source-title">{t("sources.name")}</Label>
              <Input
                id="source-title"
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("sources.provider")}</Label>
              <Select
                value={form.provider}
                disabled={!!editingSource}
                onValueChange={(provider) =>
                  setForm((current) => ({
                    ...defaultForm(provider as Provider),
                    title:
                      current.title === defaultTitle(current.provider, t)
                        ? defaultTitle(provider as Provider, t)
                        : current.title,
                    workspaceConnectionId: "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {supportsWorkspaceConnectionBinding(form.provider) && (
              <div className="grid gap-2">
                <Label htmlFor="workspace-connection">
                  {t("sources.workspaceConnection")}
                </Label>
                <Select
                  value={form.workspaceConnectionId || "__automatic__"}
                  onValueChange={(workspaceConnectionId) =>
                    updateForm({
                      workspaceConnectionId:
                        workspaceConnectionId === "__automatic__"
                          ? ""
                          : workspaceConnectionId,
                    })
                  }
                >
                  <SelectTrigger id="workspace-connection">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__automatic__">
                      {t("sources.automaticCredentialSelection")}
                    </SelectItem>
                    {formWorkspaceConnections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                        {connection.accountLabel
                          ? ` - ${connection.accountLabel}`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {selectedWorkspaceConnection
                    ? t("sources.boundConnectionDescription", {
                        connection: selectedWorkspaceConnection.label,
                      })
                    : formWorkspaceConnections.length
                      ? t("sources.pickGrantedConnection")
                      : t("sources.grantConnectionBeforePinning")}
                </p>
              </div>
            )}

            {form.provider === "slack" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconShieldCheck className="size-4 text-muted-foreground" />
                    {t("sources.slackAccessRules")}
                  </div>
                  <div className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                    <p>{t("sources.slackAccessRuleIds")}</p>
                    <p>{t("sources.slackAccessRuleScopes")}</p>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="slack-channels">
                    {t("sources.allowedChannels")}
                  </Label>
                  <Textarea
                    id="slack-channels"
                    value={form.channelRefs}
                    onChange={(event) =>
                      updateForm({ channelRefs: event.target.value })
                    }
                    placeholder={"C0123456789\n#product\n#launches"}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("sources.allowedChannelsDescription")}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="history-limit">
                      {t("sources.messagesPerPage")}
                    </Label>
                    <Input
                      id="history-limit"
                      type="number"
                      min={1}
                      max={15}
                      value={form.historyLimit}
                      onChange={(event) =>
                        updateForm({ historyLimit: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="poll-minutes">
                      {t("sources.pollMinutes")}
                    </Label>
                    <Input
                      id="poll-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={form.pollMinutes}
                      onChange={(event) =>
                        updateForm({ pollMinutes: event.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {form.provider === "granola" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="granola-page-size">
                      {t("sources.pageSize")}
                    </Label>
                    <Input
                      id="granola-page-size"
                      type="number"
                      min={1}
                      max={30}
                      value={form.granolaPageSize}
                      onChange={(event) =>
                        updateForm({ granolaPageSize: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="granola-poll-minutes">
                      {t("sources.pollMinutes")}
                    </Label>
                    <Input
                      id="granola-poll-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={form.pollMinutes}
                      onChange={(event) =>
                        updateForm({ pollMinutes: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="granola-updated-after">
                    {t("sources.initialUpdatedAfter")}
                  </Label>
                  <Input
                    id="granola-updated-after"
                    value={form.granolaUpdatedAfter}
                    onChange={(event) =>
                      updateForm({ granolaUpdatedAfter: event.target.value })
                    }
                    placeholder="2026-05-01T00:00:00.000Z"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("sources.granolaDescription")}
                  </p>
                </div>
              </div>
            )}

            {form.provider === "github" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2">
                  <Label htmlFor="github-repos">
                    {t("sources.approvedRepositories")}
                  </Label>
                  <Textarea
                    id="github-repos"
                    value={form.githubRepos}
                    onChange={(event) =>
                      updateForm({ githubRepos: event.target.value })
                    }
                    placeholder={"owner/repo\nhttps://github.com/owner/repo"}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("sources.githubRepositoriesDescription")}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="github-state">{t("sources.state")}</Label>
                    <Select
                      value={form.githubState}
                      onValueChange={(githubState) =>
                        updateForm({
                          githubState:
                            githubState as SourceFormState["githubState"],
                        })
                      }
                    >
                      <SelectTrigger id="github-state">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("sources.all")}</SelectItem>
                        <SelectItem value="open">
                          {t("sources.open")}
                        </SelectItem>
                        <SelectItem value="closed">
                          {t("sources.closed")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="github-limit">
                      {t("sources.itemsPerRepo")}
                    </Label>
                    <Input
                      id="github-limit"
                      type="number"
                      min={1}
                      max={100}
                      value={form.githubLimit}
                      onChange={(event) =>
                        updateForm({ githubLimit: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="github-poll-minutes">
                      {t("sources.pollMinutes")}
                    </Label>
                    <Input
                      id="github-poll-minutes"
                      type="number"
                      min={5}
                      max={1440}
                      value={form.pollMinutes}
                      onChange={(event) =>
                        updateForm({ pollMinutes: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-3 rounded-md bg-muted/25 p-3">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>{t("sources.includeIssues")}</span>
                    <Switch
                      checked={form.githubIncludeIssues}
                      onCheckedChange={(githubIncludeIssues) =>
                        updateForm({ githubIncludeIssues })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>{t("sources.includePullRequests")}</span>
                    <Switch
                      checked={form.githubIncludePullRequests}
                      onCheckedChange={(githubIncludePullRequests) =>
                        updateForm({ githubIncludePullRequests })
                      }
                    />
                  </label>
                </div>
              </div>
            )}

            {(form.provider === "generic" || form.provider === "clips") && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2">
                  <Label htmlFor="source-key">
                    {t("sources.webhookSourceKey")}
                  </Label>
                  <Input
                    id="source-key"
                    value={form.sourceKey}
                    onChange={(event) =>
                      updateForm({ sourceKey: event.target.value })
                    }
                    placeholder={form.provider}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("sources.webhookSourceKeyDescription")}
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {t("sources.autoSync")}
                  <span className="block text-xs text-muted-foreground">
                    {t("sources.autoSyncDescription")}
                  </span>
                </span>
                <Switch
                  checked={form.autoSync}
                  onCheckedChange={(autoSync) => updateForm({ autoSync })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {t("sources.reviewRequired")}
                  <span className="block text-xs text-muted-foreground">
                    {t("sources.reviewRequiredDescription")}
                  </span>
                </span>
                <Switch
                  checked={form.reviewRequired}
                  onCheckedChange={(reviewRequired) =>
                    updateForm({ reviewRequired })
                  }
                />
              </label>
            </div>
          </div>

          <SheetFooter className="mt-6 gap-2 sm:justify-end">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setSetupOpen(false)}
            >
              {t("sources.cancel")}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={submitSource}
              disabled={
                createSource.isPending ||
                updateSource.isPending ||
                !form.title.trim()
              }
            >
              {editingSource
                ? t("sources.saveSource")
                : t("sources.createSource")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
