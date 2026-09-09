import {
  getBrowserTabId,
  setClientAppState,
} from "@agent-native/core/client/hooks";
import { appStateKeyForBrowserTab } from "@shared/app-state-tabs";
import { useEffect, useRef } from "react";

export const CONTENT_RELATIONSHIP_CONTEXT_KEY =
  "content-relationship-context" as const;

export interface ContentRelationshipContext {
  pageId?: string;
  propertyId?: string;
  typeId?: string;
  databaseId?: string;
  selectedPageIds?: string[];
  surface: "picker" | "connections" | "bulk" | "history" | "configuration";
}

interface RelationshipContextOwner {
  context: ContentRelationshipContext;
  sequence: number;
}

const relationshipContextOwners = new Map<
  string,
  Map<symbol, RelationshipContextOwner>
>();
let relationshipContextSequence = 0;

function latestRelationshipContext(
  owners: Map<symbol, RelationshipContextOwner>,
) {
  return Array.from(owners.values()).reduce<RelationshipContextOwner | null>(
    (latest, candidate) =>
      !latest || candidate.sequence > latest.sequence ? candidate : latest,
    null,
  );
}

/**
 * Publishes only navigation and selection identifiers. Relationship data stays
 * in the canonical Action reads and never enters application state.
 */
export function useRelationshipAppState(
  context: ContentRelationshipContext | null,
) {
  const ownerRef = useRef(Symbol("content-relationship-context"));
  const serialized = context ? JSON.stringify(context) : null;

  useEffect(() => {
    if (!serialized) return;
    const owner = ownerRef.current;
    const key = appStateKeyForBrowserTab(
      CONTENT_RELATIONSHIP_CONTEXT_KEY,
      getBrowserTabId(),
    );
    const context = JSON.parse(serialized) as ContentRelationshipContext;
    const owners =
      relationshipContextOwners.get(key) ??
      new Map<symbol, RelationshipContextOwner>();
    relationshipContextOwners.set(key, owners);
    const entry = { context, sequence: ++relationshipContextSequence };
    owners.set(owner, entry);
    void setClientAppState(key, context, {
      keepalive: true,
      requestSource: "content-relationship-ui",
    });

    return () => {
      if (owners.get(owner) !== entry) return;
      const wasLatest = latestRelationshipContext(owners) === entry;
      owners.delete(owner);
      if (!wasLatest) return;
      const next = latestRelationshipContext(owners);
      if (owners.size === 0) relationshipContextOwners.delete(key);
      void setClientAppState(key, next?.context ?? null, {
        keepalive: true,
        requestSource: "content-relationship-ui",
      });
    };
  }, [serialized]);
}
