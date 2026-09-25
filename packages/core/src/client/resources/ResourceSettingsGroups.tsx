import { Skeleton } from "@agent-native/toolkit/design-system";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  IconAlertCircle,
  IconApps,
  IconArrowUpRight,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconLock,
  IconTrash,
  type Icon,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useOrgSwitcherAppLinks } from "../org/workspace-app-links.js";
import { cn } from "../utils.js";
import { filterResourceTree, type ResourceView } from "./resource-views.js";
import {
  getCollectionDescriptor,
  getFileIcon,
  getLeafResources,
  type LeafResourceNode,
} from "./ResourceTree.js";
import {
  resourceDownloadUrl,
  type ResourceMeta,
  type TreeNode,
} from "./use-resources.js";

export type ResourceGroupSource = "personal" | "shared" | "workspace";

/** One group on a Settings resource page (Personal, {Org}, From Dispatch). */
export interface ResourceSettingsGroupConfig {
  /** Anchor id, so search hits and links can scroll to the group. */
  id: string;
  view: ResourceView;
  /** Scopes whose rows this group lists; more than one tags each row. */
  sources: readonly ResourceGroupSource[];
  /** Defaults to Personal, the organization name, or From Dispatch. */
  title?: string;
  emptyIcon: Icon;
  emptyText: string;
  /** Shown in the empty row, for viewers who can write to the group. */
  emptyAction?: ReactNode;
  /** Shown at the right of the group heading. */
  action?: ReactNode;
}

export interface ResourceSourceTree {
  nodes: TreeNode[];
  isLoading: boolean;
  isError: boolean;
}

const DISPATCH_RESOURCE_METADATA_SOURCE = "dispatch-workspace-resource";
const LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE = "local-workspace-resource";

function metadataSource(resource: ResourceMeta): string | null {
  if (!resource.metadata) return null;
  try {
    const parsed = JSON.parse(resource.metadata) as { source?: unknown };
    return typeof parsed.source === "string" ? parsed.source : null;
  } catch {
    // coercion-ok: unparseable metadata only drops the Dispatch chip; the
    // row stays read-only because only local workspace rows are writable.
    return null;
  }
}

export function isResourceRowReadOnly(
  source: ResourceGroupSource,
  resource: ResourceMeta,
  canEditOrg: boolean,
): boolean {
  if (source === "personal") return false;
  if (source === "shared") return !canEditOrg;
  return metadataSource(resource) !== LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE;
}

// The download route decodes anything else as base64, and uploads keep only a
// storage URL, so only text rows get a download item.
function isTextResource(resource: ResourceMeta): boolean {
  return (
    resource.mimeType.startsWith("text/") ||
    resource.mimeType === "application/json"
  );
}

/** Every skill file is named SKILL.md, so skills show their own name. */
export function resourceRowLabel(node: LeafResourceNode): string {
  if (node.kind === "skill") {
    return (
      node.skillMeta?.name ||
      node.resource.path.split("/").slice(-2, -1)[0] ||
      node.name
    );
  }
  return node.agentMeta?.name || node.name;
}

interface GroupRow {
  node: LeafResourceNode;
  source: ResourceGroupSource;
  readOnly: boolean;
}

