import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { DispatchShell } from "@agent-native/dispatch/components";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/dispatch/components/ui/alert-dialog";
import { Badge } from "@agent-native/dispatch/components/ui/badge";
import { Button } from "@agent-native/dispatch/components/ui/button";
import { Checkbox } from "@agent-native/dispatch/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/dispatch/components/ui/dialog";
import { Input } from "@agent-native/dispatch/components/ui/input";
import { Label } from "@agent-native/dispatch/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@agent-native/dispatch/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/dispatch/components/ui/select";
import { Switch } from "@agent-native/dispatch/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBrain,
  IconBrandGithub,
  IconBrandSlack,
  IconBroadcast,
  IconBuilding,
  IconChartBar,
  IconCheck,
  IconCircleDashed,
  IconClock,
  IconDatabase,
  IconEdit,
  IconKey,
  IconMail,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import { toast } from "sonner";

export function meta() {
  return [{ title: "Workspace Integrations — Dispatch" }];
}

const CONNECTION_QUERY_PARAMS = { includeDisabled: true } as const;
const CONNECTION_QUERY_KEY = [
  "action",
  "list-workspace-connections",
  CONNECTION_QUERY_PARAMS,
] as const;

type IconComponent = ComponentType<{
  size?: number | string;
  className?: string;
}>;

