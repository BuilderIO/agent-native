import type {
  CanonicalRelationOptions,
  ContentRelationCandidate,
  ContentRelationshipItem,
} from "@shared/relationships";

export type RelationshipBulkSelectionState = "all" | "mixed" | "none";

export type RelationshipBulkCandidate = ContentRelationCandidate & {
  selectionState: RelationshipBulkSelectionState;
};

export type RelationshipBulkIntent = Record<string, boolean>;

export type RelationshipBulkPlanItem =
  | {
      kind: "add";
      anchorPageId: string;
      sourcePageId: string;
      targetPageId: string;
    }
  | {
      kind: "replace";
      anchorPageId: string;
      sourcePageId: string;
      targetPageId: string;
      observedSlotToken: string;
    }
  | {
      kind: "remove";
      anchorPageId: string;
      edge: ContentRelationshipItem;
    };

function edgeAnchorPageId(
  edge: ContentRelationshipItem,
  direction: CanonicalRelationOptions["direction"],
) {
  return direction === "forward" ? edge.sourcePageId : edge.targetPageId;
}

function edgeCandidatePageId(
  edge: ContentRelationshipItem,
  direction: CanonicalRelationOptions["direction"],
) {
  return direction === "forward" ? edge.targetPageId : edge.sourcePageId;
}

export function relationshipBulkCandidates({
  candidates,
  edges,
  selectedPageIds,
  direction,
}: {
  candidates: ContentRelationCandidate[];
  edges: ContentRelationshipItem[];
  selectedPageIds: string[];
  direction: CanonicalRelationOptions["direction"];
}): RelationshipBulkCandidate[] {
  const selectedSet = new Set(selectedPageIds);
  const candidateByPageId = new Map(
    candidates.map((candidate) => [candidate.pageId, candidate]),
  );
  for (const edge of edges) {
    const anchorPageId = edgeAnchorPageId(edge, direction);
    if (!selectedSet.has(anchorPageId)) continue;
    const endpoint = direction === "forward" ? edge.target : edge.source;
    if (!candidateByPageId.has(endpoint.pageId)) {
      candidateByPageId.set(endpoint.pageId, {
        pageId: endpoint.pageId,
        title: endpoint.title,
        context: {},
        slotObservationToken: edge.slotObservationToken,
      });
    }
  }

  return [...candidateByPageId.values()].map((candidate) => {
    const linkedAnchors = new Set(
      edges
        .filter(
          (edge) =>
            edgeCandidatePageId(edge, direction) === candidate.pageId &&
            selectedSet.has(edgeAnchorPageId(edge, direction)),
        )
        .map((edge) => edgeAnchorPageId(edge, direction)),
    );
    return {
      ...candidate,
      selectionState:
        linkedAnchors.size === 0
          ? "none"
          : linkedAnchors.size === selectedSet.size
            ? "all"
            : "mixed",
    };
  });
}

export function effectiveRelationshipBulkSelectionState(
  candidate: RelationshipBulkCandidate,
  intent: RelationshipBulkIntent,
): RelationshipBulkSelectionState {
  const desired = intent[candidate.pageId];
  return desired === undefined
    ? candidate.selectionState
    : desired
      ? "all"
      : "none";
}

function setNormalizedIntent(
  next: RelationshipBulkIntent,
  candidate: RelationshipBulkCandidate,
  desired: boolean,
) {
  const originalMatches = desired
    ? candidate.selectionState === "all"
    : candidate.selectionState === "none";
  if (originalMatches) delete next[candidate.pageId];
  else next[candidate.pageId] = desired;
}

