import type { DesktopPrivateContentSummary } from "@shared/ipc-channels";

export interface DesktopPrivateContentTreeRow {
  readonly document: DesktopPrivateContentSummary;
  readonly depth: number;
}

/**
 * Build a deterministic visible tree while refusing cycles and orphaned
 * parent references. The native registry rejects both too; this keeps an
 * unexpected renderer payload from creating an unbounded walk.
 */
export function privateContentTree(
  documents: readonly DesktopPrivateContentSummary[],
): DesktopPrivateContentTreeRow[] {
  const byParent = new Map<string | null, DesktopPrivateContentSummary[]>();
  const identifiers = new Set(documents.map((document) => document.id));
  for (const document of documents) {
    const parentId =
      document.parentId !== null && identifiers.has(document.parentId)
        ? document.parentId
        : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(document);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
  }

  const output: DesktopPrivateContentTreeRow[] = [];
  const visited = new Set<string>();
  const append = (parentId: string | null, depth: number) => {
    for (const document of byParent.get(parentId) ?? []) {
      if (visited.has(document.id)) continue;
      visited.add(document.id);
      output.push(Object.freeze({ document, depth }));
      append(document.id, depth + 1);
    }
  };
  append(null, 0);
  return output;
}