interface WorkspaceConnectionCredentialKey {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

type WorkspaceConnectionProviderReadinessStatus =
  | "ready"
  | "checking"
  | "needs_credentials"
  | "needs_attention"
  | "disabled"
  | "not_configured";

interface WorkspaceConnectionProviderReadiness {
  status: WorkspaceConnectionProviderReadinessStatus;
  connectionCount: number;
  activeConnectionCount: number;
  readyConnectionCount: number;
  requiredCredentialKeys: string[];
  missingRequiredCredentialKeys: string[];
}

interface WorkspaceConnectionProvider {
  id: string;
  label: string;
  description: string;
  credentialKeys: WorkspaceConnectionCredentialKey[];
  capabilities: string[];
  recommendedTemplateUses: string[];
  readiness?: WorkspaceConnectionProviderReadiness;
}

interface WorkspaceConnectionCredentialRef {
  key: string;
  scope?: "user" | "org" | "workspace";
  provider?: string;
  label?: string;
}

type WorkspaceConnectionStatus =
  | "connected"
  | "checking"
  | "needs_reauth"
  | "error"
  | "disabled";

interface WorkspaceConnection {
  id: string;
  provider: string;
  label: string;
  accountId: string | null;
  accountLabel: string | null;
  status: WorkspaceConnectionStatus;
  scopes: string[];
  config: Record<string, unknown>;
  allowedApps: string[];
  credentialRefs: WorkspaceConnectionCredentialRef[];
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastUsedAt?: string | null;
  lastError: string | null;
}

interface SuggestedGrantApp {
  id: string;
  label: string;
}

interface WorkspaceConnectionGrant {
  id: string;
  connectionId: string;
  provider: string;
  appId: string;
  access: "all-apps" | "selected-app" | "explicit-grant";
  lastUsedAt?: string | null;
}

interface WorkspaceConnectionGrantSummary {
  connectionId: string;
  provider: string;
  accessMode: "all-apps" | "selected-apps";
  allApps: boolean;
  selectedAppIds: string[];
  explicitGrantAppIds: string[];
  effectiveAppIds: string[];
  trackedApps?: Array<{
    appId: string;
    label: string;
    granted: boolean;
    mode: "all-apps" | "allowed-app" | "explicit-grant" | "unavailable";
    grantId: string | null;
  }>;
}

interface WorkspaceConnectionsResponse {
  providers: WorkspaceConnectionProvider[];
  connections: WorkspaceConnection[];
  grants: WorkspaceConnectionGrant[];
  grantSummaries?: WorkspaceConnectionGrantSummary[];
  suggestedApps: SuggestedGrantApp[];
  counts: {
    providers: number;
    connections: number;
    grants: number;
    allAppConnections?: number;
    selectedAppConnections?: number;
    readyProviders?: number;
  };
}

interface WorkspaceConnectionImpactPreview {
  likelyAffectedApps: Array<{
    appId: string;
    label: string;
    accessMode: string;
    lastUsedAt?: string | null;
  }>;
  impactSummary: {
    likelyAffectedCount: number;
    hasAllAppsAccess: boolean;
    usageTracked: boolean;
    lastUsedAt?: string | null;
  };
  recommendedConfirmation: {
    body: string;
  };
}

interface WorkspaceAppSummary {
  id: string;
  name: string;
  status?: "ready" | "pending";
  archived?: boolean;
}

interface GrantApp {
  id: string;
  label: string;
  icon: IconComponent;
}

interface ConnectionFormState {
  id?: string;
  provider: string;
  label: string;
  accountId: string;
  accountLabel: string;
  status: WorkspaceConnectionStatus;
  scopes: string;
  credentialRefs: WorkspaceConnectionCredentialRef[];
  allApps: boolean;
  selectedApps: string[];
}

interface WorkspaceConnectionSetupPlanCredential {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
}

interface WorkspaceConnectionSetupPlanApp {
  id: string;
  label: string;
  recommended: boolean;
}

interface WorkspaceConnectionSetupPlan {
  provider: WorkspaceConnectionProvider;
  requiredCredentialRefs: WorkspaceConnectionSetupPlanCredential[];
  suggestedCredentialRefs: Array<
    WorkspaceConnectionCredentialRef & {
      description?: string;
      required?: boolean;
    }
  >;
  suggestedApps: WorkspaceConnectionSetupPlanApp[];
  grantRecommendation: {
    accessMode: "all-apps" | "selected-apps";
    selectedAppIds: string[];
    reason: string;
  };
  warnings: string[];
  connection: Pick<
    WorkspaceConnection,
    | "id"
    | "provider"
    | "label"
    | "accountId"
    | "accountLabel"
    | "status"
    | "scopes"
    | "allowedApps"
    | "credentialRefs"
    | "lastError"
  > | null;
  explicitGrantAppIds: string[];
}

interface SetupWizardState {
  mode: "setup" | "repair";
  providerId: string;
  connectionId?: string;
}

interface SetupWizardFormState {
  connectionId?: string;
  provider: string;
  label: string;
  accountId: string;
  accountLabel: string;
  status: WorkspaceConnectionStatus;
  scopes: string;
  credentialRefs: WorkspaceConnectionCredentialRef[];
  grantMode: "all-apps" | "selected-apps";
  selectedApps: string[];
}

const EMPTY_RESPONSE: WorkspaceConnectionsResponse = {
  providers: [],
  connections: [],
  grants: [],
  suggestedApps: [
    { id: "dispatch", label: "Dispatch" },
    { id: "brain", label: "Brain" },
    { id: "assets", label: "Assets" },
    { id: "analytics", label: "Analytics" },
    { id: "mail", label: "Mail" },
  ],
  counts: { providers: 0, connections: 0, grants: 0 },
};

const STATUS_LABELS: Record<WorkspaceConnectionStatus, string> = {
  connected: "Connected",
  checking: "Checking",
  needs_reauth: "Needs reauth",
  error: "Error",
  disabled: "Disabled",
};

const STATUS_CLASSES: Record<WorkspaceConnectionStatus, string> = {
  connected:
    "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400",
  checking:
    "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  needs_reauth:
    "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  error: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400",
  disabled: "border-border bg-muted text-muted-foreground",
};

const READINESS_LABELS: Record<
  WorkspaceConnectionProviderReadinessStatus,
  string
> = {
  ready: "Ready",
  checking: "Checking",
  needs_credentials: "Needs refs",
  needs_attention: "Needs attention",
  disabled: "Disabled",
  not_configured: "Available",
};

const READINESS_CLASSES: Record<
  WorkspaceConnectionProviderReadinessStatus,
  string
> = {
  ready:
    "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400",
  checking:
    "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  needs_credentials:
    "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  needs_attention:
    "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400",
  disabled: "border-border bg-muted text-muted-foreground",
  not_configured: "border-border bg-muted text-muted-foreground",
};

const APP_ICONS: Record<string, IconComponent> = {
  dispatch: IconBroadcast,
  brain: IconBrain,
  analytics: IconChartBar,
  mail: IconMail,
};

const PROVIDER_ICONS: Record<string, IconComponent> = {
  slack: IconBrandSlack,
  github: IconBrandGithub,
  gmail: IconMail,
  google_drive: IconDatabase,
  hubspot: IconBuilding,
  granola: IconDatabase,
  clips: IconDatabase,
  notion: IconDatabase,
  generic: IconWorld,
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function iconForProvider(providerId: string): IconComponent {
  return PROVIDER_ICONS[providerId] ?? IconPlugConnected;
}

function iconForApp(appId: string): IconComponent {
  return APP_ICONS[appId] ?? IconUsersGroup;
}

function humanizeAppId(appId: string): string {
  return appId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function hasUsageTimestamp(connection: WorkspaceConnection): boolean {
  return Object.prototype.hasOwnProperty.call(connection, "lastUsedAt");
}

function hasGrantUsageTimestamp(grant: WorkspaceConnectionGrant): boolean {
  return Object.prototype.hasOwnProperty.call(grant, "lastUsedAt");
}

function formatTimestamp(value: string | null | undefined): string {
  if (value == null) return "Never used";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = date.getTime() - Date.now();
  const absMs = Math.abs(deltaMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });
  for (const [unit, ms] of units) {
    if (absMs >= ms) {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }
  return "Just now";
}

function usageSortValue(connection: WorkspaceConnection): number {
  if (!hasUsageTimestamp(connection)) return Number.NaN;
  if (connection.lastUsedAt == null) return 0;
  const time = new Date(connection.lastUsedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function credentialRefsForProvider(
  provider: WorkspaceConnectionProvider,
): WorkspaceConnectionCredentialRef[] {
  return provider.credentialKeys.map((credential) => ({
    key: credential.key,
    label: credential.label,
    provider: provider.id,
    scope: "org",
  }));
}

function normalizeCredentialRefs(
  refs: WorkspaceConnectionCredentialRef[],
  provider?: WorkspaceConnectionProvider,
): WorkspaceConnectionCredentialRef[] {
  const labels = new Map(
    provider?.credentialKeys.map((credential) => [
      credential.key,
      credential.label,
    ]) ?? [],
  );
  const seen = new Set<string>();
  return refs
    .map((ref) => {
      const key = ref.key.trim();
      return {
        key,
        label: ref.label?.trim() || labels.get(key) || key,
        provider: ref.provider?.trim() || provider?.id,
        scope: ref.scope ?? "org",
      };
    })
    .filter((ref) => {
      if (!ref.key || seen.has(ref.key)) return false;
      seen.add(ref.key);
      return true;
    });
}

function upsertCredentialRefAt(
  refs: WorkspaceConnectionCredentialRef[],
  index: number,
  patch: Partial<WorkspaceConnectionCredentialRef>,
): WorkspaceConnectionCredentialRef[] {
  return refs.map((ref, currentIndex) =>
    currentIndex === index ? { ...ref, ...patch } : ref,
  );
}

function appendCredentialRef(
  refs: WorkspaceConnectionCredentialRef[],
  provider?: WorkspaceConnectionProvider,
): WorkspaceConnectionCredentialRef[] {
  return [
    ...refs,
    {
      key: "",
      label: "",
      provider: provider?.id,
      scope: "org",
    },
  ];
}

function missingRequiredCredentialKeys(
  provider: WorkspaceConnectionProvider | undefined,
  refs: WorkspaceConnectionCredentialRef[],
): string[] {
  if (!provider) return [];
  const available = new Set(refs.map((ref) => ref.key.trim()).filter(Boolean));
  return provider.credentialKeys
    .filter((credential) => credential.required)
    .map((credential) => credential.key)
    .filter((key) => !available.has(key));
}

function formFromConnection(
  connection: WorkspaceConnection,
  provider?: WorkspaceConnectionProvider,
): ConnectionFormState {
  return {
    id: connection.id,
    provider: connection.provider,
    label: connection.label,
    accountId: connection.accountId ?? "",
    accountLabel: connection.accountLabel ?? "",
    status: connection.status,
    scopes: connection.scopes.join(", "),
    credentialRefs:
      connection.credentialRefs.length > 0
        ? normalizeCredentialRefs(connection.credentialRefs, provider)
        : provider
          ? credentialRefsForProvider(provider)
          : [],
    allApps: connection.allowedApps.length === 0,
    selectedApps: connection.allowedApps,
  };
}

function setupFormFromPlan(
  plan: WorkspaceConnectionSetupPlan,
  mode: SetupWizardState["mode"],
): SetupWizardFormState {
  const connection = plan.connection;
  const selectedApps =
    plan.grantRecommendation.accessMode === "all-apps"
      ? []
      : plan.grantRecommendation.selectedAppIds;

  return {
    connectionId: connection?.id,
    provider: plan.provider.id,
    label: connection?.label || plan.provider.label,
    accountId: connection?.accountId ?? "",
    accountLabel: connection?.accountLabel ?? "",
    status:
      mode === "repair" ? "checking" : (connection?.status ?? "connected"),
    scopes: connection?.scopes.join(", ") ?? "",
    credentialRefs: connection?.credentialRefs.length
      ? normalizeCredentialRefs(connection.credentialRefs, plan.provider)
      : normalizeCredentialRefs(plan.suggestedCredentialRefs, plan.provider),
    grantMode: plan.grantRecommendation.accessMode,
    selectedApps,
  };
}

function appIsGranted(
  connection: WorkspaceConnection,
  appId: string,
  grants: WorkspaceConnectionsResponse["grants"],
): boolean {
  return (
    connection.allowedApps.length === 0 ||
    connection.allowedApps.includes(appId) ||
    grants.some(
      (grant) =>
        grant.connectionId === connection.id &&
        (grant.appId === appId || grant.appId === "*"),
    )
  );
}

function grantModeForApp(
  connection: WorkspaceConnection,
  appId: string,
  grants: WorkspaceConnectionsResponse["grants"],
): "all-apps" | "selected" | "explicit" | "off" {
  if (connection.allowedApps.length === 0) return "all-apps";
  if (connection.allowedApps.includes(appId)) return "selected";
  if (
    grants.some(
      (grant) =>
        grant.connectionId === connection.id &&
        (grant.appId === appId || grant.appId === "*"),
    )
  ) {
    return "explicit";
  }
  return "off";
}

function grantModeLabel(mode: ReturnType<typeof grantModeForApp>): string {
  switch (mode) {
    case "all-apps":
      return "All-app";
    case "selected":
      return "Selected";
    case "explicit":
      return "Grant";
    case "off":
      return "Off";
  }
}

function usageForAppGrant(
  connection: WorkspaceConnection,
  appId: string,
  grants: WorkspaceConnectionsResponse["grants"],
): string | null | undefined {
  const explicitGrant = grants.find(
    (grant) => grant.connectionId === connection.id && grant.appId === appId,
  );
  if (explicitGrant && hasGrantUsageTimestamp(explicitGrant)) {
    return explicitGrant.lastUsedAt;
  }
  return hasUsageTimestamp(connection) ? connection.lastUsedAt : undefined;
}

function nextAllowedApps(
  connection: WorkspaceConnection,
  appId: string,
  granted: boolean,
  knownAppIds: string[],
): string[] {
  const current =
    connection.allowedApps.length === 0
      ? Array.from(new Set([...knownAppIds, appId]))
      : connection.allowedApps;
  if (granted) {
    return Array.from(new Set([...current, appId]));
  }
  return current.filter((id) => id !== appId);
}

function summarizeGrant(
  connection: WorkspaceConnection,
  grantApps: GrantApp[],
  grants: WorkspaceConnectionsResponse["grants"],
) {
  if (connection.allowedApps.length === 0) return "All apps";
  const grantedAppIds = Array.from(
    new Set([
      ...connection.allowedApps,
      ...grants
        .filter((grant) => grant.connectionId === connection.id)
        .map((grant) => grant.appId)
        .filter((appId) => appId !== "*"),
    ]),
  );
  const labels = grantedAppIds
    .map((appId) => grantApps.find((app) => app.id === appId)?.label ?? appId)
    .slice(0, 3);
  const suffix =
    grantedAppIds.length > labels.length
      ? ` +${grantedAppIds.length - labels.length}`
      : "";
  return `${labels.join(", ")}${suffix}`;
}

function summarizeAppList(appIds: string[], grantApps: GrantApp[]): string {
  const labels = appIds
    .map((appId) => grantApps.find((app) => app.id === appId)?.label ?? appId)
    .slice(0, 3);
  const suffix =
    appIds.length > labels.length ? ` +${appIds.length - labels.length}` : "";
  return labels.length > 0 ? `${labels.join(", ")}${suffix}` : "No apps";
}

function ProviderCard({
  provider,
  connections,
  onCreate,
}: {
  provider: WorkspaceConnectionProvider;
  connections: WorkspaceConnection[];
  onCreate: () => void;
}) {
  const Icon = iconForProvider(provider.id);
  const active = connections.filter((item) => item.status !== "disabled");
  const readiness = provider.readiness;
  const readinessStatus =
    readiness?.status ?? (active.length > 0 ? "ready" : "not_configured");
  return (
    <article className="flex min-h-[232px] flex-col justify-between rounded-lg border bg-card p-4 shadow-sm transition hover:border-foreground/20">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
            <Icon size={18} className="text-muted-foreground" />
          </div>
          <Pill className={READINESS_CLASSES[readinessStatus]}>
            {readinessStatus === "ready" ? (
              <IconCheck size={12} />
            ) : (
              <IconCircleDashed size={12} />
            )}
            {READINESS_LABELS[readinessStatus]}
          </Pill>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {provider.label}
          </h2>
          <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">
            {provider.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {provider.capabilities.map((capability) => (
            <Pill key={capability} className="border-border bg-background">
              {capability}
            </Pill>
          ))}
        </div>
        {readiness?.missingRequiredCredentialKeys.length ? (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Missing{" "}
            {readiness.missingRequiredCredentialKeys.slice(0, 2).join(", ")}
            {readiness.missingRequiredCredentialKeys.length > 2
              ? ` +${readiness.missingRequiredCredentialKeys.length - 2}`
              : ""}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <span className="text-xs text-muted-foreground">
          {active.length > 0
            ? `${active.length} active connection${
                active.length === 1 ? "" : "s"
              }`
            : provider.credentialKeys.length === 0
              ? "No credential refs"
              : `${provider.credentialKeys.length} credential ref${
                  provider.credentialKeys.length === 1 ? "" : "s"
                }`}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          <IconPlus size={14} />
          Connect
        </Button>
      </div>
    </article>
  );
}

function ConnectionRow({
  connection,
  provider,
  grantApps,
  grants,
  onEdit,
  onRepair,
  onDelete,
  onToggleGrant,
  grantPending,
}: {
  connection: WorkspaceConnection;
  provider?: WorkspaceConnectionProvider;
  grantApps: GrantApp[];
  grants: WorkspaceConnectionsResponse["grants"];
  onEdit: () => void;
  onRepair: () => void;
  onDelete: () => void;
  onToggleGrant: (appId: string, granted: boolean) => void;
  grantPending: boolean;
}) {
  const Icon = iconForProvider(connection.provider);
  const missingKeys = missingRequiredCredentialKeys(
    provider,
    connection.credentialRefs,
  );
  const needsRepair =
    missingKeys.length > 0 ||
    connection.status === "error" ||
    connection.status === "needs_reauth" ||
    connection.status === "disabled";
  return (
    <article className="rounded-lg border bg-card shadow-sm">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                <Icon size={18} className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-foreground">
                    {connection.label}
                  </h2>
                  <Pill className={STATUS_CLASSES[connection.status]}>
                    {STATUS_LABELS[connection.status]}
                  </Pill>
                  {missingKeys.length > 0 ? (
                    <Pill className={READINESS_CLASSES.needs_credentials}>
                      Missing refs
                    </Pill>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {provider?.label ?? connection.provider}
                  {connection.accountLabel
                    ? ` · ${connection.accountLabel}`
                    : ""}
                  {connection.accountId ? ` · ${connection.accountId}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {needsRepair ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRepair}
                >
                  <IconRefresh size={14} />
                  Repair
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
                <IconEdit size={14} />
                Edit
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onDelete}
              >
                <IconTrash size={14} />
                Delete
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ConnectionMeta
              icon={IconKey}
              label="Credential refs"
              value={
                connection.credentialRefs.length
                  ? connection.credentialRefs.map((ref) => ref.key).join(", ")
                  : "None"
              }
            />
            <ConnectionMeta
              icon={IconShieldCheck}
              label="Scopes"
              value={
                connection.scopes.length ? connection.scopes.join(", ") : "None"
              }
            />
            <ConnectionMeta
              icon={IconUsersGroup}
              label="Access"
              value={summarizeGrant(connection, grantApps, grants)}
            />
            {hasUsageTimestamp(connection) ? (
              <ConnectionMeta
                icon={IconClock}
                label="Usage"
                value={formatTimestamp(connection.lastUsedAt)}
              />
            ) : null}
          </div>

          {connection.credentialRefs.length > 0 ? (
            <CredentialRefsPreview refs={connection.credentialRefs} />
          ) : null}

          {missingKeys.length > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                Required refs missing: {missingKeys.join(", ")}
              </span>
            </div>
          ) : null}

          {connection.lastError ? (
            <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                {connection.lastError}
              </span>
            </div>
          ) : null}
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                App grants
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {connection.allowedApps.length === 0
                  ? "Every workspace app can reuse this account"
                  : `${summarizeGrant(
                      connection,
                      grantApps,
                      grants,
                    )} can reuse this account`}
              </p>
            </div>
            <Pill className="border-border bg-muted text-muted-foreground">
              {connection.allowedApps.length === 0 ? "All apps" : "Selected"}
            </Pill>
          </div>
          <div className="grid gap-1.5">
            {grantApps.map((app) => {
              const AppIcon = app.icon;
              const granted = appIsGranted(connection, app.id, grants);
              const mode = grantModeForApp(connection, app.id, grants);
              const usage = usageForAppGrant(connection, app.id, grants);
              return (
                <div
                  key={app.id}
                  className="flex min-h-9 items-center justify-between gap-3 rounded-md border px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AppIcon size={14} className="text-muted-foreground" />
                    <span className="grid min-w-0">
                      <span className="truncate text-sm font-medium">
                        {app.label}
                      </span>
                      {usage !== undefined ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {formatTimestamp(usage)}
                        </span>
                      ) : null}
                    </span>
                    <Pill
                      className={cx(
                        "h-5 px-1.5 text-[11px]",
                        granted
                          ? "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {grantModeLabel(mode)}
                    </Pill>
                  </div>
                  <Switch
                    checked={granted}
                    disabled={grantPending}
                    onCheckedChange={(checked) =>
                      onToggleGrant(app.id, checked)
                    }
                    aria-label={`${granted ? "Revoke" : "Grant"} ${
                      app.label
                    } access to ${connection.label}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
}

function ConnectionMeta({
  icon: Icon,
  label,
  value,
}: {
  icon: IconComponent;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon size={13} />
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function CredentialRefsPreview({
  refs,
}: {
  refs: WorkspaceConnectionCredentialRef[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {refs.map((ref) => (
        <Pill
          key={`${ref.scope ?? "org"}:${ref.key}`}
          className="border-border bg-background font-mono"
        >
          <IconKey size={12} />
          {ref.key}
          {ref.scope ? (
            <span className="font-sans text-muted-foreground">{ref.scope}</span>
          ) : null}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        className,
      )}
    >
      {children}
    </Badge>
  );
}

function Modal({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        <DialogHeader className="border-b p-4 pr-10">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionForm({
  open,
  form,
  providers,
  grantApps,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: ConnectionFormState | null;
  providers: WorkspaceConnectionProvider[];
  grantApps: GrantApp[];
  saving: boolean;
  onChange: (form: ConnectionFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!form) return null;
  const provider = providers.find((item) => item.id === form.provider);
  const credentialRefs = normalizeCredentialRefs(form.credentialRefs, provider);
  const missingCredentialRefs = missingRequiredCredentialKeys(
    provider,
    credentialRefs,
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={form.id ? "Edit connection" : "New connection"}
      description={provider?.description}
    >
      <form onSubmit={onSubmit}>
        <div className="grid gap-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 text-sm">
              <Label>Provider</Label>
              <Select
                value={form.provider}
                onValueChange={(value) => {
                  const nextProvider = providers.find(
                    (item) => item.id === value,
                  );
                  onChange({
                    ...form,
                    provider: value,
                    label: form.label || nextProvider?.label || value,
                    credentialRefs: nextProvider
                      ? credentialRefsForProvider(nextProvider)
                      : form.credentialRefs,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 text-sm">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  onChange({
                    ...form,
                    status: value as WorkspaceConnectionStatus,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Label"
              value={form.label}
              onChange={(value) => onChange({ ...form, label: value })}
              required
            />
            <TextField
              label="Account label"
              value={form.accountLabel}
              onChange={(value) => onChange({ ...form, accountLabel: value })}
              placeholder="Acme workspace"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Account ID"
              value={form.accountId}
              onChange={(value) => onChange({ ...form, accountId: value })}
              placeholder="team or account id"
            />
            <TextField
              label="Scopes"
              value={form.scopes}
              onChange={(value) => onChange({ ...form, scopes: value })}
              placeholder="channels:history, search"
            />
          </div>

          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Access mode</div>
                <div className="text-xs text-muted-foreground">
                  {form.allApps
                    ? "All workspace apps can reuse this connection"
                    : "Only selected apps can reuse this connection"}
                </div>
              </div>
              <Switch
                checked={form.allApps}
                onCheckedChange={(checked) =>
                  onChange({ ...form, allApps: checked })
                }
                aria-label="Grant this connection to all workspace apps"
              />
            </div>
            {!form.allApps ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {grantApps.map((app) => {
                  const AppIcon = app.icon;
                  const selected = form.selectedApps.includes(app.id);
                  return (
                    <Button
                      key={app.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        onChange({
                          ...form,
                          selectedApps: selected
                            ? form.selectedApps.filter((id) => id !== app.id)
                            : [...form.selectedApps, app.id],
                        })
                      }
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      className={cx(
                        "h-8 px-2.5 text-xs",
                        !selected && "text-muted-foreground",
                      )}
                    >
                      <AppIcon size={13} />
                      {app.label}
                    </Button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <CredentialRefsEditor
            provider={provider}
            refs={form.credentialRefs}
            missingRefs={missingCredentialRefs}
            onChange={(credentialRefs) => onChange({ ...form, credentialRefs })}
          />
        </div>
        <DialogFooter className="border-t p-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !form.label.trim()}>
            {saving ? <IconRefresh size={14} className="animate-spin" /> : null}
            Save connection
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

function CredentialRefsEditor({
  provider,
  refs,
  missingRefs,
  onChange,
}: {
  provider?: WorkspaceConnectionProvider;
  refs: WorkspaceConnectionCredentialRef[];
  missingRefs: string[];
  onChange: (refs: WorkspaceConnectionCredentialRef[]) => void;
}) {
  const providerKeys = new Map(
    provider?.credentialKeys.map((credential) => [
      credential.key,
      credential,
    ]) ?? [],
  );
  const rows = refs.length > 0 ? refs : appendCredentialRef([], provider);

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Credential refs</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Reference names only. Secret values remain in Vault or OAuth.
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(appendCredentialRef(refs, provider))}
        >
          <IconPlus size={14} />
          Add ref
        </Button>
      </div>

      <div className="mt-3 grid gap-2">
        {rows.map((ref, index) => {
          const credential = providerKeys.get(ref.key);
          return (
            <div
              key={`${index}:${ref.provider ?? provider?.id ?? "provider"}`}
              className="grid gap-2 rounded-md border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            >
              <div className="grid min-w-0 gap-1.5 text-sm">
                <Label className="flex items-center gap-1.5">
                  Ref name
                  {credential?.required ? (
                    <Pill className="h-5 border-border bg-muted px-1.5 text-[11px]">
                      Required
                    </Pill>
                  ) : null}
                </Label>
                <Input
                  value={ref.key}
                  onChange={(event) =>
                    onChange(
                      upsertCredentialRefAt(rows, index, {
                        key: event.target.value,
                        label:
                          providerKeys.get(event.target.value)?.label ??
                          ref.label,
                        provider: provider?.id ?? ref.provider,
                      }),
                    )
                  }
                  placeholder={
                    provider?.credentialKeys[index]?.key ?? "VAULT_KEY_NAME"
                  }
                  spellCheck={false}
                  className="font-mono"
                />
                {credential?.description ? (
                  <span className="text-xs leading-5 text-muted-foreground">
                    {credential.description}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-1.5 text-sm">
                <Label>Scope</Label>
                <Select
                  value={ref.scope ?? "org"}
                  onValueChange={(value) =>
                    onChange(
                      upsertCredentialRefAt(rows, index, {
                        scope:
                          value as WorkspaceConnectionCredentialRef["scope"],
                      }),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="org">Org</SelectItem>
                    <SelectItem value="workspace">Workspace</SelectItem>
                    <SelectItem value="user">User</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    onChange(rows.filter((_, itemIndex) => itemIndex !== index))
                  }
                  aria-label={`Remove ${ref.key || "credential ref"}`}
                >
                  <IconTrash size={14} />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {missingRefs.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Missing required refs: {missingRefs.join(", ")}</span>
        </div>
      ) : null}
    </div>
  );
}

function SetupWizard({
  open,
  state,
  step,
  plan,
  form,
  providers,
  grantApps,
  loading,
  saving,
  onStepChange,
  onProviderChange,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  state: SetupWizardState | null;
  step: number;
  plan?: WorkspaceConnectionSetupPlan;
  form: SetupWizardFormState | null;
  providers: WorkspaceConnectionProvider[];
  grantApps: GrantApp[];
  loading: boolean;
  saving: boolean;
  onStepChange: (step: number) => void;
  onProviderChange: (providerId: string) => void;
  onChange: (form: SetupWizardFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const provider =
    plan?.provider ?? providers.find((item) => item.id === state?.providerId);
  const credentialRefs = form
    ? normalizeCredentialRefs(form.credentialRefs, provider)
    : [];
  const missingCredentialRefs = missingRequiredCredentialKeys(
    provider,
    credentialRefs,
  );
  const selectedApps = form?.selectedApps ?? [];
  const stepItems = [
    { label: "Provider", icon: IconPlugConnected },
    { label: "Refs", icon: IconKey },
    { label: "Access", icon: IconShieldCheck },
  ];
  const canAdvance =
    step === 0
      ? Boolean(form?.label.trim())
      : step === 1
        ? missingCredentialRefs.length === 0
        : form?.grantMode === "all-apps" || selectedApps.length > 0;
  const suggestedGrantApps = useMemo(() => {
    const map = new Map<
      string,
      GrantApp & {
        recommended: boolean;
      }
    >();
    for (const app of plan?.suggestedApps ?? []) {
      map.set(app.id, {
        id: app.id,
        label: app.label,
        icon: iconForApp(app.id),
        recommended: app.recommended,
      });
    }
    for (const app of grantApps) {
      const current = map.get(app.id);
      map.set(app.id, {
        ...app,
        recommended: current?.recommended ?? false,
      });
    }
    return Array.from(map.values());
  }, [grantApps, plan?.suggestedApps]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        state?.mode === "repair"
          ? `Repair ${form?.label || provider?.label || "connection"}`
          : `Connect ${provider?.label || "provider"}`
      }
      description={provider?.description}
    >
      <div className="grid gap-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          {stepItems.map((item, index) => {
            const Icon = item.icon;
            const active = step === index;
            const complete = step > index;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onStepChange(index)}
                className={cx(
                  "flex min-h-10 items-center justify-center gap-2 rounded-md border px-2 text-xs font-medium transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : complete
                      ? "border-border bg-muted text-foreground"
                      : "border-border bg-background text-muted-foreground",
                )}
              >
                {complete ? <IconCheck size={14} /> : <Icon size={14} />}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            Loading setup plan...
          </div>
        ) : null}

        {!loading && form && provider ? (
          <>
            {plan?.warnings.length ? (
              <div className="grid gap-2">
                {plan.warnings.map((warning) => (
                  <div
                    key={warning}
                    className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
                  >
                    <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 break-words">{warning}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {step === 0 ? (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5 text-sm">
                    <Label>Provider</Label>
                    <Select
                      value={form.provider}
                      disabled={state?.mode === "repair"}
                      onValueChange={onProviderChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <TextField
                    label="Connection label"
                    value={form.label}
                    onChange={(value) => onChange({ ...form, label: value })}
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Account label"
                    value={form.accountLabel}
                    onChange={(value) =>
                      onChange({ ...form, accountLabel: value })
                    }
                    placeholder="Acme workspace"
                  />
                  <TextField
                    label="Account ID"
                    value={form.accountId}
                    onChange={(value) =>
                      onChange({ ...form, accountId: value })
                    }
                    placeholder="team or account id"
                  />
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-sm font-medium">Provider plan</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {provider.capabilities.map((capability) => (
                      <Pill key={capability} className="border-border bg-muted">
                        {capability}
                      </Pill>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {plan?.grantRecommendation.reason}
                  </p>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <CredentialRefsEditor
                provider={provider}
                refs={form.credentialRefs}
                missingRefs={missingCredentialRefs}
                onChange={(credentialRefs) =>
                  onChange({ ...form, credentialRefs })
                }
              />
            ) : null}

            {step === 2 ? (
              <div className="grid gap-4">
                <GrantPreview
                  providerLabel={provider.label}
                  grantMode={form.grantMode}
                  selectedAppIds={selectedApps}
                  grantApps={suggestedGrantApps}
                />
                <RadioGroup
                  value={form.grantMode}
                  onValueChange={(value) =>
                    onChange({
                      ...form,
                      grantMode: value as SetupWizardFormState["grantMode"],
                    })
                  }
                  className="grid gap-2"
                >
                  <Label
                    htmlFor="setup-grant-selected"
                    className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3"
                  >
                    <RadioGroupItem
                      id="setup-grant-selected"
                      value="selected-apps"
                      className="mt-0.5"
                    />
                    <span className="grid gap-1">
                      <span className="text-sm font-medium">Selected apps</span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        Grant only the apps that should reuse this provider
                        account.
                      </span>
                    </span>
                  </Label>
                  <Label
                    htmlFor="setup-grant-all"
                    className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3"
                  >
                    <RadioGroupItem
                      id="setup-grant-all"
                      value="all-apps"
                      className="mt-0.5"
                    />
                    <span className="grid gap-1">
                      <span className="text-sm font-medium">All apps</span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        Make this connection available to every workspace app.
                      </span>
                    </span>
                  </Label>
                </RadioGroup>

                {form.grantMode === "selected-apps" ? (
                  <div className="rounded-md border bg-background p-3">
                    <div className="mb-3 text-sm font-medium">App grants</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suggestedGrantApps.map((app) => {
                        const AppIcon = app.icon;
                        const selected = selectedApps.includes(app.id);
                        return (
                          <Label
                            key={app.id}
                            htmlFor={`setup-app-${app.id}`}
                            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <AppIcon
                                size={14}
                                className="text-muted-foreground"
                              />
                              <span className="truncate text-sm font-medium">
                                {app.label}
                              </span>
                              {app.recommended ? (
                                <Pill className="h-5 border-border bg-muted px-1.5 text-[11px]">
                                  Suggested
                                </Pill>
                              ) : null}
                            </span>
                            <Checkbox
                              id={`setup-app-${app.id}`}
                              checked={selected}
                              onCheckedChange={(checked) =>
                                onChange({
                                  ...form,
                                  selectedApps: checked
                                    ? Array.from(
                                        new Set([...selectedApps, app.id]),
                                      )
                                    : selectedApps.filter(
                                        (appId) => appId !== app.id,
                                      ),
                                })
                              }
                              aria-label={`${selected ? "Remove" : "Grant"} ${
                                app.label
                              }`}
                            />
                          </Label>
                        );
                      })}
                    </div>
                    {selectedApps.length === 0 ? (
                      <div className="mt-3 text-xs text-muted-foreground">
                        Choose at least one app, or switch to all apps.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <DialogFooter className="border-t p-4">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </Button>
        {step > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => onStepChange(step - 1)}
            disabled={saving}
          >
            <IconArrowLeft size={14} />
            Back
          </Button>
        ) : null}
        {step < 2 ? (
          <Button
            type="button"
            onClick={() => onStepChange(step + 1)}
            disabled={!canAdvance || loading || saving}
          >
            Next
            <IconArrowRight size={14} />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!canAdvance || loading || saving}
          >
            {saving ? <IconRefresh size={14} className="animate-spin" /> : null}
            {state?.mode === "repair" ? "Apply repair" : "Create connection"}
          </Button>
        )}
      </DialogFooter>
    </Modal>
  );
}

function GrantPreview({
  providerLabel,
  grantMode,
  selectedAppIds,
  grantApps,
}: {
  providerLabel: string;
  grantMode: SetupWizardFormState["grantMode"];
  selectedAppIds: string[];
  grantApps: GrantApp[];
}) {
  const selectedLabel = summarizeAppList(selectedAppIds, grantApps);
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <IconShieldCheck size={14} className="text-muted-foreground" />
        Grant preview
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {grantMode === "all-apps"
          ? `Every workspace app can use ${providerLabel}. Secret values stay in Vault or OAuth.`
          : selectedAppIds.length > 0
            ? `${selectedLabel} can use ${providerLabel}. App-specific channels, repos, cursors, and sync rules stay in those apps.`
            : `Choose which apps can use ${providerLabel}, or switch to all apps.`}
      </p>
    </div>
  );
}

function DeleteConfirm({
  connection,
  deleting,
  onClose,
  onConfirm,
}: {
  connection: WorkspaceConnection | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { data: impact, isLoading: impactLoading } =
    useActionQuery<WorkspaceConnectionImpactPreview>(
      "preview-workspace-connection-impact",
      {
        connectionId: connection?.id ?? "",
        operation: "delete-connection",
      },
      { enabled: Boolean(connection?.id) },
    );

  return (
    <AlertDialog
      open={!!connection}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete connection</AlertDialogTitle>
          <AlertDialogDescription>
            {connection?.label
              ? `This removes ${connection.label} and its app grants.`
              : "This removes the shared connection and its app grants."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ConnectionDeleteImpact impact={impact} loading={impactLoading} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <IconRefresh size={14} className="animate-spin" />
            ) : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConnectionDeleteImpact({
  impact,
  loading,
}: {
  impact?: WorkspaceConnectionImpactPreview;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Checking affected apps...
      </div>
    );
  }
  if (!impact) return null;

  const appLabels = impact.likelyAffectedApps
    .map((app) => app.label)
    .slice(0, 4);
  const extraCount = Math.max(
    0,
    impact.likelyAffectedApps.length - appLabels.length,
  );

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill className="border-border bg-background text-muted-foreground">
          {impact.impactSummary.hasAllAppsAccess
            ? "All-app connection"
            : "Selected grants"}
        </Pill>
        {impact.impactSummary.usageTracked ? (
          <Pill className="border-border bg-background text-muted-foreground">
            <IconClock size={12} />
            {formatTimestamp(impact.impactSummary.lastUsedAt)}
          </Pill>
        ) : null}
      </div>
      <p className="mt-2 leading-5 text-muted-foreground">
        {impact.likelyAffectedApps.length > 0
          ? `Likely affected: ${appLabels.join(", ")}${
              extraCount ? ` +${extraCount}` : ""
            }.`
          : "No current app grants were found."}
      </p>
      <p className="mt-1 leading-5 text-muted-foreground">
        {impact.recommendedConfirmation.body}
      </p>
    </div>
  );
}

export default function WorkspaceIntegrationsRoute() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ConnectionFormState | null>(null);
  const [setupWizard, setSetupWizard] = useState<SetupWizardState | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [setupForm, setSetupForm] = useState<SetupWizardFormState | null>(null);
  const [setupFormKey, setSetupFormKey] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceConnection | null>(
    null,
  );

  const connectionsQuery = useActionQuery(
    "list-workspace-connections",
    CONNECTION_QUERY_PARAMS,
  );
  const appsQuery = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
    audience: "all",
  });
  const setupPlanQuery = useActionQuery<WorkspaceConnectionSetupPlan>(
    "plan-workspace-connection-setup",
    {
      provider: setupWizard?.providerId,
      connectionId: setupWizard?.connectionId,
    },
    { enabled: Boolean(setupWizard) },
  );

  const data = (connectionsQuery.data ??
    EMPTY_RESPONSE) as WorkspaceConnectionsResponse;
  const providers = data.providers;
  const connections = data.connections;
  const apps = (appsQuery.data ?? []) as WorkspaceAppSummary[];
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  const grantApps = useMemo<GrantApp[]>(() => {
    const map = new Map<string, GrantApp>();
    for (const app of apps) {
      if (app.archived || app.status === "pending") continue;
      map.set(app.id, {
        id: app.id,
        label: app.name || humanizeAppId(app.id),
        icon: iconForApp(app.id),
      });
    }
    return Array.from(map.values());
  }, [apps]);

  const providerConnections = useMemo(() => {
    const map = new Map<string, WorkspaceConnection[]>();
    for (const connection of connections) {
      const items = map.get(connection.provider) ?? [];
      items.push(connection);
      map.set(connection.provider, items);
    }
    return map;
  }, [connections]);

  const upsertConnection = useActionMutation("upsert-workspace-connection");
  const applySetup = useActionMutation("apply-workspace-connection-setup");
  const setGrant = useActionMutation("set-workspace-connection-grant");
  const deleteConnection = useActionMutation("delete-workspace-connection");

  const currentSetupKey = setupWizard
    ? `${setupWizard.mode}:${setupWizard.connectionId ?? ""}:${
        setupWizard.providerId
      }`
    : "";

  useEffect(() => {
    if (!setupWizard || !setupPlanQuery.data) return;
    if (setupFormKey === currentSetupKey) return;
    setSetupForm(setupFormFromPlan(setupPlanQuery.data, setupWizard.mode));
    setSetupFormKey(currentSetupKey);
  }, [currentSetupKey, setupFormKey, setupPlanQuery.data, setupWizard]);

  function openSetup(provider: WorkspaceConnectionProvider) {
    setSetupWizard({ mode: "setup", providerId: provider.id });
    setSetupStep(0);
    setSetupForm(null);
    setSetupFormKey("");
  }

  function openRepair(connection: WorkspaceConnection) {
    setSetupWizard({
      mode: "repair",
      providerId: connection.provider,
      connectionId: connection.id,
    });
    setSetupStep(0);
    setSetupForm(null);
    setSetupFormKey("");
  }

  function openEdit(connection: WorkspaceConnection) {
    setForm(
      formFromConnection(connection, providersById.get(connection.provider)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    try {
      const provider = providersById.get(form.provider);
      const credentialRefs = normalizeCredentialRefs(
        form.credentialRefs,
        provider,
      );
      await upsertConnection.mutateAsync({
        id: form.id,
        provider: form.provider,
        label: form.label.trim(),
        accountId: form.accountId.trim() || null,
        accountLabel: form.accountLabel.trim() || null,
        status: form.status,
        scopes: normalizeList(form.scopes),
        credentialRefs,
        allowedApps: form.allApps ? [] : form.selectedApps,
      });
      toast.success(form.id ? "Connection updated" : "Connection created");
      setForm(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    }
  }

  async function applySetupWizard() {
    if (!setupForm) return;
    try {
      await applySetup.mutateAsync({
        connectionId: setupForm.connectionId,
        provider: setupForm.provider,
        label: setupForm.label.trim(),
        accountId: setupForm.accountId.trim() || null,
        accountLabel: setupForm.accountLabel.trim() || null,
        status: setupForm.status,
        scopes: normalizeList(setupForm.scopes),
        credentialRefs: normalizeCredentialRefs(
          setupForm.credentialRefs,
          providersById.get(setupForm.provider),
        ),
        grantMode: setupForm.grantMode,
        selectedApps: setupForm.selectedApps,
      });
      toast.success(
        setupForm.connectionId ? "Connection repaired" : "Connection created",
      );
      setSetupWizard(null);
      setSetupForm(null);
      setSetupFormKey("");
      queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY_KEY });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to apply setup",
      );
    }
  }

  async function toggleGrant(
    connection: WorkspaceConnection,
    appId: string,
    granted: boolean,
  ) {
    const previous =
      queryClient.getQueryData<WorkspaceConnectionsResponse>(
        CONNECTION_QUERY_KEY,
      );
    const knownAppIds = grantApps.map((app) => app.id);
    queryClient.setQueryData<WorkspaceConnectionsResponse>(
      CONNECTION_QUERY_KEY,
      (current) => {
        if (!current) return current;
        const existingGrant = current.grants.find(
          (grant) =>
            grant.connectionId === connection.id && grant.appId === appId,
        );
        return {
          ...current,
          connections: current.connections.map((item) =>
            item.id === connection.id
              ? {
                  ...item,
                  allowedApps: nextAllowedApps(
                    item,
                    appId,
                    granted,
                    knownAppIds,
                  ),
                }
              : item,
          ),
          grants: granted
            ? existingGrant
              ? current.grants
              : [
                  ...current.grants,
                  {
                    id: `${connection.id}:${appId}:optimistic`,
                    connectionId: connection.id,
                    provider: connection.provider,
                    appId,
                    access: "explicit-grant",
                  },
                ]
            : current.grants.filter(
                (grant) =>
                  !(
                    grant.connectionId === connection.id &&
                    (grant.appId === appId ||
                      (connection.allowedApps.length === 0 &&
                        grant.appId === "*"))
                  ),
              ),
        };
      },
    );
    try {
      await setGrant.mutateAsync({
        connectionId: connection.id,
        appId,
        granted,
        knownAppIds,
      });
      queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY_KEY });
      toast.success(granted ? "Grant added" : "Grant revoked");
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(CONNECTION_QUERY_KEY, previous);
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to update grant",
      );
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const previous =
      queryClient.getQueryData<WorkspaceConnectionsResponse>(
        CONNECTION_QUERY_KEY,
      );
    queryClient.setQueryData<WorkspaceConnectionsResponse>(
      CONNECTION_QUERY_KEY,
      (current) =>
        current
          ? {
              ...current,
              connections: current.connections.filter(
                (item) => item.id !== deleteTarget.id,
              ),
            }
          : current,
    );
    try {
      await deleteConnection.mutateAsync({ id: deleteTarget.id });
      toast.success("Connection deleted");
      setDeleteTarget(null);
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(CONNECTION_QUERY_KEY, previous);
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to delete connection",
      );
    }
  }

  const connectedCount = connections.filter(
    (connection) => connection.status === "connected",
  ).length;
  const attentionCount = connections.filter((connection) =>
    ["needs_reauth", "error", "disabled"].includes(connection.status),
  ).length;
  const connectionsMissingKeys = connections.filter(
    (connection) =>
      missingRequiredCredentialKeys(
        providersById.get(connection.provider),
        connection.credentialRefs,
      ).length,
  ).length;
  const usageTracked = connections.some(hasUsageTimestamp);
  const neverUsedCount = connections.filter(
    (connection) =>
      hasUsageTimestamp(connection) && connection.lastUsedAt == null,
  ).length;
  const mostRecentUsage = Math.max(
    ...connections
      .map(usageSortValue)
      .filter((value) => Number.isFinite(value) && value > 0),
  );

  return (
    <DispatchShell
      title="Integrations"
      description="Connect provider accounts once, then grant them to workspace apps."
    >
      <div className="space-y-6">
        <section
          className={cx(
            "grid gap-3 md:grid-cols-2",
            usageTracked ? "xl:grid-cols-5" : "xl:grid-cols-4",
          )}
        >
          <SummaryCard
            icon={IconCheck}
            label="Ready providers"
            value={`${data.counts.readyProviders ?? 0}/${providers.length}`}
            detail="Configured refs and healthy status"
          />
          <SummaryCard
            icon={IconPlugConnected}
            label="Connections"
            value={String(connections.length)}
            detail={`${connectedCount} connected`}
          />
          <SummaryCard
            icon={IconShieldCheck}
            label="App grants"
            value={String(data.grants.length)}
            detail={`${data.counts.allAppConnections ?? 0} all-app, ${
              data.counts.selectedAppConnections ?? 0
            } selected`}
          />
          <SummaryCard
            icon={IconKey}
            label="Key health"
            value={
              connectionsMissingKeys === 0
                ? "Healthy"
                : `${connectionsMissingKeys} missing`
            }
            detail={
              attentionCount
                ? `${attentionCount} connection${
                    attentionCount === 1 ? "" : "s"
                  } need attention`
                : "Required refs are present"
            }
          />
          {usageTracked ? (
            <SummaryCard
              icon={IconClock}
              label="Usage"
              value={
                Number.isFinite(mostRecentUsage)
                  ? formatTimestamp(new Date(mostRecentUsage).toISOString())
                  : "Never used"
              }
              detail={
                neverUsedCount
                  ? `${neverUsedCount} never used`
                  : "All tracked accounts have usage"
              }
            />
          ) : null}
        </section>

        <IntegrationOnboarding />

        {connectionsQuery.isLoading ? (
          <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
            Loading workspace integrations...
          </div>
        ) : null}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Provider catalog
              </h2>
              <p className="text-xs text-muted-foreground">
                {providers.length} providers available
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                connections={providerConnections.get(provider.id) ?? []}
                onCreate={() => openSetup(provider)}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Connected accounts
              </h2>
              <p className="text-xs text-muted-foreground">
                {connections.length === 0
                  ? "No shared connections yet"
                  : `${connections.length} saved connection${
                      connections.length === 1 ? "" : "s"
                    }`}
              </p>
            </div>
          </div>
          {connections.length === 0 && !connectionsQuery.isLoading ? (
            <div className="rounded-lg border border-dashed px-6 py-12 text-center">
              <IconPlugConnected
                size={24}
                className="mx-auto text-muted-foreground"
              />
              <p className="mt-3 text-sm font-medium text-foreground">
                No shared accounts yet.
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-muted-foreground">
                Pick a provider from the catalog above, save its credential ref
                names, then grant the shared account to Brain, Analytics, Mail,
                Dispatch, or another workspace app.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  provider={providersById.get(connection.provider)}
                  grantApps={grantApps}
                  grants={data.grants}
                  grantPending={setGrant.isPending}
                  onEdit={() => openEdit(connection)}
                  onRepair={() => openRepair(connection)}
                  onDelete={() => setDeleteTarget(connection)}
                  onToggleGrant={(appId, granted) =>
                    toggleGrant(connection, appId, granted)
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <SetupWizard
        open={!!setupWizard}
        state={setupWizard}
        step={setupStep}
        plan={setupPlanQuery.data}
        form={setupForm}
        providers={providers}
        grantApps={grantApps}
        loading={setupPlanQuery.isLoading}
        saving={applySetup.isPending}
        onStepChange={setSetupStep}
        onProviderChange={(providerId) => {
          setSetupWizard({ mode: "setup", providerId });
          setSetupStep(0);
          setSetupForm(null);
          setSetupFormKey("");
        }}
        onChange={setSetupForm}
        onClose={() => {
          setSetupWizard(null);
          setSetupForm(null);
          setSetupFormKey("");
        }}
        onSubmit={applySetupWizard}
      />
      <ConnectionForm
        open={!!form}
        form={form}
        providers={providers}
        grantApps={grantApps}
        saving={upsertConnection.isPending}
        onChange={setForm}
        onClose={() => setForm(null)}
        onSubmit={handleSubmit}
      />
      <DeleteConfirm
        connection={deleteTarget}
        deleting={deleteConnection.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </DispatchShell>
  );
}

function IntegrationOnboarding() {
  const steps: Array<{
    icon: IconComponent;
    title: string;
    detail: string;
  }> = [
    {
      icon: IconPlugConnected,
      title: "Connect once",
      detail:
        "Save safe account metadata and credential ref names in Dispatch.",
    },
    {
      icon: IconShieldCheck,
      title: "Grant apps",
      detail: "Let Brain, Analytics, Mail, or Dispatch reuse the account.",
    },
    {
      icon: IconDatabase,
      title: "Keep app setup local",
      detail: "Channels, repos, cursors, and sync rules stay with each app.",
    },
  ];

  return (
    <section className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] lg:items-center">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Connect once, grant to apps
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Dispatch owns shared provider accounts. Each app owns how it uses
            the account.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="flex min-w-0 gap-2">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <Icon size={14} className="text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">
                    {step.title}
                  </div>
                  <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
          <Icon size={16} className="text-muted-foreground" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
