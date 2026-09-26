import { TextField } from "@agent-native/toolkit/design-system";
import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconAlertCircle,
  IconApps,
  IconExternalLink,
  IconLink,
  IconMessage,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTopologyRing2,
  IconTrash,
  IconUserBolt,
  IconWorld,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getTemplate } from "../../../../cli/templates-meta.js";
import { getRemoteAgentIdFromPath } from "../../../../resources/metadata.js";
import { HIDDEN_FIRST_PARTY_AGENT_IDS } from "../../../../shared/first-party-agents.js";
import { PromptComposer } from "../../../composer/index.js";
import { useT } from "../../../i18n.js";
import { useOrg, useSyncA2ASecret } from "../../../org/hooks.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import {
  ErrorRow,
  ReadOnlyNote,
  ResourceRowsSkeleton,
  RowMenuTrigger,
  SettingsEmpty,
} from "../../../resources/ResourceSettingsGroups.js";
import {
  buildAgentResourceContent,
  CUSTOM_AGENT_BODY_TEMPLATE,
  requestCustomAgentFromAgent,
  slugifyName,
} from "../../../resources/ResourcesPanel.js";
import {
  useCreateResource,
  useResourceTree,
  type ResourceMeta,
  type TreeNode,
} from "../../../resources/use-resources.js";
import { cn } from "../../../utils.js";
import {
  A2A_REGISTRY_URL,
  useAgentDirectoryProviders,
  type AgentDirectoryProvider,
} from "../../AgentDirectorySection.js";
import {
  AgentAddForm,
  AgentEditForm,
  canManageSharedAgents,
  probeStatus,
  readAgentConnectRequest,
  stripAgentConnectParams,
  useRemoteAgents,
  type AgentConnectRequest,
  type AgentProbeResult,
  type HostedAgentProvider,
  type RemoteAgentInfo,
} from "../../AgentsSection.js";
import { useSettingsPageHeader } from "../context.js";
import {
  ResourceSettingsPage,
  useOpenResourceRef,
  type AddActionPlacement,
} from "./resource-settings-page.js";

/** Group ids double as anchors for search hits and legacy links. */
export const SUB_AGENT_GROUP_IDS = {
  apps: "workspace-apps",
  external: "external-agents",
  custom: "custom-agents",
} as const;

/** One row of the {Org} apps or External agents group. */
export interface SubAgentRow {
  /** Lowercase agent id, the key the batched probe answers with. */
  agentId: string;
  name: string;
  url: string;
  /** The manifest behind the row; absent for apps only discovery knows. */
  agent?: RemoteAgentInfo;
}

/**
 * First-party templates are the workspace's apps. Discovery skips hidden and
 * removed first-party ids, so a stale manifest for one is not a sub-agent and
 * is not listed.
 */
function classifyAgentId(agentId: string): "app" | "external" | "hidden" {
  if (HIDDEN_FIRST_PARTY_AGENT_IDS.has(agentId)) return "hidden";
  return getTemplate(agentId) ? "app" : "external";
}

/**
 * Splits the registered agents into the workspace's apps and external
 * agents, one row per agent id. Apps that only discovery knows (sibling
 * workspace apps, which have no manifest) come from the batched probe.
 */
export function groupSubAgents(
  agents: readonly RemoteAgentInfo[],
  probeById: ReadonlyMap<string, AgentProbeResult> | null,
): { apps: SubAgentRow[]; external: SubAgentRow[] } {
  const apps: SubAgentRow[] = [];
  const external: SubAgentRow[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    const agentId = getRemoteAgentIdFromPath(agent.path).toLowerCase();
    if (seen.has(agentId)) continue;
    seen.add(agentId);
    const kind = classifyAgentId(agentId);
    if (kind === "hidden") continue;
    const row = {
      agentId,
      name: agent.name,
      url: agent.cardUrl || agent.url,
      agent,
    };
    (kind === "app" ? apps : external).push(row);
  }
  for (const [agentId, result] of probeById ?? []) {
    if (seen.has(agentId) || classifyAgentId(agentId) === "hidden") continue;
    seen.add(agentId);
    apps.push({
      agentId,
      name: getTemplate(agentId)?.label ?? result.name ?? agentId,
      url: result.url,
    });
  }
  const byName = (a: SubAgentRow, b: SubAgentRow) =>
    a.name.localeCompare(b.name);
  return { apps: apps.sort(byName), external: external.sort(byName) };
}