export function toggleRelationshipBulkIntent({
  candidateId,
  candidates,
  intent,
  direction,
  forwardCardinality,
}: {
  candidateId: string;
  candidates: RelationshipBulkCandidate[];
  intent: RelationshipBulkIntent;
  direction: CanonicalRelationOptions["direction"];
  forwardCardinality: "one" | "many";
}): RelationshipBulkIntent {
  const candidate = candidates.find((item) => item.pageId === candidateId);
  if (!candidate) return intent;
  const desired =
    effectiveRelationshipBulkSelectionState(candidate, intent) !== "all";
  const next = { ...intent };

  if (desired && direction === "forward" && forwardCardinality === "one") {
    for (const item of candidates) {
      setNormalizedIntent(next, item, item.pageId === candidateId);
    }
  } else {
    setNormalizedIntent(next, candidate, desired);
  }
  return next;
}

export function relationshipBulkReadStatus(
  reads: Array<{
    isError: boolean;
    isPlaceholderData?: boolean;
    data?: { nextCursor: string | null };
  }>,
): "loading" | "unavailable" | "ready" {
  if (reads.some((read) => read.isError || read.data?.nextCursor)) {
    return "unavailable";
  }
  return reads.some((read) => !read.data || read.isPlaceholderData)
    ? "loading"
    : "ready";
}

export function planRelationshipBulkChanges({
  candidates,
  edges,
  selectedPageIds,
  direction,
  forwardCardinality,
  intent,
}: {
  candidates: RelationshipBulkCandidate[];
  edges: ContentRelationshipItem[];
  selectedPageIds: string[];
  direction: CanonicalRelationOptions["direction"];
  forwardCardinality: "one" | "many";
  intent: RelationshipBulkIntent;
}): {
  items: RelationshipBulkPlanItem[];
  error: "inverse-max-one" | "refresh-required" | null;
} {
  const intendedEntries = Object.entries(intent);
  if (
    direction === "inverse" &&
    forwardCardinality === "one" &&
    selectedPageIds.length > 1 &&
    intendedEntries.some(([, desired]) => desired)
  ) {
    return { items: [], error: "inverse-max-one" };
  }

  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.pageId, candidate]),
  );
  const desiredAllIds = new Set(
    intendedEntries.flatMap(([candidateId, desired]) =>
      desired ? [candidateId] : [],
    ),
  );
  const items: RelationshipBulkPlanItem[] = [];

  for (const anchorPageId of selectedPageIds) {
    const currentEdges = edges.filter(
      (edge) => edgeAnchorPageId(edge, direction) === anchorPageId,
    );
    const replacementCandidateId =
      direction === "forward" && forwardCardinality === "one"
        ? [...desiredAllIds][0]
        : undefined;
    const replacementNeeded =
      replacementCandidateId !== undefined &&
      !currentEdges.some(
        (edge) =>
          edgeCandidatePageId(edge, direction) === replacementCandidateId,
      );

    for (const [candidateId, desired] of intendedEntries) {
      const matchingEdge = currentEdges.find(
        (edge) => edgeCandidatePageId(edge, direction) === candidateId,
      );
      if (desired) {
        if (matchingEdge) continue;
        const sourcePageId =
          direction === "forward" ? anchorPageId : candidateId;
        const targetPageId =
          direction === "forward" ? candidateId : anchorPageId;
        if (forwardCardinality === "one") {
          const observedSlotToken =
            direction === "inverse"
              ? candidatesById.get(candidateId)?.slotObservationToken
              : currentEdges[0]?.slotObservationToken;
          if (direction === "inverse" || currentEdges.length > 0) {
            if (!observedSlotToken) {
              return { items: [], error: "refresh-required" };
            }
            items.push({
              kind: "replace",
              anchorPageId,
              sourcePageId,
              targetPageId,
              observedSlotToken,
            });
            continue;
          }
        }
        items.push({
          kind: "add",
          anchorPageId,
          sourcePageId,
          targetPageId,
        });
        continue;
      }
      if (!matchingEdge) continue;
      if (
        direction === "forward" &&
        replacementNeeded &&
        forwardCardinality === "one" &&
        edgeCandidatePageId(matchingEdge, direction) !== replacementCandidateId
      ) {
        continue;
      }
      items.push({ kind: "remove", anchorPageId, edge: matchingEdge });
    }
  }

  return { items, error: null };
}
