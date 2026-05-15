import {
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { DispatchShell } from "@agent-native/dispatch/components";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconBrain,
  IconBrandGithub,
  IconBrandSlack,
  IconBroadcast,
  IconBuilding,
  IconChartBar,
  IconCheck,
  IconCircleDashed,
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
  IconX,
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
  lastError: string | null;
}

interface SuggestedGrantApp {
  id: string;
  label: string;
}

interface WorkspaceConnectionsResponse {
  providers: WorkspaceConnectionProvider[];
  connections: WorkspaceConnection[];
  grants: Array<{
    id: string;
    connectionId: string;
    provider: string;
    appId: string;
    access: "all-apps" | "selected-app" | "explicit-grant";
  }>;
  suggestedApps: SuggestedGrantApp[];
  counts: {
    providers: number;
    connections: number;
    grants: number;
    readyProviders?: number;
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

const EMPTY_RESPONSE: WorkspaceConnectionsResponse = {
  providers: [],
  connections: [],
  grants: [],
  suggestedApps: [
    { id: "dispatch", label: "Dispatch" },
    { id: "brain", label: "Brain" },
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

function buttonClass(
  variant: "primary" | "secondary" | "ghost" | "danger" = "secondary",
) {
  return cx(
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    variant === "primary" &&
      "bg-primary text-primary-foreground hover:bg-primary/90",
    variant === "secondary" &&
      "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
    variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
    variant === "danger" &&
      "border border-red-500/20 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-400",
  );
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

function defaultForm(
  provider: WorkspaceConnectionProvider,
  grantApps: GrantApp[],
): ConnectionFormState {
  const recommended = provider.recommendedTemplateUses.filter((appId) =>
    grantApps.some((app) => app.id === appId),
  );
  const selectedApps = Array.from(new Set(["dispatch", ...recommended]));
  return {
    provider: provider.id,
    label: provider.label,
    accountId: "",
    accountLabel: "",
    status: "connected",
    scopes: "",
    credentialRefs: credentialRefsForProvider(provider),
    allApps: false,
    selectedApps,
  };
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
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={onCreate}
        >
          <IconPlus size={14} />
          Connect
        </button>
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
  onDelete,
  onToggleGrant,
  grantPending,
}: {
  connection: WorkspaceConnection;
  provider?: WorkspaceConnectionProvider;
  grantApps: GrantApp[];
  grants: WorkspaceConnectionsResponse["grants"];
  onEdit: () => void;
  onDelete: () => void;
  onToggleGrant: (appId: string, granted: boolean) => void;
  grantPending: boolean;
}) {
  const Icon = iconForProvider(connection.provider);
  const missingKeys = missingRequiredCredentialKeys(
    provider,
    connection.credentialRefs,
  );
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
              <button
                type="button"
                className={buttonClass("ghost")}
                onClick={onEdit}
              >
                <IconEdit size={14} />
                Edit
              </button>
              <button
                type="button"
                className={buttonClass("danger")}
                onClick={onDelete}
              >
                <IconTrash size={14} />
                Delete
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
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
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              App grants
            </h3>
            {connection.allowedApps.length === 0 ? (
              <Pill className="border-border bg-muted text-muted-foreground">
                All apps
              </Pill>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {grantApps.map((app) => {
              const AppIcon = app.icon;
              const granted = appIsGranted(connection, app.id, grants);
              return (
                <button
                  key={app.id}
                  type="button"
                  aria-pressed={granted}
                  disabled={grantPending}
                  onClick={() => onToggleGrant(app.id, !granted)}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    granted
                      ? "border-foreground/15 bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <AppIcon size={13} />
                  {app.label}
                </button>
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
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-connection-dialog-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div>
            <h2
              id="workspace-connection-dialog-title"
              className="text-base font-semibold text-foreground"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={buttonClass("ghost")}
            onClick={onClose}
            aria-label="Close"
          >
            <IconX size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
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
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Provider</span>
              <select
                value={form.provider}
                onChange={(event) => {
                  const nextProvider = providers.find(
                    (item) => item.id === event.target.value,
                  );
                  onChange({
                    ...form,
                    provider: event.target.value,
                    label:
                      form.label || nextProvider?.label || event.target.value,
                    credentialRefs: nextProvider
                      ? credentialRefsForProvider(nextProvider)
                      : form.credentialRefs,
                  });
                }}
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Status</span>
              <select
                value={form.status}
                onChange={(event) =>
                  onChange({
                    ...form,
                    status: event.target.value as WorkspaceConnectionStatus,
                  })
                }
                className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
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
                <div className="text-sm font-medium">All workspace apps</div>
                <div className="text-xs text-muted-foreground">
                  Selected grants
                </div>
              </div>
              <button
                type="button"
                aria-pressed={form.allApps}
                onClick={() => onChange({ ...form, allApps: !form.allApps })}
                className={cx(
                  "relative h-6 w-11 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  form.allApps ? "bg-foreground" : "bg-muted",
                )}
              >
                <span
                  className={cx(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition",
                    form.allApps ? "left-5" : "left-0.5",
                  )}
                />
              </button>
            </div>
            {!form.allApps ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {grantApps.map((app) => {
                  const AppIcon = app.icon;
                  const selected = form.selectedApps.includes(app.id);
                  return (
                    <button
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
                      className={cx(
                        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected
                          ? "border-foreground/15 bg-foreground text-background"
                          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <AppIcon size={13} />
                      {app.label}
                    </button>
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
        <div className="flex items-center justify-end gap-2 border-t p-4">
          <button
            type="button"
            className={buttonClass("secondary")}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={buttonClass("primary")}
            disabled={saving || !form.label.trim()}
          >
            {saving ? <IconRefresh size={14} className="animate-spin" /> : null}
            Save connection
          </button>
        </div>
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
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
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
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={() => onChange(appendCredentialRef(refs, provider))}
        >
          <IconPlus size={14} />
          Add ref
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        {rows.map((ref, index) => {
          const credential = providerKeys.get(ref.key);
          return (
            <div
              key={`${index}:${ref.provider ?? provider?.id ?? "provider"}`}
              className="grid gap-2 rounded-md border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            >
              <label className="grid min-w-0 gap-1.5 text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  Ref name
                  {credential?.required ? (
                    <Pill className="h-5 border-border bg-muted px-1.5 text-[11px]">
                      Required
                    </Pill>
                  ) : null}
                </span>
                <input
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
                  className="h-9 rounded-md border bg-card px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {credential?.description ? (
                  <span className="text-xs leading-5 text-muted-foreground">
                    {credential.description}
                  </span>
                ) : null}
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Scope</span>
                <select
                  value={ref.scope ?? "org"}
                  onChange={(event) =>
                    onChange(
                      upsertCredentialRefAt(rows, index, {
                        scope: event.target
                          .value as WorkspaceConnectionCredentialRef["scope"],
                      }),
                    )
                  }
                  className="h-9 rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="org">Org</option>
                  <option value="workspace">Workspace</option>
                  <option value="user">User</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className={buttonClass("ghost")}
                  onClick={() =>
                    onChange(rows.filter((_, itemIndex) => itemIndex !== index))
                  }
                  aria-label={`Remove ${ref.key || "credential ref"}`}
                >
                  <IconTrash size={14} />
                </button>
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
  return (
    <Modal
      open={!!connection}
      onClose={onClose}
      title="Delete connection"
      description={connection?.label}
    >
      <div className="p-4">
        <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          This removes the shared connection and its app grants.
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t p-4">
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={onClose}
          disabled={deleting}
        >
          Cancel
        </button>
        <button
          type="button"
          className={buttonClass("danger")}
          onClick={onConfirm}
          disabled={deleting}
        >
          {deleting ? <IconRefresh size={14} className="animate-spin" /> : null}
          Delete
        </button>
      </div>
    </Modal>
  );
}

export default function WorkspaceIntegrationsRoute() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ConnectionFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceConnection | null>(
    null,
  );

  const connectionsQuery = useActionQuery<WorkspaceConnectionsResponse>(
    "list-workspace-connections",
    CONNECTION_QUERY_PARAMS,
  );
  const appsQuery = useActionQuery<WorkspaceAppSummary[]>(
    "list-workspace-apps",
    {
      includeAgentCards: false,
      audience: "all",
    },
  );

  const data = connectionsQuery.data ?? EMPTY_RESPONSE;
  const providers = data.providers;
  const connections = data.connections;
  const apps = appsQuery.data ?? [];
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  const grantApps = useMemo<GrantApp[]>(() => {
    const map = new Map<string, GrantApp>();
    for (const app of data.suggestedApps) {
      map.set(app.id, {
        id: app.id,
        label: app.label,
        icon: iconForApp(app.id),
      });
    }
    for (const app of apps) {
      if (app.archived || app.status === "pending") continue;
      map.set(app.id, {
        id: app.id,
        label: app.name || humanizeAppId(app.id),
        icon: iconForApp(app.id),
      });
    }
    return Array.from(map.values());
  }, [apps, data.suggestedApps]);

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
  const setGrant = useActionMutation("set-workspace-connection-grant");
  const deleteConnection = useActionMutation("delete-workspace-connection");

  function openCreate(provider: WorkspaceConnectionProvider) {
    setForm(defaultForm(provider, grantApps));
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

  return (
    <DispatchShell
      title="Integrations"
      description="Shared provider connections and app-level grants for the workspace."
    >
      <div className="space-y-6">
        <section className="grid gap-3 md:grid-cols-4">
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
            detail={`${grantApps.length} apps tracked`}
          />
          <SummaryCard
            icon={IconAlertTriangle}
            label="Needs attention"
            value={String(attentionCount)}
            detail="Reauth, disabled, or error"
          />
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
                onCreate={() => openCreate(provider)}
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
                No shared connections yet.
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
        "Save provider metadata and vault ref names in one workspace place.",
    },
    {
      icon: IconShieldCheck,
      title: "Grant apps",
      detail:
        "Enable Brain, Analytics, Mail, or Dispatch without copying secrets.",
    },
    {
      icon: IconDatabase,
      title: "Configure locally",
      detail:
        "Each app keeps its own channels, repos, cursors, and sync rules.",
    },
  ];

  return (
    <section className="rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] lg:items-center">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Connect once, use everywhere
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Shared connections keep provider setup in Dispatch while each app
            owns its source-specific choices.
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
