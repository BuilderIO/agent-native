import {
  useBuilderConnectFlow,
  useBuilderStatus,
  useCodeMode,
} from "@agent-native/core/client";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type BuilderCmsModelSummary,
  type ContentDatabaseItem,
  type ContentDatabaseOpenPagesIn,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ContentDatabaseSourceJoinRequest,
  type ContentDatabaseSourceReviewPayload,
  type ContentDatabaseView,
  type ContentDatabaseViewType,
  type DocumentProperty,
  type DocumentPropertyType,
  type DocumentPropertyValue,
  type SourceJoinSuggestion,
} from "@shared/api";
import { evaluateNormalizationFormula } from "@shared/properties";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconLayoutGrid,
  IconLayoutKanban,
  IconList,
  IconLock,
  IconPencil,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTimeline,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  useAddContentDatabaseSourceFieldProperty,
  useBuilderCmsModels,
  useContentDatabases,
  useSuggestSourceJoinKey,
} from "@/hooks/use-content-database";
import { cn } from "@/lib/utils";

import { resolveBuilderCmsWriteEffect } from "../../../../actions/_builder-cms-write-adapter.js";
import { AddProperty, TYPE_ICONS } from "../DocumentProperties";
import {
  databaseViewGroupableProperties,
  databaseViewGroupingProperty,
} from "./grouping";
import {
  databasePropertyPickerItems,
  databaseToolbarIconButtonClass,
  databaseViewIcon,
} from "./shared";
import { dbText } from "./text";
import {
  DATABASE_OPEN_PAGES_IN,
  DATABASE_VIEW_TYPES,
  type ColumnKey,
  type DatabaseFilterMode,
} from "./types";
import { databaseViewDefaultName } from "./view-config";
import { isDatabasePropertyVisibleInView } from "./view-state";

export type DatabaseSettingsPanel =
  | "main"
  | "source"
  | "layout"
  | "property_visibility"
  | "group";

// One step in the Sources drill-down: Sources (root, empty stack) → provider
// (Builder) → space → model leaf. The model step carries the full summary so
// the leaf can attach without re-fetching.
// A second source being added, awaiting the canonical-key confirm step.
type PendingSourceCandidate = {
  sourceType: "mock-local" | "builder-cms" | "local-table";
  sourceName: string;
  sourceTable: string;
  displayName: string;
  existingSourceId?: string;
};

type SourceNavStep =
  | { kind: "provider"; providerId: "builder" }
  | { kind: "space"; spaceId: string; spaceName: string }
  | { kind: "model"; model: BuilderCmsModelSummary }
  | { kind: "addSource" }
  | { kind: "secondarySource"; sourceId: string; sourceName: string }
  | { kind: "keyConfirm"; candidate: PendingSourceCandidate }
  | { kind: "fieldPicker"; sourceId: string; sourceName: string };

function sourceNavTitle(stack: SourceNavStep[]): string {
  const top = stack[stack.length - 1];
  if (!top) return dbText("sources");
  if (top.kind === "provider") return "Builder";
  if (top.kind === "space") return top.spaceName;
  if (top.kind === "addSource") return dbText("addASource");
  if (top.kind === "secondarySource") return top.sourceName;
  if (top.kind === "keyConfirm") return dbText("matchExistingItemsToDetails");
  if (top.kind === "fieldPicker") return dbText("chooseFields");
  return top.model.displayName;
}

// The Builder "B" brand mark (first glyph of the wordmark), drawn with
// currentColor so it themes against the panel background.
function BuilderLogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 71 80"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M70.86 24C70.86 10.69 60.06 0 46.86 0H6.31995C2.81995 0 0 2.84031 0 6.32031C0 12.8003 13.71 17.71 13.71 40C13.71 62.29 0 67.2102 0 73.6802C0 77.1602 2.81995 80 6.31995 80H46.86C60.06 80 70.86 69.31 70.86 56C70.86 46.22 64.98 40.25 64.75 40C64.98 39.75 70.86 33.78 70.86 24ZM8.37 6.86035H46.87C51.45 6.86035 55.75 8.64037 58.99 11.8804C62.23 15.1204 64.01 19.42 64.01 24C64.01 28.58 62.3199 32.62 59.3199 35.79L8.37 6.86035ZM58.99 68.1304C55.75 71.3704 51.45 73.1504 46.87 73.1504H8.37L59.3199 44.2202C62.3199 47.3902 64.01 51.5703 64.01 56.0103C64.01 60.4503 62.23 64.8904 58.99 68.1304ZM15.83 61.02C16.24 60.17 20.58 51.74 20.58 40C20.58 28.26 16.24 19.83 15.83 18.98L52.85 40L15.83 61.02Z" />
    </svg>
  );
}

// The Notion logo, reusing the shared `.notion-logo-icon` styling (same mark as
// the sidebar's Notion button) so it themes consistently.
function NotionLogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("notion-logo-icon", className)}
      aria-hidden="true"
    >
      <path
        className="notion-logo-icon-face"
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
      />
      <path
        className="notion-logo-icon-mark"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
      />
    </svg>
  );
}

