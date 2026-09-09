import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import type {
  ContentRelationCandidate,
  ContentRelationshipHistoryChange,
  ContentRelationshipHistoryItem,
  ContentRelationshipItem,
  MutateContentRelationshipsResult,
  RemoveContentRelationPropertyInput,
  RemoveContentRelationPropertyResult,
  RelationshipChange,
  RelationshipRouteRef,
} from "@shared/relationships";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsExchange,
  IconCheck,
  IconChevronDown,
  IconClockFilled,
  IconHistory,
  IconLink,
  IconRotate,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  canonicalRelationOptions,
  contentRelationshipOperationId,
  isSupersededRelationshipMutationError,
  relationshipMutationErrorMessage,
  useContentRelationCandidates,
  useContentRelationshipHistory,
  useContentRelationships,
  useContentRelationshipTypes,
  useMutateContentRelationships,
  usePrepareContentRelationshipRemoval,
  useRemoveContentRelationProperty,
  useUndoContentRelationshipRevision,
} from "@/hooks/use-content-relationships";
import { useRelationshipAppState } from "@/hooks/use-relationship-app-state";
import { cn } from "@/lib/utils";

export function relationshipOppositeEndpoint(
  edge: ContentRelationshipItem,
  pageId: string,
) {
  return edge.sourcePageId === pageId ? edge.target : edge.source;
}

export function relationshipHistoryAuthorizingPrincipal(
  item: Pick<ContentRelationshipHistoryItem, "actor" | "authorizingPrincipal">,
) {
  const email = item.authorizingPrincipal.email;
  if (typeof email !== "string" || !email.trim()) return null;
  if (
    item.actor.kind === "person" &&
    (email === item.actor.email || email === item.actor.displayName)
  ) {
    return null;
  }
  return email;
}

export function relationshipHistoryChangeDisplayText(
  change: ContentRelationshipHistoryChange,
) {
  return {
    endpoints: `${change.source.title} → ${change.target.title}`,
    relationship: change.relationshipLabel,
    previousTarget: change.previousTarget?.title ?? null,
  };
}

export function relationshipPickerCandidates(
  candidates: ContentRelationCandidate[],
  selectedEdges: ContentRelationshipItem[],
  pageId: string,
) {
  const byPageId = new Map(
    candidates.map((candidate) => [candidate.pageId, candidate]),
  );
  for (const edge of selectedEdges) {
    const endpoint = relationshipOppositeEndpoint(edge, pageId);
    if (!byPageId.has(endpoint.pageId)) {
      byPageId.set(endpoint.pageId, {
        pageId: endpoint.pageId,
        title: endpoint.title,
        context: {},
        slotObservationToken: edge.slotObservationToken,
      });
    }
  }
  return Array.from(byPageId.values());
}

export function relationshipPropertyRemovalMode({
  keep,
  selectionReceipt,
  selectedEdgeIds,
}: {
  keep: boolean;
  selectionReceipt: string | undefined;
  selectedEdgeIds: string[];
}): RemoveContentRelationPropertyInput["relationshipMode"] | null {
  if (keep) return { kind: "keep" };
  if (!selectionReceipt || selectedEdgeIds.length === 0) return null;
  return {
    kind: "remove-selected",
    selectionReceipt,
    edgeIds: [...selectedEdgeIds],
  };
}

type RelationshipPropertyRemovalOperation = {
  key: string;
  operationId: string;
};

export function relationshipPropertyRemovalOperation(
  current: RelationshipPropertyRemovalOperation | null,
  propertyId: string,
  relationshipMode: RemoveContentRelationPropertyInput["relationshipMode"],
  createOperationId: () => string = contentRelationshipOperationId,
): RelationshipPropertyRemovalOperation {
  const key = JSON.stringify({ propertyId, relationshipMode });
  return current?.key === key
    ? current
    : { key, operationId: createOperationId() };
}

function RelationshipMutationFailure({
  message,
  onRetry,
  pending,
  className,
}: {
  message: string;
  onRetry?: () => void;
  pending: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className={cn(
        "grid justify-items-start gap-1.5 text-destructive",
        className,
      )}
    >
      <span>{message}</span>
      {onRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={pending}
          onClick={onRetry}
        >
          {t("relationships.retrySavedChange")}
        </Button>
      ) : null}
    </div>
  );
}

function historyChangeKindMessage(
  kind: ContentRelationshipHistoryChange["kind"],
) {
  switch (kind) {
    case "added":
      return "relationships.historyChangeAdded" as const;
    case "removed":
      return "relationships.historyChangeRemoved" as const;
    case "replaced":
      return "relationships.historyChangeReplaced" as const;
    case "restored":
      return "relationships.historyChangeRestored" as const;
  }
}

function historyActorKindMessage(
  kind: ContentRelationshipHistoryItem["actor"]["kind"],
) {
  switch (kind) {
    case "person":
      return "relationships.historyActorPerson" as const;
    case "agent":
      return "relationships.historyActorAgent" as const;
    case "automation":
      return "relationships.historyActorAutomation" as const;
    case "programmatic":
      return "relationships.historyActorProgrammatic" as const;
  }
}

