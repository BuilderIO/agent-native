import {
  useFormatters,
  useUploadResource,
  useT,
  type AgentPageScope,
} from "@agent-native/core/client";
import { useOrg } from "@agent-native/core/client/org";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@agent-native/toolkit/ui";
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBooks,
  IconCheck,
  IconDots,
  IconFileImport,
  IconFileText,
  IconLayout,
  IconPalette,
  IconPhoto,
  IconPin,
  IconRefresh,
  IconSearch,
  IconSlideshow,
  IconSparkles,
  IconUpload,
  IconWorld,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { creativeContextMediaUrl } from "../media-url.js";
import type {
  ContextImportJobResult,
  ContextPackSummary,
  ContextReviewItem,
  ContextSourceSummary,
} from "../types.js";
import {
  useCreativeContextBrandProfile,
  useCreativeContexts,
  useCanonicalLogoCandidates,
  useCreativeContextConnections,
  useCreativeContextGooglePickerSession,
  useCreativeContextRootRecommendations,
  useCreativeContextImportStatus,
  useCreativeContextPack,
  useCreativeContextPacks,
  useCreativeContextSearch,
  useCreativeContextSuggestions,
  useCreativeContextSources,
  useManageCreativeContextSource,
  useManageLayoutTemplate,
  usePreviewCreativeContextImport,
  usePublishCreativeContextBrandDna,
  useConfirmCanonicalLogo,
  useProposeCanonicalLogo,
  useRefreshCreativeContextSource,
  useReviewCreativeContextItems,
  useStartCreativeContextImport,
  parseCreativeContexts,
  type CreativeContextConnectionProvider,
  type CreativeContextRootRecommendation,
  type CreativeContextRecommendationProvider,
} from "./actions.js";
import {
  useCreativeContextState,
  type CreativeContextMode,
} from "./application-state.js";
import { CreativeContextChip } from "./CreativeContextChip.js";
import { chooseGoogleSlidesPresentations } from "./google-slides-picker.js";

type ConnectorKind =
  | "google-slides"
  | "figma"
  | "notion"
  | "website"
  | "upload";

interface ConnectorDefinition {
  kind: ConnectorKind;
  label: string;
  referencePlaceholder: string;
  referenceRequired: boolean;
  icon: typeof IconBooks;
}

export interface UploadedContextFile {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  url: string;
}

const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    kind: "google-slides",
    label: "Google Slides",
    referencePlaceholder: "Presentation URLs or IDs — one per line",
    referenceRequired: false,
    icon: IconSlideshow,
  },
  {
    kind: "figma",
    label: "Figma",
    referencePlaceholder: "Team, project, or file URLs — one per line",
    referenceRequired: false,
    icon: IconPalette,
  },
  {
    kind: "notion",
    label: "Notion",
    referencePlaceholder: "Page or teamspace root URLs / IDs — one per line",
    referenceRequired: false,
    icon: IconFileText,
  },
  {
    kind: "website",
    label: "Website",
    referencePlaceholder: "https://example.com\nhttps://example.com/about",
    referenceRequired: true,
    icon: IconWorld,
  },
  {
    kind: "upload",
    label: "Uploaded files",
    referencePlaceholder: "One hosted file URL per line",
    referenceRequired: true,
    icon: IconUpload,
  },
];

export interface CreativeContextPanelProps {
  scope?: AgentPageScope;
  canManageOrg?: boolean;
  scopeControl?: ReactNode;
  connectionsHref?: string;
}

function isVisibleInScope(
  visibility: "private" | "org" | "public",
  scope: AgentPageScope,
) {
  return scope === "org" ? visibility !== "private" : visibility === "private";
}

