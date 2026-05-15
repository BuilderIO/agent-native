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

interface WorkspaceConnectionProvider {
  id: string;
  label: string;
  description: string;
  credentialKeys: WorkspaceConnectionCredentialKey[];
  capabilities: string[];
  recommendedTemplateUses: string[];
}

interface WorkspaceConnectionCredentialRef {
  key: string;
  scope?: "user" | "org";
  provider?: string;
  label?: string;
  [key: string]: unknown;
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
  credentialRefs: string;
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

function parseCredentialRefs(
  value: string,
): WorkspaceConnectionCredentialRef[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("Credential refs must be a JSON array.");
  }
  return parsed as WorkspaceConnectionCredentialRef[];
}

function credentialRefsText(refs: WorkspaceConnectionCredentialRef[]) {
  return refs.length > 0 ? JSON.stringify(refs, null, 2) : "";
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
    credentialRefs:
      provider.credentialKeys.length > 0
        ? JSON.stringify(
            provider.credentialKeys.map((credential) => ({
              key: credential.key,
              label: credential.label,
              provider: provider.id,
              scope: "org",
            })),
            null,
            2,
          )
        : "",
    allApps: false,
    selectedApps,
  };
}

function formFromConnection(
  connection: WorkspaceConnection,
): ConnectionFormState {
  return {
    id: connection.id,
    provider: connection.provider,
    label: connection.label,
    accountId: connection.accountId ?? "",
    accountLabel: connection.accountLabel ?? "",
    status: connection.status,
    scopes: connection.scopes.join(", "),
    credentialRefs: credentialRefsText(connection.credentialRefs),
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
  return (
    <article className="flex min-h-[220px] flex-col justify-between rounded-lg border bg-card p-4 shadow-sm">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
            <Icon size={18} className="text-muted-foreground" />
          </div>
          <Pill
            className={
              active.length > 0
                ? "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400"
                : "border-border bg-muted text-muted-foreground"
            }
          >
            {active.length > 0 ? (
              <IconCheck size={12} />
            ) : (
              <IconCircleDashed size={12} />
            )}
            {active.length > 0 ? `${active.length} connected` : "Available"}
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
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <span className="text-xs text-muted-foreground">
          {provider.credentialKeys.length === 0
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
              value={String(connection.credentialRefs.length)}
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

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Credential refs JSON</span>
            <textarea
              value={form.credentialRefs}
              onChange={(event) =>
                onChange({ ...form, credentialRefs: event.target.value })
              }
              rows={6}
              spellCheck={false}
              className="min-h-32 rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
              placeholder='[{"key":"SLACK_BOT_TOKEN","scope":"org"}]'
            />
          </label>
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
    setForm(formFromConnection(connection));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    try {
      const credentialRefs = parseCredentialRefs(form.credentialRefs);
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
        <section className="grid gap-3 md:grid-cols-3">
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