function RelationshipHistoryChangeRow({
  change,
}: {
  change: ContentRelationshipHistoryChange;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-border/60 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-medium text-foreground">
          {t(historyChangeKindMessage(change.kind))}
        </span>
        <span className="truncate text-muted-foreground">
          {change.relationshipLabel}
        </span>
      </div>
      <div className="mt-0.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 text-foreground">
        <Link
          to={`/page/${change.source.pageId}`}
          className="min-w-0 truncate rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {change.source.title}
        </Link>
        <IconArrowRight className="size-3 shrink-0 text-muted-foreground" />
        <Link
          to={`/page/${change.target.pageId}`}
          className="min-w-0 truncate rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {change.target.title}
        </Link>
      </div>
      {change.previousTarget ? (
        <div className="mt-0.5 truncate text-muted-foreground">
          {t("relationships.historyPreviousTarget", {
            name: change.previousTarget.title,
          })}
        </div>
      ) : null}
    </div>
  );
}

function RelationshipHistoryDetails({
  item,
}: {
  item: ContentRelationshipHistoryItem;
}) {
  const t = useT();
  if (!Array.isArray(item.changes)) {
    return (
      <div role="status" className="break-words text-muted-foreground">
        {t("relationships.historyDetailsUnavailable")}
      </div>
    );
  }
  if (item.changes.length === 0) {
    return <div className="break-words text-foreground">{item.summary}</div>;
  }
  return (
    <div className="grid gap-1">
      {item.changes.map((change) => (
        <RelationshipHistoryChangeRow key={change.eventId} change={change} />
      ))}
    </div>
  );
}

function relationDirection(property: DocumentProperty) {
  const relation = canonicalRelationOptions(property);
  if (!relation) return null;
  return relation.direction === "forward" ? "outgoing" : "incoming";
}

function propertyRoute(
  property: DocumentProperty,
  pageId: string,
): RelationshipRouteRef | null {
  const relation = canonicalRelationOptions(property);
  if (!relation || !relation.editable) return null;
  return relation.direction === "forward"
    ? {
        kind: "forward-property",
        propertyId: property.definition.id,
        sourcePageId: pageId,
      }
    : {
        kind: "inverse-property",
        propertyId: property.definition.id,
        targetPageId: pageId,
      };
}

function edgePropertyRoute(
  edge: ContentRelationshipItem,
  property: DocumentProperty,
) {
  return (
    edge.routes.find(
      (route) =>
        (route.kind === "forward-property" ||
          route.kind === "inverse-property") &&
        route.propertyId === property.definition.id,
    ) ?? null
  );
}

function candidateContext(candidate: ContentRelationCandidate) {
  return Object.values(candidate.context)
    .flatMap((value) => {
      if (typeof value === "string" || typeof value === "number") {
        return String(value).trim();
      }
      return [];
    })
    .filter(Boolean)
    .slice(0, 2);
}

export function RelationValueSummary({
  property,
  pageId,
  fallback,
}: {
  property: DocumentProperty;
  pageId: string;
  fallback?: React.ReactNode;
}) {
  const t = useT();
  const relation = canonicalRelationOptions(property);
  const direction = relationDirection(property);
  const query = useContentRelationships(
    relation && direction
      ? {
          pageId,
          relationshipTypeId: relation.relationshipTypeId,
          direction,
          limit: 100,
        }
      : null,
  );

  if (!relation) return fallback ?? null;
  if (query.isLoading && !query.data) {
    return <Skeleton className="h-5 w-24" />;
  }
  if (query.isError) {
    return (
      <span className="text-destructive">
        {t("relationships.valueUnavailable")}
      </span>
    );
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <span className="text-muted-foreground">{t("relationships.empty")}</span>
    );
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {items.slice(0, 3).map((edge) => {
        const endpoint = relationshipOppositeEndpoint(edge, pageId);
        return (
          <span
            key={edge.edgeId}
            className={cn(
              "inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium",
              edge.state !== "active" && "opacity-60",
            )}
          >
            <span className="min-w-0 truncate">{endpoint.title}</span>
            {edge.state !== "active" ? (
              <span className="ms-1 shrink-0 font-normal text-muted-foreground">
                · {t(`relationships.states.${edge.state}`)}
              </span>
            ) : null}
          </span>
        );
      })}
      {items.length > 3 ? (
        <span className="text-xs text-muted-foreground">
          {t("relationships.moreCount", { count: items.length - 3 })}
        </span>
      ) : null}
    </span>
  );
}

