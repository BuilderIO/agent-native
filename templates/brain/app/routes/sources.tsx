import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
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
  EmptyActionState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from "@/components/brain/Surface";

type Provider = "manual" | "generic" | "clips" | "slack" | "granola" | "github";
type CaptureStatusFilter = BrainCaptureReviewStatus | "all";

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

function defaultTitle(provider: Provider) {
  switch (provider) {
    case "slack":
      return "Slack knowledge channels";
    case "granola":
      return "Granola team notes";
    case "github":
      return "GitHub product repos";
    case "clips":
      return "Clips exports";
    case "generic":
      return "Generic transcript webhook";
    case "manual":
    default:
      return "Manual imports";
  }
}

function defaultForm(provider: Provider): SourceFormState {
  return {
    title: defaultTitle(provider),
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

function syncDetail(source: BrainSource) {
  const retry = sourceRetryAfter(source);
  if (retry) return `Retry after ${shortDate(retry) ?? retry}`;
  if (source.lastError) return source.lastError;
  if (source.latestRun?.status === "error") {
    return source.latestRun.error ?? "Last sync failed";
  }
  if (source.nextSyncAt) return `Next ${shortDate(source.nextSyncAt)}`;
  return sourceAutoSync(source) ? "Waiting for first sync" : "Manual sync";
}

const captureStatusOptions: CaptureStatusFilter[] = [
  "queued",
  "distilling",
  "distilled",
  "ignored",
  "all",
];

function captureStatusLabel(status: CaptureStatusFilter) {
  switch (status) {
    case "queued":
      return "Queued";
    case "distilling":
      return "Distilling";
    case "distilled":
      return "Distilled";
    case "ignored":
      return "Ignored";
    case "all":
    default:
      return "All captures";
  }
}

function queueStatusLabel(status: string) {
  switch (status) {
    case "processing":
      return "Processing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "queued":
    default:
      return "Queued";
  }
}

function queueActionLabel(
  queue: NonNullable<CapturesResponse["captures"]>[number]["distillationQueue"],
) {
  if (!queue) return "Queue distill";
  if (queue.status === "failed") return "Retry distill";
  if (queue.status === "done") return "Distilled";
  return "Queued";
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

function grantStateLabel(state: BrainWorkspaceConnectionGrantState) {
  switch (state) {
    case "connected":
      return "Connected";
    case "granted":
      return "Granted";
    case "needs_grant":
      return "Needs grant";
    case "not_connected":
    default:
      return "Not connected";
  }
}

function grantStateDetail(
  provider: BrainConnectionProvider,
  state: BrainWorkspaceConnectionGrantState,
) {
  const workspace = provider.workspaceConnection;
  if (workspace?.grantAvailabilityMessage) {
    return workspace.grantAvailabilityMessage;
  }
  const sourceCount = provider.configuredSourceCount.toLocaleString();
  switch (state) {
    case "connected":
      return `${workspace?.activeConnectionCount ?? 0} active connection${
        workspace?.activeConnectionCount === 1 ? "" : "s"
      } granted to Brain`;
    case "granted":
      return `Brain can access ${
        workspace?.grantedConnectionCount ?? 0
      } connection${workspace?.grantedConnectionCount === 1 ? "" : "s"}`;
    case "needs_grant":
      return "Connection exists in Dispatch; grant Brain access to reuse it";
    case "not_connected":
    default:
      return provider.hasConfiguredSources
        ? `${sourceCount} source${sourceCount === "1" ? "" : "s"} configured with scoped credentials`
        : "No shared workspace connection yet";
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

function providerHealthLabel(provider: BrainConnectionProvider) {
  switch (provider.providerHealth?.status) {
    case "ready":
      return "Ready";
    case "needs_grant":
      return "Grant needed";
    case "unhealthy":
      return "Needs repair";
    case "missing_credentials":
      return "Missing keys";
    case "unsupported":
      return "Metadata only";
    default:
      return "Unknown";
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

function appAccessLabel(access: BrainWorkspaceSummaryConnection["appAccess"]) {
  switch (access?.mode) {
    case "all-apps":
      return "All apps";
    case "allowed-app":
      return "Brain allow-list";
    case "explicit-grant":
      return "Brain grant";
    case "unavailable":
    default:
      return "Needs Brain grant";
  }
}

function appAccessClass(access: BrainWorkspaceSummaryConnection["appAccess"]) {
  return access?.available
    ? readinessToneClass("muted")
    : grantStateClass("needs_grant");
}

function workspaceStatusLabel(status: BrainWorkspaceConnectionStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "checking":
      return "Checking";
    case "needs_reauth":
      return "Needs reauth";
    case "error":
      return "Error";
    case "disabled":
    default:
      return "Disabled";
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
): ProviderReadinessItem {
  const workspace = provider.workspaceConnection;
  if (!workspace) {
    return {
      label: "Shared connection",
      value: "Checking",
      detail: "Workspace connection status has not loaded yet.",
      tone: "muted",
      icon: IconCircleDashed,
    };
  }
  if (workspace.hasActiveWorkspaceConnection) {
    return {
      label: "Shared connection",
      value: "Connected",
      detail: `${countLabel(
        workspace.activeConnectionCount,
        "active connection",
      )} can provide credential refs.`,
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  if (workspace.hasGrantedWorkspaceConnection) {
    return {
      label: "Shared connection",
      value: "Repair",
      detail: "Brain has a grant, but the provider connection needs attention.",
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (workspace.hasWorkspaceConnection) {
    return {
      label: "Shared connection",
      value: "Grantable",
      detail: "A workspace connection exists and can be granted to Brain.",
      tone: "attention",
      icon: IconShieldCheck,
    };
  }
  return {
    label: "Shared connection",
    value: "Not connected",
    detail: scopedCredentialCount(provider)
      ? "Brain can still use scoped local credential refs."
      : "Add a reusable provider connection in Dispatch.",
    tone: "muted",
    icon: IconCircleDashed,
  };
}

function appGrantReadiness(
  provider: BrainConnectionProvider,
): ProviderReadinessItem {
  const workspace = provider.workspaceConnection;
  const grantState = workspace?.grantState ?? "not_connected";
  if (grantState === "connected" || grantState === "granted") {
    return {
      label: "Brain app grant",
      value: grantState === "connected" ? "Granted" : "Granted, repair",
      detail:
        grantState === "connected"
          ? "Brain can use the shared workspace connection."
          : "Access is granted, but the connection is not active yet.",
      tone: grantState === "connected" ? "ready" : "attention",
      icon: grantStateIcon(grantState),
    };
  }
  if (grantState === "needs_grant") {
    return {
      label: "Brain app grant",
      value: "Needed",
      detail: "Grant the existing provider connection to the Brain app.",
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  return {
    label: "Brain app grant",
    value: scopedCredentialCount(provider) ? "Not needed" : "No grant",
    detail: scopedCredentialCount(provider)
      ? "Scoped Brain credentials are already available."
      : "A grant appears after a workspace provider connection exists.",
    tone: "muted",
    icon: IconCircleDashed,
  };
}

function credentialPathReadiness(
  provider: BrainConnectionProvider,
): ProviderReadinessItem {
  const health = provider.credentialHealth;
  if (!health) {
    return {
      label: "Credential path",
      value: "Checking",
      detail: "Credential availability has not loaded yet.",
      tone: "muted",
      icon: IconCircleDashed,
    };
  }
  if (health.status === "not_required") {
    return {
      label: "Credential path",
      value: "Not required",
      detail: "This provider does not require a credential key.",
      tone: "ready",
      icon: IconCircleCheck,
    };
  }

  const available = availableCredentialDetails(provider)[0];
  if (available?.provenance?.source === "workspace_connection") {
    return {
      label: "Credential path",
      value: "Shared",
      detail: "Using workspace credential refs; values stay hidden.",
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (available?.provenance?.source === "brain_local") {
    return {
      label: "Credential path",
      value: "Brain-local",
      detail: "Scoped Brain credential refs are configured.",
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (available?.provenance?.source === "registered_secret") {
    return {
      label: "Credential path",
      value: "Vault",
      detail: "A registered credential ref is available in the vault.",
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (health.available) {
    return {
      label: "Credential path",
      value: "Available",
      detail: "Required credential refs are available without exposing values.",
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  return {
    label: "Credential path",
    value: "Missing",
    detail:
      health.missingMessages[0] ??
      "Add a shared provider connection or scoped Brain credential.",
    tone: "danger",
    icon: IconAlertTriangle,
  };
}

function providerConnectionReadiness(
  provider: BrainConnectionProvider,
): ProviderReadinessItem {
  const workspace = provider.workspaceConnection;
  const health = provider.providerHealth?.status;
  if (!provider.sourceProviderSupported) {
    return {
      label: "Provider connection",
      value: "Metadata only",
      detail: "Brain source setup is not implemented for this provider.",
      tone: "muted",
      icon: IconCircleDashed,
    };
  }
  if (health === "ready") {
    return {
      label: "Provider connection",
      value: "Ready",
      detail: workspace?.hasActiveWorkspaceConnection
        ? "Ready through a shared workspace connection."
        : scopedCredentialCount(provider)
          ? "Ready through scoped Brain credential refs."
          : "Ready for source setup.",
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  if (health === "needs_grant") {
    return {
      label: "Provider connection",
      value: "Needs grant",
      detail: "The provider is connected, but Brain needs app access.",
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (health === "unhealthy") {
    return {
      label: "Provider connection",
      value: "Repair",
      detail: "Reauthorize or repair the shared provider connection.",
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (health === "missing_credentials" && !workspace?.hasWorkspaceConnection) {
    return {
      label: "Provider connection",
      value: "Connect provider",
      detail: "Add a shared connection or configure scoped Brain credentials.",
      tone: "danger",
      icon: IconAlertTriangle,
    };
  }
  return {
    label: "Provider connection",
    value: providerHealthLabel(provider),
    detail:
      provider.providerHealth?.message ??
      "Provider readiness could not be determined.",
    tone: health === "missing_credentials" ? "danger" : "muted",
    icon:
      health === "missing_credentials" ? IconAlertTriangle : IconCircleDashed,
  };
}

function providerReadinessItems(provider: BrainConnectionProvider) {
  return [
    sharedConnectionReadiness(provider),
    appGrantReadiness(provider),
    providerConnectionReadiness(provider),
    credentialPathReadiness(provider),
  ];
}

function providerReadinessCallout(
  provider: BrainConnectionProvider,
): ProviderReadinessItem & { title: string } {
  const workspace = provider.workspaceConnection;
  if (!provider.sourceProviderSupported) {
    return {
      ...providerConnectionReadiness(provider),
      title: "Connection metadata only",
    };
  }
  if (workspace?.hasActiveWorkspaceConnection) {
    return {
      label: "Readiness",
      value: "Shared",
      title: "Shared workspace connection ready",
      detail: "Brain can reuse the provider connection without showing values.",
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  if (workspace?.grantState === "needs_grant") {
    return {
      label: "Readiness",
      value: "Grant needed",
      title: "Grant Brain access",
      detail:
        "A workspace provider connection exists; approve Brain to use it.",
      tone: "attention",
      icon: IconAlertTriangle,
    };
  }
  if (scopedCredentialCount(provider)) {
    return {
      label: "Readiness",
      value: "Local",
      title: "Scoped credentials ready",
      detail: "Brain has local credential refs available; values stay hidden.",
      tone: "ready",
      icon: IconShieldCheck,
    };
  }
  if (provider.credentialHealth?.status === "not_required") {
    return {
      label: "Readiness",
      value: "Ready",
      title: "No credential required",
      detail: "This provider can be configured without a credential key.",
      tone: "ready",
      icon: IconCircleCheck,
    };
  }
  return {
    label: "Readiness",
    value: "Connect",
    title: "Connect the provider",
    detail: "Add a shared provider connection or scoped Brain credential.",
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
) {
  switch (provenance.source) {
    case "workspace_connection":
      return [
        provenance.connectionLabel ?? "Workspace connection",
        provenance.appAccessMode === "explicit-grant"
          ? "explicit Brain grant"
          : provenance.appAccessMode === "all-apps"
            ? "all apps"
            : provenance.appAccessMode === "allowed-app"
              ? "Brain allow-list"
              : null,
      ]
        .filter(Boolean)
        .join(" - ");
    case "brain_local":
      return "Brain-local credential";
    case "registered_secret":
      return "Credential vault";
    default:
      return "Credential source";
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
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(
    null,
  );

  return (
    <section className="grid gap-3 lg:col-span-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <IconDatabaseImport className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Connection providers</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Reuse workspace integrations, grant Brain access, or add Brain-local
            sources without exposing credential values.
          </p>
        </div>
        <Badge variant="outline" className="w-fit max-w-full">
          {loading
            ? "Loading"
            : `${connectionProviders.length.toLocaleString()} providers`}
        </Badge>
      </div>

      {loading ? (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <IconLoader2 className="size-4 animate-spin" />
            Loading provider catalog...
          </div>
        </div>
      ) : connectionProviders.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            const readinessCallout = providerReadinessCallout(provider);
            const ReadinessIcon = readinessCallout.icon;
            const readinessItems = providerReadinessItems(provider);
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
                          : "No Brain sources yet"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`${grantStateClass(grantState)} w-fit max-w-full`}
                  >
                    <GrantIcon className="mr-1 size-3" />
                    {grantStateLabel(grantState)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`${providerHealthClass(provider)} w-fit max-w-full`}
                  >
                    {providerHealthLabel(provider)}
                  </Badge>
                </div>

                <p className="text-xs leading-5 text-muted-foreground">
                  {provider.providerHealth?.message ??
                    grantStateDetail(provider, grantState)}
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
                          Connection readiness
                        </p>
                        <span className="truncate text-xs text-muted-foreground">
                          Values hidden
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
                          ? "Credential refs"
                          : "Catalog keys"}
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
                            No credential keys required
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
                          Slack setup guide
                        </div>
                        <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
                          <p>
                            Allow-list approved channel IDs such as C0123456789,
                            or channel names like #product when name resolution
                            is acceptable.
                          </p>
                          <p>
                            Minimum scopes are channels:read and
                            channels:history. Add groups:read and groups:history
                            for private channels.
                          </p>
                          <p>
                            Invite the Slack app to private channels before
                            syncing. DMs and MPIMs stay excluded.
                          </p>
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
                                  required
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
                          Credential provenance
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
                                {detail.available ? "Available" : "Missing"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {detail.provenance
                                ? provenanceLabel(detail.provenance)
                                : detail.missingMessage}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {workspace?.connections.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Workspace connections
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
                                    {workspaceStatusLabel(connection.status)}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={appAccessClass(
                                      connection.appAccess,
                                    )}
                                  >
                                    {appAccessLabel(connection.appAccess)}
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
                                  No credential refs on this connection
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
                        No shared workspace connection has been registered for
                        this provider yet.
                      </p>
                    )}
                    {!provider.sourceProviderSupported ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Brain can reuse this connection metadata, but source
                        setup for this provider has not been added to this
                        template yet.
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
                    {expanded ? "Hide details" : "Details"}
                  </Button>
                  {grantState === "needs_grant" ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={dispatchIntegrationsHref(provider.id)}>
                        <IconExternalLink className="size-4" />
                        Grant in Dispatch
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
                      Add source
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          No Brain connection providers are available from the shared catalog.
        </div>
      )}
      {workspaceError ? (
        <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          Workspace integration status is unavailable: {workspaceError}
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
            <h2 className="text-sm font-medium">Brain health</h2>
            {loading ? (
              <Badge variant="outline" className="gap-1.5">
                <IconLoader2 className="size-3 animate-spin" />
                Checking
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {nextStep ??
              "Sources, review queue, and retrieval checks are ready for normal use."}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-flow-col sm:auto-cols-max">
          <Badge variant="outline" className="justify-center gap-1.5">
            <IconCircleCheck className="size-3" />
            {health?.sources.healthy ?? 0}/{health?.sources.total ?? 0} healthy
          </Badge>
          {attention ? (
            <Badge variant="outline" className="justify-center gap-1.5">
              <IconAlertTriangle className="size-3" />
              {attention} attention
            </Badge>
          ) : null}
          <Badge variant="outline" className="justify-center gap-1.5">
            <IconClock className="size-3" />
            {health?.sources.lastSyncedAt
              ? `Last sync ${shortDate(health.sources.lastSyncedAt)}`
              : "No sync yet"}
          </Badge>
          {lastEval ? (
            <Badge variant="outline" className="justify-center gap-1.5">
              Eval {Math.round(lastEval.score * 100)}%
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,auto)_auto] xl:items-center">
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
                    Next sync {nextSync}
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
              label="Captures"
              value={(source.recordCount ?? 0).toLocaleString()}
            />
            <SourceFact
              label="Last sync"
              value={shortDate(sourceLastSync(source)) ?? "Never"}
            />
            {coverage ? <SourceFact label="Coverage" value={coverage} /> : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onReview}>
              <IconFileSearch className="size-4" />
              Captures
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9"
                  aria-label={`More actions for ${sourceName(source)}`}
                >
                  <IconDotsVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem disabled={syncPending} onSelect={onSync}>
                  <IconRefresh className="size-4" />
                  Sync now
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onTune}>
                  <IconSettings2 className="size-4" />
                  Tune source
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
              {syncDetail(source)}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function SourcesRoute() {
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
  const [form, setForm] = useState<SourceFormState>(() => defaultForm("slack"));

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
    setForm(defaultForm(selected));
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
        title: form.title.trim() || defaultTitle(form.provider),
        status:
          form.autoSync || sourceEnabled(editingSource) ? "active" : "paused",
        config,
      });
    } else {
      createSource.mutate({
        title: form.title.trim() || defaultTitle(form.provider),
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
        eyebrow="Sources"
        title="Source configuration"
        description="Connect approved places Brain can learn from, then sync and review them as needed."
        actions={
          <div className="grid w-full gap-2 sm:w-auto sm:grid-flow-col sm:auto-cols-max sm:justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAdvancedOpen(true)}
            >
              <IconSettings2 className="size-4" />
              Advanced
            </Button>
            <Button
              size="sm"
              disabled={createSource.isPending}
              onClick={() => openCreate()}
            >
              <IconDatabaseImport className="size-4" />
              Add source
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
              title="Connect Brain's first source"
              detail="Add an approved Slack channel, Granola Team-space source, GitHub repo, Clips export, manual import, or signed webhook."
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
              title="Source action failed"
              detail="Check source credentials, channel allow-lists, and the latest sync error."
            />
          </div>
        ) : null}
      </div>

      <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Advanced source controls</SheetTitle>
            <SheetDescription>
              Filter sources, check connection readiness, and run maintenance
              syncs when the normal source list is not enough.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-5">
            <section className="grid gap-3 rounded-md border border-border bg-card p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="grid gap-2">
                  <Label htmlFor="source-type-filter">Source type</Label>
                  <Select value={type} onValueChange={updateType}>
                    <SelectTrigger id="source-type-filter">
                      <SelectValue placeholder="Source type" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceTypes.map((sourceType) => (
                        <SelectItem key={sourceType} value={sourceType}>
                          {sourceType === "all" ? "All sources" : sourceType}
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
                  Run due syncs
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
            <SheetTitle>Review raw captures</SheetTitle>
            <SheetDescription>
              {reviewSource
                ? `${sourceName(reviewSource)} inventory. Raw bodies stay hidden unless a reviewer enables previews.`
                : "Review imported raw material before distillation."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-4">
            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="grid gap-2 sm:max-w-56">
                <Label htmlFor="capture-status-filter">Status</Label>
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
                        {captureStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Previews
                  <span className="block text-xs text-muted-foreground">
                    Show short snippets for intentional review
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
                    <p className="text-sm font-medium">Batch distillation</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Select queueable captures and hand them to the Brain
                      distillation worker together.
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
                      {allQueueableSelected ? "Unselect all" : "Select all"}
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
                        <IconSend className="size-4" />
                      )}
                      Queue selected
                    </Button>
                    {selectedCaptureIds.size ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedCaptureIds(new Set())}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {selectedQueueableIds.length.toLocaleString()} selected
                  </Badge>
                  <Badge variant="outline">
                    {queueableCaptures.length.toLocaleString()} queueable
                  </Badge>
                  {bulkResult ? (
                    <Badge
                      variant={bulkResult.errors ? "destructive" : "secondary"}
                    >
                      {bulkResult.queued.toLocaleString()} queued,{" "}
                      {bulkResult.existing.toLocaleString()} existing,{" "}
                      {bulkResult.errors.toLocaleString()} errors
                    </Badge>
                  ) : null}
                </div>
              </div>
            )}

            {capturesQuery.isLoading ? (
              <LoadingRows rows={3} />
            ) : capturesQuery.isError ? (
              <EmptyActionState
                title="Capture inventory failed"
                detail="Check source access and try again."
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
                            aria-label={`Select ${capture.title}`}
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
                                Raw content hidden. Enable previews or open the
                                source only when review requires context.
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
                                    Distillation{" "}
                                    {queueStatusLabel(queue.status)}
                                  </Badge>
                                  {queue.attempts ? (
                                    <span>
                                      {queue.attempts}{" "}
                                      {queue.attempts === 1
                                        ? "attempt"
                                        : "attempts"}
                                    </span>
                                  ) : null}
                                  {queue.runAfter ? (
                                    <span>
                                      Next check{" "}
                                      {shortDate(queue.runAfter) ??
                                        queue.runAfter}
                                    </span>
                                  ) : null}
                                </div>
                                {queue.error ? (
                                  <p className="mt-2">{queue.error}</p>
                                ) : queueIsActive ? (
                                  <p className="mt-2">
                                    Waiting for the Brain distillation worker to
                                    write knowledge or send this capture to
                                    review.
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
                              Source
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
                            <IconSend className="size-4" />
                          )}
                          {queueActionLabel(queue)}
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
                          Ignore
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyActionState
                title="No captures match this view"
                detail="Try another status, run a source sync, or import a transcript."
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={setupOpen} onOpenChange={setSetupOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {editingSource ? "Tune source" : "Add source"}
            </SheetTitle>
            <SheetDescription>
              Configure what Brain may ingest. Credentials stay in the workspace
              credential store; this form only saves allow-lists, cursors, and
              review rules.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="source-title">Name</Label>
              <Input
                id="source-title"
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label>Provider</Label>
              <Select
                value={form.provider}
                disabled={!!editingSource}
                onValueChange={(provider) =>
                  setForm((current) => ({
                    ...defaultForm(provider as Provider),
                    title:
                      current.title === defaultTitle(current.provider)
                        ? defaultTitle(provider as Provider)
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
                  Workspace connection
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
                      Automatic credential selection
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
                    ? `This source is bound to ${selectedWorkspaceConnection.label}; sync will not fall back to another shared connection.`
                    : formWorkspaceConnections.length
                      ? "Pick a granted connection to pin this source, or leave automatic to use the existing credential fallback."
                      : "Grant a workspace connection to Brain in Dispatch before pinning this source."}
                </p>
              </div>
            )}

            {form.provider === "slack" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="rounded-md border border-border bg-muted/25 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <IconShieldCheck className="size-4 text-muted-foreground" />
                    Slack access rules
                  </div>
                  <div className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                    <p>
                      Use one approved channel ID or #name per line. IDs are
                      safest for pilots; names are resolved before validation.
                    </p>
                    <p>
                      Slack access should support auth.test,
                      conversations.info/history, and chat.getPermalink. Add
                      private-channel access when piloting private channels.
                    </p>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="slack-channels">Allowed channels</Label>
                  <Textarea
                    id="slack-channels"
                    value={form.channelRefs}
                    onChange={(event) =>
                      updateForm({ channelRefs: event.target.value })
                    }
                    placeholder={"C0123456789\n#product\n#launches"}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Brain verifies the allow-list, rejects DMs/MPIMs, and never
                    stores credential values in source config.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="history-limit">Messages per page</Label>
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
                    <Label htmlFor="poll-minutes">Poll minutes</Label>
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
                    <Label htmlFor="granola-page-size">Page size</Label>
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
                    <Label htmlFor="granola-poll-minutes">Poll minutes</Label>
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
                    Initial updated-after
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
                    Granola Enterprise API returns Team-space notes; private
                    notes are outside the API scope.
                  </p>
                </div>
              </div>
            )}

            {form.provider === "github" && (
              <div className="grid gap-4 rounded-md border border-border p-4">
                <div className="grid gap-2">
                  <Label htmlFor="github-repos">Approved repositories</Label>
                  <Textarea
                    id="github-repos"
                    value={form.githubRepos}
                    onChange={(event) =>
                      updateForm({ githubRepos: event.target.value })
                    }
                    placeholder={"owner/repo\nhttps://github.com/owner/repo"}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Brain imports bounded issue and pull request context from
                    these repositories using the workspace GitHub credential.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="github-state">State</Label>
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
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="github-limit">Items per repo</Label>
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
                    <Label htmlFor="github-poll-minutes">Poll minutes</Label>
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
                    <span>Include issues</span>
                    <Switch
                      checked={form.githubIncludeIssues}
                      onCheckedChange={(githubIncludeIssues) =>
                        updateForm({ githubIncludeIssues })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Include pull requests</span>
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
                  <Label htmlFor="source-key">Webhook source key</Label>
                  <Input
                    id="source-key"
                    value={form.sourceKey}
                    onChange={(event) =>
                      updateForm({ sourceKey: event.target.value })
                    }
                    placeholder={form.provider}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    New sources receive a one-time ingest token. Existing
                    sources keep their token unless rotated separately.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Auto-sync
                  <span className="block text-xs text-muted-foreground">
                    Background polling uses this source when due
                  </span>
                </span>
                <Switch
                  checked={form.autoSync}
                  onCheckedChange={(autoSync) => updateForm({ autoSync })}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Review required
                  <span className="block text-xs text-muted-foreground">
                    Queue extracted knowledge before approval
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
              Cancel
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
              {editingSource ? "Save source" : "Create source"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
