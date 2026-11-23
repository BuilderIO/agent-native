import type { CellDraft } from "../app/lib/model/contracts.js";

export const MAX_SECTION_DEPTH = 2;

type SectionMember = {
  id: string;
  contents: { kind: string; parentSectionId?: string | null | undefined };
};

export function sectionParent(cell: SectionMember) {
  return cell.contents.parentSectionId ?? null;
}

function childrenByParent<T extends SectionMember>(cells: readonly T[]) {
  const children = new Map<string | null, T[]>();
  for (const cell of cells) {
    const parent = sectionParent(cell);
    const siblings = children.get(parent);
    if (siblings) siblings.push(cell);
    else children.set(parent, [cell]);
  }
  return children;
}

function flatten<T extends SectionMember>(
  children: Map<string | null, T[]>,
  parent: string | null,
  visited = new Set(parent === null ? [] : [parent]),
): T[] {
  return (children.get(parent) ?? []).flatMap((cell) => {
    if (visited.has(cell.id)) return [];
    visited.add(cell.id);
    return [cell, ...flatten(children, cell.id, visited)];
  });
}

export function notebookSectionOrder<T extends SectionMember>(
  cells: readonly T[],
) {
  return flatten(childrenByParent(cells), null);
}

export function sectionDescendantIds(
  cells: readonly SectionMember[],
  sectionId: string,
) {
  return flatten(childrenByParent(cells), sectionId).map(({ id }) => id);
}

function depthById(cells: ReadonlyMap<string, SectionMember>, cellId: string) {
  let cell = cells.get(cellId);
  if (!cell) return null;
  for (let depth = 0; depth <= MAX_SECTION_DEPTH + 1; depth++) {
    const parent = sectionParent(cell);
    if (parent === null) return depth;
    cell = cells.get(parent);
    if (cell?.contents.kind !== "collapsible") return null;
  }
  return null;
}

export function sectionDepth(cells: readonly SectionMember[], id: string) {
  return depthById(new Map(cells.map((cell) => [cell.id, cell])), id);
}

export function validNotebookSections(cells: readonly SectionMember[]) {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  return cells.every((cell) => {
    const depth = depthById(byId, cell.id);
    return (
      depth !== null &&
      (cell.contents.kind !== "collapsible" || depth <= MAX_SECTION_DEPTH)
    );
  });
}

export function restoreNotebookMembership(
  cells: readonly CellDraft[],
  allocateId: () => string,
): CellDraft[] | null {
  const ids = new Map<string, string>();
  const rows = [];
  for (const contents of cells) {
    const id = allocateId();
    if (contents.id !== undefined) {
      if (ids.has(contents.id)) return null;
      ids.set(contents.id, id);
    }
    rows.push({ id, contents });
  }
  const remapped = rows.map(({ id, contents }) => {
    const parent = contents.parentSectionId;
    return {
      id,
      contents: {
        ...contents,
        id,
        ...(parent == null
          ? {}
          : { parentSectionId: ids.get(parent) ?? parent }),
      },
    };
  });
  return validNotebookSections(remapped)
    ? notebookSectionOrder(remapped).map(({ contents }) => contents)
    : null;
}

export function sectionSelectionRoots<T extends SectionMember>(
  cells: readonly T[],
  ids: readonly string[],
) {
  const selected = new Set(ids);
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const hasSelectedAncestor = (cell: T) => {
    let parent = sectionParent(cell);
    for (
      let depth = 0;
      parent !== null && depth <= MAX_SECTION_DEPTH;
      depth++
    ) {
      if (selected.has(parent)) return true;
      const ancestor = byId.get(parent);
      parent = ancestor ? sectionParent(ancestor) : null;
    }
    return false;
  };
  return cells.filter(
    (cell) => selected.has(cell.id) && !hasSelectedAncestor(cell),
  );
}

function reparent(
  cells: readonly SectionMember[],
  roots: readonly SectionMember[],
  parentSectionId: string | null,
) {
  const ids = new Set(roots.map(({ id }) => id));
  return cells.map((cell) =>
    ids.has(cell.id)
      ? { ...cell, contents: { ...cell.contents, parentSectionId } }
      : cell,
  );
}

export function canMoveIntoSection(
  cells: readonly SectionMember[],
  ids: readonly string[],
  parentSectionId: string | null,
) {
  const roots = sectionSelectionRoots(cells, ids);
  return (
    roots.length > 0 &&
    validNotebookSections(reparent(cells, roots, parentSectionId))
  );
}

export function canGroupInSection(
  cells: readonly SectionMember[],
  ids: readonly string[],
) {
  const roots = sectionSelectionRoots(cells, ids);
  const first = roots[0];
  if (!first) return false;
  const parentSectionId = sectionParent(first);
  const depth = sectionDepth(cells, first.id);
  if (depth === null || depth >= MAX_SECTION_DEPTH) return false;
  const marker = "";
  return validNotebookSections([
    ...reparent(cells, roots, marker),
    { id: marker, contents: { kind: "collapsible", parentSectionId } },
  ]);
}

export function notebookInsertionGap<T extends SectionMember>(
  cells: readonly T[],
  options: {
    parentSectionId?: string | null | undefined;
    beforeCellId?: string | undefined;
    afterCellId?: string | null | undefined;
  },
) {
  const anchorId = options.beforeCellId ?? options.afterCellId;
  const anchor =
    anchorId == null ? undefined : cells.find(({ id }) => id === anchorId);
  if (anchorId != null && !anchor) return null;
  const parentSectionId =
    options.parentSectionId === undefined
      ? anchor
        ? sectionParent(anchor)
        : null
      : options.parentSectionId;
  if (anchor && sectionParent(anchor) !== parentSectionId) return null;
  const siblings = cells.filter(
    (cell) => sectionParent(cell) === parentSectionId,
  );
  const position = anchor
    ? siblings.indexOf(anchor) + (options.beforeCellId === undefined ? 1 : 0)
    : siblings.length;
  return {
    parentSectionId,
    gap: {
      afterCellId: siblings[position - 1]?.id ?? null,
      beforeCellId: siblings[position]?.id ?? null,
    },
  };
}

export function notebookSectionInsertPosition(
  cells: readonly SectionMember[],
  parentSectionId: string | null,
  gap: { afterCellId: string | null; beforeCellId: string | null },
) {
  const siblings = cells.filter(
    (cell) => sectionParent(cell) === parentSectionId,
  );
  const after =
    gap.afterCellId === null
      ? -1
      : siblings.findIndex(({ id }) => id === gap.afterCellId);
  if (gap.afterCellId !== null && after < 0) return null;
  if ((siblings[after + 1]?.id ?? null) !== gap.beforeCellId) return null;
  const previousId = gap.afterCellId ?? parentSectionId;
  if (previousId === null) return 0;
  const descendants =
    gap.afterCellId === null ? [] : sectionDescendantIds(cells, previousId);
  const index = cells.findIndex(
    ({ id }) => id === (descendants.at(-1) ?? previousId),
  );
  return index === -1 ? null : index + 1;
}