type ConnectDialogState =
  | { stage: "directory" }
  | {
      stage: "form";
      title: string;
      provider?: HostedAgentProvider;
      prefill?: AgentConnectRequest["prefill"];
    };

export default function SubAgentsSettingsPage() {
  const t = useT();
  const orgQuery = useOrg();
  const canManage = canManageSharedAgents(orgQuery);
  const orgName = orgQuery.data?.orgName ?? null;
  const syncSecret = useSyncA2ASecret();
  const remote = useRemoteAgents();
  const { ref: openResourceRef, open: openResource } = useOpenResourceRef();
  const [connect, setConnect] = useState<ConnectDialogState | null>(null);
  const [editing, setEditing] = useState<RemoteAgentInfo | null>(null);
  const [removing, setRemoving] = useState<RemoteAgentInfo | null>(null);
  const [deepLink, setDeepLink] = useState<AgentConnectRequest | null>(null);
  // A custom agent opens in the panel's editor; the agent lists yield to it.
  const [editingCustom, setEditingCustom] = useState(false);

  // The shell rewrites a legacy link keeping its query, so the params stay
  // until the form closes.
  useEffect(() => setDeepLink(readAgentConnectRequest({ strip: false })), []);
  // Only owners and admins get the form; the role is known once the org loads.
  useEffect(() => {
    if (!deepLink || !canManage) return;
    setConnect({
      stage: "form",
      title:
        deepLink.provider === "anthropic-managed-agents"
          ? t("agentChat.agents.directoryAnthropic")
          : t("agentChat.settingsSubAgents.anyAgent"),
      provider: deepLink.provider,
      prefill: deepLink.prefill,
    });
    setDeepLink(null);
  }, [canManage, deepLink, t]);

  const openDirectory = useCallback(
    () => setConnect({ stage: "directory" }),
    [],
  );
  const header = useMemo(
    () => ({
      action: canManage ? (
        <ConnectAgentButton onClick={openDirectory} />
      ) : undefined,
    }),
    [canManage, openDirectory],
  );
  useSettingsPageHeader(header);

  const { apps, external } = useMemo(
    () => groupSubAgents(remote.agents, remote.probeById),
    [remote.agents, remote.probeById],
  );
  const managedNote = canManage ? undefined : (
    <ReadOnlyNote
      label={t("agentChat.settingsSubAgents.managedByAdmins")}
      hint={t("agentChat.settingsResources.readOnlyHint")}
    />
  );

  const rowsFor = (rows: SubAgentRow[], removable: boolean) =>
    rows.map((row) => (
      <SubAgentListRow
        key={row.agentId}
        row={row}
        probe={remote.probeById?.get(row.agentId)}
        actions={
          canManage && row.agent ? (
            <SubAgentRowMenu
              onEdit={() => setEditing(row.agent ?? null)}
              onRemove={
                removable ? () => setRemoving(row.agent ?? null) : undefined
              }
            />
          ) : undefined
        }
      />
    ));

  const customGroups = useMemo<ResourceSettingsGroupConfig[]>(
    () => [
      {
        id: SUB_AGENT_GROUP_IDS.custom,
        view: "agents",
        sources: ["personal", "shared"],
        title: t("agentChat.settingsSubAgents.custom"),
        emptyIcon: IconUserBolt,
        emptyTitle: t("agentChat.settingsSubAgents.customEmptyTitle"),
        emptyDescription: t("agentChat.settingsSubAgents.customEmpty"),
        emptyAction: (
          <AddCustomAgentMenu placement="empty" onCreated={openResource} />
        ),
        action: (
          <AddCustomAgentMenu placement="group" onCreated={openResource} />
        ),
      },
    ],
    [openResource, t],
  );

  return (
    <div className="flex flex-col gap-8">
      <SubAgentGroup
        id={SUB_AGENT_GROUP_IDS.apps}
        hidden={editingCustom}
        title={
          orgName
            ? t("agentChat.settingsSubAgents.orgApps", { org: orgName })
            : t("agentChat.settingsSubAgents.workspaceApps")
        }
        note={managedNote}
        status={remote.status}
        onRetry={remote.retry}
        empty={
          <SettingsEmpty
            icon={IconApps}
            title={t("agentChat.settingsSubAgents.appsEmpty")}
          />
        }
      >
        {apps.length > 0 ? rowsFor(apps, false) : null}
      </SubAgentGroup>
      <SubAgentGroup
        id={SUB_AGENT_GROUP_IDS.external}
        hidden={editingCustom}
        title={t("agentChat.settingsSubAgents.external")}
        note={managedNote}
        status={remote.status}
        onRetry={remote.retry}
        empty={
          <SettingsEmpty
            icon={IconWorld}
            title={t("agentChat.settingsSubAgents.externalEmptyTitle")}
            description={t("agentChat.settingsSubAgents.externalEmpty")}
          >
            {canManage ? <ConnectAgentButton onClick={openDirectory} /> : null}
          </SettingsEmpty>
        }
      >
        {external.length > 0 ? rowsFor(external, true) : null}
      </SubAgentGroup>
      <ResourceSettingsPage
        view="agents"
        groups={customGroups}
        openResourceRef={openResourceRef}
        onEditingChange={setEditingCustom}
      />

      <ConnectAgentDialog
        state={connect}
        onStateChange={(next) => {
          if (!next) stripAgentConnectParams();
          setConnect(next);
        }}
        remote={remote}
        secretSet={orgQuery.data?.a2aSecretSet}
        syncSecret={syncSecret}
      />
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {t("agentChat.settingsSubAgents.editTitle", {
                name: editing?.name ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <AgentEditForm
              key={editing.id}
              variant="dialog"
              agent={editing}
              credentialOptions={remote.credentialOptions}
              onSave={async (agent) => {
                await remote.save(agent);
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <RemoveAgentDialog
        agent={removing}
        orgName={orgName}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        onRemove={remote.remove}
      />
    </div>
  );
}

/** The page's one action, also the External agents empty state's. */
function ConnectAgentButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <Button type="button" size="sm" onClick={onClick}>
      <IconPlus />
      {t("agentChat.settingsSubAgents.connect")}
    </Button>
  );
}

function RemoveAgentDialog({
  agent,
  orgName,
  onOpenChange,
  onRemove,
}: {
  agent: RemoteAgentInfo | null;
  orgName: string | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves false when the delete failed. */
  onRemove: (resourceId: string) => Promise<boolean>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = agent?.name ?? "";

  useEffect(() => setFailed(false), [agent?.id]);

  const remove = async () => {
    if (!agent || pending) return;
    setPending(true);
    setFailed(false);
    const removed = await onRemove(agent.id);
    setPending(false);
    if (removed) onOpenChange(false);
    else setFailed(true);
  };

  return (
    <AlertDialog open={agent !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("agentChat.settingsResources.removeTitle", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {orgName
              ? t("agentChat.settingsSubAgents.removeDescription", {
                  name,
                  org: orgName,
                })
              : t("agentChat.settingsSubAgents.removeDescriptionSolo", {
                  name,
                })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertDescription>
              {t("agentChat.settingsResources.removeFailed", { name })}
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t("agentChat.settingsResources.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending ? <Spinner /> : null}
            {pending
              ? t("agentChat.settingsResources.removing")
              : t("agentChat.settingsResources.remove")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SubAgentGroup({
  id,
  hidden,
  title,
  note,
  status,
  onRetry,
  empty,
  children,
}: {
  id: string;
  hidden?: boolean;
  title: string;
  note?: ReactNode;
  status: "loading" | "ready" | "error";
  onRetry: () => void;
  empty: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section
      id={id}
      hidden={hidden}
      data-sub-agent-group={id}
      className="scroll-mt-16"
    >
      <header className="mb-2.5 flex min-h-7 items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {note}
      </header>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
        {status === "loading" ? (
          <ResourceRowsSkeleton />
        ) : status === "error" ? (
          <ErrorRow
            text={t("agentChat.settingsSubAgents.loadFailed")}
            onRetry={onRetry}
          />
        ) : children ? (
          <div className="divide-y divide-border/60">{children}</div>
        ) : (
          empty
        )}
      </div>
    </section>
  );
}

function probeLabel(
  t: ReturnType<typeof useT>,
  probe: AgentProbeResult | undefined,
): { text: string; warn: boolean } | null {
  if (!probe) return null;
  if (!probe.reachable) {
    return {
      text: t("agentChat.settingsSubAgents.statusUnreachable"),
      warn: true,
    };
  }
  const status = probeStatus(probe);
  if (status === "auth-rejected") {
    return { text: t("agentChat.agents.statusAuthRejected"), warn: true };
  }
  if (status === "no-json-rpc") {
    return { text: t("agentChat.agents.statusNoJsonRpc"), warn: true };
  }
  return { text: t("agentChat.agents.statusReachable"), warn: false };
}

function SubAgentListRow({
  row,
  probe,
  actions,
}: {
  row: SubAgentRow;
  probe: AgentProbeResult | undefined;
  actions?: ReactNode;
}) {
  const t = useT();
  const label = probeLabel(t, probe);
  return (
    <div
      data-sub-agent-row={row.agentId}
      className="flex items-center gap-3 px-5 py-4 sm:px-6"
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-xs font-semibold text-muted-foreground"
      >
        {row.name.trim().charAt(0).toUpperCase() || (
          <IconTopologyRing2 className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {row.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {label ? (
            <>
              <span
                className={cn(
                  "shrink-0",
                  label.warn && "text-amber-600 dark:text-amber-400",
                )}
              >
                {label.text}
              </span>
              <span aria-hidden className="shrink-0">
                ·
              </span>
            </>
          ) : null}
          <span className="truncate font-mono">{row.url}</span>
        </span>
      </span>
      {actions}
    </div>
  );
}

function SubAgentRowMenu({
  onEdit,
  onRemove,
}: {
  onEdit: () => void;
  onRemove?: () => void;
}) {
  const t = useT();
  return (
    <RowMenuTrigger>
      <DropdownMenuItem onSelect={onEdit}>
        <IconPencil className="size-4" />
        {t("agentChat.settingsSubAgents.edit")}
      </DropdownMenuItem>
      {onRemove && (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onRemove}
        >
          <IconTrash className="size-4" />
          {t("agentChat.settingsResources.remove")}
        </DropdownMenuItem>
      )}
    </RowMenuTrigger>
  );
}

function ConnectAgentDialog({
  state,
  onStateChange,
  remote,
  secretSet,
  syncSecret,
}: {
  state: ConnectDialogState | null;
  onStateChange: (state: ConnectDialogState | null) => void;
  remote: ReturnType<typeof useRemoteAgents>;
  secretSet: boolean | undefined;
  syncSecret: ReturnType<typeof useSyncA2ASecret>;
}) {
  const t = useT();
  const close = () => onStateChange(null);
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={state?.stage === "form" ? "sm:max-w-md" : undefined}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {state?.stage === "form"
              ? state.title
              : t("agentChat.settingsSubAgents.directoryTitle")}
          </DialogTitle>
        </DialogHeader>
        {state?.stage === "form" ? (
          <AgentAddForm
            variant="dialog"
            initialName={state.prefill?.name}
            initialUrl={state.prefill?.url}
            initialDescription={state.prefill?.description}
            initialProvider={state.provider}
            credentialOptions={remote.credentialOptions}
            secretSet={secretSet}
            syncSecret={syncSecret}
            onAdd={remote.add}
            onClose={close}
          />
        ) : state ? (
          <AgentDirectory
            onConnect={(provider) =>
              onStateChange({
                stage: "form",
                title: t("agentChat.settingsSubAgents.connectTitle", {
                  name: t(provider.nameKey),
                }),
                provider: provider.provider,
              })
            }
            onAddByUrl={() =>
              onStateChange({
                stage: "form",
                title: t("agentChat.settingsSubAgents.anyAgent"),
              })
            }
            onClose={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AgentDirectory({
  onConnect,
  onAddByUrl,
  onClose,
}: {
  onConnect: (provider: AgentDirectoryProvider) => void;
  onAddByUrl: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const providers = useAgentDirectoryProviders(query);
  const normalized = query.trim().toLowerCase();
  const showAnyAgent =
    !normalized ||
    [
      t("agentChat.settingsSubAgents.anyAgent"),
      t("agentChat.settingsSubAgents.anyAgentHint"),
      t("agentChat.agents.directoryManual"),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized);

  return (
    <div className="grid gap-3">
      <TextField
        value={query}
        onChange={setQuery}
        aria-label={t("agentChat.agents.directorySearch")}
        placeholder={t("agentChat.agents.directorySearch")}
        leadingContent={<IconSearch size={15} />}
      />
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        {providers.length > 0 || showAnyAgent ? (
          <div className="divide-y divide-border/60">
            {providers.map((provider) => (
              <DirectoryRow
                key={provider.id}
                icon={
                  <span className="text-xs font-semibold">
                    {t(provider.nameKey).charAt(0)}
                  </span>
                }
                name={t(provider.nameKey)}
                badge={t(provider.protocolKey)}
                hint={t(provider.hintKey)}
                actionLabel={t("agentChat.common.connect")}
                onAction={() => onConnect(provider)}
              />
            ))}
            {showAnyAgent && (
              <DirectoryRow
                icon={<IconLink className="size-4" />}
                name={t("agentChat.settingsSubAgents.anyAgent")}
                hint={t("agentChat.settingsSubAgents.anyAgentHint")}
                actionLabel={t("agentChat.agents.directoryManual")}
                onAction={onAddByUrl}
              />
            )}
          </div>
        ) : (
          <SettingsEmpty
            icon={IconSearch}
            title={t("agentChat.agents.directoryNoMatches")}
          />
        )}
      </div>
      <a
        href={A2A_REGISTRY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {t("agentChat.settingsSubAgents.registryLink")}
        <IconExternalLink className="size-3.5" />
      </a>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("agentChat.settingsSubAgents.close")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function DirectoryRow({
  icon,
  name,
  badge,
  hint,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  name: string;
  badge?: string;
  hint?: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {badge && <Badge variant="outline">{badge}</Badge>}
        </span>
        {hint && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

function collectResourcePaths(
  nodes: readonly TreeNode[],
  into = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    into.add(node.path.toLowerCase());
    if (node.children) collectResourcePaths(node.children, into);
  }
  return into;
}

function uniqueAgentPath(slug: string, taken: ReadonlySet<string>): string {
  let path = `agents/${slug}.md`;
  for (let n = 2; taken.has(path.toLowerCase()); n += 1) {
    path = `agents/${slug}-${n}.md`;
  }
  return path;
}

/** Custom agents "Add agent": describe it to the agent, or write it. */
function AddCustomAgentMenu({
  placement,
  onCreated,
}: {
  placement: Exclude<AddActionPlacement, "header">;
  onCreated: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const [describing, setDescribing] = useState(false);
  const [writing, setWriting] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={placement === "group" ? "secondary" : "default"}
            size={placement === "group" ? "xs" : "sm"}
          >
            <IconPlus />
            {t("agentChat.settingsSubAgents.addAgent")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDescribing(true)}>
            <IconMessage className="size-4" />
            {t("agentChat.settingsSubAgents.describe")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setWriting(true)}>
            <IconPencil className="size-4" />
            {t("agentChat.settingsSubAgents.write")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={describing} onOpenChange={setDescribing}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {t("agentChat.settingsSubAgents.describe")}
            </DialogTitle>
          </DialogHeader>
          <PromptComposer
            autoFocus
            placeholder={t("agentChat.settingsSubAgents.describePlaceholder")}
            draftScope="settings:create-agent"
            onSubmit={(text) => {
              requestCustomAgentFromAgent(text, "personal");
              setDescribing(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <WriteCustomAgentDialog
        open={writing}
        onOpenChange={setWriting}
        onCreated={onCreated}
      />
    </>
  );
}

function WriteCustomAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const nameId = useId();
  const descriptionId = useId();
  const instructionsId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState(CUSTOM_AGENT_BODY_TEMPLATE);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const create = useCreateResource();
  const tree = useResourceTree("personal");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setInstructions(CUSTOM_AGENT_BODY_TEMPLATE);
    setFailedPath(null);
  }, [open]);

  const valid = Boolean(
    name.trim() && description.trim() && instructions.trim(),
  );

  const submit = async () => {
    if (!valid || create.isPending) return;
    const path = uniqueAgentPath(
      slugifyName(name.trim()),
      collectResourcePaths(tree.data ?? []),
    );
    setFailedPath(null);
    try {
      const resource = await create.mutateAsync({
        path,
        content: buildAgentResourceContent({
          name: name.trim(),
          description: description.trim(),
          model: "inherit",
          tools: "inherit",
          body: instructions,
        }),
        mimeType: "text/markdown",
        shared: false,
      });
      onOpenChange(false);
      onCreated(resource);
    } catch {
      setFailedPath(path);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("agentChat.settingsSubAgents.addAgent")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={nameId}>
              {t("agentChat.settingsSubAgents.name")}
            </Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={descriptionId}>
              {t("agentChat.settingsSubAgents.description")}
            </Label>
            <Input
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={instructionsId}>
              {t("agentChat.settingsSubAgents.instructions")}
            </Label>
            <Textarea
              id={instructionsId}
              rows={8}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          {failedPath ? (
            <Alert variant="destructive">
              <IconAlertCircle />
              <AlertDescription>
                {t("agentChat.settingsResources.saveFailed", {
                  name: failedPath,
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t("agentChat.settingsResources.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? <Spinner /> : null}
              {create.isPending
                ? t("agentChat.settingsResources.creating")
                : t("agentChat.settingsResources.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