export function RelationValueEditor({
  property,
  pageId,
  onDone,
}: {
  property: DocumentProperty;
  pageId: string;
  onDone: () => void;
}) {
  const t = useT();
  const relation = canonicalRelationOptions(property);
  const direction = relationDirection(property);
  const [query, setQuery] = useState("");
  const relationships = useContentRelationships(
    relation && direction
      ? {
          pageId,
          relationshipTypeId: relation.relationshipTypeId,
          direction,
          limit: 100,
        }
      : null,
  );
  const candidates = useContentRelationCandidates(
    relation
      ? {
          propertyId: property.definition.id,
          anchorPageId: pageId,
          search: query,
          limit: 100,
          contextPropertyIds: [],
        }
      : null,
  );
  const relationshipTypes = useContentRelationshipTypes(
    relation && property.definition.databaseId
      ? { databaseId: property.definition.databaseId, limit: 100 }
      : null,
  );
  const mutate = useMutateContentRelationships();
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useRelationshipAppState(
    relation
      ? {
          pageId,
          propertyId: property.definition.id,
          typeId: relation.relationshipTypeId,
          databaseId: property.definition.databaseId ?? undefined,
          surface: "picker",
        }
      : null,
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const closePicker = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !(event.target instanceof Node) ||
        !editorRef.current?.contains(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onDone();
    };
    window.addEventListener("keydown", closePicker, { capture: true });
    return () =>
      window.removeEventListener("keydown", closePicker, { capture: true });
  }, [onDone]);

  const selectedEdges = relationships.data?.items ?? [];
  const serverSelectedIds = selectedEdges.map(
    (edge) => relationshipOppositeEndpoint(edge, pageId).pageId,
  );
  const selectedIds = optimisticIds ?? serverSelectedIds;
  const serverSelectedKey = [...serverSelectedIds].sort().join("\u0000");
  const optimisticSelectedKey = optimisticIds
    ? [...optimisticIds].sort().join("\u0000")
    : null;
  const typeDescriptor = relationshipTypes.data?.items.find(
    (item) => item.type.id === relation?.relationshipTypeId,
  );

  useEffect(() => {
    if (
      optimisticSelectedKey !== null &&
      serverSelectedKey === optimisticSelectedKey
    ) {
      setOptimisticIds(null);
    }
  }, [optimisticSelectedKey, serverSelectedKey]);
  const projectionCardinality =
    relation?.direction === "forward"
      ? typeDescriptor?.version.forwardCardinality
      : typeDescriptor?.version.inverseCardinality;
  const pickerCandidates = useMemo(
    () =>
      relationshipPickerCandidates(
        candidates.data?.items ?? [],
        selectedEdges,
        pageId,
      ),
    [candidates.data?.items, pageId, selectedEdges],
  );
  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return pickerCandidates.filter(
      (candidate) =>
        !normalized ||
        candidate.title.toLowerCase().includes(normalized) ||
        candidateContext(candidate).some((value) =>
          value.toLowerCase().includes(normalized),
        ),
    );
  }, [pickerCandidates, query]);

  async function toggle(candidate: ContentRelationCandidate) {
    if (!relation || !typeDescriptor || mutate.isPending) return;
    const before = selectedIds;
    const selected = before.includes(candidate.pageId);
    setError(null);
    setOptimisticIds(
      selected
        ? before.filter((id) => id !== candidate.pageId)
        : projectionCardinality === "one"
          ? [candidate.pageId]
          : [...before, candidate.pageId],
    );

    try {
      let change: RelationshipChange;
      if (selected) {
        const edge = selectedEdges.find(
          (item) =>
            relationshipOppositeEndpoint(item, pageId).pageId ===
            candidate.pageId,
        );
        const route = edge ? edgePropertyRoute(edge, property) : null;
        if (!edge || !route) {
          throw new Error(t("relationships.routeUnavailable"));
        }
        change = {
          kind: "remove",
          edgeId: edge.edgeId,
          observedActivationIds: edge.observedActivationIds,
          observationToken: edge.observationToken,
          route,
        };
      } else {
        const route = propertyRoute(property, pageId);
        if (!route) throw new Error(t("relationships.routeUnavailable"));
        const sourcePageId =
          relation.direction === "forward" ? pageId : candidate.pageId;
        const targetPageId =
          relation.direction === "forward" ? candidate.pageId : pageId;
        if (typeDescriptor.version.forwardCardinality === "one") {
          const slotObservationToken =
            relation.direction === "forward"
              ? candidates.data?.slotObservationToken
              : candidate.slotObservationToken;
          if (!slotObservationToken) {
            throw new Error(t("relationships.refreshBeforeReplacing"));
          }
          change = {
            kind: "replace",
            typeId: relation.relationshipTypeId,
            typeVersionId: typeDescriptor.version.id,
            sourcePageId,
            targetPageId,
            observedSlotToken: slotObservationToken,
            route,
          };
        } else {
          change = {
            kind: "add",
            typeId: relation.relationshipTypeId,
            typeVersionId: typeDescriptor.version.id,
            sourcePageId,
            targetPageId,
            route,
          };
        }
      }
      await mutate.mutateAsync({
        operationId: contentRelationshipOperationId(),
        changes: [change],
      });
      if (projectionCardinality === "one") onDone();
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setOptimisticIds(before);
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.updateFailed"),
        ),
      );
    }
  }

  async function retryToggle() {
    setError(null);
    try {
      await mutate.retryFailed();
      if (projectionCardinality === "one") onDone();
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.updateFailed"),
        ),
      );
    }
  }

  if (!relation) {
    return (
      <div role="alert" className="p-2 text-sm text-destructive">
        {t("relationships.legacyUnsupported")}
      </div>
    );
  }

  const loading =
    (relationships.isLoading && !relationships.data) ||
    (candidates.isLoading && !candidates.data) ||
    (relationshipTypes.isLoading && !relationshipTypes.data);
  const loadError =
    relationships.isError || candidates.isError || relationshipTypes.isError;

  return (
    <div ref={editorRef} className="grid gap-2">
      <div className="flex h-8 items-center gap-1 rounded border border-border bg-background px-2">
        <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          placeholder={t("relationships.searchPages")}
          aria-label={t("relationships.searchForProperty", {
            name: property.definition.name,
          })}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) =>
                Math.min(filteredCandidates.length - 1, current + 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              const candidate = filteredCandidates[activeIndex];
              if (candidate) {
                event.preventDefault();
                void toggle(candidate);
              }
            }
          }}
          className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="grid gap-1 p-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : loadError ? (
          <div className="grid gap-2 p-2 text-sm text-destructive">
            <span>{t("relationships.loadFailed")}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void relationships.refetch();
                void candidates.refetch();
                void relationshipTypes.refetch();
              }}
            >
              {t("relationships.tryAgain")}
            </Button>
          </div>
        ) : filteredCandidates.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            {t("relationships.noMatchingPages")}
          </div>
        ) : (
          filteredCandidates.map((candidate, index) => {
            const selected = selectedIds.includes(candidate.pageId);
            const context = candidateContext(candidate);
            const selectedEdge = selectedEdges.find(
              (edge) =>
                relationshipOppositeEndpoint(edge, pageId).pageId ===
                candidate.pageId,
            );
            return (
              <button
                key={candidate.pageId}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "flex min-h-10 w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  index === activeIndex && "bg-accent/60",
                )}
                disabled={mutate.isPending}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void toggle(candidate)}
              >
                <IconLink className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{candidate.title}</span>
                  {context.length > 0 ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {context.join(" · ")}
                    </span>
                  ) : null}
                  {selectedEdge && selectedEdge.state !== "active" ? (
                    <span className="block text-xs text-muted-foreground">
                      {t(`relationships.states.${selectedEdge.state}`)}
                    </span>
                  ) : null}
                </span>
                {selected ? <IconCheck className="size-4 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
      {error ? (
        <RelationshipMutationFailure
          message={error}
          pending={mutate.isPending}
          onRetry={
            mutate.failedVariables ? () => void retryToggle() : undefined
          }
          className="px-1 text-xs"
        />
      ) : null}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("relationships.done")}
        </Button>
      </div>
    </div>
  );
}