function splitReferences(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function connectionProviderForConnector(
  kind: ConnectorKind | null,
): CreativeContextConnectionProvider | null {
  if (kind === "google-slides") return "google_drive";
  if (kind === "figma" || kind === "notion") return kind;
  return null;
}

function recommendationProviderForConnector(
  kind: ConnectorKind | null,
): CreativeContextRecommendationProvider | null {
  if (kind === "google-slides" || kind === "figma" || kind === "notion") {
    return kind;
  }
  return null;
}

export function parseFigmaRecommendationBoundary(reference: string): {
  figmaProjectId?: string;
  figmaTeamId?: string;
} {
  for (const value of splitReferences(reference)) {
    const teamId =
      value.match(/\/team\/([^/?#]+)/)?.[1] ??
      (value.startsWith("team:") ? value.slice("team:".length) : undefined);
    if (teamId) return { figmaTeamId: teamId };
    const projectId =
      value.match(/\/project\/([^/?#]+)/)?.[1] ??
      (value.startsWith("project:")
        ? value.slice("project:".length)
        : undefined);
    if (projectId) return { figmaProjectId: projectId };
  }
  return {};
}

export function selectRenderableLayoutThumbnails<
  T extends { hasThumbnail: boolean },
>(thumbnails: readonly T[]): T[] {
  return thumbnails.filter((thumbnail) => thumbnail.hasThumbnail).slice(0, 3);
}

export function mergeRecommendationSelection(
  current: ReadonlySet<string>,
  available: ReadonlySet<string>,
  previouslySeen: ReadonlySet<string>,
): Set<string> {
  const next = new Set(
    [...current].filter((externalId) => available.has(externalId)),
  );
  for (const externalId of available) {
    if (!previouslySeen.has(externalId)) next.add(externalId);
  }
  return next;
}

export function buildCreativeContextSourceConfig(
  kind: ConnectorKind,
  reference: string,
  uploadedFiles: UploadedContextFile[],
  recommendations: CreativeContextRootRecommendation[] = [],
) {
  const references = splitReferences(reference);
  if (kind === "google-slides") {
    const presentationIds = references.flatMap((value) => {
      const match = value.match(/\/presentation\/d\/([^/?#]+)/);
      const id = match?.[1] ?? (/^https?:\/\//.test(value) ? "" : value);
      return id ? [id] : [];
    });
    return {
      presentationIds: [
        ...new Set([
          ...presentationIds,
          ...recommendations.map((item) => item.externalId),
        ]),
      ],
    };
  }
  if (kind === "figma") {
    const fileUrls: string[] = [];
    const projectUrls: string[] = [];
    const teamUrls: string[] = [];
    for (const url of references) {
      if (/\/team\//.test(url)) teamUrls.push(url);
      else if (/\/project\//.test(url)) projectUrls.push(url);
      else fileUrls.push(url);
    }
    return {
      fileUrls,
      projectUrls,
      teamUrls,
      ...(recommendations.length
        ? { fileKeys: recommendations.map((item) => item.externalId) }
        : {}),
    };
  }
  if (kind === "notion") {
    const rootPageIds: string[] = [];
    const rootPageUrls: string[] = [];
    const teamspaceRootPageIds: string[] = [];
    const teamspaceRootPageUrls: string[] = [];
    for (const root of references) {
      const isTeamspace = root.startsWith("teamspace:");
      const value = isTeamspace ? root.slice("teamspace:".length) : root;
      if (/^https?:\/\//.test(value)) {
        (isTeamspace ? teamspaceRootPageUrls : rootPageUrls).push(value);
      } else {
        (isTeamspace ? teamspaceRootPageIds : rootPageIds).push(value);
      }
    }
    return {
      rootPageIds: [
        ...rootPageIds,
        ...recommendations.map((item) => item.externalId),
      ],
      rootPageUrls,
      teamspaceRootPageIds,
      teamspaceRootPageUrls,
    };
  }
  if (kind === "website") return { urls: references };
  return { items: uploadedFiles };
}

function ContextModeButton({
  mode,
  activeMode,
  label,
  description,
  disabled,
  onSelect,
}: {
  mode: CreativeContextMode;
  activeMode: CreativeContextMode;
  label: string;
  description: string;
  disabled: boolean;
  onSelect: (mode: CreativeContextMode) => void;
}) {
  const selected = mode === activeMode;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(mode)}
      className={`min-w-0 flex-1 cursor-pointer rounded-md border px-3 py-2 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-foreground/25 bg-accent/70 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      }`}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="mt-0.5 block text-xs leading-relaxed">
        {description}
      </span>
    </button>
  );
}

function ScopeControl({
  scope,
  onChange,
}: {
  scope: AgentPageScope;
  onChange: (scope: AgentPageScope) => void;
}) {
  const t = useT();
  return (
    <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
      {(["user", "org"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={scope === value}
          onClick={() => onChange(value)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            scope === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(
            value === "user"
              ? "creativeContext.personal"
              : "creativeContext.organization",
          )}
        </button>
      ))}
    </div>
  );
}

function SourceRow({
  source,
  refreshing,
  canReview,
  onRefresh,
  onReview,
  onCurate,
  canPromote,
  onPromote,
  onPause,
  onRestore,
  onDelete,
}: {
  source: ContextSourceSummary;
  refreshing: boolean;
  canReview: boolean;
  onRefresh: (sourceId: string) => void;
  onReview: (source: ContextSourceSummary) => void;
  onCurate: (source: ContextSourceSummary) => void;
  canPromote: boolean;
  onPromote: (source: ContextSourceSummary) => void;
  onPause: (source: ContextSourceSummary) => void;
  onRestore: (source: ContextSourceSummary) => void;
  onDelete: (source: ContextSourceSummary) => void;
}) {
  const t = useT();
  const { formatDate, formatNumber } = useFormatters();
  return (
    <div className="flex items-start gap-3 border-t border-border/60 py-3 first:border-t-0">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <IconBooks className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {source.name}
          </span>
          <Badge variant="secondary" className="font-normal">
            {source.kind}
          </Badge>
          {source.status === "error" ? (
            <Badge variant="destructive" className="font-normal">
              {t("creativeContext.sourceError")}
            </Badge>
          ) : source.status !== "active" ? (
            <Badge variant="outline" className="font-normal">
              {source.status}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("creativeContext.itemsLabel", {
              count: formatNumber(source.itemCount),
            })}
          </span>
          {source.lastSyncedAt ? (
            <span>
              {formatDate(source.lastSyncedAt, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          ) : null}
        </div>
        {source.restrictedItemCount > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <span>
              {t("creativeContext.restrictedItems", {
                count: formatNumber(source.restrictedItemCount),
              })}
            </span>
            {canReview ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onReview(source)}
              >
                {t("creativeContext.reviewRestricted")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {source.lastError ? (
          <p className="mt-1 line-clamp-2 text-xs text-destructive">
            {source.lastError}
          </p>
        ) : null}
      </div>
      {source.status !== "archived" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={refreshing}
          onClick={() => onRefresh(source.id)}
        >
          <IconRefresh className={refreshing ? "animate-spin" : undefined} />
          {refreshing
            ? t("creativeContext.refreshing")
            : t("creativeContext.refresh")}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("creativeContext.manage")}
          >
            <IconDots />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onCurate(source)}>
            {t("creativeContext.curateItems")}
          </DropdownMenuItem>
          {source.status === "paused" || source.status === "error" ? (
            <DropdownMenuItem onSelect={() => onRestore(source)}>
              {t("creativeContext.restore")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => onPause(source)}>
              {t("creativeContext.pause")}
            </DropdownMenuItem>
          )}
          {canPromote ? (
            <DropdownMenuItem onSelect={() => onPromote(source)}>
              {t("creativeContext.promoteToOrganization")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(source)}
          >
            {t("creativeContext.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PackRow({
  pack,
  pinned,
  disabled,
  onPin,
  onDetails,
}: {
  pack: ContextPackSummary;
  pinned: boolean;
  disabled: boolean;
  onPin: (packId: string | null) => void;
  onDetails: (packId: string) => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  return (
    <div className="flex items-center gap-3 border-t border-border/60 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{pack.name}</span>
          {pinned ? (
            <Badge variant="secondary" className="font-normal">
              <IconPin className="me-1 size-3" />
              {t("creativeContext.pinned")}
            </Badge>
          ) : null}
        </div>
        {pack.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {pack.description}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("creativeContext.itemsLabel", {
            count: formatNumber(pack.memberCount),
          })}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onDetails(pack.id)}
      >
        {t("creativeContext.packDetails")}
      </Button>
      <Button
        type="button"
        variant={pinned ? "secondary" : "ghost"}
        size="sm"
        disabled={disabled}
        onClick={() => onPin(pinned ? null : pack.id)}
      >
        <IconPin />
        {pinned ? t("creativeContext.unpin") : t("creativeContext.pin")}
      </Button>
    </div>
  );
}

type ContextItemReviewOperation =
  | "approve"
  | "exclude"
  | "exemplar"
  | "normal"
  | "ignore"
  | "star"
  | "unstar"
  | "deprecate"
  | "restore";

function AccessScopedThumbnail({
  itemId,
  itemVersionId,
  className,
}: {
  itemId: string;
  itemVersionId: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-muted-foreground ${className}`}
      >
        <IconFileText className="size-5" />
      </div>
    );
  }
  return (
    <img
      src={creativeContextMediaUrl({ itemId, itemVersionId })}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

function ItemCuration({
  source,
  items,
  busy,
  onReview,
  onClose,
}: {
  source: ContextSourceSummary;
  items: ContextReviewItem[];
  busy: boolean;
  onReview: (operation: ContextItemReviewOperation, itemId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-4 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("creativeContext.curateItems")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{source.name}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("creativeContext.cancel")}
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <article
            key={item.id}
            className="overflow-hidden rounded-md border border-border/70"
          >
            {item.thumbnailBlobRef ? (
              <AccessScopedThumbnail
                key={item.currentVersionId}
                itemId={item.id}
                itemVersionId={item.currentVersionId}
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
                <IconFileText className="size-5" />
              </div>
            )}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.kind}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {item.curationRank === "exemplar" ? (
                    <Badge variant="secondary">
                      {t("creativeContext.exemplar")}
                    </Badge>
                  ) : null}
                  {item.status === "deprecated" ? (
                    <Badge variant="outline">
                      {t("creativeContext.deprecated")}
                    </Badge>
                  ) : null}
                  {item.upstreamAccess === "unknown" ? (
                    <Badge variant="outline">
                      {t("creativeContext.unknownAccess")}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant={item.starred ? "secondary" : "outline"}
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onReview(item.starred ? "unstar" : "star", item.id)
                  }
                >
                  {t(
                    item.starred
                      ? "creativeContext.unstar"
                      : "creativeContext.star",
                  )}
                </Button>
                <Button
                  type="button"
                  variant={
                    item.curationRank === "exemplar" ? "secondary" : "outline"
                  }
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onReview(
                      item.curationRank === "exemplar" ? "normal" : "exemplar",
                      item.id,
                    )
                  }
                >
                  {t("creativeContext.exemplar")}
                </Button>
                <Button
                  type="button"
                  variant={
                    item.curationRank === "ignored" ? "secondary" : "outline"
                  }
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onReview(
                      item.curationRank === "ignored" ? "normal" : "ignore",
                      item.id,
                    )
                  }
                >
                  {t("creativeContext.ignore")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onReview(
                      item.status === "deprecated" ? "restore" : "deprecate",
                      item.id,
                    )
                  }
                >
                  {t(
                    item.status === "deprecated"
                      ? "creativeContext.restore"
                      : "creativeContext.deprecate",
                  )}
                </Button>
              </div>
              {item.curationStatus === "review" ? (
                <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => onReview("exclude", item.id)}
                  >
                    {t("creativeContext.exclude")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => onReview("approve", item.id)}
                  >
                    {t("creativeContext.approve")}
                  </Button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

type LibraryView = "items" | "sources" | "approvals" | "settings";

interface SafePreviewManifest {
  title: string;
  kind: string;
  itemId: string;
  itemVersionId: string;
  hasPreview: boolean;
}

function ContextPreviewSheet({
  manifest,
  onOpenChange,
}: {
  manifest: SafePreviewManifest | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(manifest)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{manifest?.title ?? "Context preview"}</SheetTitle>
          <SheetDescription>{manifest?.kind ?? ""}</SheetDescription>
        </SheetHeader>
        {manifest?.hasPreview ? (
          <img
            src={creativeContextMediaUrl({
              itemId: manifest.itemId,
              itemVersionId: manifest.itemVersionId,
            })}
            alt=""
            className="mt-5 max-h-[70vh] w-full rounded-md border border-border object-contain"
          />
        ) : (
          <div className="mt-5 flex min-h-44 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            No safe preview is available for this item.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ContextRail({
  contexts,
  selectedContextId,
  disabled,
  onSelect,
}: {
  contexts: Array<{
    id: string;
    name: string;
    description?: string | null;
    itemCount?: number;
  }>;
  selectedContextId: string | null | undefined;
  disabled: boolean;
  onSelect: (contextId: string) => void;
}) {
  return (
    <aside className="border-b border-border/70 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Contexts</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose the reusable context that should guide this work.
          </p>
        </div>
        <Badge variant="outline">{contexts.length}</Badge>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {contexts.map((context) => (
          <button
            key={context.id}
            type="button"
            disabled={disabled}
            aria-pressed={selectedContextId === context.id}
            onClick={() => onSelect(context.id)}
            className={`min-w-40 rounded-md border px-3 py-2 text-start transition-colors disabled:opacity-60 ${selectedContextId === context.id ? "border-foreground/25 bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}
          >
            <span className="block truncate text-sm font-medium">
              {context.name}
            </span>
            <span className="mt-0.5 block truncate text-xs">
              {context.description || `${context.itemCount ?? 0} items`}
            </span>
          </button>
        ))}
        {!contexts.length ? (
          <p className="py-2 text-sm text-muted-foreground">
            Create a context from a resource’s Share tab to start organizing the
            Library.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export function CreativeContextPanel({
  scope = "user",
  canManageOrg = false,
  scopeControl,
  connectionsHref = "/agent#connections",
}: CreativeContextPanelProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const { data: org } = useOrg();
  const [libraryScope, setLibraryScope] = useState<AgentPageScope>(scope);
  const sourcesQuery = useCreativeContextSources({ limit: 100 });
  const contextsQuery = useCreativeContexts();
  const packsQuery = useCreativeContextPacks();
  const brandProfileQuery = useCreativeContextBrandProfile();
  const suggestionsQuery = useCreativeContextSuggestions();
  const logoCandidatesQuery = useCanonicalLogoCandidates(
    brandProfileQuery.data?.profile?.id,
    suggestionsQuery.data?.capabilities.canonicalLogo === true,
  );
  const refreshSource = useRefreshCreativeContextSource();
  const manageSource = useManageCreativeContextSource();
  const uploadResource = useUploadResource();
  const startImport = useStartCreativeContextImport();
  const searchContext = useCreativeContextSearch();
  const reviewItems = useReviewCreativeContextItems();
  const publishBrandDna = usePublishCreativeContextBrandDna();
  const proposeCanonicalLogo = useProposeCanonicalLogo();
  const confirmCanonicalLogo = useConfirmCanonicalLogo();
  const manageLayoutTemplate = useManageLayoutTemplate();
  const contextState = useCreativeContextState();
  const [query, setQuery] = useState("");
  const [libraryView, setLibraryView] = useState<LibraryView>("items");
  const [previewManifest, setPreviewManifest] =
    useState<SafePreviewManifest | null>(null);
  const [savingState, setSavingState] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [connectorKind, setConnectorKind] = useState<ConnectorKind | null>(
    null,
  );
  const connectionProvider = connectionProviderForConnector(connectorKind);
  const connectionsQuery = useCreativeContextConnections(connectionProvider);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const recommendationProvider =
    recommendationProviderForConnector(connectorKind);
  const recommendationsQuery = useCreativeContextRootRecommendations(
    recommendationProvider,
    selectedConnectionId || null,
    connectorKind === "figma"
      ? parseFigmaRecommendationBoundary(sourceReference)
      : {},
  );
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<
    Set<string>
  >(() => new Set());
  const seenRecommendationIdsRef = useRef<Set<string>>(new Set());
  const [pickerRecommendations, setPickerRecommendations] = useState<
    CreativeContextRootRecommendation[]
  >([]);
  const [openingGooglePicker, setOpeningGooglePicker] = useState(false);
  const googlePickerSession = useCreativeContextGooglePickerSession(
    connectorKind === "google-slides" && selectedConnectionId
      ? selectedConnectionId
      : null,
  );
  const [uploadedFiles, setUploadedFiles] = useState<UploadedContextFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [previewSourceId, setPreviewSourceId] = useState<string | null>(null);
  const [previewSourceName, setPreviewSourceName] = useState("");
  const [selectedPreviewItemIds, setSelectedPreviewItemIds] = useState<
    Set<string>
  >(() => new Set());
  const initializedPreviewSelectionRef = useRef<string | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importTargetScope, setImportTargetScope] =
    useState<AgentPageScope>("user");
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const [promotionPreview, setPromotionPreview] = useState<NonNullable<
    Awaited<ReturnType<typeof manageSource.mutateAsync>>["promotionPreview"]
  > | null>(null);
  const [promotionSourceId, setPromotionSourceId] = useState<string | null>(
    null,
  );
  const [promotionMessage, setPromotionMessage] = useState<string | null>(null);
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
  const [deleteSource, setDeleteSource] = useState<ContextSourceSummary | null>(
    null,
  );
  const [hiddenSourceIds, setHiddenSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [publishedMessage, setPublishedMessage] = useState<string | null>(null);
  const [reviewSource, setReviewSource] = useState<ContextSourceSummary | null>(
    null,
  );
  const [reviewedItems, setReviewedItems] = useState<ContextReviewItem[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const previewQuery = usePreviewCreativeContextImport(previewSourceId);
  const importStatusQuery = useCreativeContextImportStatus(importJobId);
  const packQuery = useCreativeContextPack(selectedPackId);

  useEffect(() => setLibraryScope(scope), [scope]);

  useEffect(() => {
    if (!connectionProvider) {
      setSelectedConnectionId("");
      return;
    }
    setSelectedConnectionId(
      connectionsQuery.data?.autoSelectedConnectionId ?? "",
    );
  }, [connectionProvider, connectionsQuery.data?.autoSelectedConnectionId]);

  const availableRecommendations = useMemo(() => {
    const byId = new Map<string, CreativeContextRootRecommendation>();
    for (const recommendation of [
      ...(recommendationsQuery.data?.recommendations ?? []),
      ...pickerRecommendations,
    ]) {
      byId.set(recommendation.externalId, recommendation);
    }
    return [...byId.values()];
  }, [pickerRecommendations, recommendationsQuery.data?.recommendations]);

  useEffect(() => {
    const availableIds = new Set(
      availableRecommendations.map(({ externalId }) => externalId),
    );
    const previouslySeen = seenRecommendationIdsRef.current;
    setSelectedRecommendationIds((current) =>
      mergeRecommendationSelection(current, availableIds, previouslySeen),
    );
    seenRecommendationIdsRef.current = availableIds;
  }, [availableRecommendations]);

  const sources = useMemo(
    () =>
      (sourcesQuery.data?.sources ?? []).filter(
        (source) =>
          source.status !== "archived" &&
          !hiddenSourceIds.has(source.id) &&
          isVisibleInScope(source.visibility, libraryScope),
      ),
    [hiddenSourceIds, libraryScope, sourcesQuery.data?.sources],
  );
  const packs = useMemo(
    () =>
      (packsQuery.data?.packs ?? []).filter(
        (pack) =>
          !pack.archivedAt && isVisibleInScope(pack.visibility, libraryScope),
      ),
    [libraryScope, packsQuery.data?.packs],
  );
  const contexts = useMemo(
    () => parseCreativeContexts(contextsQuery.data),
    [contextsQuery.data],
  );
  const activePack = packs.find(
    (pack) => pack.id === contextState.state.currentPackId,
  );
  const selectedConnector = CONNECTORS.find(
    (connector) => connector.kind === connectorKind,
  );
  const importJob = importStatusQuery.data?.job;
  const importResult = importJob?.result as ContextImportJobResult | null;
  const brandProposal = importResult?.inference?.brandDnaProposal;
  const brandLayoutThumbnails = selectRenderableLayoutThumbnails(
    brandProposal?.layoutThumbnails ?? [],
  );
  const brandVoicePreview =
    brandProposal?.voiceDescriptors?.join(" · ") ?? brandProposal?.voiceLine;
  const canManageScope = libraryScope === "user" || canManageOrg;
  const proposalCapabilities = suggestionsQuery.data?.capabilities;
  const logoCandidates = proposalCapabilities?.canonicalLogo
    ? (logoCandidatesQuery.data?.candidates ?? [])
    : [];
  const proposedLayouts = (suggestionsQuery.data?.suggestions ?? []).filter(
    (suggestion) =>
      suggestion.kind === "layout-template" &&
      (suggestion.status === "proposed" || suggestion.status === "promoted"),
  );

  useEffect(() => {
    if (!previewSourceId || !previewQuery.data) return;
    const defaults = previewQuery.data.smartDefaultExternalIds ?? [];
    const initializationKey = `${previewSourceId}:${defaults.join("\u0000")}`;
    if (initializedPreviewSelectionRef.current === initializationKey) return;
    const discoveredIds = new Set(
      previewQuery.data.items.map((item) => item.externalId),
    );
    setSelectedPreviewItemIds(
      new Set(defaults.filter((externalId) => discoveredIds.has(externalId))),
    );
    initializedPreviewSelectionRef.current = initializationKey;
  }, [previewQuery.data, previewSourceId]);

  useEffect(() => {
    if (importJob?.status !== "completed" || completedJobId === importJob.id)
      return;
    setCompletedJobId(importJob.id);
    void sourcesQuery.refetch();
    void packsQuery.refetch();
    void brandProfileQuery.refetch();
    if (importTargetScope === "org" && previewSourceId) {
      setPromotionSourceId(previewSourceId);
      void manageSource
        .mutateAsync({
          operation: "preview-promotion",
          sourceId: previewSourceId,
        })
        .then((result) => setPromotionPreview(result.promotionPreview ?? null))
        .catch(() => setPromotionMessage(t("creativeContext.saveFailed")));
    }
  }, [
    brandProfileQuery,
    completedJobId,
    importJob,
    importTargetScope,
    manageSource,
    packsQuery,
    previewSourceId,
    sourcesQuery,
    t,
  ]);

  async function changeMode(mode: CreativeContextMode) {
    if (mode === contextState.state.contextMode) return;
    setSavingState(true);
    setStateError(null);
    try {
      await contextState.setState(
        mode === "off"
          ? {
              contextMode: "off",
              selectedContextId: null,
              currentPackId: null,
              pinnedPackId: null,
            }
          : {
              ...contextState.state,
              contextMode: "auto",
              selectedContextId: null,
              pinnedPackId: null,
            },
      );
    } catch {
      setStateError(t("creativeContext.stateSaveFailed"));
    } finally {
      setSavingState(false);
    }
  }

  async function changePinnedPack(packId: string | null) {
    setSavingState(true);
    setStateError(null);
    try {
      await contextState.setState({
        ...contextState.state,
        contextMode: "auto",
        selectedContextId: null,
        pinnedPackId: packId,
      });
    } catch {
      setStateError(t("creativeContext.stateSaveFailed"));
    } finally {
      setSavingState(false);
    }
  }

  async function selectContext(contextId: string) {
    setSavingState(true);
    setStateError(null);
    try {
      await contextState.setState({
        ...contextState.state,
        contextMode: "auto",
        selectedContextId: contextId,
        pinnedPackId: null,
      });
    } catch {
      setStateError(t("creativeContext.stateSaveFailed"));
    } finally {
      setSavingState(false);
    }
  }

  function refresh(sourceId: string) {
    setRefreshMessage(null);
    refreshSource.mutate(
      { sourceId, mode: "incremental" },
      {
        onSuccess: () => setRefreshMessage(t("creativeContext.refreshed")),
        onError: () => setRefreshMessage(t("creativeContext.refreshFailed")),
      },
    );
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setSetupError(null);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const relativePath =
            (file as File & { webkitRelativePath?: string })
              .webkitRelativePath || file.name;
          const safePath = relativePath
            .replace(/\.\./g, "")
            .replace(/[^a-zA-Z0-9._/-]/g, "-");
          const formData = new FormData();
          formData.append("file", file, file.name);
          formData.append(
            "path",
            `/creative-context/${Date.now()}-${safePath}`,
          );
          const resource = (await uploadResource.mutateAsync(formData)) as {
            id: string;
            content: string;
            url?: string;
          };
          const url = resource.url ?? resource.content;
          if (!url) throw new Error("Upload returned no file handle");
          return {
            id: resource.id,
            title: file.name,
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            url,
          };
        }),
      );
      setUploadedFiles((current) => [...current, ...uploaded]);
    } catch {
      setSetupError(t("creativeContext.saveFailed"));
    }
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    void uploadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConnector || !sourceName.trim()) return;
    setSetupError(null);
    setImportJobId(null);
    setCompletedJobId(null);
    setPublishedMessage(null);
    try {
      const confirmedRecommendations = availableRecommendations.filter(
        (recommendation) =>
          selectedRecommendationIds.has(recommendation.externalId),
      );
      const result = await manageSource.mutateAsync({
        operation: "create",
        name: sourceName.trim(),
        kind: selectedConnector.kind,
        connectionId: selectedConnectionId || undefined,
        externalRef:
          selectedConnector.kind === "upload"
            ? `${uploadedFiles.length} files`
            : sourceReference.trim() ||
              (confirmedRecommendations.length
                ? `${selectedConnector.kind}:${confirmedRecommendations
                    .map((recommendation) => recommendation.externalId)
                    .join(",")}`
                : undefined),
        config: buildCreativeContextSourceConfig(
          selectedConnector.kind,
          sourceReference,
          uploadedFiles,
          confirmedRecommendations,
        ),
      });
      if (!result.source) throw new Error("Source creation returned no source");
      setImportTargetScope(libraryScope);
      setPreviewSourceName(result.source.name);
      setPreviewSourceId(result.source.id);
      setSelectedPreviewItemIds(new Set());
      initializedPreviewSelectionRef.current = null;
      setPromotionSourceId(null);
      setPromotionPreview(null);
      setPromotionMessage(null);
      setConnectorKind(null);
      setSourceName("");
      setSourceReference("");
      setPickerRecommendations([]);
      seenRecommendationIdsRef.current.clear();
      setUploadedFiles([]);
      await sourcesQuery.refetch();
    } catch {
      setSetupError(t("creativeContext.saveFailed"));
    }
  }

  async function chooseGoogleSlides() {
    setSetupError(null);
    setOpeningGooglePicker(true);
    try {
      const session = await googlePickerSession.refetch();
      if (!session.data) {
        throw new Error("Google Picker session is unavailable.");
      }
      const selections = await chooseGoogleSlidesPresentations(session.data);
      if (!selections.length) return;
      const selected = selections.map((selection) => ({
        ...selection,
        provider: "google-slides" as const,
        kind: "presentation" as const,
      }));
      setPickerRecommendations((current) => {
        const byId = new Map(
          current.map((recommendation) => [
            recommendation.externalId,
            recommendation,
          ]),
        );
        for (const recommendation of selected) {
          byId.set(recommendation.externalId, recommendation);
        }
        return [...byId.values()];
      });
      setSelectedRecommendationIds((current) => {
        const next = new Set(current);
        for (const recommendation of selected) {
          next.add(recommendation.externalId);
        }
        return next;
      });
      void recommendationsQuery.refetch();
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningGooglePicker(false);
    }
  }

  async function confirmPromotion() {
    if (!promotionSourceId || !promotionPreview) return;
    setPromotionMessage(null);
    try {
      await manageSource.mutateAsync({
        operation: "promote",
        sourceId: promotionSourceId,
        confirmation: {
          containerRef: promotionPreview.containerRef,
          boundaryHash: promotionPreview.boundaryHash,
          itemCount: promotionPreview.itemCount,
        },
      });
      setPromotionMessage(t("creativeContext.promotionComplete"));
      setPromotionPreview(null);
      setPromotionSourceId(null);
      await sourcesQuery.refetch();
    } catch {
      setPromotionMessage(t("creativeContext.saveFailed"));
    }
  }

  async function pauseSource(source: ContextSourceSummary) {
    setLifecycleMessage(null);
    try {
      await manageSource.mutateAsync({
        operation: "update",
        sourceId: source.id,
        patch: { status: "paused" },
      });
      setLifecycleMessage(t("creativeContext.sourcePaused"));
      await sourcesQuery.refetch();
    } catch {
      setLifecycleMessage(t("creativeContext.saveFailed"));
    }
  }

  async function restoreSource(source: ContextSourceSummary) {
    setLifecycleMessage(null);
    try {
      await manageSource.mutateAsync({
        operation: "restore",
        sourceId: source.id,
      });
      setLifecycleMessage(t("creativeContext.sourceRestored"));
      await sourcesQuery.refetch();
    } catch {
      setLifecycleMessage(t("creativeContext.saveFailed"));
    }
  }

  async function previewSourcePromotion(source: ContextSourceSummary) {
    setPromotionMessage(null);
    setPromotionPreview(null);
    setPromotionSourceId(source.id);
    try {
      const result = await manageSource.mutateAsync({
        operation: "preview-promotion",
        sourceId: source.id,
      });
      setPromotionPreview(result.promotionPreview ?? null);
    } catch {
      setPromotionSourceId(null);
      setPromotionMessage(t("creativeContext.saveFailed"));
    }
  }

  async function confirmDeleteSource() {
    if (!deleteSource) return;
    const sourceId = deleteSource.id;
    setLifecycleMessage(null);
    setDeleteSource(null);
    setHiddenSourceIds((current) => new Set(current).add(sourceId));
    try {
      await manageSource.mutateAsync({ operation: "delete", sourceId });
      setLifecycleMessage(t("creativeContext.deletionQueued"));
      void sourcesQuery.refetch();
    } catch {
      setHiddenSourceIds((current) => {
        const next = new Set(current);
        next.delete(sourceId);
        return next;
      });
      setLifecycleMessage(t("creativeContext.saveFailed"));
    }
  }

  async function beginImport() {
    if (!previewSourceId || !selectedPreviewItemIds.size) return;
    setSetupError(null);
    try {
      const result = await startImport.mutateAsync({
        sourceId: previewSourceId,
        mode: "incremental",
        itemExternalIds: (previewQuery.data?.items ?? [])
          .map((item) => item.externalId)
          .filter((externalId) => selectedPreviewItemIds.has(externalId)),
      });
      setImportJobId(result.job.id);
    } catch {
      setSetupError(t("creativeContext.importFailed"));
    }
  }

  async function publishProposal() {
    const importResult = importJob?.result as ContextImportJobResult | null;
    const proposal = importResult?.inference?.brandDnaProposal;
    if (!proposal) return;
    setPublishedMessage(null);
    try {
      const result = await publishBrandDna.mutateAsync({
        profileId: proposal.profileId,
        proposalVersionId: proposal.dnaVersionId,
        confirmation: {
          proposalVersionId: proposal.dnaVersionId,
          contentHash: proposal.contentHash,
        },
      });
      setPublishedMessage(
        `${t("creativeContext.brandContextPublished")} · ${result.profile.name} · v${result.dna.versionNumber}`,
      );
      await brandProfileQuery.refetch();
    } catch {
      setPublishedMessage(t("creativeContext.saveFailed"));
    }
  }

  async function openItemCuration(
    source: ContextSourceSummary,
    queue: "restricted" | "all" = "all",
  ) {
    setReviewSource(source);
    setReviewError(null);
    try {
      const result = await reviewItems.mutateAsync({
        sourceId: source.id,
        operation: "list",
        queue,
        limit: 100,
      });
      setReviewedItems(result.items);
    } catch {
      setReviewedItems([]);
      setReviewError(t("creativeContext.unavailable"));
    }
  }

  async function reviewContextItem(
    operation: ContextItemReviewOperation,
    itemId: string,
  ) {
    if (!reviewSource) return;
    setReviewError(null);
    try {
      await reviewItems.mutateAsync({
        sourceId: reviewSource.id,
        operation,
        itemIds: [itemId],
      });
      const result = await reviewItems.mutateAsync({
        sourceId: reviewSource.id,
        operation: "list",
        queue: "all",
        limit: 100,
      });
      setReviewedItems(result.items);
      await sourcesQuery.refetch();
    } catch {
      setReviewError(t("creativeContext.saveFailed"));
    }
  }

  async function chooseCanonicalLogo(
    candidate: NonNullable<
      typeof logoCandidatesQuery.data
    >["candidates"][number],
  ) {
    setSuggestionError(null);
    try {
      const suggestion = await proposeCanonicalLogo.mutateAsync({
        profileId: brandProfileQuery.data?.profile?.id,
        itemId: candidate.itemId,
        itemVersionId: candidate.itemVersionId,
        reason: "Selected from the ranked Library review card",
        payload: { mediaId: candidate.mediaId },
      });
      await confirmCanonicalLogo.mutateAsync({
        suggestionId: suggestion.id,
        decision: "confirm",
      });
      await suggestionsQuery.refetch();
    } catch {
      setSuggestionError(t("creativeContext.saveFailed"));
    }
  }

  async function decideLayoutSuggestion(
    suggestionId: string,
    operation: "promote" | "demote" | "reject",
  ) {
    setSuggestionError(null);
    try {
      await manageLayoutTemplate.mutateAsync({ suggestionId, operation });
      await suggestionsQuery.refetch();
    } catch {
      setSuggestionError(t("creativeContext.saveFailed"));
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const searchText = query.trim();
    if (!searchText || !sources.length) return;
    setSearchError(null);
    try {
      const result = await searchContext.mutateAsync({
        query: searchText,
        sourceIds: sources.map((source) => source.id),
        packId: contextState.state.pinnedPackId ?? undefined,
        limit: 20,
        snapshot: true,
      });
      if (result.contextPackId && contextState.state.contextMode === "auto") {
        await contextState.setState({
          ...contextState.state,
          currentPackId: result.contextPackId,
        });
      }
    } catch {
      setSearchError(t("creativeContext.unavailable"));
    }
  }

  const loading =
    sourcesQuery.isLoading ||
    packsQuery.isLoading ||
    contextsQuery.isLoading ||
    contextState.isLoading;
  const unavailable =
    sourcesQuery.error || packsQuery.error || contextsQuery.error;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("creativeContext.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("creativeContext.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scopeControl ??
            (org?.orgId ? (
              <ScopeControl scope={libraryScope} onChange={setLibraryScope} />
            ) : null)}
          <CreativeContextChip
            state={contextState.state}
            packs={packs}
            contexts={contexts}
          />
        </div>
      </header>

      {loading ? (
        <div className="space-y-3" aria-label={t("creativeContext.loading")}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : unavailable ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          <IconAlertTriangle className="size-5" />
          {t("creativeContext.unavailable")}
        </div>
      ) : (
        <>
          <ContextRail
            contexts={contexts}
            selectedContextId={contextState.state.selectedContextId}
            disabled={savingState}
            onSelect={(contextId) => void selectContext(contextId)}
          />
          <Tabs
            value={libraryView}
            onValueChange={(value) => setLibraryView(value as LibraryView)}
          >
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="items">Items</TabsTrigger>
              <TabsTrigger value="sources">Sources</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="items">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reviewedItems
                  .filter((item) => item.curationStatus !== "review")
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setPreviewManifest({
                          title: item.title,
                          kind: item.kind,
                          itemId: item.id,
                          itemVersionId: item.currentVersionId,
                          hasPreview: Boolean(item.thumbnailBlobRef),
                        })
                      }
                      className="overflow-hidden rounded-md border border-border text-start transition-colors hover:bg-accent/40"
                    >
                      {item.thumbnailBlobRef ? (
                        <AccessScopedThumbnail
                          itemId={item.id}
                          itemVersionId={item.currentVersionId}
                          className="aspect-video w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-video items-center justify-center bg-muted text-muted-foreground">
                          <IconFileText className="size-5" />
                        </div>
                      )}
                      <span className="block truncate p-3 text-sm font-medium">
                        {item.title}
                      </span>
                    </button>
                  ))}
              </div>
              {!reviewedItems.filter((item) => item.curationStatus !== "review")
                .length ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Approved items appear here after they are reviewed from a
                  source.
                </p>
              ) : null}
            </TabsContent>
            <TabsContent value="approvals">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reviewedItems
                  .filter((item) => item.curationStatus === "review")
                  .map((item) => (
                    <article
                      key={item.id}
                      className="rounded-md border border-border p-3"
                    >
                      <p className="truncate text-sm font-medium">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Awaiting review
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            void reviewContextItem("approve", item.id)
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void reviewContextItem("exclude", item.id)
                          }
                        >
                          Exclude
                        </Button>
                      </div>
                    </article>
                  ))}
              </div>
              {!reviewedItems.filter((item) => item.curationStatus === "review")
                .length ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Open a source review queue to approve pending items.
                </p>
              ) : null}
            </TabsContent>
            <TabsContent value="sources">
              <p className="text-sm text-muted-foreground">
                Sources and their review queues are managed below.
              </p>
            </TabsContent>
            <TabsContent value="settings">
              <p className="text-sm text-muted-foreground">
                Automatic selection is the default. Exact context packs remain
                available as an advanced provenance pin.
              </p>
            </TabsContent>
          </Tabs>
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">
                {t("creativeContext.modeLabel")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {activePack
                  ? `${t("creativeContext.activePack")}: ${activePack.name}`
                  : t("creativeContext.noActivePack")}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup">
              <ContextModeButton
                mode="auto"
                activeMode={contextState.state.contextMode}
                label={t("creativeContext.automatic")}
                description={t("creativeContext.automaticDescription")}
                disabled={savingState}
                onSelect={(mode) => void changeMode(mode)}
              />
              <ContextModeButton
                mode="off"
                activeMode={contextState.state.contextMode}
                label={t("creativeContext.off")}
                description={t("creativeContext.offDescription")}
                disabled={savingState}
                onSelect={(mode) => void changeMode(mode)}
              />
            </div>
            {stateError ? (
              <p className="text-xs text-destructive">{stateError}</p>
            ) : null}
          </section>

          {brandProfileQuery.data?.profile && brandProfileQuery.data.dna ? (
            <section className="border-t border-border/70 pt-6">
              <div className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {t("creativeContext.publishedBrandContext")}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {brandProfileQuery.data.profile.name}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    v{brandProfileQuery.data.dna.versionNumber}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {brandProfileQuery.data.dna.payload.summary}
                </p>
              </div>
            </section>
          ) : null}

          {logoCandidates.length || proposedLayouts.length ? (
            <section className="border-t border-border/70 pt-6">
              <div className="flex items-center gap-2">
                <IconSparkles className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">
                  {t("creativeContext.suggestions")}
                </h2>
              </div>
              {logoCandidates.length ? (
                <div className="mt-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <IconPhoto className="size-4 text-muted-foreground" />
                    {t("creativeContext.logo")}
                  </h3>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {logoCandidates.map((candidate) => (
                      <article
                        key={candidate.mediaId}
                        className="overflow-hidden rounded-md border border-border"
                      >
                        <div className="flex h-28 items-center justify-center bg-muted/40 p-3">
                          <img
                            src={candidate.thumbnailUrl}
                            alt={candidate.title}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 p-3">
                          <p className="min-w-0 truncate text-sm font-medium">
                            {candidate.title}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              proposeCanonicalLogo.isPending ||
                              confirmCanonicalLogo.isPending
                            }
                            onClick={() => void chooseCanonicalLogo(candidate)}
                          >
                            <IconCheck />
                            {t("creativeContext.approve")}
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {proposedLayouts.length &&
              proposalCapabilities?.layoutTemplate ? (
                <div className="mt-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <IconLayout className="size-4 text-muted-foreground" />
                    {t("creativeContext.layouts")}
                  </h3>
                  <div className="mt-2 divide-y divide-border/70 rounded-md border border-border">
                    {proposedLayouts.map((suggestion) => (
                      <article
                        key={suggestion.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {suggestion.reason ?? suggestion.itemId}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {suggestion.status}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {suggestion.status === "proposed" ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={manageLayoutTemplate.isPending}
                                onClick={() =>
                                  void decideLayoutSuggestion(
                                    suggestion.id,
                                    "promote",
                                  )
                                }
                              >
                                <IconCheck />
                                {t("creativeContext.approve")}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={manageLayoutTemplate.isPending}
                                onClick={() =>
                                  void decideLayoutSuggestion(
                                    suggestion.id,
                                    "reject",
                                  )
                                }
                              >
                                {t("creativeContext.exclude")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={manageLayoutTemplate.isPending}
                              onClick={() =>
                                void decideLayoutSuggestion(
                                  suggestion.id,
                                  "demote",
                                )
                              }
                            >
                              {t("creativeContext.deprecate")}
                            </Button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {suggestionError ? (
                <p className="mt-3 text-sm text-destructive">
                  {suggestionError}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="border-t border-border/70 pt-6">
            <div>
              <h2 className="text-lg font-semibold">
                {t("creativeContext.addSource")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("creativeContext.sourcesDescription")}
              </p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {CONNECTORS.map((connector) => {
                const Icon = connector.icon;
                return (
                  <button
                    key={connector.kind}
                    type="button"
                    disabled={!canManageScope}
                    onClick={() => {
                      setConnectorKind(connector.kind);
                      setSourceName(connector.label);
                      setSourceReference("");
                      setUploadedFiles([]);
                      setPickerRecommendations([]);
                      seenRecommendationIdsRef.current.clear();
                      setSelectedConnectionId("");
                      setSelectedRecommendationIds(new Set());
                      setSetupError(null);
                    }}
                    className="flex min-h-24 flex-col items-start justify-between rounded-md border border-border p-3 text-start transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Icon className="size-5 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {connector.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedConnector ? (
              <form
                className="mt-4 rounded-md border border-border p-4"
                onSubmit={(event) => void previewImport(event)}
              >
                {connectionProvider ? (
                  <div className="mb-3">
                    {connectionsQuery.isLoading ? (
                      <Skeleton className="h-9 w-full" />
                    ) : connectionsQuery.data?.needsSetup ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                        <span>{t("creativeContext.setupConnection")}</span>
                        <Button
                          asChild
                          type="button"
                          variant="outline"
                          size="sm"
                        >
                          <a
                            href={
                              connectionsQuery.data.connectPath ||
                              connectionsQuery.data.connectionsPath ||
                              connectionsHref
                            }
                          >
                            {t("creativeContext.connectProvider")}
                            <IconArrowUpRight />
                          </a>
                        </Button>
                      </div>
                    ) : connectionsQuery.data?.needsPicker ? (
                      <label className="block space-y-1.5 text-xs font-medium">
                        <span>{t("creativeContext.chooseConnection")}</span>
                        <Select
                          value={selectedConnectionId}
                          onValueChange={setSelectedConnectionId}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "creativeContext.chooseConnection",
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {connectionsQuery.data.connections.map(
                              (connection) => (
                                <SelectItem
                                  key={connection.connectionId}
                                  value={connection.connectionId}
                                >
                                  {connection.label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </label>
                    ) : null}
                  </div>
                ) : null}
                {recommendationProvider && selectedConnectionId ? (
                  <div className="mb-3 rounded-md border border-border p-3">
                    {connectorKind === "google-slides" ? (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                        <p className="max-w-lg text-xs text-muted-foreground">
                          {t("creativeContext.googlePickerDescription")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={openingGooglePicker}
                          onClick={() => void chooseGoogleSlides()}
                        >
                          <IconSlideshow />
                          {openingGooglePicker
                            ? t("creativeContext.loading")
                            : t("creativeContext.choosePresentations")}
                        </Button>
                      </div>
                    ) : null}
                    {recommendationsQuery.isLoading &&
                    !availableRecommendations.length ? (
                      <Skeleton className="h-16 w-full" />
                    ) : availableRecommendations.length ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>
                            {t("creativeContext.discoveredItems", {
                              count: formatNumber(
                                availableRecommendations.length,
                              ),
                            })}
                          </span>
                          <span>
                            {t("creativeContext.selectedItems", {
                              count: formatNumber(
                                selectedRecommendationIds.size,
                              ),
                            })}
                          </span>
                        </div>
                        <div className="max-h-52 divide-y divide-border/60 overflow-y-auto">
                          {availableRecommendations.map((recommendation) => (
                            <label
                              key={recommendation.externalId}
                              className="flex cursor-pointer items-start gap-3 py-2"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={selectedRecommendationIds.has(
                                  recommendation.externalId,
                                )}
                                onCheckedChange={(checked) =>
                                  setSelectedRecommendationIds((current) => {
                                    const next = new Set(current);
                                    if (checked) {
                                      next.add(recommendation.externalId);
                                    } else {
                                      next.delete(recommendation.externalId);
                                    }
                                    return next;
                                  })
                                }
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm">
                                  {recommendation.title}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {recommendation.containerRef ??
                                    recommendation.kind}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {recommendationsQuery.data?.unavailableReason ??
                          t("creativeContext.unavailable")}
                      </p>
                    )}
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium">
                    <span>{t("creativeContext.sourceName")}</span>
                    <Input
                      value={sourceName}
                      onChange={(event) => setSourceName(event.target.value)}
                      required
                    />
                  </label>
                  {selectedConnector.kind === "upload" ? (
                    <div className="space-y-1.5 text-xs font-medium">
                      <span>{t("creativeContext.sourceReference")}</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pptx,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        className="hidden"
                        onChange={chooseFiles}
                      />
                      <input
                        ref={folderInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={chooseFiles}
                        {...({ webkitdirectory: "", directory: "" } as {
                          webkitdirectory: string;
                          directory: string;
                        })}
                      />
                      <div
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={dropFiles}
                        className="rounded-md border border-dashed border-border p-4"
                      >
                        <p className="text-xs text-muted-foreground">
                          {t("creativeContext.dropFiles")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {t("creativeContext.chooseFiles")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => folderInputRef.current?.click()}
                          >
                            {t("creativeContext.chooseFolder")}
                          </Button>
                        </div>
                        {uploadedFiles.length ? (
                          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                            {uploadedFiles.map((file) => (
                              <li key={file.id} className="truncate">
                                {file.fileName}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <label className="space-y-1.5 text-xs font-medium">
                      <span>{t("creativeContext.sourceReference")}</span>
                      {selectedConnector.kind === "website" ||
                      selectedConnector.kind === "figma" ||
                      selectedConnector.kind === "notion" ? (
                        <Textarea
                          value={sourceReference}
                          onChange={(event) =>
                            setSourceReference(event.target.value)
                          }
                          placeholder={selectedConnector.referencePlaceholder}
                          required={selectedConnector.referenceRequired}
                          rows={3}
                        />
                      ) : (
                        <Input
                          value={sourceReference}
                          onChange={(event) =>
                            setSourceReference(event.target.value)
                          }
                          placeholder={selectedConnector.referencePlaceholder}
                          required={selectedConnector.referenceRequired}
                        />
                      )}
                    </label>
                  )}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setConnectorKind(null)}
                  >
                    {t("creativeContext.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      manageSource.isPending ||
                      uploadResource.isPending ||
                      (selectedConnector.kind === "upload" &&
                        !uploadedFiles.length) ||
                      (Boolean(connectionProvider) && !selectedConnectionId) ||
                      (selectedConnector.referenceRequired &&
                        !sourceReference.trim()) ||
                      (Boolean(recommendationProvider) &&
                        !sourceReference.trim() &&
                        !selectedRecommendationIds.size)
                    }
                  >
                    <IconFileImport />
                    {t("creativeContext.preview")}
                  </Button>
                </div>
              </form>
            ) : null}

            {previewSourceId ? (
              <div className="mt-4 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {previewSourceName}
                    </h3>
                    {previewQuery.isLoading ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("creativeContext.loading")}
                      </p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t("creativeContext.discoveredItems", {
                            count: formatNumber(
                              previewQuery.data?.total ??
                                previewQuery.data?.items.length ??
                                0,
                            ),
                          })}
                        </span>
                        <span>
                          {t("creativeContext.selectedItems", {
                            count: formatNumber(selectedPreviewItemIds.size),
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    disabled={
                      previewQuery.isLoading ||
                      !previewQuery.data?.items.length ||
                      !selectedPreviewItemIds.size ||
                      startImport.isPending ||
                      importJob?.status === "queued" ||
                      importJob?.status === "running"
                    }
                    onClick={() => void beginImport()}
                  >
                    <IconFileImport />
                    {startImport.isPending
                      ? t("creativeContext.importing")
                      : t("creativeContext.startImport")}
                  </Button>
                </div>
                {previewQuery.data?.items.length ? (
                  <div className="mt-3">
                    <div className="flex items-center gap-2 border-y border-border/60 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedPreviewItemIds(
                            new Set(
                              previewQuery.data?.items.map(
                                (item) => item.externalId,
                              ) ?? [],
                            ),
                          )
                        }
                      >
                        {t("creativeContext.selectAll")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPreviewItemIds(new Set())}
                      >
                        {t("creativeContext.clearSelection")}
                      </Button>
                    </div>
                    <div className="max-h-80 divide-y divide-border/60 overflow-y-auto">
                      {previewQuery.data.items.map((item) => (
                        <label
                          key={item.externalId}
                          className="flex cursor-pointer items-start gap-3 py-2"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedPreviewItemIds.has(
                              item.externalId,
                            )}
                            onCheckedChange={(checked) =>
                              setSelectedPreviewItemIds((current) => {
                                const next = new Set(current);
                                if (checked) next.add(item.externalId);
                                else next.delete(item.externalId);
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {item.title}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {item.kind}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {importJob ? (
              <div className="mt-4 rounded-md border border-border p-4">
                <div className="flex items-center gap-2">
                  {importJob.status === "completed" ? (
                    <IconCheck className="size-5 text-emerald-600" />
                  ) : importJob.status === "failed" ? (
                    <IconAlertTriangle className="size-5 text-destructive" />
                  ) : (
                    <IconRefresh className="size-5 animate-spin text-muted-foreground" />
                  )}
                  <h3 className="text-sm font-semibold">
                    {importJob.status === "completed"
                      ? t("creativeContext.importComplete")
                      : importJob.status === "failed"
                        ? t("creativeContext.importFailed")
                        : t("creativeContext.importing")}
                  </h3>
                </div>
                {importJob.status === "completed" && brandProposal ? (
                  <div className="mt-4 rounded-md bg-muted/50 p-4">
                    <div className="flex items-start gap-3">
                      <IconSparkles className="mt-0.5 size-5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold">
                          {t("creativeContext.brandDnaTitle")}
                        </h4>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {brandProposal.summary}
                        </p>
                        {brandProposal.colors.length ? (
                          <div className="mt-4">
                            <p className="text-xs font-medium">
                              {t("creativeContext.colors")}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {brandProposal.colors.map((color) => (
                                <div
                                  key={color}
                                  className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs"
                                >
                                  <span
                                    className="size-4 rounded-sm border border-black/10"
                                    style={{ backgroundColor: color }}
                                  />
                                  {color}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {brandProposal.fonts.length ? (
                          <div className="mt-4">
                            <p className="text-xs font-medium">
                              {t("creativeContext.fonts")}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {brandProposal.fonts.map((font) => (
                                <Badge key={font} variant="outline">
                                  {font}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {brandLayoutThumbnails.length ? (
                          <div className="mt-4">
                            <p className="text-xs font-medium">
                              {t("creativeContext.layouts")}
                            </p>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {brandLayoutThumbnails.map((thumbnail) => (
                                <AccessScopedThumbnail
                                  key={thumbnail.itemVersionId}
                                  itemId={thumbnail.itemId}
                                  itemVersionId={thumbnail.itemVersionId}
                                  className="aspect-video w-full rounded border border-border object-cover"
                                />
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {brandVoicePreview ? (
                          <div className="mt-4">
                            <p className="text-xs font-medium">
                              {t("creativeContext.voice")}
                            </p>
                            <blockquote className="mt-1 border-s-2 border-border ps-3 text-sm text-muted-foreground">
                              {brandVoicePreview}
                            </blockquote>
                          </div>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            disabled={publishBrandDna.isPending}
                            onClick={() => void publishProposal()}
                          >
                            <IconSparkles />
                            {publishBrandDna.isPending
                              ? t("creativeContext.applyingBrandContext")
                              : t("creativeContext.applyBrandContext")}
                          </Button>
                          <Button asChild type="button" variant="outline">
                            <a href="/agent">
                              {t("creativeContext.generateWithContext")}
                              <IconArrowUpRight />
                            </a>
                          </Button>
                        </div>
                        {publishedMessage ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {publishedMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : importJob.error ? (
                  <p className="mt-2 text-sm text-destructive">
                    {importJob.error}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatNumber(importJob.progressCurrent)} /{" "}
                    {formatNumber(importJob.progressTotal ?? 0)}
                  </p>
                )}
              </div>
            ) : null}
            {promotionPreview ? (
              <div className="mt-4 rounded-md border border-border p-4">
                <h3 className="text-sm font-semibold">
                  {t("creativeContext.promoteToOrganization")}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("creativeContext.promotionDescription")}
                </p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">
                      {t("creativeContext.sourceReference")}
                    </dt>
                    <dd className="mt-0.5 truncate font-medium">
                      {promotionPreview.containerRef}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("creativeContext.itemsLabel", { count: "" })}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {formatNumber(promotionPreview.itemCount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("creativeContext.restrictedItems", { count: "" })}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {formatNumber(promotionPreview.restrictedItemCount)}
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  className="mt-4"
                  disabled={manageSource.isPending}
                  onClick={() => void confirmPromotion()}
                >
                  {t("creativeContext.promoteToOrganization")}
                </Button>
              </div>
            ) : null}
            {promotionMessage ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {promotionMessage}
              </p>
            ) : null}
            {setupError ? (
              <p className="mt-2 text-sm text-destructive">{setupError}</p>
            ) : null}
          </section>

          <section className="border-t border-border/70 pt-6">
            <h2 className="text-lg font-semibold">
              {t("creativeContext.sourcesTitle")}
            </h2>
            {sources.length ? (
              <div className="mt-3">
                {sources.map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    refreshing={
                      refreshSource.isPending &&
                      refreshSource.variables?.sourceId === source.id
                    }
                    canReview={canManageScope}
                    canPromote={
                      libraryScope === "user" &&
                      Boolean(org?.orgId) &&
                      canManageOrg &&
                      source.visibility === "private"
                    }
                    onRefresh={refresh}
                    onReview={(selected) =>
                      void openItemCuration(selected, "restricted")
                    }
                    onCurate={(selected) => void openItemCuration(selected)}
                    onPromote={(selected) =>
                      void previewSourcePromotion(selected)
                    }
                    onPause={(selected) => void pauseSource(selected)}
                    onRestore={(selected) => void restoreSource(selected)}
                    onDelete={setDeleteSource}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center">
                <IconBooks className="mx-auto size-7 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold">
                  {t("creativeContext.noSourcesTitle")}
                </h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  {t("creativeContext.noSourcesDescription")}
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <a href={connectionsHref}>
                    {t("creativeContext.connectSources")}
                    <IconArrowUpRight />
                  </a>
                </Button>
              </div>
            )}
            {reviewSource ? (
              <ItemCuration
                source={reviewSource}
                items={reviewedItems}
                busy={reviewItems.isPending}
                onReview={(operation, itemId) =>
                  void reviewContextItem(operation, itemId)
                }
                onClose={() => {
                  setReviewSource(null);
                  setReviewedItems([]);
                }}
              />
            ) : null}
            {reviewError ? (
              <p className="mt-2 text-sm text-destructive">{reviewError}</p>
            ) : null}
            {refreshMessage ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {refreshMessage}
              </p>
            ) : null}
            {lifecycleMessage ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {lifecycleMessage}
              </p>
            ) : null}
          </section>

          <section className="border-t border-border/70 pt-6">
            <h2 className="text-lg font-semibold">
              {t("creativeContext.packsTitle")}
            </h2>
            {packs.length ? (
              <div className="mt-3">
                {packs.map((pack) => (
                  <PackRow
                    key={pack.id}
                    pack={pack}
                    pinned={contextState.state.pinnedPackId === pack.id}
                    disabled={savingState}
                    onPin={(packId) => void changePinnedPack(packId)}
                    onDetails={setSelectedPackId}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
                {t("creativeContext.noPacks")}
              </p>
            )}
            {selectedPackId ? (
              <div className="mt-4 rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {packQuery.data?.pack?.name ??
                        t("creativeContext.packDetails")}
                    </h3>
                    {packQuery.data?.pack?.derivedFromPackId ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("creativeContext.influence")}:{" "}
                        {packQuery.data.pack.derivedFromPackId}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPackId(null)}
                  >
                    {t("creativeContext.cancel")}
                  </Button>
                </div>
                {packQuery.data?.pack?.members.length ? (
                  <div className="mt-3 divide-y divide-border/60">
                    {packQuery.data.pack.members.map((member) => (
                      <div key={member.id} className="py-2 text-xs">
                        <p className="font-medium">{member.itemId}</p>
                        {member.reason ? (
                          <p className="mt-0.5 text-muted-foreground">
                            {t("creativeContext.influence")}: {member.reason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="border-t border-border/70 pt-6">
            <div>
              <h2 className="text-lg font-semibold">
                {t("creativeContext.searchTitle")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("creativeContext.searchDescription")}
              </p>
            </div>
            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => void search(event)}
            >
              <div className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("creativeContext.searchPlaceholder")}
                  aria-label={t("creativeContext.searchPlaceholder")}
                  className="ps-9"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={
                  !query.trim() || !sources.length || searchContext.isPending
                }
              >
                <IconSearch />
                {t("creativeContext.searchTitle")}
              </Button>
            </form>
            {searchError ? (
              <p className="mt-4 text-sm text-destructive">{searchError}</p>
            ) : !searchContext.data && !searchContext.isPending ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("creativeContext.searchPrompt")}
              </p>
            ) : searchContext.isPending ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : searchContext.data?.results.length ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {t("creativeContext.resultsLabel", {
                    count: formatNumber(searchContext.data.results.length),
                  })}
                </p>
                {searchContext.data.results.map((result) => (
                  <article
                    key={`${result.itemVersionId}:${result.chunkId ?? "item"}`}
                    className="rounded-md border border-border/70 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium">
                          {result.title}
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {result.sourceName} · {result.kind}
                        </p>
                      </div>
                      {result.canonicalUrl ? (
                        <Button asChild variant="ghost" size="icon">
                          <a
                            href={result.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={result.title}
                          >
                            <IconArrowUpRight />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {result.excerpt}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("creativeContext.noResults")}
              </p>
            )}
          </section>
        </>
      )}
      <ContextPreviewSheet
        manifest={previewManifest}
        onOpenChange={(open) => {
          if (!open) setPreviewManifest(null);
        }}
      />
      <AlertDialog
        open={Boolean(deleteSource)}
        onOpenChange={(open) => {
          if (!open) setDeleteSource(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("creativeContext.deleteSourceTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("creativeContext.deleteSourceDescription", {
                name: deleteSource?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("creativeContext.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDeleteSource()}
            >
              {t("creativeContext.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
