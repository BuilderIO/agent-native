/**
 * Unsaved view state and the three-way save fork.
 *
 * A draft (filter, sort, presentation, grouping) lives ONLY in the URL search
 * params. That is the whole mechanism behind "a reload reverts": nothing is
 * mirrored into component state that could outlive the address bar, and
 * nothing is written back to `crm_saved_views` until the user picks a branch.
 * A shared view is never autosaved.
 */

export const BOARD_DRAFT_PARAMS = {
  mode: "mode",
  group: "group",
  filter: "filter",
  sort: "sort",
} as const;

/** A draft param that cannot be read. Never coerced to "no draft". */
export class BoardDraftError extends Error {
  readonly param: string;

  constructor(param: string) {
    super(`The "${param}" value in this URL is not readable.`);
    this.name = "BoardDraftError";
    this.param = param;
  }
}

export interface BoardDraft {
  mode?: "table" | "board";
  groupByAttributeId?: string;
  filter?: unknown;
  sort?: unknown[];
}

export interface SavedViewShape {
  id: string;
  name: string;
  description?: string | undefined;
  dataProgramId?: string | undefined;
  viewKind: "table" | "board";
  targetKind: "object" | "list";
  targetId?: string | undefined;
  kind?: string | undefined;
  groupByAttributeId?: string | undefined;
  filters?: unknown;
  sort?: unknown[];
  columns?: unknown[];
  audience: "personal" | "shared";
  pinned?: boolean;
  updatedAt: string;
}

function readJsonParam(params: URLSearchParams, name: string): unknown {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A dropped filter looks exactly like a correct unfiltered board, so an
    // unreadable param is surfaced instead of ignored.
    throw new BoardDraftError(name);
  }
}

export function readBoardDraft(params: URLSearchParams): BoardDraft {
  const mode = params.get(BOARD_DRAFT_PARAMS.mode);
  if (mode !== null && mode !== "table" && mode !== "board") {
    throw new BoardDraftError(BOARD_DRAFT_PARAMS.mode);
  }
  const sort = readJsonParam(params, BOARD_DRAFT_PARAMS.sort);
  if (sort !== undefined && !Array.isArray(sort)) {
    throw new BoardDraftError(BOARD_DRAFT_PARAMS.sort);
  }
  const group = params.get(BOARD_DRAFT_PARAMS.group);
  const filter = readJsonParam(params, BOARD_DRAFT_PARAMS.filter);
  return {
    ...(mode ? { mode } : {}),
    ...(group ? { groupByAttributeId: group } : {}),
    ...(filter === undefined ? {} : { filter }),
    ...(sort === undefined ? {} : { sort }),
  };
}

/** The draft params written onto a copy of `params`; absent keys are removed. */
export function writeBoardDraft(
  params: URLSearchParams,
  draft: BoardDraft,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) next.delete(name);
    else next.set(name, value);
  };
  set(BOARD_DRAFT_PARAMS.mode, draft.mode);
  set(BOARD_DRAFT_PARAMS.group, draft.groupByAttributeId);
  set(
    BOARD_DRAFT_PARAMS.filter,
    draft.filter === undefined ? undefined : JSON.stringify(draft.filter),
  );
  set(
    BOARD_DRAFT_PARAMS.sort,
    draft.sort === undefined ? undefined : JSON.stringify(draft.sort),
  );
  return next;
}

export function clearBoardDraft(params: URLSearchParams): URLSearchParams {
  return writeBoardDraft(params, {});
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The view as it would look with the draft applied. */
export function effectiveView(view: SavedViewShape, draft: BoardDraft) {
  return {
    viewKind: draft.mode ?? view.viewKind,
    groupByAttributeId: draft.groupByAttributeId ?? view.groupByAttributeId,
    filter: draft.filter ?? view.filters,
    sort: draft.sort ?? view.sort ?? [],
  };
}

export function draftIsDirty(view: SavedViewShape, draft: BoardDraft): boolean {
  const next = effectiveView(view, draft);
  return (
    next.viewKind !== view.viewKind ||
    (next.groupByAttributeId ?? null) !== (view.groupByAttributeId ?? null) ||
    !sameJson(next.filter, view.filters) ||
    !sameJson(next.sort, view.sort ?? [])
  );
}

export type BoardSaveBranch = "update" | "new" | "discard";

export interface BoardSaveMutation {
  action: "save-crm-saved-view";
  input: Record<string, unknown>;
}

/**
 * The mutation each branch of the save fork produces.
 *
 * `discard` writes nothing: the draft only ever lived in the URL, so dropping
 * the params is the whole operation.
 */
export function buildSaveFork(
  branch: BoardSaveBranch,
  input: { view: SavedViewShape; draft: BoardDraft; name?: string },
): BoardSaveMutation | null {
  if (branch === "discard") return null;
  const next = effectiveView(input.view, input.draft);
  const common = {
    name: branch === "new" ? (input.name ?? "").trim() : input.view.name,
    ...(input.view.description ? { description: input.view.description } : {}),
    viewKind: next.viewKind,
    targetKind: input.view.targetKind,
    ...(input.view.targetId ? { targetId: input.view.targetId } : {}),
    ...(input.view.kind ? { kind: input.view.kind } : {}),
    ...(next.viewKind === "board" && next.groupByAttributeId
      ? { groupByAttributeId: next.groupByAttributeId }
      : {}),
    ...(next.filter === undefined || next.filter === null
      ? {}
      : { filter: next.filter }),
    sort: next.sort,
    ...(input.view.columns ? { columns: input.view.columns } : {}),
  };
  if (branch === "new") {
    if (!common.name) {
      throw new Error("A new view needs a name.");
    }
    // A fork of someone's shared view starts personal; sharing is a separate,
    // deliberate act.
    return {
      action: "save-crm-saved-view",
      input: { ...common, audience: "personal" },
    };
  }
  return {
    action: "save-crm-saved-view",
    input: {
      ...common,
      id: input.view.id,
      audience: input.view.audience,
      // Rejects the overwrite when the stored view moved under us.
      expectedUpdatedAt: input.view.updatedAt,
    },
  };
}

/** Saved views grouped for the views index, in a stable display order. */
export function groupSavedViews<T extends SavedViewShape>(views: readonly T[]) {
  const groups = new Map<
    string,
    { targetKind: "object" | "list"; targetId: string; views: T[] }
  >();
  for (const view of views) {
    const targetId = view.targetId ?? view.kind ?? "";
    const key = `${view.targetKind}:${targetId}`;
    const bucket = groups.get(key) ?? {
      targetKind: view.targetKind,
      targetId,
      views: [],
    };
    bucket.views.push(view);
    groups.set(key, bucket);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      views: [...group.views].sort(
        (a, b) =>
          Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
          a.name.localeCompare(b.name),
      ),
    }))
    .sort(
      (a, b) =>
        // Object targets first: accounts/people/opportunities are the spine,
        // lists are the overlay on top of them.
        Number(a.targetKind === "list") - Number(b.targetKind === "list") ||
        a.targetId.localeCompare(b.targetId),
    );
}