export function DatabaseSettingsPanelSheet({
  open,
  panel,
  documentId,
  canEdit,
  activeView,
  properties,
  items,
  source,
  sources,
  hiddenCount,
  groupIds,
  onClose,
  onPanelChange,
  onAttachBuilderSource,
  onFederateSource,
  onChangeSourceRole,
  onDisconnectSecondary,
  onRefreshSource,
  onHydrateBuilderBodies,
  onDisconnectSource,
  onReviewBuilderUpdate,
  onSetBuilderLiveWrites,
  sourceActionPending,
  onViewTypeChange,
  onWrapCellsChange,
  onOpenPagesInChange,
  onPropertyHiddenChange,
  onPropertiesHiddenChange,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onGroupsCollapsedChange,
}: {
  open: boolean;
  panel: DatabaseSettingsPanel;
  documentId: string;
  canEdit: boolean;
  activeView: ContentDatabaseView;
  properties: DocumentProperty[];
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  hiddenCount: number;
  groupIds: string[];
  onClose: () => void;
  onPanelChange: (panel: DatabaseSettingsPanel) => void;
  onAttachBuilderSource: (
    model: BuilderCmsModelSummary,
    relationshipMode?: "items" | "details",
  ) => Promise<ContentDatabaseResponse>;
  onFederateSource: (
    candidate: PendingSourceCandidate,
    join: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onChangeSourceRole: (
    sourceId: string,
    relationshipMode: "items" | "details",
    join?: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onDisconnectSecondary: (sourceId: string) => void;
  onRefreshSource: (sourceId?: string) => void;
  onHydrateBuilderBodies: (sourceId: string) => void;
  onDisconnectSource: (sourceId?: string) => void;
  onReviewBuilderUpdate: () => void;
  onSetBuilderLiveWrites: (enabled: boolean) => void;
  sourceActionPending: boolean;
  onViewTypeChange: (type: ContentDatabaseViewType) => void;
  onWrapCellsChange: (wrapCells: boolean) => void;
  onOpenPagesInChange: (openPagesIn: ContentDatabaseOpenPagesIn) => void;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  // Local drill-down path *within* the Source(s) panel. Kept here (not in the
  // flat panel enum) because the levels are dynamic — space/model names aren't
  // known at compile time. The sheet's back button pops this stack first.
  const [sourceNavStack, setSourceNavStack] = useState<SourceNavStep[]>([]);
  useEffect(() => {
    // Always re-enter the Sources panel at its root, and don't retain a path
    // across close/reopen.
    if (!open || panel !== "source") setSourceNavStack([]);
  }, [open, panel]);

  if (!open) return null;

  const title =
    panel === "main"
      ? "Database settings"
      : panel === "source"
        ? sourceNavTitle(sourceNavStack)
        : databaseSettingsPanelTitle(panel);

  const handleBack = () => {
    if (panel === "source" && sourceNavStack.length > 0) {
      setSourceNavStack((stack) => stack.slice(0, -1));
      return;
    }
    onPanelChange("main");
  };

  return (
    <aside
      className="fixed bottom-0 right-0 top-12 z-40 flex w-[320px] max-w-[calc(100vw-1rem)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgba(15,23,42,0.06)]"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        {panel === "main" ? null : (
          <button
            type="button"
            aria-label="Back"
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleBack}
          >
            <IconArrowLeft className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </div>
        <button
          type="button"
          aria-label={dbText("closeDatabaseSettings")}
          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
        >
          <IconX className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        {panel === "main" ? (
          <DatabaseSettingsMainPanel
            activeView={activeView}
            source={source}
            sourceCount={sources.length || (source ? 1 : 0)}
            propertyCount={properties.length}
            hiddenCount={hiddenCount}
            onPanelChange={onPanelChange}
          />
        ) : panel === "source" ? (
          <DatabaseSettingsSourcePanel
            source={source}
            sources={sources}
            documentId={documentId}
            itemCount={items.length}
            canEdit={canEdit}
            nav={sourceNavStack}
            onNavPush={(step) => setSourceNavStack((stack) => [...stack, step])}
            onNavReplace={setSourceNavStack}
            onAttachBuilderSource={onAttachBuilderSource}
            onFederateSource={onFederateSource}
            onChangeSourceRole={onChangeSourceRole}
            onDisconnectSecondary={(sourceId) => {
              onDisconnectSecondary(sourceId);
              setSourceNavStack([]);
            }}
            onRefreshSource={onRefreshSource}
            onHydrateBuilderBodies={onHydrateBuilderBodies}
            onDisconnectSource={onDisconnectSource}
            onReviewBuilderUpdate={onReviewBuilderUpdate}
            onSetBuilderLiveWrites={onSetBuilderLiveWrites}
            sourceActionPending={sourceActionPending}
          />
        ) : panel === "layout" ? (
          <DatabaseSettingsLayoutPanel
            activeView={activeView}
            onViewTypeChange={onViewTypeChange}
            onWrapCellsChange={onWrapCellsChange}
            onOpenPagesInChange={onOpenPagesInChange}
          />
        ) : panel === "property_visibility" ? (
          <DatabaseSettingsPropertyVisibilityPanel
            documentId={documentId}
            properties={properties}
            activeView={activeView}
            items={items}
            source={source}
            sources={sources}
            hiddenCount={hiddenCount}
            onPropertyHiddenChange={onPropertyHiddenChange}
            onPropertiesHiddenChange={onPropertiesHiddenChange}
          />
        ) : panel === "group" ? (
          <DatabaseSettingsGroupPanel
            activeView={activeView}
            properties={properties}
            groupIds={groupIds}
            onGroupByChange={onGroupByChange}
            onHideEmptyGroupsChange={onHideEmptyGroupsChange}
            onGroupsCollapsedChange={onGroupsCollapsedChange}
          />
        ) : null}
      </div>
    </aside>
  );
}

function databaseSettingsPanelTitle(panel: DatabaseSettingsPanel) {
  if (panel === "source") return "Source";
  if (panel === "layout") return "Layout";
  if (panel === "property_visibility") return "Property visibility";
  if (panel === "group") return "Group";
  return "Database settings";
}

function DatabaseSettingsMainPanel({
  activeView,
  source,
  sourceCount,
  propertyCount,
  hiddenCount,
  onPanelChange,
}: {
  activeView: ContentDatabaseView;
  source: ContentDatabaseSource | null;
  sourceCount: number;
  propertyCount: number;
  hiddenCount: number;
  onPanelChange: (panel: DatabaseSettingsPanel) => void;
}) {
  const groupLabel = activeView.groupByPropertyId ? "On" : "";
  const sourceBadgeCount = builderReviewableChangeSets(source).length;
  return (
    <div className="grid gap-3">
      <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-2">
        {databaseViewIconElement(
          activeView.type,
          "size-4 text-muted-foreground",
        )}
        <Input
          value={activeView.name}
          readOnly
          aria-label={dbText("viewName")}
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="grid gap-1">
        <DatabaseSettingsRow
          icon={<IconPlugConnected className="size-4" />}
          label="Sources"
          value={sourceCount > 0 ? `${sourceCount} connected` : "None"}
          badgeCount={sourceBadgeCount}
          onClick={() => onPanelChange("source")}
        />
        <DatabaseSettingsRow
          icon={databaseViewIconElement(activeView.type)}
          label="Layout"
          value={databaseViewDefaultName(activeView.type)}
          onClick={() => onPanelChange("layout")}
        />
        <DatabaseSettingsRow
          icon={<IconEye className="size-4" />}
          label={dbText("propertyVisibility")}
          value={propertyCount > 0 ? String(propertyCount - hiddenCount) : ""}
          onClick={() => onPanelChange("property_visibility")}
        />
        <DatabaseSettingsRow
          icon={<IconLayoutKanban className="size-4" />}
          label="Group"
          value={groupLabel}
          onClick={() => onPanelChange("group")}
        />
      </div>
    </div>
  );
}

export function builderReviewableChangeSets(
  source: ContentDatabaseSource | null,
) {
  if (source?.sourceType !== "builder-cms") return [];
  return source.changeSets.filter(
    (changeSet) =>
      changeSet.direction === "outbound" &&
      (changeSet.state === "pending_push" ||
        changeSet.state === "staged_revision" ||
        changeSet.state === "approved"),
  );
}

function sourceReviewRiskRank(
  risk: ContentDatabaseSourceReviewPayload["riskLevel"],
) {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function maxSourceReviewRisk(
  current: ContentDatabaseSourceReviewPayload["riskLevel"],
  next: ContentDatabaseSourceReviewPayload["riskLevel"],
) {
  return sourceReviewRiskRank(next) > sourceReviewRiskRank(current)
    ? next
    : current;
}

export function builderReviewExecutableRows(
  review: ContentDatabaseSourceReviewPayload,
) {
  if (!review.liveWritesEnabled || review.result.status !== "validated") {
    return [];
  }
  return review.rows.filter(
    (row) => row.execution?.state === "ready" && row.execution.idempotencyKey,
  );
}

export function builderSourceLiveWriteControlState(
  source: ContentDatabaseSource | null,
) {
  const isBuilderSource = source?.sourceType === "builder-cms";
  const safeTarget =
    isBuilderSource && source?.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL;
  const enabled = source?.capabilities.liveWritesEnabled === true;
  return {
    safeTarget,
    enabled,
    showAction: safeTarget,
    actionLabel: enabled ? "Disable" : "Enable",
    description: enabled
      ? "Enabled for autosave writes to the Agent Native test collection."
      : safeTarget
        ? "Off by default. Enable only when you are ready to send autosave writes to the Agent Native test collection."
        : isBuilderSource
          ? "Unavailable here; live writes are locked to the Agent Native test collection."
          : "Live writes are not available for this source.",
  };
}

export function buildClientBuilderReviewPayload(
  source: ContentDatabaseSource,
  changeSets: ContentDatabaseSourceChangeSet[],
): ContentDatabaseSourceReviewPayload {
  let riskLevel: ContentDatabaseSourceReviewPayload["riskLevel"] = "low";
  const riskReasons = new Set<string>();
  const rows = changeSets.map((changeSet) => {
    riskLevel = maxSourceReviewRisk(riskLevel, changeSet.riskLevel);
    changeSet.riskReasons.forEach((reason) => riskReasons.add(reason));
    if (changeSet.conflictState === "source_changed") {
      riskLevel = maxSourceReviewRisk(riskLevel, "medium");
      riskReasons.add("source changed");
    }
    const sourceRow =
      source.rows.find(
        (row) =>
          row.documentId === changeSet.documentId ||
          row.databaseItemId === changeSet.databaseItemId,
      ) ?? null;
    const latestExecution =
      changeSet.executions[changeSet.executions.length - 1] ?? null;
    const titleChange = changeSet.fieldChanges.find(
      (field) => field.localFieldKey === "title",
    );
    const proposedTitle = titleChange?.proposedValue;

    return {
      changeSetId: changeSet.id,
      databaseItemId: changeSet.databaseItemId,
      documentId: changeSet.documentId,
      title:
        typeof proposedTitle === "string" && proposedTitle.trim()
          ? proposedTitle
          : sourceRow?.sourceDisplayKey || "Untitled",
      fieldChanges: changeSet.fieldChanges,
      bodyChange: changeSet.bodyChange,
      riskLevel: changeSet.riskLevel,
      riskReasons: changeSet.riskReasons,
      conflictState: changeSet.conflictState,
      effect: resolveBuilderCmsWriteEffect({ source, changeSet }),
      execution: latestExecution,
    };
  });
  const statuses = rows
    .map((row) => builderExecutionDryRunStatus(row.execution?.payload ?? {}))
    .filter(
      (
        status,
      ): status is {
        status: "validated" | "stale" | "blocked";
        validatedAt: string | null;
      } => !!status,
    );
  const executionStates = rows
    .map((row) => row.execution?.state)
    .filter(Boolean);
  const hasExecutionEvidence =
    statuses.length > 0 || executionStates.length > 0;
  const resultStatus =
    executionStates.length > 0 &&
    executionStates.every((state) => state === "succeeded")
      ? "succeeded"
      : executionStates.includes("failed")
        ? "failed"
        : executionStates.includes("running")
          ? "running"
          : statuses.some((status) => status.status === "stale")
            ? "stale"
            : statuses.some((status) => status.status === "blocked")
              ? "blocked"
              : statuses.some((status) => status.status === "validated")
                ? "validated"
                : source.capabilities.liveWritesEnabled
                  ? "validated"
                  : "write_disabled";

  return {
    summary:
      rows.length === 1
        ? "1 Builder row has changes ready to review."
        : `${rows.length} Builder rows have changes ready to review.`,
    sourceName: source.sourceName,
    sourceTable: source.sourceTable,
    pushMode: source.metadata.pushMode ?? "autosave",
    dryRunOnly: !source.capabilities.liveWritesEnabled,
    liveWritesEnabled: source.capabilities.liveWritesEnabled,
    riskLevel,
    riskReasons: Array.from(riskReasons),
    rows,
    result: {
      status: resultStatus,
      message:
        resultStatus === "succeeded"
          ? "Pushed to Builder and reconciled locally."
          : resultStatus === "failed"
            ? "Builder push failed. The change remains retryable."
            : resultStatus === "running"
              ? "Builder push is running."
              : resultStatus === "validated"
                ? source.capabilities.liveWritesEnabled
                  ? hasExecutionEvidence
                    ? "Push checked successfully. Ready to send to Builder."
                    : "Ready to send to Builder."
                  : "Push checked successfully. Nothing was sent to Builder."
                : resultStatus === "blocked"
                  ? "Push needs attention before anything can be sent to Builder."
                  : resultStatus === "stale"
                    ? "Push needs a fresh review because the plan changed."
                    : "Builder writes are off in this local build. Push will check the update only.",
    },
  };
}

function DatabaseSettingsSourcePanel({
  source,
  sources,
  documentId,
  itemCount,
  canEdit,
  nav,
  onNavPush,
  onNavReplace,
  onAttachBuilderSource,
  onFederateSource,
  onChangeSourceRole,
  onDisconnectSecondary,
  onRefreshSource,
  onHydrateBuilderBodies,
  onDisconnectSource,
  onReviewBuilderUpdate,
  onSetBuilderLiveWrites,
  sourceActionPending,
}: {
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  documentId: string;
  itemCount: number;
  canEdit: boolean;
  nav: SourceNavStep[];
  onNavPush: (step: SourceNavStep) => void;
  onNavReplace: (stack: SourceNavStep[]) => void;
  onAttachBuilderSource: (
    model: BuilderCmsModelSummary,
    relationshipMode?: "items" | "details",
  ) => Promise<ContentDatabaseResponse>;
  onFederateSource: (
    candidate: PendingSourceCandidate,
    join: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onChangeSourceRole: (
    sourceId: string,
    relationshipMode: "items" | "details",
    join?: ContentDatabaseSourceJoinRequest,
  ) => Promise<ContentDatabaseResponse>;
  onDisconnectSecondary: (sourceId: string) => void;
  onRefreshSource: (sourceId?: string) => void;
  onHydrateBuilderBodies: (sourceId: string) => void;
  onDisconnectSource: (sourceId?: string) => void;
  onReviewBuilderUpdate: () => void;
  onSetBuilderLiveWrites: (enabled: boolean) => void;
  sourceActionPending: boolean;
}) {
  const outboundChangeSets =
    source?.changeSets.filter(
      (changeSet) => changeSet.direction === "outbound",
    ) ?? [];
  const reviewableBuilderChangeSets = outboundChangeSets.filter(
    (changeSet) =>
      changeSet.state === "pending_push" ||
      changeSet.state === "staged_revision" ||
      changeSet.state === "approved",
  );
  const conflictChangeSets =
    source?.changeSets.filter(
      (changeSet) => changeSet.conflictState === "source_changed",
    ) ?? [];
  const { isCodeMode } = useCodeMode();
  const isBuilderSource = source?.sourceType === "builder-cms";
  const builderStatus = useBuilderStatus();
  const builderConfigured = builderStatus.status?.configured === true;
  const builderOrgName = builderStatus.status?.orgName ?? null;
  // Real space name(s) from the Admin API, falling back to the generic org
  // name (then a constant) so the drill-down never renders a blank label.
  const builderSpaces =
    builderStatus.status?.spaces && builderStatus.status.spaces.length > 0
      ? builderStatus.status.spaces
      : builderOrgName
        ? [{ id: "builder-space", name: builderOrgName }]
        : [{ id: "builder-space", name: dbText("builderSpace") }];
  const builderSpaceLabel = builderSpaces[0]?.name ?? builderOrgName;
  const connect = useBuilderConnectFlow({
    trackingSource: "database_source_panel",
    onConnected: () => {
      void builderStatus.refetch();
    },
  });
  const builderSyncFailed =
    isBuilderSource &&
    (source?.syncState === "error" || Boolean(source?.lastError));

  // Auto-sync: the manual Refresh button is gone, so pull the read-only
  // snapshot when the panel opens and whenever the window regains focus.
  // Throttled so rapid focus changes don't hammer Builder; the refresh
  // mutation is silent (no toast), so this stays quiet in the background.
  const refreshSourceRef = useRef(onRefreshSource);
  refreshSourceRef.current = onRefreshSource;
  const lastAutoSyncRef = useRef(0);
  const autoSyncEnabled = Boolean(source) && isBuilderSource && canEdit;
  useEffect(() => {
    if (!autoSyncEnabled) return;
    const maybeSync = () => {
      const now = Date.now();
      if (now - lastAutoSyncRef.current < 15_000) return;
      lastAutoSyncRef.current = now;
      refreshSourceRef.current();
    };
    maybeSync();
    const onFocus = () => maybeSync();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [autoSyncEnabled]);

  const top = nav[nav.length - 1];

  // ── Sources list (root) ───────────────────────────────────────────────
  if (!top) {
    return (
      <SourcesListView
        source={source}
        sources={sources}
        builderConfigured={builderConfigured}
        builderSpaceLabel={builderSpaceLabel}
        reviewableCount={reviewableBuilderChangeSets.length}
        onOpenBuilder={() =>
          onNavPush({ kind: "provider", providerId: "builder" })
        }
        onOpenSecondary={(secondary) =>
          onNavPush({
            kind: "secondarySource",
            sourceId: secondary.id,
            sourceName: secondary.sourceName,
          })
        }
        onAddSource={() => onNavPush({ kind: "addSource" })}
      />
    );
  }

  // ── Add a source → local tables picker ────────────────────────────────
  if (top.kind === "addSource") {
    return (
      <AddSourceView
        excludeDatabaseIds={[
          ...(source?.databaseId ? [source.databaseId] : []),
          ...sources
            .filter((item) => item.sourceType === "local-table")
            .map((item) => item.sourceTable),
        ]}
        canEdit={canEdit}
        onPickLocalTable={(table) =>
          onNavPush({
            kind: "keyConfirm",
            candidate: {
              sourceType: "local-table",
              sourceName: table.title,
              sourceTable: table.databaseId,
              displayName: table.title,
            },
          })
        }
      />
    );
  }

  // ── Secondary (federated) source leaf ─────────────────────────────────
  if (top.kind === "secondarySource") {
    const secondary = sources.find((item) => item.id === top.sourceId) ?? null;
    return (
      <SecondarySourceLeaf
        source={secondary}
        canEdit={canEdit}
        pending={sourceActionPending}
        onAddDetails={() =>
          secondary
            ? onNavPush({
                kind: "keyConfirm",
                candidate: {
                  sourceType: secondary.sourceType,
                  sourceName: secondary.sourceName,
                  sourceTable: secondary.sourceTable,
                  displayName: secondary.sourceName,
                  existingSourceId: secondary.id,
                },
              })
            : undefined
        }
        onAddItems={async () => {
          if (!secondary) return;
          await onChangeSourceRole(secondary.id, "items");
          onNavReplace([]);
        }}
        onChooseFields={() =>
          secondary
            ? onNavPush({
                kind: "fieldPicker",
                sourceId: secondary.id,
                sourceName: secondary.sourceName,
              })
            : undefined
        }
        onDisconnect={() => onDisconnectSecondary(top.sourceId)}
      />
    );
  }

  // ── Canonical-key confirm (adding a second source) ────────────────────
  if (top.kind === "keyConfirm") {
    return (
      <CanonicalKeyConfirmView
        documentId={documentId}
        candidate={top.candidate}
        canEdit={canEdit}
        pending={sourceActionPending}
        onCommit={async (join) => {
          const result = top.candidate.existingSourceId
            ? await onChangeSourceRole(
                top.candidate.existingSourceId,
                "details",
                join,
              )
            : await onFederateSource(top.candidate, join);
          const detailsSource = findDetailsSource(result, top.candidate);
          onNavReplace(
            detailsSource
              ? [
                  {
                    kind: "fieldPicker",
                    sourceId: detailsSource.id,
                    sourceName: detailsSource.sourceName,
                  },
                ]
              : [],
          );
        }}
      />
    );
  }

  if (top.kind === "fieldPicker") {
    const pickerSource =
      sources.find((item) => item.id === top.sourceId) ?? null;
    return (
      <SourceDetailsFieldPicker
        documentId={documentId}
        source={pickerSource}
        canEdit={canEdit}
        pending={sourceActionPending}
        onDone={() => onNavReplace([])}
      />
    );
  }

  // ── Builder provider → space list ─────────────────────────────────────
  if (top.kind === "provider") {
    if (!builderConfigured) {
      // Don't flash "Connect Builder" at an already-connected user while the
      // status is still loading — show a checking state until we actually know.
      if (!builderStatus.status && builderStatus.loading) {
        return (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {dbText("checkingBuilderConnection")}
          </div>
        );
      }
      return (
        <div className="grid min-w-0 gap-3">
          <div className="min-w-0 break-words text-xs text-muted-foreground">
            {dbText("connectYourBuilderAccountToBrowseItsSpaces")}
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || connect.connecting}
              onClick={() => connect.start()}
            >
              {connect.connecting ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconExternalLink className="mr-1.5 size-3.5" />
              )}
              Connect Builder
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-w-0 gap-1.5">
        {builderSpaces.map((space) => (
          <DatabaseSettingsRow
            key={space.id}
            icon={<IconLayoutGrid className="size-4" />}
            label={space.name}
            onClick={() =>
              onNavPush({
                kind: "space",
                spaceId: space.id,
                spaceName: space.name,
              })
            }
          />
        ))}
      </div>
    );
  }

  // ── Space → model list ────────────────────────────────────────────────
  if (top.kind === "space") {
    return (
      <BuilderSpaceModelsView
        attachedModelName={
          isBuilderSource ? (source?.sourceTable ?? null) : null
        }
        onOpenModel={(model) => onNavPush({ kind: "model", model })}
      />
    );
  }

  // ── Model leaf ────────────────────────────────────────────────────────
  const model = top.model;
  const isAttachedModel =
    Boolean(source) && isBuilderSource && source?.sourceTable === model.name;

  // Unattached model → the attach affordance (the model is already chosen by
  // drilling in, so there's no model picker here).
  if (!isAttachedModel || !source) {
    return (
      <div className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="truncate font-medium" title={model.displayName}>
            {model.displayName}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded border border-border px-1.5 py-0.5">
              {model.name}
            </span>
            <span className="rounded border border-border px-1.5 py-0.5">
              {model.fields.length} fields
            </span>
            <span className="rounded border border-border px-1.5 py-0.5">
              read-only
            </span>
          </div>
        </div>
        {sources.length > 0 || source ? (
          <SourceRelationshipChoice
            documentId={documentId}
            candidate={{
              sourceType: "builder-cms",
              sourceName: model.displayName,
              sourceTable: model.name,
              displayName: model.displayName,
            }}
            canEdit={canEdit}
            pending={sourceActionPending}
            onAddDetails={() =>
              onNavPush({
                kind: "keyConfirm",
                candidate: {
                  sourceType: "builder-cms",
                  sourceName: model.displayName,
                  sourceTable: model.name,
                  displayName: model.displayName,
                },
              })
            }
            onAddItems={async () => {
              await onAttachBuilderSource(model, "items");
              onNavReplace([]);
            }}
          />
        ) : (
          <div>
            <Button
              type="button"
              size="sm"
              disabled={!canEdit || sourceActionPending}
              onClick={async () => {
                await onAttachBuilderSource(model);
                onNavReplace([]);
              }}
            >
              {sourceActionPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconPlugConnected className="mr-1.5 size-3.5" />
              )}
              Attach
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Attached model → the minimal read-only leaf panel.
  return (
    <div className="grid min-w-0 gap-4">
      <>
        <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-medium" title={source.sourceName}>
              {source.sourceName}
            </span>
            {isBuilderSource ? (
              source.capabilities.liveWritesEnabled ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">
                  <IconPencil className="size-3" />
                  {dbText("liveWritesOn")}
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <IconLock className="size-3" />
                  {dbText("readOnly")}
                </span>
              )
            ) : (
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {source.syncState}
              </span>
            )}
          </div>
          <div className="min-w-0 break-words text-xs text-muted-foreground">
            {builderSyncFailed ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-60"
                disabled={!canEdit || sourceActionPending}
                onClick={() => onRefreshSource(source.id)}
              >
                <IconRefresh className="size-3" />
                {dbText("couldntSyncRetry")}
              </button>
            ) : isBuilderSource ? (
              [
                builderConfigured ? (builderSpaceLabel ?? "Connected") : null,
                source.lastRefreshedAt
                  ? `synced ${
                      formatRelativeSyncTime(source.lastRefreshedAt) ??
                      source.freshness
                    }`
                  : source.freshness,
              ]
                .filter(Boolean)
                .join(" · ")
            ) : (
              `Local snapshot · ${source.freshness}`
            )}
          </div>
        </div>

        {reviewableBuilderChangeSets.length > 0 ||
        conflictChangeSets.length > 0 ? (
          <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {conflictChangeSets.length > 0
                    ? `${conflictChangeSets.length} change${
                        conflictChangeSets.length === 1 ? "" : "s"
                      } need review`
                    : `${reviewableBuilderChangeSets.length} change${
                        reviewableBuilderChangeSets.length === 1 ? "" : "s"
                      } ready to push`}
                </div>
                <div className="mt-0.5 break-words text-xs text-muted-foreground">
                  {dbText("reviewBeforeTheyReachBuilder")}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={!canEdit || sourceActionPending}
                onClick={onReviewBuilderUpdate}
              >
                <IconCheck className="mr-1.5 size-3.5" />
                {dbText("reviewDiff")}
              </Button>
            </div>
          </div>
        ) : null}

        {isBuilderSource && source.bodyHydration ? (
          <BuilderBodyHydrationCard
            source={source}
            canEdit={canEdit}
            pending={sourceActionPending}
            onHydrate={() => onHydrateBuilderBodies(source.id)}
          />
        ) : null}

        {isCodeMode ? (
          <>
            <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3 text-sm">
              <div className="font-medium">
                {source.sourceType === "builder-cms"
                  ? "Local Builder changes"
                  : "Local outbound changes"}
              </div>
              <div className="text-xs text-muted-foreground">
                {source.sourceType === "builder-cms"
                  ? source.capabilities.liveWritesEnabled
                    ? "Local edits can be reviewed and sent through the guarded Builder autosave path."
                    : "Local edits can be staged as a Builder save revision/autosave record. Live Builder writes are disabled."
                  : "No local outbound push lane is active for this mock source."}
              </div>
              <div className="grid min-w-0 gap-2">
                {outboundChangeSets.slice(0, 6).map((changeSet) => (
                  <SourceChangeSetReviewCard
                    key={changeSet.id}
                    changeSet={changeSet}
                    source={source}
                  />
                ))}
                {outboundChangeSets.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {source.sourceType === "builder-cms"
                      ? "No pending local Builder changes yet. Rename a source-backed row to see a local outbound diff."
                      : "No local outbound changes yet."}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        <SourceRoleCard
          source={source}
          canAddDetails={sources.some(
            (item) => item.id !== source.id && !sourceAddsDetails(item),
          )}
          canEdit={canEdit}
          pending={sourceActionPending}
          onAddDetails={() =>
            onNavPush({
              kind: "keyConfirm",
              candidate: {
                sourceType: source.sourceType,
                sourceName: source.sourceName,
                sourceTable: source.sourceTable,
                displayName: source.sourceName,
                existingSourceId: source.id,
              },
            })
          }
          onAddItems={async () => {
            await onChangeSourceRole(source.id, "items");
            onNavReplace([]);
          }}
          onChooseFields={() =>
            onNavPush({
              kind: "fieldPicker",
              sourceId: source.id,
              sourceName: source.sourceName,
            })
          }
        />

        <div className="rounded-lg border border-border bg-background p-3">
          <div className="text-xs font-medium">
            {dbText("disconnectSource")}
          </div>
          <div className="mt-0.5 break-words text-xs text-muted-foreground">
            {dbText("keepTheDatabaseRowsAndLocalPropertiesButRemoveSource")}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-8 text-xs text-destructive hover:text-destructive"
            disabled={!canEdit || sourceActionPending}
            onClick={() => onDisconnectSource(source.id)}
          >
            {sourceActionPending ? (
              <Spinner className="mr-1 size-3.5" />
            ) : (
              <IconX className="mr-1 size-3.5" />
            )}
            Disconnect
          </Button>
        </div>
      </>
    </div>
  );
}

// Root of the Sources drill-down: third-party integrations + Agent-Native apps,
// each provider a row. Builder is live; the rest are disabled "coming soon".
function SourcesListView({
  source,
  sources,
  builderConfigured,
  builderSpaceLabel,
  reviewableCount,
  onOpenBuilder,
  onOpenSecondary,
  onAddSource,
}: {
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  builderConfigured: boolean;
  builderSpaceLabel: string | null;
  reviewableCount: number;
  onOpenBuilder: () => void;
  onOpenSecondary: (source: ContentDatabaseSource) => void;
  onAddSource: () => void;
}) {
  const isBuilderSource = source?.sourceType === "builder-cms";
  const connectedSources =
    sources.length > 0 ? sources : source ? [source] : [];
  return (
    <div className="grid min-w-0 gap-4">
      {connectedSources.length === 0 ? (
        <div className="min-w-0 break-words text-xs text-muted-foreground">
          {dbText("thisDatabaseIsLocalConnectASourceToMapIts")}
        </div>
      ) : (
        <div className="grid min-w-0 gap-1.5">
          <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {dbText("connectedSources")}
          </div>
          {connectedSources.map((connected, index) => (
            <DatabaseSettingsRow
              key={connected.id}
              icon={
                connected.sourceType === "builder-cms" ? (
                  <BuilderLogoMark className="size-4" />
                ) : (
                  <IconLayoutGrid className="size-4" />
                )
              }
              label={connected.sourceName}
              value={sourceRoleLabel(connected, index)}
              onClick={
                connected.metadata.federation?.role === "secondary"
                  ? () => onOpenSecondary(connected)
                  : connected.sourceType === "builder-cms"
                    ? onOpenBuilder
                    : undefined
              }
              disabled={
                connected.metadata.federation?.role !== "secondary" &&
                connected.sourceType !== "builder-cms"
              }
            />
          ))}
          <DatabaseSettingsRow
            icon={<IconPlus className="size-4" />}
            label={dbText("addAnotherSource")}
            onClick={onAddSource}
          />
        </div>
      )}
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Integrations
        </div>
        <DatabaseSettingsRow
          icon={<BuilderLogoMark className="size-4" />}
          label="Builder"
          value={
            isBuilderSource
              ? (builderSpaceLabel ?? "Connected")
              : builderConfigured
                ? "Connected"
                : undefined
          }
          badgeCount={reviewableCount}
          onClick={onOpenBuilder}
        />
        <DatabaseSettingsRow
          icon={<NotionLogoMark className="size-4" />}
          label="Notion"
          value="Coming soon"
          disabled
        />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {dbText("agentNativeApps")}
        </div>
        <DatabaseSettingsRow
          icon={<IconTimeline className="size-4" />}
          label="Analytics"
          value="Coming soon"
          disabled
        />
      </div>
    </div>
  );
}

// Confirm the canonical-key join before federating a second source. The
// heuristic proposes a key field + normalization formula per side; the user can
// tweak the formulas and watch a live sample-match preview before committing.
function CanonicalKeyConfirmView({
  documentId,
  candidate,
  canEdit,
  pending,
  onCommit,
}: {
  documentId: string;
  candidate: PendingSourceCandidate;
  canEdit: boolean;
  pending: boolean;
  onCommit: (join: ContentDatabaseSourceJoinRequest) => void | Promise<void>;
}) {
  const suggestionQuery = useSuggestSourceJoinKey({
    documentId,
    candidateSourceType: candidate.sourceType,
    candidateSourceTable: candidate.sourceTable,
    enabled: true,
  });
  const suggestion: SourceJoinSuggestion | null =
    suggestionQuery.data?.suggestion ?? null;

  const [primaryFormula, setPrimaryFormula] = useState("");
  const [secondaryFormula, setSecondaryFormula] = useState("");
  const [primaryKeyField, setPrimaryKeyField] = useState("");
  const [secondaryKeyField, setSecondaryKeyField] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (suggestion && !hydrated) {
      setPrimaryFormula(suggestion.primary.normalizationFormula);
      setSecondaryFormula(suggestion.secondary.normalizationFormula);
      setPrimaryKeyField(suggestion.primary.keyField);
      setSecondaryKeyField(suggestion.secondary.keyField);
      setHydrated(true);
    }
  }, [suggestion, hydrated]);

  const previewRows = useMemo(() => {
    if (!suggestion) return [];
    return suggestion.sampleMatches.map((sample) => {
      const primaryNorm = evaluateNormalizationFormula(primaryFormula, {
        [primaryKeyField]: sample.primaryRaw,
      });
      const secondaryNorm = sample.secondaryRaw
        ? evaluateNormalizationFormula(secondaryFormula, {
            [secondaryKeyField]: sample.secondaryRaw,
          })
        : null;
      return {
        primaryRaw: sample.primaryRaw,
        normalized: primaryNorm,
        matched: primaryNorm !== null && primaryNorm === secondaryNorm,
      };
    });
  }, [
    suggestion,
    primaryFormula,
    secondaryFormula,
    primaryKeyField,
    secondaryKeyField,
  ]);

  const matchedCount = previewRows.filter((row) => row.matched).length;

  if (suggestionQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {dbText("checkingHowTheseRecordsMatch")}
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        {suggestionQuery.data?.message ??
          "Couldn't find a match field automatically."}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
        <div className="truncate font-medium" title={candidate.displayName}>
          {candidate.displayName}
        </div>
        <div className="min-w-0 break-words text-xs text-muted-foreground">
          Match existing items to details. Suggested match:{" "}
          <span className="font-medium text-foreground">
            {suggestion.canonicalKey.label}
          </span>
          .
        </div>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <label className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {dbText("existingSourceNormalize")}
        </label>
        <Input
          value={primaryFormula}
          onChange={(event) => setPrimaryFormula(event.target.value)}
          disabled={!canEdit}
          className="font-mono text-xs"
        />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <label className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {dbText("newSourceNormalize")}
        </label>
        <Input
          value={secondaryFormula}
          onChange={(event) => setSecondaryFormula(event.target.value)}
          disabled={!canEdit}
          className="font-mono text-xs"
        />
      </div>

      <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{dbText("sampleMatches")}</span>
          <span className="text-muted-foreground">
            {matchedCount} of {previewRows.length} match
          </span>
        </div>
        <div className="grid min-w-0 gap-1">
          {previewRows.map((row, index) => (
            <div
              key={index}
              className="flex min-w-0 items-center gap-1.5 text-[11px]"
            >
              {row.matched ? (
                <IconCheck className="size-3 shrink-0 text-foreground" />
              ) : (
                <IconX className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span
                className="truncate text-muted-foreground"
                title={row.primaryRaw}
              >
                {row.primaryRaw}
              </span>
              <span className="shrink-0 text-muted-foreground">→</span>
              <span
                className="truncate font-medium"
                title={row.normalized ?? ""}
              >
                {row.normalized ?? "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        disabled={!canEdit || pending || matchedCount === 0}
        onClick={() =>
          onCommit({
            canonicalKey: suggestion.canonicalKey,
            primary: {
              keyField: primaryKeyField,
              normalizationFormula: primaryFormula,
            },
            secondary: {
              keyField: secondaryKeyField,
              normalizationFormula: secondaryFormula,
            },
          })
        }
      >
        {pending ? (
          <Spinner className="mr-1.5 size-3.5" />
        ) : (
          <IconPlugConnected className="mr-1.5 size-3.5" />
        )}
        Add details
      </Button>
    </div>
  );
}

// Pick a second source to federate. NEXT supports local tables (any other
// workspace database); integrations beyond Builder are coming soon.
function AddSourceView({
  excludeDatabaseIds,
  canEdit,
  onPickLocalTable,
}: {
  excludeDatabaseIds: string[];
  canEdit: boolean;
  onPickLocalTable: (table: {
    databaseId: string;
    documentId: string;
    title: string;
  }) => void;
}) {
  const query = useContentDatabases({ enabled: true });
  // Exclude this database (no self-reference) and any table already federated
  // onto it — those live in the "Connected sources" group above.
  const excluded = new Set(excludeDatabaseIds);
  const tables = (query.data?.databases ?? []).filter(
    (table) => !excluded.has(table.databaseId),
  );
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {dbText("localTables")}
        </div>
        {query.isLoading ? (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {dbText("loadingTables")}
          </div>
        ) : tables.length === 0 ? (
          <div className="min-w-0 break-words px-2 text-xs text-muted-foreground">
            {dbText("noOtherDatabasesAvailableToAdd")}
          </div>
        ) : (
          tables.map((table) => (
            <DatabaseSettingsRow
              key={table.databaseId}
              icon={<IconLayoutGrid className="size-4" />}
              label={table.title}
              onClick={canEdit ? () => onPickLocalTable(table) : undefined}
              disabled={!canEdit}
            />
          ))
        )}
      </div>
      <div className="grid min-w-0 gap-1.5">
        <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Integrations
        </div>
        <DatabaseSettingsRow
          icon={<NotionLogoMark className="size-4" />}
          label="Notion"
          value="Coming soon"
          disabled
        />
      </div>
    </div>
  );
}

// A connected federated (secondary) source: read-only details + remove.
function SecondarySourceLeaf({
  source,
  canEdit,
  pending,
  onAddDetails,
  onAddItems,
  onChooseFields,
  onDisconnect,
}: {
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  onAddDetails: () => void;
  onAddItems: () => void | Promise<void>;
  onChooseFields: () => void;
  onDisconnect: () => void;
}) {
  if (!source) {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        {dbText("thisSourceIsNoLongerConnected")}
      </div>
    );
  }
  const federation = source.metadata.federation;
  const fieldCount = source.fields.length;
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-1.5 rounded-lg border border-border bg-background p-3 text-sm">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate font-medium" title={source.sourceName}>
            {source.sourceName}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <IconLock className="size-3" />
            {dbText("readOnly")}
          </span>
        </div>
        <div className="min-w-0 break-words text-xs text-muted-foreground">
          {`${sourceRoleLabel(source, 0)} · ${fieldCount} field${
            fieldCount === 1 ? "" : "s"
          }`}
          {federation?.canonicalKey?.label
            ? ` · joined on ${federation.canonicalKey.label}`
            : ""}
        </div>
      </div>
      <SourceRoleCard
        source={source}
        canEdit={canEdit}
        pending={pending}
        onAddDetails={onAddDetails}
        onAddItems={onAddItems}
        onChooseFields={onChooseFields}
      />
      {federation ? (
        <div className="grid min-w-0 gap-1 rounded-lg border border-border bg-background p-3 text-xs">
          <div className="font-medium">{dbText("matchFormula")}</div>
          <code className="block min-w-0 break-words rounded bg-muted px-1.5 py-1 font-mono text-[11px]">
            {federation.normalizationFormula}
          </code>
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="text-xs font-medium">{dbText("removeThisSource")}</div>
        <div className="mt-0.5 break-words text-xs text-muted-foreground">
          Removes the federated columns&rsquo; link to this source. Your local
          rows and columns stay.
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 h-8 text-xs text-destructive hover:text-destructive"
          disabled={!canEdit || pending}
          onClick={onDisconnect}
        >
          {pending ? (
            <Spinner className="mr-1 size-3.5" />
          ) : (
            <IconX className="mr-1 size-3.5" />
          )}
          Remove
        </Button>
      </div>
    </div>
  );
}

function sourceAddsDetails(source: ContentDatabaseSource | null | undefined) {
  return source?.metadata.federation?.role === "secondary";
}

function sourceRoleLabel(
  source: ContentDatabaseSource | null | undefined,
  _index: number,
) {
  return sourceAddsDetails(source)
    ? dbText("addingDetails")
    : dbText("addingItems");
}

function detailsReasonText(suggestion: SourceJoinSuggestion | null) {
  if (!suggestion)
    return dbText("recommendedWhenCollectionDescribesExistingRows");
  const percent = Math.round(suggestion.confidence * 100);
  return dbText("recommendedBecauseSampledRowsMatchOn", {
    field: suggestion.canonicalKey.label,
    percent,
  });
}

function findDetailsSource(
  response: ContentDatabaseResponse,
  candidate: PendingSourceCandidate,
) {
  return (
    (response.sources ?? []).find((source) => {
      if (!sourceAddsDetails(source)) return false;
      if (candidate.existingSourceId) {
        return source.id === candidate.existingSourceId;
      }
      return (
        source.sourceType === candidate.sourceType &&
        source.sourceTable === candidate.sourceTable
      );
    }) ?? null
  );
}

function SourceRelationshipChoice({
  documentId,
  candidate,
  canEdit,
  pending,
  onAddDetails,
  onAddItems,
}: {
  documentId: string;
  candidate: PendingSourceCandidate;
  canEdit: boolean;
  pending: boolean;
  onAddDetails: () => void;
  onAddItems: () => void | Promise<void>;
}) {
  const suggestionQuery = useSuggestSourceJoinKey({
    documentId,
    candidateSourceType: candidate.sourceType,
    candidateSourceTable: candidate.sourceTable,
    enabled: true,
  });
  const suggestion = suggestionQuery.data?.suggestion ?? null;
  const detailsRecommended = Boolean(suggestion);
  return (
    <div className="grid min-w-0 gap-2">
      <button
        type="button"
        disabled={!canEdit || pending}
        className={cn(
          "grid min-w-0 gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
          detailsRecommended
            ? "border-foreground/30 bg-muted/30"
            : "border-border bg-background hover:bg-muted/50",
        )}
        onClick={onAddDetails}
      >
        <span className="grid min-w-0 gap-1">
          <span className="break-words text-sm font-medium leading-snug">
            {dbText("addDetailsToExistingItems")}
          </span>
          {detailsRecommended ? (
            <span className="w-fit rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium text-background">
              {dbText("recommended")}
            </span>
          ) : null}
        </span>
        <span className="break-words text-xs text-muted-foreground">
          {suggestionQuery.isLoading
            ? dbText("checkingForMatchingFields")
            : detailsReasonText(suggestion)}
        </span>
      </button>
      <button
        type="button"
        disabled={!canEdit || pending}
        className="grid min-w-0 gap-1 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
        onClick={onAddItems}
      >
        <span className="truncate text-sm font-medium">
          {dbText("addMoreItemsToThisList")}
        </span>
        <span className="break-words text-xs text-muted-foreground">
          {dbText("bestWhenSameKindAdditionalRows")}
        </span>
      </button>
    </div>
  );
}

function SourceRoleCard({
  source,
  canAddDetails = true,
  canEdit,
  pending,
  onAddDetails,
  onAddItems,
  onChooseFields,
}: {
  source: ContentDatabaseSource;
  canAddDetails?: boolean;
  canEdit: boolean;
  pending: boolean;
  onAddDetails: () => void;
  onAddItems: () => void | Promise<void>;
  onChooseFields: () => void;
}) {
  const addingDetails = sourceAddsDetails(source);
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3">
      <div className="grid min-w-0 gap-0.5">
        <div className="text-xs font-medium">{dbText("sourceRole")}</div>
        <div className="break-words text-xs text-muted-foreground">
          {addingDetails
            ? dbText("addingDetailsMatchedOn", {
                field:
                  source.metadata.federation?.canonicalKey?.label ??
                  dbText("aField"),
              })
            : dbText("addingItemsAsRows")}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {addingDetails ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!canEdit || pending}
              onClick={onChooseFields}
            >
              {dbText("chooseFields")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={!canEdit || pending}
              onClick={onAddItems}
            >
              {dbText("addAsItems")}
            </Button>
          </>
        ) : canAddDetails ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={!canEdit || pending}
            onClick={onAddDetails}
          >
            {dbText("addDetailsInstead")}
          </Button>
        ) : (
          <div className="break-words text-xs text-muted-foreground">
            {dbText("addAnotherItemSourceBeforeChangingToDetails")}
          </div>
        )}
      </div>
    </div>
  );
}

function BuilderBodyHydrationCard({
  source,
  canEdit,
  pending,
  onHydrate,
}: {
  source: ContentDatabaseSource;
  canEdit: boolean;
  pending: boolean;
  onHydrate: () => void;
}) {
  const summary = source.bodyHydration;
  if (!summary || summary.total === 0) return null;
  const activeCount = summary.pending + summary.hydrating;
  const needsWork = activeCount > 0 || summary.error > 0;
  const hydratedLabel = dbText("builderBodiesHydrated", {
    hydrated: summary.hydrated,
    total: summary.total,
  });
  const detail = needsWork
    ? [
        activeCount > 0
          ? dbText("builderBodiesQueued", { count: activeCount })
          : null,
        summary.error > 0
          ? dbText("builderBodySyncFailed", { count: summary.error })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : dbText("builderBodiesReadyLocally");

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium">{dbText("builderBodySync")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {hydratedLabel}
          </div>
        </div>
        {needsWork ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={!canEdit || pending}
            onClick={onHydrate}
          >
            {pending ? (
              <Spinner className="mr-1 size-3.5" />
            ) : (
              <IconRefresh className="mr-1 size-3.5" />
            )}
            {summary.error > 0 ? dbText("retry") : dbText("resume")}
          </Button>
        ) : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-[width]"
          style={{
            width: `${Math.round((summary.hydrated / summary.total) * 100)}%`,
          }}
        />
      </div>
      <div className="break-words text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

const DETAIL_FIELD_NAME_HINTS = [
  "name",
  "title",
  "bio",
  "description",
  "image",
  "photo",
  "avatar",
  "url",
  "handle",
  "email",
];

function shouldPreselectDetailField(
  field: ContentDatabaseSource["fields"][number],
) {
  const key = `${field.sourceFieldKey} ${field.sourceFieldLabel}`.toLowerCase();
  if (
    field.propertyId ||
    field.mappingType === "system" ||
    field.mappingType === "title"
  ) {
    return false;
  }
  if (/(\b|\.|_)(id|created|updated|published|rev)(\b|\.|_)/i.test(key)) {
    return false;
  }
  return DETAIL_FIELD_NAME_HINTS.some((hint) => key.includes(hint));
}

function sourceFieldIconType(
  sourceFieldType: string,
): DocumentPropertyType | "name" {
  const normalized = sourceFieldType.trim().toLowerCase();
  if (normalized === "number") return "number";
  if (normalized === "datetime" || normalized === "date") return "date";
  if (normalized === "url") return "url";
  if (normalized === "boolean" || normalized === "checkbox") return "checkbox";
  if (
    normalized === "list" ||
    normalized === "array" ||
    normalized === "tags" ||
    normalized === "multi_select"
  ) {
    return "multi_select";
  }
  return "text";
}

function SourceDetailsFieldPicker({
  documentId,
  source,
  canEdit,
  pending,
  onDone,
}: {
  documentId: string;
  source: ContentDatabaseSource | null;
  canEdit: boolean;
  pending: boolean;
  onDone: () => void;
}) {
  const addField = useAddContentDatabaseSourceFieldProperty(documentId);
  const fields = useMemo(
    () =>
      (source?.fields ?? []).filter(
        (field) =>
          !field.propertyId &&
          field.mappingType !== "system" &&
          field.mappingType !== "title",
      ),
    [source],
  );
  const defaultSelectedIds = useMemo(
    () =>
      fields
        .filter(shouldPreselectDetailField)
        .slice(0, 8)
        .map((field) => field.id),
    [fields],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(defaultSelectedIds);
  }, [defaultSelectedIds]);

  if (!source) {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        {dbText("thisSourceIsNoLongerConnected")}
      </div>
    );
  }

  const selected = new Set(selectedIds);
  const toggleField = (fieldId: string) => {
    setSelectedIds((current) =>
      current.includes(fieldId)
        ? current.filter((id) => id !== fieldId)
        : [...current, fieldId],
    );
  };
  const addSelected = async () => {
    const sourceFieldIds = fields
      .filter((field) => selected.has(field.id))
      .map((field) => field.id);
    if (sourceFieldIds.length === 0) {
      onDone();
      return;
    }
    try {
      for (const sourceFieldId of sourceFieldIds) {
        await addField.mutateAsync({ documentId, sourceFieldId });
      }
      toast.success(dbText("detailFieldsAdded"), {
        description:
          sourceFieldIds.length === 1
            ? dbText("addedOneFieldFromSource")
            : dbText("addedFieldsFromSource", { count: sourceFieldIds.length }),
      });
      onDone();
    } catch (error) {
      toast.error(dbText("fieldsWereNotAdded"), {
        description:
          error instanceof Error ? error.message : dbText("tryAgain"),
      });
    }
  };

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1 rounded-lg border border-border bg-background p-3">
        <div className="truncate text-sm font-medium" title={source.sourceName}>
          {source.sourceName}
        </div>
        <div className="break-words text-xs text-muted-foreground">
          {dbText("pickDetailsBecomeColumns")}
        </div>
      </div>
      {fields.length === 0 ? (
        <div className="break-words text-xs text-muted-foreground">
          {dbText("allAvailableDetailFieldsAlreadyVisible")}
        </div>
      ) : (
        <div className="grid min-w-0 gap-1">
          {fields.map((field) => {
            const iconType = sourceFieldIconType(field.sourceFieldType);
            const Icon =
              iconType === "name" ? IconFileText : TYPE_ICONS[iconType];
            return (
              <button
                key={field.id}
                type="button"
                className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => toggleField(field.id)}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    selected.has(field.id)
                      ? "border-[#2383e2] bg-[#2383e2] text-white"
                      : "border-muted-foreground/40 text-transparent",
                  )}
                >
                  <IconCheck className="size-3" />
                </span>
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {field.sourceFieldLabel}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {field.sourceFieldType}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={addField.isPending}
          onClick={onDone}
        >
          Done
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canEdit || pending || addField.isPending}
          onClick={addSelected}
        >
          {addField.isPending ? (
            <Spinner className="mr-1.5 size-3.5" />
          ) : (
            <IconPlus className="mr-1.5 size-3.5" />
          )}
          Add selected
        </Button>
      </div>
    </div>
  );
}

// A Builder space's data models, as drill-in rows. The attached model (if any)
// is marked; selecting a row opens that model's leaf.
function BuilderSpaceModelsView({
  attachedModelName,
  onOpenModel,
}: {
  attachedModelName: string | null;
  onOpenModel: (model: BuilderCmsModelSummary) => void;
}) {
  const modelsQuery = useBuilderCmsModels(true);
  const models = modelsQuery.data?.models ?? [];
  const [query, setQuery] = useState("");

  if (modelsQuery.isLoading) {
    if (attachedModelName) {
      return (
        <div className="grid min-w-0 gap-2">
          <div className="grid min-w-0 gap-1.5">
            <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {dbText("alreadyAttached")}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <IconLayoutGrid className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{attachedModelName}</span>
              </span>
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                attached
              </span>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {dbText("loadingBuilderModels")}
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {dbText("loadingBuilderModels")}
      </div>
    );
  }

  if (modelsQuery.data?.state === "unconfigured") {
    return (
      <div className="min-w-0 break-words text-xs text-muted-foreground">
        {dbText("builderIsntConnectedGoBackToConnectYour")}
      </div>
    );
  }

  if (modelsQuery.data?.state === "error") {
    return (
      <div className="grid min-w-0 gap-2">
        <div className="text-xs text-destructive">
          {modelsQuery.data.message ?? "Builder models could not be loaded."}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => modelsQuery.refetch()}
        >
          <IconRefresh className="mr-1.5 size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="grid min-w-0 gap-2">
        <div className="text-xs text-muted-foreground">
          {dbText("noBuilderModelsWereFoundInThisSpace")}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={modelsQuery.isFetching}
          onClick={() => modelsQuery.refetch()}
        >
          {modelsQuery.isFetching ? (
            <Spinner className="mr-1.5 size-3.5" />
          ) : (
            <IconRefresh className="mr-1.5 size-3.5" />
          )}
          Refresh
        </Button>
      </div>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (model: BuilderCmsModelSummary) =>
    !normalizedQuery ||
    model.displayName.toLowerCase().includes(normalizedQuery) ||
    model.name.toLowerCase().includes(normalizedQuery);
  const filtered = models.filter(matchesQuery);
  const attachedModels = filtered.filter(
    (model) => attachedModelName === model.name,
  );
  const otherModels = filtered.filter(
    (model) => attachedModelName !== model.name,
  );

  const renderRow = (model: BuilderCmsModelSummary) => {
    const isAttached = attachedModelName === model.name;
    return (
      <button
        key={model.id}
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpenModel(model)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          <IconList className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate" title={model.displayName}>
          {model.displayName}
        </span>
        {isAttached ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            <IconCheck className="size-3" />
            Attached
          </span>
        ) : null}
        <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  };

  return (
    <div className="grid min-w-0 gap-2">
      <div className="relative min-w-0">
        <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={dbText("searchModels")}
          aria-label={dbText("searchBuilderModels")}
          className="h-8 min-w-0 pl-7 text-sm"
        />
      </div>

      {attachedModels.length > 0 ? (
        <div className="grid min-w-0 gap-1.5">
          <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {dbText("alreadyAttached")}
          </div>
          {attachedModels.map(renderRow)}
        </div>
      ) : null}

      <div className="grid min-w-0 gap-1.5">
        {attachedModels.length > 0 && otherModels.length > 0 ? (
          <div className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {dbText("allModels")}
          </div>
        ) : null}
        {otherModels.map(renderRow)}
        {filtered.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No models match “{query.trim()}”.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SourceChangeSetReviewCard({
  changeSet,
  source,
}: {
  changeSet: ContentDatabaseSourceChangeSet;
  source: ContentDatabaseSource;
}) {
  const latestReview =
    changeSet.reviewEvents[changeSet.reviewEvents.length - 1] ?? null;
  const latestExecution =
    changeSet.executions[changeSet.executions.length - 1] ?? null;
  const dryRunStatus = latestExecution
    ? builderExecutionDryRunStatus(latestExecution.payload)
    : null;

  return (
    <div className="min-w-0 rounded-md border border-border/70 px-2 py-1.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span
          className="min-w-0 break-words font-medium leading-snug"
          title={changeSet.summary}
        >
          {changeSet.summary}
        </span>
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {changeSet.state.replace(/_/g, " ")}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className={sourceRiskClass(changeSet.riskLevel)}>
          {changeSet.riskLevel} risk
        </span>
        <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
          {changeSet.conflictState === "source_changed"
            ? "source changed"
            : "no conflict"}
        </span>
        <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
          {sourcePushModeLabel(changeSet.pushMode)}
        </span>
        <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
          {changeSet.localOnly ? "local-only" : "external write"}
        </span>
      </div>

      <div className="mt-2 grid min-w-0 gap-1.5">
        {changeSet.fieldChanges.slice(0, 3).map((field) => (
          <div
            key={`${changeSet.id}-${field.localFieldKey}`}
            className="min-w-0 rounded border border-border/60 bg-muted/20 p-1.5 text-xs"
          >
            <div className="font-medium">
              {field.propertyName ?? field.sourceFieldKey}
            </div>
            <div className="mt-1 grid min-w-0 gap-1 text-muted-foreground">
              <div className="min-w-0 break-words">
                Current: {sourceValueText(field.currentValue)}
              </div>
              <div className="min-w-0 break-words">
                Proposed: {sourceValueText(field.proposedValue)}
              </div>
            </div>
          </div>
        ))}
        {changeSet.fieldChanges.length > 3 ? (
          <div className="text-xs text-muted-foreground">
            +{changeSet.fieldChanges.length - 3} more field changes
          </div>
        ) : null}
        {changeSet.bodyChange ? (
          <div className="rounded border border-border/60 bg-muted/20 p-1.5 text-xs">
            <div className="font-medium">{changeSet.bodyChange.summary}</div>
            <div className="mt-1 text-muted-foreground">
              {dbText("bodyDiff")}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 break-words text-xs text-muted-foreground">
        {changeSet.riskReasons.join(", ")}
        {" • "}
        {source.capabilities.liveWritesEnabled
          ? "live writes enabled"
          : "live writes disabled"}
        {" • "}
        {formatSourceTimestamp(changeSet.updatedAt)}
      </div>

      {latestReview ? (
        <div className="mt-2 rounded border border-border/60 bg-muted/20 p-1.5 text-xs text-muted-foreground">
          {latestReview.decision} by {latestReview.reviewerEmail}
          {" • "}
          {formatSourceTimestamp(latestReview.createdAt)}
        </div>
      ) : null}

      {latestExecution ? (
        <div className="mt-2 rounded border border-border/60 bg-muted/20 p-1.5 text-xs">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="font-medium">{dbText("executionGate")}</span>
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
              {latestExecution.state.replace(/_/g, " ")}
            </span>
          </div>
          <div className="mt-1 break-words text-muted-foreground">
            {latestExecution.summary}
          </div>
          {builderExecutionRequestLine(latestExecution.payload) ? (
            <div className="mt-1 break-words text-muted-foreground">
              Would call {builderExecutionRequestLine(latestExecution.payload)}
            </div>
          ) : null}
          {builderExecutionBlockers(latestExecution.payload).length > 0 ? (
            <div className="mt-1 grid gap-1 text-muted-foreground">
              {builderExecutionBlockers(latestExecution.payload)
                .slice(0, 2)
                .map((blocker) => (
                  <div key={blocker} className="break-words">
                    Blocked: {blocker}
                  </div>
                ))}
            </div>
          ) : null}
          {dryRunStatus ? (
            <div className="mt-1 break-words text-muted-foreground">
              Dry run {dryRunStatus.status}
              {dryRunStatus.validatedAt
                ? ` • ${formatSourceTimestamp(dryRunStatus.validatedAt)}`
                : ""}
            </div>
          ) : null}
          {latestExecution.lastError ? (
            <div className="mt-1 break-words text-destructive">
              {latestExecution.lastError}
            </div>
          ) : null}
          <div className="mt-1 break-all text-muted-foreground">
            {latestExecution.idempotencyKey}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SourceMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className="min-w-0 max-w-[65%] break-words text-right"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function sourceRiskClass(risk: ContentDatabaseSourceChangeSet["riskLevel"]) {
  return cn(
    "rounded border px-1.5 py-0.5",
    risk === "high"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : risk === "medium"
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  );
}

function sourceValueText(value: DocumentPropertyValue) {
  if (value === null || value === undefined || value === "") return "empty";
  if (Array.isArray(value)) return value.join(", ") || "empty";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function builderExecutionRequestLine(payload: Record<string, unknown>) {
  const request =
    payload.request &&
    typeof payload.request === "object" &&
    !Array.isArray(payload.request)
      ? (payload.request as Record<string, unknown>)
      : null;
  const method =
    typeof request?.method === "string" ? request.method.toUpperCase() : null;
  const path = typeof request?.path === "string" ? request.path : null;
  if (!request || !method || !path) return null;

  const query =
    request.query && typeof request.query === "object"
      ? (request.query as Record<string, unknown>)
      : null;
  const queryText = query
    ? Object.entries(query)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
        .map(([key, value]) => `${key}=${value}`)
        .join("&")
    : "";
  return `${method} ${path}${queryText ? `?${queryText}` : ""}`;
}

function builderExecutionBlockers(payload: Record<string, unknown>) {
  const safety =
    payload.safety &&
    typeof payload.safety === "object" &&
    !Array.isArray(payload.safety)
      ? (payload.safety as Record<string, unknown>)
      : null;
  const blockers = safety?.blockers;
  return Array.isArray(blockers)
    ? blockers.filter(
        (blocker): blocker is string => typeof blocker === "string",
      )
    : [];
}

function builderExecutionDryRunStatus(payload: Record<string, unknown>) {
  const dryRun =
    payload.dryRun &&
    typeof payload.dryRun === "object" &&
    !Array.isArray(payload.dryRun)
      ? (payload.dryRun as Record<string, unknown>)
      : null;
  const status =
    dryRun?.status === "validated" ||
    dryRun?.status === "stale" ||
    dryRun?.status === "blocked"
      ? dryRun.status
      : null;
  if (!status) return null;
  return {
    status,
    validatedAt:
      typeof dryRun?.validatedAt === "string" ? dryRun.validatedAt : null,
  };
}

export function formatSourceTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRelativeSyncTime(value: string | null): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function sourceBuilderReadModeSummary(source: ContentDatabaseSource) {
  if (source.metadata.liveReadConfigured) return "Builder API read-only";
  if (source.metadata.readMode === "fixture") {
    return "Local fixture; Builder credentials unavailable";
  }
  return "Local fixture";
}

function sourcePushModeLabel(
  mode: ContentDatabaseSource["metadata"]["pushMode"] | null | undefined,
) {
  if (mode === "autosave") return "Save revision / autosave";
  if (mode === "draft") return "Draft";
  if (mode === "publish") return "Publish";
  return "No push";
}

export function sourceFieldMappingForColumn(
  source: ContentDatabaseSource | null,
  columnKey: ColumnKey,
) {
  if (!source) return null;
  if (columnKey === "name") {
    return (
      source.fields.find((field) => field.mappingType === "title") ??
      source.fields.find((field) => field.localFieldKey === "title") ??
      null
    );
  }
  return (
    source.fields.find((field) => field.propertyId === columnKey) ??
    source.fields.find((field) => field.localFieldKey === columnKey) ??
    null
  );
}

function databaseViewIconElement(
  type: ContentDatabaseViewType,
  className = "size-4",
) {
  const Icon = databaseViewIcon(type);
  return <Icon className={className} />;
}

function DatabaseSettingsRow({
  icon,
  label,
  value,
  badgeCount = 0,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  badgeCount?: number;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !onClick}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled || !onClick
          ? "cursor-default text-muted-foreground/60"
          : "text-foreground hover:bg-muted",
      )}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick?.();
      }}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? (
        <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">
          {value}
        </span>
      ) : null}
      {badgeCount > 0 ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-foreground text-[9px] leading-none text-background">
          {badgeCount}
        </span>
      ) : null}
      {onClick && !disabled ? (
        <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

function DatabaseSettingsSwitch({
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-[#2383e2]" : "bg-muted-foreground/25",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
            checked ? "left-0.5 translate-x-4" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

function DatabaseSettingsLayoutPanel({
  activeView,
  onViewTypeChange,
  onWrapCellsChange,
  onOpenPagesInChange,
}: {
  activeView: ContentDatabaseView;
  onViewTypeChange: (type: ContentDatabaseViewType) => void;
  onWrapCellsChange: (wrapCells: boolean) => void;
  onOpenPagesInChange: (openPagesIn: ContentDatabaseOpenPagesIn) => void;
}) {
  const wrapCells = activeView.wrapCells === true;
  const openPagesIn = activeView.openPagesIn ?? "preview";

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2">
        {DATABASE_VIEW_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={activeView.type === type}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeView.type === type
                ? "border-[#2383e2] bg-[#2383e2]/5 text-[#2383e2]"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onViewTypeChange(type)}
          >
            {databaseViewIconElement(type, "size-4")}
            {databaseViewDefaultName(type)}
          </button>
        ))}
      </div>
      <div className="grid gap-1">
        <DatabaseSettingsSwitch
          label={dbText("wrapAllContent")}
          checked={wrapCells}
          disabled={activeView.type !== "table"}
          onCheckedChange={onWrapCellsChange}
        />
      </div>
      <DatabaseOpenPagesInSetting
        value={openPagesIn}
        onChange={onOpenPagesInChange}
      />
    </div>
  );
}

function DatabaseOpenPagesInSetting({
  value,
  onChange,
}: {
  value: ContentDatabaseOpenPagesIn;
  onChange: (value: ContentDatabaseOpenPagesIn) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md px-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{dbText("openPagesIn")}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="max-w-28 truncate">
              {databaseOpenPagesInLabel(value)}
            </span>
            <IconChevronRight className="size-4 shrink-0" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-1">
        {DATABASE_OPEN_PAGES_IN.map((option) => {
          const Icon =
            option === "full_page" ? IconExternalLink : IconLayoutGrid;
          return (
            <DropdownMenuItem
              key={option}
              className="items-start gap-2 py-2"
              onSelect={(event) => {
                event.preventDefault();
                onChange(option);
              }}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {databaseOpenPagesInLabel(option)}
                </span>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {databaseOpenPagesInDescription(option)}
                </span>
              </span>
              {value === option ? (
                <IconCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DatabaseSettingsPropertyVisibilityPanel({
  documentId,
  properties,
  activeView,
  items,
  source,
  sources,
  hiddenCount,
  onPropertyHiddenChange,
  onPropertiesHiddenChange,
}: {
  documentId: string;
  properties: DocumentProperty[];
  activeView: ContentDatabaseView;
  items: ContentDatabaseItem[];
  source: ContentDatabaseSource | null;
  sources: ContentDatabaseSource[];
  hiddenCount: number;
  onPropertyHiddenChange: (propertyId: string, hidden: boolean) => void;
  onPropertiesHiddenChange: (propertyIds: string[], hidden: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredProperties = normalizedQuery
    ? properties.filter((property) =>
        property.definition.name.toLowerCase().includes(normalizedQuery),
      )
    : properties;
  const visibleCount = properties.filter((property) =>
    isDatabasePropertyVisibleInView(property, items, activeView),
  ).length;
  const propertyIds = properties.map((property) => property.definition.id);

  return (
    <div className="grid gap-3">
      <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          placeholder={dbText("searchProperties")}
          aria-label={dbText("searchProperties")}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {visibleCount} shown, {properties.length - visibleCount} hidden
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={hiddenCount === 0}
            onClick={() => onPropertiesHiddenChange(propertyIds, false)}
          >
            {dbText("showAll")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={visibleCount === 0}
            onClick={() => onPropertiesHiddenChange(propertyIds, true)}
          >
            {dbText("hideAll")}
          </Button>
        </div>
      </div>
      <div className="grid gap-1">
        {filteredProperties.map((property) => {
          const Icon = TYPE_ICONS[property.definition.type];
          const visible = isDatabasePropertyVisibleInView(
            property,
            items,
            activeView,
          );
          return (
            <button
              key={property.definition.id}
              type="button"
              className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() =>
                onPropertyHiddenChange(property.definition.id, visible)
              }
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {property.definition.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {visible ? "Shown" : "Hidden"}
              </span>
              {visible ? (
                <IconCheck className="size-4 shrink-0 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
        {filteredProperties.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">
            {dbText("noMatchingProperties")}
          </div>
        ) : null}
      </div>
      <div className="border-t border-border/70 pt-3">
        <AddProperty
          documentId={documentId}
          label={dbText("newProperty")}
          source={source}
          sources={sources}
        />
      </div>
    </div>
  );
}

function DatabaseSettingsGroupPanel({
  activeView,
  properties,
  groupIds,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onGroupsCollapsedChange,
}: {
  activeView: Pick<
    ContentDatabaseView,
    "type" | "groupByPropertyId" | "hideEmptyGroups"
  >;
  properties: DocumentProperty[];
  groupIds: string[];
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  const [propertyQuery, setPropertyQuery] = useState("");
  const groupableProperties = databaseViewGroupableProperties(properties);
  const groupProperty = databaseViewGroupingProperty(activeView, properties);
  const hideEmptyGroups = activeView.hideEmptyGroups === true;
  const groupPropertyItems = databasePropertyPickerItems(
    groupableProperties,
    propertyQuery,
    { includeName: false },
  );
  const canGroupView =
    activeView.type === "table" ||
    activeView.type === "list" ||
    activeView.type === "gallery";

  return (
    <div className="grid gap-3">
      <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={propertyQuery}
          placeholder={dbText("searchProperties")}
          aria-label={dbText("searchGroupProperties")}
          disabled={!canGroupView}
          onChange={(event) => setPropertyQuery(event.target.value)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="grid gap-1">
        <button
          type="button"
          disabled={!canGroupView}
          className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
          onClick={() => onGroupByChange(null)}
        >
          <IconX className="size-4 text-muted-foreground" />
          <span className="flex-1">None</span>
          {!groupProperty ? (
            <IconCheck className="size-4 text-muted-foreground" />
          ) : null}
        </button>
        {groupPropertyItems.map((item) => {
          const Icon =
            item.type === "name" ? IconFileText : TYPE_ICONS[item.type];
          return (
            <button
              key={item.key}
              type="button"
              disabled={!canGroupView}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
              onClick={() => onGroupByChange(item.key)}
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {groupProperty?.definition.id === item.key ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>
      {groupableProperties.length === 0 ? (
        <div className="px-2 text-xs text-muted-foreground">
          {dbText("addAStatusSelectMultiSelectOrCheckboxPropertyToGroup")}
        </div>
      ) : null}
      {groupProperty ? (
        <div className="grid gap-1 border-t border-border/70 pt-3">
          <DatabaseSettingsSwitch
            label={dbText("hideEmptyGroups")}
            checked={hideEmptyGroups}
            onCheckedChange={onHideEmptyGroupsChange}
          />
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 flex-1 text-xs"
              disabled={groupIds.length === 0}
              onClick={() => onGroupsCollapsedChange(groupIds, true)}
            >
              {dbText("collapseAll")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 flex-1 text-xs"
              disabled={groupIds.length === 0}
              onClick={() => onGroupsCollapsedChange(groupIds, false)}
            >
              {dbText("expandAll")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type DatabasePropertyPickerOption = {
  key: string;
  label: string;
  type: DocumentPropertyType | "name";
};

function DatabasePropertyPickerSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-b border-border/70 p-1">
      <div className="flex h-8 items-center gap-2 rounded border border-input bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={dbText("searchProperties")}
          aria-label={dbText("searchProperties")}
          className="h-6 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function DatabasePropertyPickerItem({
  item,
  selected,
  onSelect,
}: {
  item: DatabasePropertyPickerOption;
  selected: boolean;
  onSelect: (key: string, label: string) => void;
}) {
  const Icon = item.type === "name" ? IconFileText : TYPE_ICONS[item.type];
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onSelect(item.key, item.label);
      }}
    >
      <Icon className="mr-2 size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {selected ? <IconCheck className="size-4 text-muted-foreground" /> : null}
    </DropdownMenuItem>
  );
}

export function DatabasePropertyPickerSubContent({
  properties,
  selectedKey,
  includeName,
  onSelect,
}: {
  properties: DocumentProperty[];
  selectedKey: string;
  includeName?: boolean;
  onSelect: (key: string, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const items = databasePropertyPickerItems(properties, query, { includeName });

  return (
    <DropdownMenuSubContent className="max-h-80 w-64 overflow-auto">
      <DatabasePropertyPickerSearch value={query} onChange={setQuery} />
      {items.map((item) => (
        <DatabasePropertyPickerItem
          key={item.key}
          item={item}
          selected={selectedKey === item.key}
          onSelect={onSelect}
        />
      ))}
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {dbText("noPropertiesFound")}
        </div>
      ) : null}
    </DropdownMenuSubContent>
  );
}

export function DatabaseGroupMenu({
  activeView,
  properties,
  groupIds,
  onGroupByChange,
  onHideEmptyGroupsChange,
  onGroupsCollapsedChange,
}: {
  activeView: Pick<
    ContentDatabaseView,
    "type" | "groupByPropertyId" | "hideEmptyGroups"
  >;
  properties: DocumentProperty[];
  groupIds: string[];
  onGroupByChange: (propertyId: string | null) => void;
  onHideEmptyGroupsChange: (hideEmptyGroups: boolean) => void;
  onGroupsCollapsedChange: (groupIds: string[], collapsed: boolean) => void;
}) {
  const groupableProperties = databaseViewGroupableProperties(properties);
  const groupProperty = databaseViewGroupingProperty(activeView, properties);
  const hideEmptyGroups = activeView.hideEmptyGroups === true;
  const [propertyQuery, setPropertyQuery] = useState("");
  const groupPropertyItems = databasePropertyPickerItems(
    groupableProperties,
    propertyQuery,
    { includeName: false },
  );
  const canGroupView =
    activeView.type === "table" ||
    activeView.type === "list" ||
    activeView.type === "gallery";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canGroupView}
          aria-label={
            groupProperty
              ? `Group by ${groupProperty.definition.name}`
              : "Group"
          }
          title="Group"
          className={cn(databaseToolbarIconButtonClass(Boolean(groupProperty)))}
        >
          <IconLayoutKanban className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {dbText("groupBy")}
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onGroupByChange(null);
          }}
        >
          <span className="flex-1">None</span>
          {!groupProperty ? (
            <IconCheck className="size-4 text-muted-foreground" />
          ) : null}
        </DropdownMenuItem>
        {groupableProperties.length > 0 ? <DropdownMenuSeparator /> : null}
        {groupableProperties.length > 0 ? (
          <DatabasePropertyPickerSearch
            value={propertyQuery}
            onChange={setPropertyQuery}
          />
        ) : null}
        {groupPropertyItems.map((item) => (
          <DatabasePropertyPickerItem
            key={item.key}
            item={item}
            selected={groupProperty?.definition.id === item.key}
            onSelect={(key) => onGroupByChange(key)}
          />
        ))}
        {groupableProperties.length > 0 && groupPropertyItems.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {dbText("noPropertiesFound")}
          </div>
        ) : null}
        {groupProperty ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onHideEmptyGroupsChange(!hideEmptyGroups);
              }}
            >
              <IconEyeOff className="mr-2 size-4 text-muted-foreground" />
              <span className="flex-1">{dbText("hideEmptyGroups")}</span>
              {hideEmptyGroups ? (
                <IconCheck className="size-4 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={groupIds.length === 0}
              onSelect={(event) => {
                event.preventDefault();
                onGroupsCollapsedChange(groupIds, true);
              }}
            >
              <IconChevronRight className="mr-2 size-4 text-muted-foreground" />
              {dbText("collapseAllGroups")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={groupIds.length === 0}
              onSelect={(event) => {
                event.preventDefault();
                onGroupsCollapsedChange(groupIds, false);
              }}
            >
              <IconChevronDown className="mr-2 size-4 text-muted-foreground" />
              {dbText("expandAllGroups")}
            </DropdownMenuItem>
          </>
        ) : null}
        {groupableProperties.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {dbText("addAStatusSelectMultiSelectOrCheckboxPropertyToGroup")}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function databaseOpenPagesInLabel(value: ContentDatabaseOpenPagesIn) {
  return value === "full_page" ? "Full page" : "Side preview";
}

function databaseOpenPagesInDescription(value: ContentDatabaseOpenPagesIn) {
  return value === "full_page"
    ? "Navigate to the page when opening a row."
    : "Open rows in a side panel without leaving the database.";
}

export function databaseFilterModeLabel(filterMode: DatabaseFilterMode) {
  return filterMode === "or" ? "Any" : "All";
}

export function databaseFilterModePhrase(filterMode: DatabaseFilterMode) {
  return filterMode === "or" ? "any filter" : "all filters";
}