export function ResourceSettingsGroups({
  groups,
  trees,
  canEditOrg,
  orgName,
  deletingId,
  onOpen,
  onRemove,
}: {
  groups: readonly ResourceSettingsGroupConfig[];
  trees: Record<ResourceGroupSource, ResourceSourceTree>;
  canEditOrg: boolean;
  orgName: string | null;
  deletingId: string | null;
  onOpen: (resource: ResourceMeta) => void;
  onRemove: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const hasWorkspaceGroup = groups.some((group) =>
    group.sources.includes("workspace"),
  );
  const dispatchLinks = useOrgSwitcherAppLinks(hasWorkspaceGroup);
  const [removing, setRemoving] = useState<ResourceMeta | null>(null);

  const sourceLabel = (source: ResourceGroupSource) =>
    source === "personal"
      ? t("agentChat.settingsResources.personal")
      : source === "shared"
        ? orgName || t("agentChat.settingsResources.organization")
        : t("agentChat.settingsResources.fromDispatch");

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const rows: GroupRow[] = group.sources.flatMap((source) =>
          getLeafResources(
            filterResourceTree(trees[source].nodes, group.view),
          ).map((node) => ({
            node,
            source,
            readOnly: isResourceRowReadOnly(source, node.resource, canEditOrg),
          })),
        );
        const isLoading = group.sources.some(
          (source) => trees[source].isLoading,
        );
        const isError = group.sources.some((source) => trees[source].isError);
        const groupReadOnly = group.sources.every(
          (source) =>
            source === "workspace" || (source === "shared" && !canEditOrg),
        );
        const isDispatch =
          group.sources.length === 1 && group.sources[0] === "workspace";

        return (
          <section
            key={group.id}
            id={group.id}
            data-resource-group={group.id}
            className="scroll-mt-16"
          >
            <header className="mb-2.5 flex min-h-7 items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {group.title ?? sourceLabel(group.sources[0])}
              </h2>
              {groupReadOnly && (
                <ReadOnlyNote
                  label={t("agentChat.settingsResources.readOnly")}
                  hint={
                    isDispatch
                      ? t("agentChat.settingsResources.editInDispatch")
                      : t("agentChat.settingsResources.readOnlyHint")
                  }
                />
              )}
              <div className="ms-auto flex items-center gap-1">
                {group.action}
                {isDispatch && dispatchLinks.isWorkspace && (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                  >
                    <a
                      href={dispatchLinks.dispatchResourcesHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("agentChat.settingsResources.openDispatch")}
                      <IconArrowUpRight className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </header>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card text-card-foreground">
              {rows.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {rows.map((row) => (
                    <ResourceSettingsRow
                      key={row.node.resource.id}
                      row={row}
                      scopeLabel={
                        group.sources.length > 1
                          ? sourceLabel(row.source)
                          : undefined
                      }
                      isDeleting={deletingId === row.node.resource.id}
                      onOpen={onOpen}
                      onRemove={setRemoving}
                    />
                  ))}
                </div>
              ) : isLoading ? (
                <ResourceRowsSkeleton />
              ) : isError ? (
                <EmptyRow
                  icon={IconAlertCircle}
                  text={t("agentChat.settingsResources.loadFailed")}
                  tone="error"
                />
              ) : (
                <EmptyRow
                  icon={group.emptyIcon}
                  text={group.emptyText}
                  action={groupReadOnly ? undefined : group.emptyAction}
                />
              )}
            </div>
          </section>
        );
      })}
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
                name: removing?.path ?? "",
              })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("agentChat.settingsResources.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing) onRemove(removing);
                setRemoving(null);
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

export function ReadOnlyNote({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <IconLock className="size-3.5" />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function ResourceSettingsRow({
  row,
  scopeLabel,
  isDeleting,
  onOpen,
  onRemove,
}: {
  row: GroupRow;
  scopeLabel?: string;
  isDeleting: boolean;
  onOpen: (resource: ResourceMeta) => void;
  onRemove: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const { node, source, readOnly } = row;
  const resource = node.resource;
  const descriptor = getCollectionDescriptor(node);
  const fromDispatch =
    source === "workspace" &&
    metadataSource(resource) === DISPATCH_RESOURCE_METADATA_SOURCE;

  return (
    <div
      data-resource-row={resource.path}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-opacity",
        isDeleting && "pointer-events-none opacity-40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(resource)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
          {getFileIcon(node)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {resourceRowLabel(node)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {descriptor === resource.path
              ? resource.path
              : `${resource.path} · ${descriptor}`}
          </span>
        </span>
      </button>
      {scopeLabel && (
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {scopeLabel}
        </span>
      )}
      {fromDispatch && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <IconApps className="size-3.5" />
              {t("agentChat.settingsResources.allApps")}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t("agentChat.settingsResources.allAppsHint")}
          </TooltipContent>
        </Tooltip>
      )}
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
          <DropdownMenuItem onSelect={() => onOpen(resource)}>
            <IconExternalLink className="size-4" />
            {t("agentChat.settingsResources.open")}
          </DropdownMenuItem>
          {isTextResource(resource) && (
            <DropdownMenuItem asChild>
              <a href={resourceDownloadUrl(resource.id)} download>
                <IconDownload className="size-4" />
                {t("agentChat.settingsResources.download")}
              </a>
            </DropdownMenuItem>
          )}
          {!readOnly && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onRemove(resource)}
            >
              <IconTrash className="size-4" />
              {t("agentChat.settingsResources.remove")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function EmptyRow({
  icon: RowIcon,
  text,
  action,
  tone = "muted",
}: {
  icon: Icon;
  text: string;
  action?: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <RowIcon
        className={cn(
          "size-4 shrink-0",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <span
        role={tone === "error" ? "alert" : undefined}
        className="min-w-0 flex-1 text-sm text-muted-foreground"
      >
        {text}
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}

const SKELETON_LABEL_WIDTHS = ["w-40", "w-28"] as const;

export function ResourceRowsSkeleton() {
  const t = useT();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("agentChat.settingsShell.loading")}
      className="divide-y divide-border/60"
    >
      {SKELETON_LABEL_WIDTHS.map((width) => (
        <div key={width} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-3.5", width)} />
            <Skeleton className="h-3 w-52 max-w-[70%]" />
          </div>
          <Skeleton className="size-7 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}
