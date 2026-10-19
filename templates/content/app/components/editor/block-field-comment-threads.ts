import type { ResourceSuggestion } from "@agent-native/core/review";
import type { DocumentProperty } from "@shared/api";
import { isBlocksPropertyType, isPrimaryBlocksField } from "@shared/properties";

import type { CommentThread } from "@/hooks/use-comments";

import { suggestionsByThread } from "./thread-suggestions";

/**
 * The tab a thread sits in: a Blocks field id, or null for the page body.
 * Threads from before field comments, and Property threads, are the body's.
 */
export function commentThreadFieldId(
  thread: Pick<CommentThread, "field">,
): string | null {
  return thread.field?.fieldId ?? null;
}

/** A key for a tab that a Map or a filter can hold: "" is the page body. */
export function commentTabKey(fieldId: string | null): string {
  return fieldId ?? "";
}

/** A Blocks field as comments see it: the primary field is the body (null). */
export type CommentTab = { fieldId: string | null; name: string };

/** The page's Blocks fields in tab order. */
export function commentTabsFromProperties(
  properties: readonly DocumentProperty[] | undefined,
): CommentTab[] {
  return (properties ?? [])
    .filter((property) => isBlocksPropertyType(property.definition.type))
    .sort((left, right) => left.definition.position - right.definition.position)
    .map((property) => ({
      fieldId: isPrimaryBlocksField(property.definition.options)
        ? null
        : property.definition.id,
      name: property.definition.name,
    }));
}

/** Where a Comments panel entry sits, and the field name its thread saved. */
export type CommentTabPlacement = {
  fieldId: string | null;
  fieldName: string | null;
};

export function commentThreadPlacement(
  thread: Pick<CommentThread, "field">,
): CommentTabPlacement {
  return {
    fieldId: commentThreadFieldId(thread),
    fieldName: thread.field?.fieldName ?? null,
  };
}

export type CommentTabGroup<T> = {
  key: string;
  fieldId: string | null;
  /** The tab's name; for a deleted tab, the name its threads saved. */
  name: string | null;
  /** The tab is no longer on the page. */
  removed: boolean;
  entries: T[];
};

/**
 * Entries grouped by tab: the page's tabs in order, then tabs since deleted,
 * under the name their threads saved. The page body is never deleted, even
 * when no Blocks field is primary. `keepEmptyTabs` keeps the page's tabs that
 * have no entries, for a list of tabs to filter by.
 */
export function groupCommentsByTab<T>(
  entries: readonly T[],
  tabs: readonly CommentTab[],
  placement: (entry: T) => CommentTabPlacement,
  keepEmptyTabs = false,
): CommentTabGroup<T>[] {
  const groups = new Map<string, CommentTabGroup<T>>();
  for (const tab of tabs) {
    const key = commentTabKey(tab.fieldId);
    if (groups.has(key)) continue;
    groups.set(key, {
      key,
      fieldId: tab.fieldId,
      name: tab.name,
      removed: false,
      entries: [],
    });
  }
  for (const entry of entries) {
    const { fieldId, fieldName } = placement(entry);
    const key = commentTabKey(fieldId);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        fieldId,
        name: fieldName,
        removed: fieldId !== null,
        entries: [],
      };
      groups.set(key, group);
    } else if (group.removed && !group.name && fieldName) {
      group.name = fieldName;
    }
    group.entries.push(entry);
  }
  return [...groups.values()].filter(
    (group) => group.entries.length > 0 || (keepEmptyTabs && !group.removed),
  );
}

/**
 * Whether the Comments panel groups and filters by tab: when the page has two
 * or more Blocks fields, or keeps threads from a tab since deleted.
 */
export function showsCommentTabs(
  tabs: readonly CommentTab[],
  threads: readonly Pick<CommentThread, "field" | "property">[],
): boolean {
  if (tabs.length >= 2) return true;
  if (tabs.length === 0) return false;
  return threads.some(
    (thread) =>
      !thread.property &&
      !tabs.some((tab) => tab.fieldId === commentThreadFieldId(thread)),
  );
}

export type BlockFieldOpenCounts = ReadonlyMap<string | null, number>;

/**
 * Open review per tab, as the margin shows it: unresolved threads, and on the
 * body also pending suggestions with their text on the page (a proposal of
 * several edits counts once) and unsaved draft suggestions. Property threads
 * belong to no tab.
 */
export function openReviewCountsByField({
  threads,
  suggestions,
  draftSuggestions,
  anchoredSuggestionIds,
}: {
  threads: readonly CommentThread[] | undefined;
  suggestions: readonly ResourceSuggestion[];
  draftSuggestions: readonly unknown[];
  anchoredSuggestionIds: readonly string[] | null | undefined;
}): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  const add = (fieldId: string | null, count = 1) =>
    counts.set(fieldId, (counts.get(fieldId) ?? 0) + count);
  for (const thread of threads ?? []) {
    if (thread.resolved || thread.property) continue;
    add(commentThreadFieldId(thread));
  }
  const embedded = new Set(
    [...suggestionsByThread(suggestions, threads ?? []).values()]
      .flat()
      .map((suggestion) => suggestion.id),
  );
  const proposalSizes = new Map<string, number>();
  for (const suggestion of suggestions) {
    if (!suggestion.proposalId) continue;
    proposalSizes.set(
      suggestion.proposalId,
      (proposalSizes.get(suggestion.proposalId) ?? 0) + 1,
    );
  }
  const countedProposals = new Set<string>();
  for (const suggestion of suggestions) {
    if (suggestion.status !== "pending" || embedded.has(suggestion.id)) {
      continue;
    }
    if (anchoredSuggestionIds && !anchoredSuggestionIds.includes(suggestion.id))
      continue;
    const proposalId = suggestion.proposalId;
    if (proposalId && (proposalSizes.get(proposalId) ?? 0) >= 2) {
      if (countedProposals.has(proposalId)) continue;
      countedProposals.add(proposalId);
    }
    add(null);
  }
  if (draftSuggestions.length > 0) add(null, draftSuggestions.length);
  return counts;
}