function ConnectionRow({
  edge,
  pageId,
  onRemove,
  pending,
}: {
  edge: ContentRelationshipItem;
  pageId: string;
  onRemove: (edge: ContentRelationshipItem) => void;
  pending: boolean;
}) {
  const t = useT();
  const endpoint = relationshipOppositeEndpoint(edge, pageId);
  const canRemove =
    edge.routes.length > 0 && edge.observedActivationIds.length > 0;
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      {edge.direction === "outgoing" ? (
        <IconArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <IconArrowLeft className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-muted-foreground">
          {edge.relationship.label}
        </div>
        <Link
          to={`/page/${endpoint.pageId}`}
          className="block truncate rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {endpoint.title}
        </Link>
      </div>
      {edge.state !== "active" ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t(`relationships.states.${edge.state}`)}
        </span>
      ) : null}
      {canRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label={t("relationships.removeConnection", {
            name: endpoint.title,
          })}
          disabled={pending}
          onClick={() => onRemove(edge)}
        >
          <IconX className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function ContentConnectionsSection({ pageId }: { pageId: string }) {
  const t = useT();
  const formatters = useFormatters();
  const relationships = useContentRelationships({
    pageId,
    direction: "both",
    limit: 100,
  });
  const history = useContentRelationshipHistory({ pageId, limit: 50 });
  const mutate = useMutateContentRelationships();
  const undo = useUndoContentRelationshipRevision();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRelationshipAppState({
    pageId,
    surface: historyOpen ? "history" : "connections",
  });

  async function finishRemoval(
    result: MutateContentRelationshipsResult,
    routes: RelationshipRouteRef[],
  ) {
    const refreshedHistory = await history.refetch();
    const recovery = refreshedHistory.data?.items.find(
      (item) => item.revisionId === result.revisionId,
    )?.recovery.recoveryToken;
    toast.success(
      t("relationships.connectionRemoved"),
      recovery
        ? {
            action: {
              label: t("relationships.undo"),
              onClick: () => {
                void undoHistory(result.revisionId, recovery, routes);
              },
            },
          }
        : undefined,
    );
  }

  async function remove(edge: ContentRelationshipItem) {
    const route = edge.routes[0];
    if (!route || edge.observedActivationIds.length === 0) return;
    undo.clearFailedRequest();
    setError(null);
    try {
      const result = await mutate.mutateAsync({
        operationId: contentRelationshipOperationId(),
        changes: [
          {
            kind: "remove",
            edgeId: edge.edgeId,
            observedActivationIds: edge.observedActivationIds,
            observationToken: edge.observationToken,
            route,
          },
        ],
      });
      await finishRemoval(result, [route]);
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.removeFailed"),
        ),
      );
    }
  }

  async function undoHistory(
    revisionId: string,
    recoveryToken: string,
    routes: RelationshipRouteRef[] = [],
  ) {
    mutate.clearFailedRequest();
    setError(null);
    try {
      await undo.mutateAsync({
        revisionId,
        recoveryToken,
        operationId: contentRelationshipOperationId(),
        routes,
      });
      toast.success(t("relationships.changeUndone"));
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.undoFailed"),
        ),
      );
    }
  }

  async function retryConnectionChange() {
    setError(null);
    try {
      if (mutate.failedVariables) {
        const failedRequest = mutate.failedVariables;
        const result = await mutate.retryFailed();
        const routes = failedRequest.changes.map((change) => change.route);
        await finishRemoval(result, routes);
        return;
      }
      if (undo.failedVariables) {
        await undo.retryFailed();
        toast.success(t("relationships.changeUndone"));
      }
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          mutate.failedVariables
            ? t("relationships.removeFailed")
            : t("relationships.undoFailed"),
        ),
      );
    }
  }

  return (
    <section className="mt-5" data-content-connections>
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("relationships.connections")}
        </h3>
        {(relationships.data?.items.length ?? 0) > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatters.formatNumber(relationships.data?.items.length ?? 0)}
          </span>
        ) : null}
      </div>
      {relationships.isLoading && !relationships.data ? (
        <div className="grid gap-1 px-2 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      ) : relationships.isError ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mx-1"
          onClick={() => void relationships.refetch()}
        >
          {t("relationships.retryConnections")}
        </Button>
      ) : relationships.data?.items.length ? (
        <div className="grid max-h-72 gap-0.5 overflow-y-auto">
          {relationships.data.items.map((edge) => (
            <ConnectionRow
              key={edge.edgeId}
              edge={edge}
              pageId={pageId}
              pending={mutate.isPending}
              onRemove={(item) => void remove(item)}
            />
          ))}
        </div>
      ) : (
        <div className="px-2 py-3 text-sm text-muted-foreground">
          {t("relationships.noConnections")}
        </div>
      )}
      {error ? (
        <RelationshipMutationFailure
          message={error}
          pending={mutate.isPending || undo.isPending}
          onRetry={
            mutate.failedVariables || undo.failedVariables
              ? () => void retryConnectionChange()
              : undefined
          }
          className="px-2 py-1 text-xs"
        />
      ) : null}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-xs font-medium text-muted-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconHistory className="size-3.5" />
            <span className="flex-1">{t("relationships.history")}</span>
            <IconChevronDown
              className={cn(
                "size-3.5 transition-transform duration-150 ease-out",
                historyOpen && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-0.5">
          {history.isLoading && !history.data ? (
            <div className="grid gap-1 px-2 py-1">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-4/5" />
            </div>
          ) : history.isError ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => void history.refetch()}
            >
              {t("relationships.retryHistory")}
            </Button>
          ) : history.data?.items.length ? (
            history.data.items.map((item) => (
              <div
                key={item.revisionId}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted/40"
              >
                <IconClockFilled className="mt-0.5 size-3.5 text-muted-foreground" />
                <div className="min-w-0">
                  <RelationshipHistoryDetails item={item} />
                  <div className="mt-1 break-words text-muted-foreground">
                    {t("relationships.historyActor", {
                      kind: t(historyActorKindMessage(item.actor.kind)),
                      name: item.actor.displayName,
                    })}
                    {" · "}
                    {t("relationships.historyOrigin", { origin: item.origin })}
                    {" · "}
                    {formatters.formatDate(item.committedAt, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </div>
                  {relationshipHistoryAuthorizingPrincipal(item) ? (
                    <div className="mt-0.5 break-words text-muted-foreground">
                      {t("relationships.historyAuthorizedBy", {
                        principal:
                          relationshipHistoryAuthorizingPrincipal(item)!,
                      })}
                    </div>
                  ) : null}
                </div>
                {item.recovery.allowed && item.recovery.recoveryToken ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("relationships.undoChange")}
                    disabled={undo.isPending}
                    onClick={() =>
                      void undoHistory(
                        item.revisionId,
                        item.recovery.recoveryToken!,
                      )
                    }
                  >
                    <IconRotate className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              {t("relationships.noHistory")}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export function RelationBulkValueEditor({
  property,
  selectedItems,
  disabled,
  onDone,
}: {
  property: DocumentProperty;
  selectedItems: ContentDatabaseItem[];
  disabled: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const relation = canonicalRelationOptions(property);
  const selectedPageIds = selectedItems.map((item) => item.document.id);
  const anchorPageId = selectedPageIds[0] ?? "";
  const [query, setQuery] = useState("");
  const relationships = useContentRelationships(
    relation && property.definition.databaseId
      ? {
          databaseId: property.definition.databaseId,
          relationshipTypeId: relation.relationshipTypeId,
          direction: "both",
          limit: 100,
        }
      : null,
  );
  const candidates = useContentRelationCandidates(
    relation && anchorPageId
      ? {
          propertyId: property.definition.id,
          anchorPageId,
          search: query,
          limit: 100,
          contextPropertyIds: [],
        }
      : null,
  );
  const types = useContentRelationshipTypes(
    relation && property.definition.databaseId
      ? { databaseId: property.definition.databaseId, limit: 100 }
      : null,
  );
  const mutate = useMutateContentRelationships();
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [selectedOppositePageId, setSelectedOppositePageId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useRelationshipAppState(
    relation
      ? {
          propertyId: property.definition.id,
          typeId: relation.relationshipTypeId,
          databaseId: property.definition.databaseId ?? undefined,
          selectedPageIds,
          surface: "bulk",
        }
      : null,
  );

  const selectedSet = useMemo(
    () => new Set(selectedPageIds),
    [selectedPageIds],
  );
  const relevantEdges = (relationships.data?.items ?? []).filter((edge) =>
    relation?.direction === "inverse"
      ? selectedSet.has(edge.targetPageId)
      : selectedSet.has(edge.sourcePageId),
  );
  const removeCandidates = Array.from(
    new Map(
      relevantEdges.map((edge) => {
        const anchor =
          relation?.direction === "inverse"
            ? edge.targetPageId
            : edge.sourcePageId;
        const endpoint = relationshipOppositeEndpoint(edge, anchor);
        return [
          endpoint.pageId,
          {
            pageId: endpoint.pageId,
            title: endpoint.title,
            context: {},
            slotObservationToken: null,
          },
        ];
      }),
    ).values(),
  );
  const availableCandidates =
    mode === "add" ? (candidates.data?.items ?? []) : removeCandidates;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCandidates = availableCandidates.filter(
    (candidate) =>
      !normalizedQuery ||
      candidate.title.toLowerCase().includes(normalizedQuery),
  );
  const typeDescriptor = types.data?.items.find(
    (item) => item.type.id === relation?.relationshipTypeId,
  );
  const selectedCandidate = availableCandidates.find(
    (candidate) => candidate.pageId === selectedOppositePageId,
  );

  async function apply() {
    if (!relation || !typeDescriptor || !selectedOppositePageId) return;
    setError(null);
    try {
      const changes: RelationshipChange[] = [];
      if (mode === "add") {
        if (
          relation.direction === "inverse" &&
          typeDescriptor.version.forwardCardinality === "one" &&
          selectedPageIds.length > 1
        ) {
          throw new Error(t("relationships.bulkInverseMaxOne"));
        }
        for (const pageId of selectedPageIds) {
          const route = propertyRoute(property, pageId);
          if (!route) throw new Error(t("relationships.routeUnavailable"));
          const sourcePageId =
            relation.direction === "forward" ? pageId : selectedOppositePageId;
          const targetPageId =
            relation.direction === "forward" ? selectedOppositePageId : pageId;
          const current = relevantEdges.find(
            (edge) =>
              relation.direction === "forward" && edge.sourcePageId === pageId,
          );
          if (
            typeDescriptor.version.forwardCardinality === "one" &&
            (relation.direction === "inverse" ||
              (current &&
                relationshipOppositeEndpoint(current, pageId).pageId !==
                  selectedOppositePageId))
          ) {
            const slotObservationToken =
              relation.direction === "inverse"
                ? selectedCandidate?.slotObservationToken
                : current?.slotObservationToken;
            if (!slotObservationToken) {
              throw new Error(t("relationships.refreshBeforeReplacing"));
            }
            changes.push({
              kind: "replace",
              typeId: relation.relationshipTypeId,
              typeVersionId: typeDescriptor.version.id,
              sourcePageId,
              targetPageId,
              observedSlotToken: slotObservationToken,
              route,
            });
          } else {
            changes.push({
              kind: "add",
              typeId: relation.relationshipTypeId,
              typeVersionId: typeDescriptor.version.id,
              sourcePageId,
              targetPageId,
              route,
            });
          }
        }
      } else {
        for (const edge of relevantEdges) {
          const anchor =
            relation.direction === "forward"
              ? edge.sourcePageId
              : edge.targetPageId;
          if (
            relationshipOppositeEndpoint(edge, anchor).pageId !==
            selectedOppositePageId
          ) {
            continue;
          }
          const route = edgePropertyRoute(edge, property);
          if (!route) throw new Error(t("relationships.routeUnavailable"));
          changes.push({
            kind: "remove",
            edgeId: edge.edgeId,
            observedActivationIds: edge.observedActivationIds,
            observationToken: edge.observationToken,
            route,
          });
        }
      }
      if (changes.length === 0) return;
      const result = await mutate.mutateAsync({
        operationId: contentRelationshipOperationId(),
        changes,
      });
      toast.success(
        t(
          mode === "add"
            ? "relationships.bulkAdded"
            : "relationships.bulkRemoved",
          { count: result.results.length },
        ),
      );
      onDone();
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.bulkFailed"),
        ),
      );
    }
  }

  async function retryApply() {
    setError(null);
    try {
      const result = await mutate.retryFailed();
      toast.success(
        t(
          mode === "add"
            ? "relationships.bulkAdded"
            : "relationships.bulkRemoved",
          { count: result.results.length },
        ),
      );
      onDone();
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.bulkFailed"),
        ),
      );
    }
  }

  if (!relation) {
    return (
      <div className="text-sm text-destructive">
        {t("relationships.legacyUnsupported")}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-1 rounded bg-muted p-1">
        {(["add", "remove"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={mode === value ? "secondary" : "ghost"}
            className="h-7"
            onClick={() => {
              mutate.clearFailedRequest();
              setError(null);
              setMode(value);
              setSelectedOppositePageId("");
            }}
          >
            {t(
              value === "add"
                ? "relationships.addToSelected"
                : "relationships.removeFromSelected",
            )}
          </Button>
        ))}
      </div>
      <div className="flex h-8 items-center gap-1 rounded border px-2">
        <IconSearch className="size-3.5 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          placeholder={t("relationships.searchPages")}
          className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDone();
          }}
        />
      </div>
      <div className="max-h-44 overflow-y-auto">
        {visibleCandidates.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            {mode === "remove"
              ? t("relationships.noSharedRelationships")
              : t("relationships.noMatchingPages")}
          </div>
        ) : (
          visibleCandidates.map((candidate) => (
            <button
              key={candidate.pageId}
              type="button"
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded px-2 text-start text-sm hover:bg-accent",
                selectedOppositePageId === candidate.pageId && "bg-accent",
              )}
              onClick={() => {
                mutate.clearFailedRequest();
                setError(null);
                setSelectedOppositePageId(candidate.pageId);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
              {selectedOppositePageId === candidate.pageId ? (
                <IconCheck className="size-4" />
              ) : null}
            </button>
          ))
        )}
      </div>
      {error ? (
        <RelationshipMutationFailure
          message={error}
          pending={mutate.isPending}
          onRetry={mutate.failedVariables ? () => void retryApply() : undefined}
          className="text-xs"
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("relationships.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || mutate.isPending || !selectedOppositePageId}
          onClick={() => void apply()}
        >
          {t("relationships.apply")}
        </Button>
      </div>
    </div>
  );
}

export function RelationPropertyDeletionDialog({
  open,
  property,
  onOpenChange,
  onDeleted,
}: {
  open: boolean;
  property: DocumentProperty;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const relation = canonicalRelationOptions(property);
  const prepare = usePrepareContentRelationshipRemoval();
  const remove = useRemoveContentRelationProperty();
  const undo = useUndoContentRelationshipRevision();
  const relationships = useContentRelationships(
    relation && property.definition.databaseId
      ? {
          databaseId: property.definition.databaseId,
          relationshipTypeId: relation.relationshipTypeId,
          direction: "both",
          limit: 100,
        }
      : null,
  );
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [previewQuery, setPreviewQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const removalOperationRef =
    useRef<RelationshipPropertyRemovalOperation>(null);

  useRelationshipAppState(
    open && relation
      ? {
          propertyId: property.definition.id,
          typeId: relation.relationshipTypeId,
          databaseId: property.definition.databaseId ?? undefined,
          surface: "configuration",
        }
      : null,
  );

  useEffect(() => {
    if (!open) return;
    setSelectedEdgeIds([]);
    setPreviewQuery("");
    setError(null);
    removalOperationRef.current = null;
    prepare.reset();
    void prepare
      .mutateAsync({
        selection: { kind: "property", propertyId: property.definition.id },
      })
      .catch((caught) => {
        setError(
          actionErrorMessage(caught) ?? t("relationships.removalPreviewFailed"),
        );
      });
  }, [open, property.definition.id]);

  async function retryPropertyUndo() {
    try {
      await undo.retryFailed();
      toast.success(t("relationships.changeUndone"));
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      toast.error(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.undoFailed"),
        ),
        {
          action: {
            label: t("relationships.retrySavedChange"),
            onClick: () => void retryPropertyUndo(),
          },
        },
      );
    }
  }

  function finishPropertyRemoval(result: RemoveContentRelationPropertyResult) {
    removalOperationRef.current = null;
    onOpenChange(false);
    onDeleted();
    toast.success(t("relationships.propertyRemoved"), {
      action: {
        label: t("relationships.undo"),
        onClick: () => {
          void undo
            .mutateAsync({
              revisionId: result.undo.revisionId,
              recoveryToken: result.undo.recoveryToken,
              operationId: contentRelationshipOperationId(),
              routes: [],
            })
            .then(() => toast.success(t("relationships.changeUndone")))
            .catch((caught) => {
              if (isSupersededRelationshipMutationError(caught)) return;
              toast.error(
                relationshipMutationErrorMessage(
                  caught,
                  t("relationships.requestInterrupted"),
                  t("relationships.undoFailed"),
                ),
                {
                  action: {
                    label: t("relationships.retrySavedChange"),
                    onClick: () => void retryPropertyUndo(),
                  },
                },
              );
            });
        },
      },
    });
  }

  async function commit(keep: boolean) {
    setError(null);
    try {
      const relationshipMode = relationshipPropertyRemovalMode({
        keep,
        selectionReceipt: prepare.data?.selectionReceipt,
        selectedEdgeIds,
      });
      if (!relationshipMode) {
        setError(t("relationships.removalPreviewFailed"));
        return;
      }

      removalOperationRef.current = relationshipPropertyRemovalOperation(
        removalOperationRef.current,
        property.definition.id,
        relationshipMode,
      );
      const result = await remove.mutateAsync({
        propertyId: property.definition.id,
        relationshipMode,
        operationId: removalOperationRef.current.operationId,
      });
      finishPropertyRemoval(result);
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.removePropertyFailed"),
        ),
      );
    }
  }

  async function retryPropertyRemoval() {
    setError(null);
    try {
      finishPropertyRemoval(await remove.retryFailed());
    } catch (caught) {
      if (isSupersededRelationshipMutationError(caught)) return;
      setError(
        relationshipMutationErrorMessage(
          caught,
          t("relationships.requestInterrupted"),
          t("relationships.removePropertyFailed"),
        ),
      );
    }
  }

  const edgeById = new Map(
    (relationships.data?.items ?? []).map((edge) => [edge.edgeId, edge]),
  );
  const previewEdges = (prepare.data?.edges ?? [])
    .map((edge) => edgeById.get(edge.edgeId))
    .filter((edge): edge is ContentRelationshipItem => !!edge);
  const normalizedPreviewQuery = previewQuery.trim().toLowerCase();
  const visiblePreviewEdges = previewEdges.filter(
    (edge) =>
      !normalizedPreviewQuery ||
      edge.source.title.toLowerCase().includes(normalizedPreviewQuery) ||
      edge.target.title.toLowerCase().includes(normalizedPreviewQuery) ||
      edge.relationship.label.toLowerCase().includes(normalizedPreviewQuery),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,42rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b px-5 py-4 text-start">
          <DialogTitle>{t("relationships.removeProperty")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="text-sm">
            {t("relationships.removePropertyNamed", {
              name: property.definition.name,
            })}
          </div>
          <div className="mt-4 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <IconArrowsExchange className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t("relationships.relationshipsPreserved")}
              </span>
            </div>
          </div>
          {prepare.isPending || relationships.isLoading ? (
            <div className="mt-3 grid gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-4/5" />
            </div>
          ) : previewEdges.length > 0 ? (
            <div className="mt-4 grid gap-1">
              <div className="px-1 text-xs font-medium text-muted-foreground">
                {t("relationships.selectRelationshipsToRemove")}
              </div>
              <div className="mb-1 flex h-8 items-center gap-1 rounded border px-2">
                <IconSearch className="size-3.5 text-muted-foreground" />
                <Input
                  value={previewQuery}
                  aria-label={t("relationships.filterRelationships")}
                  placeholder={t("relationships.filterRelationships")}
                  className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                  onChange={(event) => setPreviewQuery(event.target.value)}
                />
              </div>
              {visiblePreviewEdges.map((edge) => {
                const selected = selectedEdgeIds.includes(edge.edgeId);
                return (
                  <label
                    key={edge.edgeId}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={(checked) => {
                        remove.clearFailedRequest();
                        removalOperationRef.current = null;
                        setError(null);
                        setSelectedEdgeIds((current) =>
                          checked
                            ? [...current, edge.edgeId]
                            : current.filter((id) => id !== edge.edgeId),
                        );
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {edge.source.title}{" "}
                      <span className="text-muted-foreground">→</span>{" "}
                      {edge.target.title}
                    </span>
                  </label>
                );
              })}
              {visiblePreviewEdges.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  {t("relationships.noMatchingRelationships")}
                </div>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <RelationshipMutationFailure
              message={error}
              pending={remove.isPending}
              onRetry={
                remove.failedVariables
                  ? () => void retryPropertyRemoval()
                  : undefined
              }
              className="mt-3 text-sm"
            />
          ) : null}
        </div>
        <DialogFooter className="border-t px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("relationships.cancel")}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => void commit(true)}
            >
              {t("relationships.removePropertyOnly")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending || selectedEdgeIds.length === 0}
              onClick={() => void commit(false)}
            >
              <IconTrash className="size-4" />
              {t("relationships.removePropertyAndSelected", {
                count: selectedEdgeIds.length,
              })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
