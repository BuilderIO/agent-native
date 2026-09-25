import { TextField } from "@agent-native/toolkit/design-system";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
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
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconAlertCircle,
  IconApps,
  IconDots,
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
import { toast } from "sonner";

import { getTemplate } from "../../../../cli/templates-meta.js";
import { getRemoteAgentIdFromPath } from "../../../../resources/metadata.js";
import { HIDDEN_FIRST_PARTY_AGENT_IDS } from "../../../../shared/first-party-agents.js";
import { PromptComposer } from "../../../composer/index.js";
import { useT } from "../../../i18n.js";
import { useOrg, useSyncA2ASecret } from "../../../org/hooks.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import {
  EmptyRow,
  ReadOnlyNote,
  ResourceRowsSkeleton,
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
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={openDirectory}
        >
          <IconPlus className="size-3.5" />
          {t("agentChat.settingsSubAgents.connect")}
        </Button>
      ) : undefined,
    }),
    [canManage, openDirectory, t],
  );
  useSettingsPageHeader(header);

  const { apps, external } = useMemo(
    () => groupSubAgents(remote.agents, remote.probeById),
    [remote.agents, remote.probeById],
  );
  const probePending = remote.probeById === null && !remote.probeFailed;
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
        probePending={probePending}
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
        emptyText: t("agentChat.settingsSubAgents.customEmpty"),
        action: <AddCustomAgentMenu onCreated={openResource} />,
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
        empty={
          <EmptyRow
            icon={IconApps}
            text={t("agentChat.settingsSubAgents.appsEmpty")}
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
        empty={
          <EmptyRow
            icon={IconWorld}
            text={t("agentChat.settingsSubAgents.externalEmpty")}
            action={
              canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={openDirectory}
                >
                  {t("agentChat.settingsSubAgents.browseDirectory")}
                </Button>
              ) : undefined
            }
          />
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
        <DialogContent className="sm:max-w-md">
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
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("agentChat.settingsResources.removeTitle", {
                name: removing?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {orgName
                ? t("agentChat.settingsSubAgents.removeDescription", {
                    name: removing?.name ?? "",
                    org: orgName,
                  })
                : t("agentChat.settingsSubAgents.removeDescriptionSolo", {
                    name: removing?.name ?? "",
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("agentChat.settingsResources.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const agent = removing;
                setRemoving(null);
                if (!agent) return;
                void remote.remove(agent.id).then((removed) => {
                  if (!removed) {
                    toast.error(
                      t("agentChat.settingsResources.removeFailed", {
                        name: agent.name,
                      }),
                    );
                  }
                });
              }}
            >
              {t("agentChat.settingsResources.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SubAgentGroup({
  id,
  hidden,
  title,
  note,
  status,
  empty,
  children,
}: {
  id: string;
  hidden?: boolean;
  title: string;
  note?: ReactNode;
  status: "loading" | "ready" | "error";
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
          <EmptyRow
            icon={IconAlertCircle}
            text={t("agentChat.settingsSubAgents.loadFailed")}
            tone="error"
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
  probePending,
  actions,
}: {
  row: SubAgentRow;
  probe: AgentProbeResult | undefined;
  probePending: boolean;
  actions?: ReactNode;
}) {
  const t = useT();
  const label = probeLabel(t, probe);
  return (
    <div
      data-sub-agent-row={row.agentId}
      className="flex items-center gap-3 px-4 py-3"
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
          ) : probePending ? (
            <span
              aria-hidden
              className="h-3 w-14 shrink-0 animate-pulse rounded bg-muted"
            />
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={t("agentChat.settingsResources.moreActions")}
        >
          <IconDots className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
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
        className={state?.stage === "form" ? "sm:max-w-md" : "sm:max-w-lg"}
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
          <EmptyRow
            icon={IconSearch}
            text={t("agentChat.agents.directoryNoMatches")}
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
        <Button type="button" variant="outline" onClick={onClose}>
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
          {badge && (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              {badge}
            </span>
          )}
        </span>
        {hint && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 px-2.5 text-xs"
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
  onCreated,
}: {
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
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
          >
            <IconPlus className="size-3.5" />
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
        <DialogContent className="sm:max-w-lg">
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
  const create = useCreateResource();
  const tree = useResourceTree("personal");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setInstructions(CUSTOM_AGENT_BODY_TEMPLATE);
  }, [open]);

  const canSubmit =
    Boolean(name.trim() && description.trim() && instructions.trim()) &&
    !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const path = uniqueAgentPath(
      slugifyName(name.trim()),
      collectResourcePaths(tree.data ?? []),
    );
    create.mutate(
      {
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
      },
      {
        onSuccess: (resource) => {
          onOpenChange(false);
          onCreated(resource);
        },
        onError: () => {
          toast.error(
            t("agentChat.settingsResources.saveFailed", { name: path }),
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("agentChat.settingsSubAgents.addAgent")}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
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
          <div className="grid gap-1.5">
            <Label htmlFor={descriptionId}>
              {t("agentChat.settingsSubAgents.description")}
            </Label>
            <Input
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
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
          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("agentChat.settingsResources.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t("agentChat.settingsResources.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
