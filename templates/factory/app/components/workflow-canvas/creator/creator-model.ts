import {
  addNode,
  connect,
  createNode,
  disconnect,
  fitNewNodePosition,
  nextNodeIdentity,
  nodeSize,
  portsFor,
  reject,
  type NewNodeOptions,
  type NodeKind,
  type NodeVariant,
  type Point,
  type Rejection,
  type WorkflowCatalog,
  type WorkflowGraph,
  type WorkflowNode,
} from "@/lib/workflow-editor";

import { buildPalette, type PaletteEntry } from "../palette";
import { providerIdentity } from "../provider-identity";
import type { WorkflowCanvasStrings } from "../strings";

/** Where a new step goes: after one output of a step, or into a connection between two steps. */
export type CreatorTarget =
  | {
      kind: "append";
      after?: { nodeId: string; port: string };
      /** Where a drag from an output was released. The panel does not place the step there yet. */
      position?: Point;
    }
  | { kind: "insert"; edgeId: string };

/** `unknown` is a check that failed or has not run. It is never read as `not connected`. */
export type ProviderLinkStatus = "connected" | "not connected" | "unknown";

/** A deeper list the root can open. `sources` and `actions` list the apps. */
type ListId = "sources" | "actions" | "ai" | "data" | "flow";

/** What the panel shows: the root list for the target, one deeper list, or one app's steps. */
export type CreatorView =
  | { kind: "root" }
  | { kind: "list"; list: ListId }
  | { kind: "app"; provider: string; from: "start" | "next" };

/** The two collapsible groups inside an app. */
export type AppGroup = "triggers" | "actions";

export type CreatorRow =
  | {
      type: "entry";
      id: string;
      label: string;
      entry: PaletteEntry;
      description?: string;
      indented: boolean;
    }
  | {
      type: "list";
      id: string;
      label: string;
      kind: NodeKind;
      description?: string;
      view: CreatorView;
    }
  | {
      type: "provider";
      id: string;
      label: string;
      provider: string;
      view: CreatorView;
    }
  | {
      type: "group";
      id: string;
      label: string;
      group: AppGroup;
      count: number;
      open: boolean;
    }
  | { type: "describe"; id: "describe"; label: string; description?: string };

/** One line of a list. Captions and notices are text, so the keyboard skips them. */
export type CreatorItem =
  | CreatorRow
  | { type: "caption"; id: string; label: string }
  | { type: "notice"; id: string; label: string };

export interface CreatorListModel {
  items: CreatorItem[];
  /** The root lists always have a search box; other lists only when they hold more than eight rows. */
  searchable: boolean;
}

/** What a Left or Right press does next. `caret` leaves the key to the text box. */
type HorizontalOutcome = "caret" | "back" | "collapse" | "activate";

type Hint = keyof WorkflowCanvasStrings["creator"]["hint"];

const SEARCH_THRESHOLD = 8;

/** The start list is the root when the workflow has no trigger. Inserting between two steps never starts a workflow. */
export function isStartList(
  target: CreatorTarget,
  hasTrigger: boolean,
): boolean {
  return target.kind === "append" && !hasTrigger;
}

function allowedAt(
  kind: NodeKind,
  target: CreatorTarget,
  hasTrigger: boolean,
): boolean {
  if (target.kind === "insert") {
    return kind !== "trigger" && kind !== "source" && kind !== "end";
  }
  if (kind === "trigger") return target.after === undefined && !hasTrigger;
  return true;
}

function providerLabel(provider: string): string {
  return providerIdentity(provider).label;
}

/** Entries of the given kinds, grouped by kind in the order given and kept in palette order within each kind. */
function ofKinds(
  entries: readonly PaletteEntry[],
  kinds: readonly NodeKind[],
): PaletteEntry[] {
  return kinds.flatMap((kind) =>
    entries.filter((entry) => entry.kind === kind),
  );
}

/** Each provider once, alphabetical by its display name. */
function providersOf(entries: readonly PaletteEntry[]): string[] {
  const providers = [
    ...new Set(
      entries.flatMap((entry) =>
        entry.provider === undefined ? [] : [entry.provider],
      ),
    ),
  ];
  return providers.sort((a, b) =>
    providerLabel(a).localeCompare(providerLabel(b)),
  );
}

export function listLabel(list: ListId, s: WorkflowCanvasStrings): string {
  switch (list) {
    case "sources":
      return s.creator.newFromApp;
    case "actions":
      return s.creator.appAction;
    case "ai":
      return s.creator.ai;
    case "data":
      return s.creator.data;
    case "flow":
      return s.creator.flow;
  }
}

export function listKind(list: ListId): NodeKind {
  switch (list) {
    case "sources":
      return "source";
    case "actions":
      return "action";
    case "ai":
      return "ai";
    case "data":
      return "combine";
    case "flow":
      return "switch";
  }
}

function listHint(list: ListId): Hint {
  switch (list) {
    case "sources":
      return "newFromApp";
    case "actions":
      return "appAction";
    case "ai":
      return "ai";
    case "data":
      return "data";
    case "flow":
      return "flow";
  }
}

function combineHint(variant: NodeVariant | undefined): Hint | undefined {
  switch (variant) {
    case "list":
      return "combineList";
    case "count":
      return "combineCount";
    case "groupBy":
      return "combineGroup";
    case "summarize":
      return "combineSummarize";
    default:
      return undefined;
  }
}

function waitHint(variant: NodeVariant | undefined): Hint | undefined {
  switch (variant) {
    case "reply":
      return "waitReply";
    case "time":
      return "waitTime";
    case "condition":
      return "waitCondition";
    default:
      return undefined;
  }
}

function agentHint(operationId: string | undefined): Hint | undefined {
  switch (operationId) {
    case "builder.start":
      return "builderStart";
    case "builder.check":
      return "builderCheck";
    case "builder.followUp":
      return "builderFollowUp";
    default:
      return undefined;
  }
}

/** The one-line explanation under a step on the root and intent lists. Lookups and actions have none: their app says it. */
function hintOf(entry: PaletteEntry): Hint | undefined {
  switch (entry.kind) {
    case "trigger":
      return "onSchedule";
    case "source":
      return entry.options.variant === "status" ? "itemsInStatus" : undefined;
    case "ai":
      return "decideAi";
    case "agent":
      return agentHint(entry.options.operationId);
    case "filter":
      return "filter";
    case "split":
      return "split";
    case "combine":
      return combineHint(entry.options.variant);
    case "switch":
      return "switch";
    case "wait":
      return waitHint(entry.options.variant);
    case "end":
      return "finish";
    default:
      return undefined;
  }
}

type EntryRow = Extract<CreatorRow, { type: "entry" }>;

/**
 * A step's row. Inside its app (`inApp`) the app's name already heads the list,
 * so the row drops the "<App>: " it starts with and sits indented in its group.
 */
function entryRow(
  entry: PaletteEntry,
  s: WorkflowCanvasStrings,
  withDescription: boolean,
  inApp?: string,
): EntryRow {
  const hint = withDescription ? hintOf(entry) : undefined;
  return {
    type: "entry",
    id: entry.id,
    label: inApp === undefined ? entry.label : titleInApp(entry.label, inApp),
    entry,
    indented: inApp !== undefined,
    description: hint === undefined ? undefined : s.creator.hint[hint],
  };
}

/** The title left after the app's name is dropped, with its first letter capitalised to read as a title. */
function titleInApp(label: string, provider: string): string {
  const prefix = `${providerLabel(provider)}: `;
  if (!label.startsWith(prefix)) return label;
  const title = label.slice(prefix.length);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function providerRow(provider: string, from: "start" | "next"): CreatorRow {
  return {
    type: "provider",
    id: `provider:${provider}`,
    label: providerLabel(provider),
    provider,
    view: { kind: "app", provider, from },
  };
}

function listRow(list: ListId, s: WorkflowCanvasStrings): CreatorRow {
  return {
    type: "list",
    id: `list:${list}`,
    label: listLabel(list, s),
    kind: listKind(list),
    description: s.creator.hint[listHint(list)],
    view: { kind: "list", list },
  };
}

function describeRow(s: WorkflowCanvasStrings): CreatorRow {
  return {
    type: "describe",
    id: "describe",
    label: s.creator.describeIt,
    description: s.creator.hint.describe,
  };
}

/** Every word typed must match. A trailing "trigger" is dropped, so "slack trigger" searches Slack. */
function queryWords(query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 1 && words[words.length - 1] === "trigger"
    ? words.slice(0, -1)
    : words;
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function isSubsequence(letters: string, text: string): boolean {
  let at = 0;
  for (const letter of letters) {
    at = text.indexOf(letter, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

/**
 * How well the query matches one candidate, from 1 (best) to 5: the exact
 * name; the name starts with it; each word starts a word of the name; each
 * word starts a word of the keywords (provider, kind, operation id); its
 * letters appear in order in the name. Undefined when none of those holds.
 */
function matchTier(
  words: readonly string[],
  label: string,
  keywords: string,
): number | undefined {
  const name = label.toLowerCase();
  const phrase = words.join(" ");
  if (name === phrase) return 1;
  if (name.startsWith(phrase)) return 2;
  const nameWords = wordsOf(name);
  if (words.every((word) => nameWords.some((part) => part.startsWith(word)))) {
    return 3;
  }
  const keywordWords = wordsOf(keywords);
  if (
    words.every((word) => keywordWords.some((part) => part.startsWith(word)))
  ) {
    return 4;
  }
  return isSubsequence(phrase.replace(/\s+/g, ""), name) ? 5 : undefined;
}

function rowFields(row: CreatorRow): { label: string; keywords: string } {
  switch (row.type) {
    // Matched by the full name, because a row inside its app shows a shorter title.
    case "entry":
      return { label: row.entry.label, keywords: row.entry.keywords };
    case "provider":
      return { label: row.label, keywords: row.provider };
    default:
      return { label: row.label, keywords: "" };
  }
}

/** The matches, best tier first and alphabetical inside a tier. */
function rank(
  rows: readonly CreatorRow[],
  words: readonly string[],
): CreatorRow[] {
  if (words.length === 0) return [...rows];
  return rows
    .flatMap((row) => {
      const { label, keywords } = rowFields(row);
      const tier = matchTier(words, label, keywords);
      return tier === undefined ? [] : [{ row, tier, label }];
    })
    .sort((a, b) => a.tier - b.tier || a.label.localeCompare(b.label))
    .map(({ row }) => row);
}

/**
 * An empty search that finds nothing says so and offers the agent. The query
 * is the one thing the person typed, so the message does not repeat it.
 */
function settle(
  items: CreatorItem[],
  searching: boolean,
  describable: boolean,
  s: WorkflowCanvasStrings,
): CreatorItem[] {
  if (!searching || selectableRows(items).length > 0) return items;
  return [
    { type: "notice", id: "notice", label: s.creator.noResults },
    ...(describable ? [describeRow(s)] : []),
  ];
}

/** The root: the start list or the next list, or every step matching the query. */
function rootList(input: {
  entries: PaletteEntry[];
  words: string[];
  start: boolean;
  describable: boolean;
  s: WorkflowCanvasStrings;
}): CreatorListModel {
  const { entries, words, start, describable, s } = input;
  if (words.length > 0) {
    const found = rank(
      entries.map((entry) => entryRow(entry, s, false)),
      words,
    );
    return {
      searchable: true,
      items: settle(found, true, describable, s),
    };
  }
  const sourceApps = providersOf(ofKinds(entries, ["source"]));
  const actionApps = providersOf(ofKinds(entries, ["lookup", "action"]));
  const rows: CreatorRow[] = start
    ? [
        ...ofKinds(entries, ["trigger"]).map((entry) =>
          entryRow(entry, s, true),
        ),
        ...(sourceApps.length > 0 ? [listRow("sources", s)] : []),
        ...entries
          .filter(
            (entry) =>
              entry.kind === "source" && entry.options.variant === "status",
          )
          .map((entry) => entryRow(entry, s, true)),
      ]
    : [
        ...(ofKinds(entries, ["ai", "agent"]).length > 0
          ? [listRow("ai", s)]
          : []),
        ...(actionApps.length > 0 ? [listRow("actions", s)] : []),
        ...(ofKinds(entries, ["filter", "split", "combine"]).length > 0
          ? [listRow("data", s)]
          : []),
        ...(ofKinds(entries, ["switch", "wait", "end"]).length > 0
          ? [listRow("flow", s)]
          : []),
      ];
  return {
    searchable: true,
    items: [...rows, ...(describable ? [describeRow(s)] : [])],
  };
}

/** Every row a deeper list can show before a search narrows it. */
function listCandidates(
  entries: readonly PaletteEntry[],
  list: ListId,
  s: WorkflowCanvasStrings,
): CreatorRow[] {
  switch (list) {
    case "sources":
      return providersOf(ofKinds(entries, ["source"])).map((provider) =>
        providerRow(provider, "start"),
      );
    case "actions":
      return providersOf(ofKinds(entries, ["lookup", "action"])).map(
        (provider) => providerRow(provider, "next"),
      );
    case "ai":
      return ofKinds(entries, ["ai", "agent"]).map((entry) =>
        entryRow(entry, s, true),
      );
    case "data":
      return ofKinds(entries, ["filter", "split", "combine"]).map((entry) =>
        entryRow(entry, s, true),
      );
    case "flow":
      return ofKinds(entries, ["switch", "wait", "end"]).map((entry) =>
        entryRow(entry, s, true),
      );
  }
}

/** One deeper list: an intent list of steps, or the apps that have a source or an action. */
function listView(input: {
  entries: PaletteEntry[];
  words: string[];
  list: ListId;
  describable: boolean;
  s: WorkflowCanvasStrings;
}): CreatorListModel {
  const { entries, words, list, describable, s } = input;
  const candidates = listCandidates(entries, list, s);
  return {
    searchable: candidates.length > SEARCH_THRESHOLD,
    items: settle(rank(candidates, words), words.length > 0, describable, s),
  };
}

/**
 * Inside a connection into an app's lookups and actions, the two groups list
 * the app's triggers and its actions. The group the person came from opens
 * first. Lookups and actions get small captions only when the app came from
 * the next list, where the split helps.
 */
function actionItems(
  rows: CreatorRow[],
  from: "start" | "next",
  s: WorkflowCanvasStrings,
): CreatorItem[] {
  const isKind = (kind: NodeKind) => (row: CreatorRow) =>
    row.type === "entry" && row.entry.kind === kind;
  const lookups = rows.filter(isKind("lookup"));
  const actions = rows.filter(isKind("action"));
  if (from === "start" || lookups.length === 0 || actions.length === 0) {
    return rows;
  }
  return [
    {
      type: "caption",
      id: "caption:lookups",
      label: s.creator.lookUpCaption,
    },
    ...lookups,
    {
      type: "caption",
      id: "caption:actions",
      label: s.creator.sendOrChangeCaption,
    },
    ...actions,
  ];
}

function appView(input: {
  entries: PaletteEntry[];
  words: string[];
  provider: string;
  from: "start" | "next";
  open: Partial<Record<AppGroup, boolean>>;
  describable: boolean;
  s: WorkflowCanvasStrings;
}): CreatorListModel {
  const { entries, words, provider, from, open, describable, s } = input;
  const own = entries.filter((entry) => entry.provider === provider);
  const triggers = ofKinds(own, ["source"]).map((entry) =>
    entryRow(entry, s, false, provider),
  );
  const actions = ofKinds(own, ["lookup", "action"]).map((entry) =>
    entryRow(entry, s, false, provider),
  );
  const shown: Record<AppGroup, CreatorRow[]> = {
    triggers: rank(triggers, words),
    actions: rank(actions, words),
  };
  const primary: AppGroup = from === "start" ? "triggers" : "actions";
  const primaryEmpty = shown[primary].length === 0;
  const searching = words.length > 0;
  const order: AppGroup[] =
    from === "start" ? ["triggers", "actions"] : ["actions", "triggers"];
  const items: CreatorItem[] = [];
  for (const group of order) {
    const rows = shown[group];
    if (rows.length === 0) continue;
    // A search opens both groups. Otherwise the primary opens, and the other opens only when the primary is empty.
    const expanded =
      searching ||
      (open[group] ?? (group === primary ? !primaryEmpty : primaryEmpty));
    items.push({
      type: "group",
      id: `group:${group}`,
      label: group === "triggers" ? s.creator.triggers : s.creator.actions,
      group,
      count: rows.length,
      open: expanded,
    });
    if (expanded) {
      items.push(...(group === "actions" ? actionItems(rows, from, s) : rows));
    }
  }
  return {
    searchable: own.length > SEARCH_THRESHOLD,
    items: settle(items, searching, describable, s),
  };
}

/**
 * What the panel lists for its current view. The root list depends on the
 * target and on whether the workflow has a trigger; a query searches every
 * step on the root, one list's steps on a deeper list, or one app's steps
 * inside an app.
 */
export function creatorList({
  catalog,
  target,
  hasTrigger,
  view,
  query,
  open,
  describable,
  strings: s,
}: {
  catalog: WorkflowCatalog;
  target: CreatorTarget;
  hasTrigger: boolean;
  view: CreatorView;
  query: string;
  /** The groups the person opened or closed inside an app. A group left out takes its default. */
  open: Partial<Record<AppGroup, boolean>>;
  /** Whether a query nothing matches can be handed to the agent. */
  describable: boolean;
  strings: WorkflowCanvasStrings;
}): CreatorListModel {
  const words = queryWords(query);
  const entries = buildPalette(catalog, { hasTrigger: false }, s)
    .flatMap((section) => section.entries)
    .filter((entry) => allowedAt(entry.kind, target, hasTrigger));
  switch (view.kind) {
    case "root":
      return rootList({
        entries,
        words,
        start: isStartList(target, hasTrigger),
        describable,
        s,
      });
    case "list":
      return listView({ entries, words, list: view.list, describable, s });
    case "app":
      return appView({
        entries,
        words,
        provider: view.provider,
        from: view.from,
        open,
        describable,
        s,
      });
  }
}

export function selectableRows(items: readonly CreatorItem[]): CreatorRow[] {
  return items.filter(
    (item): item is CreatorRow =>
      item.type !== "caption" && item.type !== "notice",
  );
}

/** The row a key press acts on: the one the person moved to, else the first. */
export function highlightedRow(
  rows: readonly CreatorRow[],
  highlight: string | null,
): CreatorRow | undefined {
  return rows.find((row) => row.id === highlight) ?? rows[0];
}

/** Where an arrow key moves from `current`. It wraps from the last row to the first, and back. */
export function moveHighlight(
  rows: readonly CreatorRow[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (rows.length === 0) return null;
  const index = rows.findIndex((row) => row.id === current);
  if (index < 0) return rows[step > 0 ? 0 : rows.length - 1].id;
  return rows[(index + step + rows.length) % rows.length].id;
}

/**
 * What a Left or Right press does. In a non-empty search box the arrows move
 * the caret, and Right opens the row only at the end of the text. In an empty
 * box Right opens the row, and Left collapses an open group or goes back.
 */
export function horizontalKey(
  direction: "left" | "right",
  state: { query: string; caretAtEnd: boolean; onOpenGroup: boolean },
): HorizontalOutcome {
  if (state.query !== "") {
    return direction === "right" && state.caretAtEnd ? "activate" : "caret";
  }
  if (direction === "right") return "activate";
  return state.onOpenGroup ? "collapse" : "back";
}

function centreOf(graph: WorkflowGraph, node: WorkflowNode): Point {
  const size = nodeSize(graph, node);
  return {
    x: node.position.x + size.width / 2,
    y: node.position.y + size.height / 2,
  };
}

type InsertOutcome =
  | { ok: true; graph: WorkflowGraph; node: WorkflowNode }
  | { ok: false; reason: "loop" }
  | { ok: false; rejection: Rejection };

/**
 * Puts a new step into a connection: the source keeps its output port and
 * feeds the new step, and the new step's first output feeds the old target.
 * Built from the same pure commands the editor uses, so the result is one
 * graph to swap in as a single undo step.
 */
export function insertOnEdge(
  graph: WorkflowGraph,
  catalog: WorkflowCatalog,
  edgeId: string,
  kind: NodeKind,
  options: Omit<NewNodeOptions, "after" | "position"> = {},
): InsertOutcome {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return reject("unknown_edge", `No edge "${edgeId}".`);
  // A loop's back-edge runs against the flow, so a step cannot sit between its ends.
  if (edge.back) return { ok: false, reason: "loop" };
  const from = graph.nodes.find((node) => node.id === edge.from.node);
  const to = graph.nodes.find((node) => node.id === edge.to.node);
  if (!from || !to) {
    return reject("unknown_node", `Edge "${edgeId}" points at a missing step.`);
  }

  const identity = nextNodeIdentity(graph, kind);
  const sized = createNode(
    kind,
    { id: identity, name: identity, position: { x: 0, y: 0 } },
    catalog,
    options,
  );
  if (!sized.ok) return sized;
  // Checked before the graph changes: a step with no output would drop the old target.
  const [output] = portsFor(sized.node);
  if (output === undefined) {
    return reject(
      "unknown_port",
      `"${identity}" has no output to continue from.`,
    );
  }

  const detached = disconnect(graph, edgeId);
  if (!detached.ok) return detached;
  const fromAt = centreOf(graph, from);
  const toAt = centreOf(graph, to);
  const position = fitNewNodePosition(detached.graph, {
    near: { x: (fromAt.x + toAt.x) / 2, y: (fromAt.y + toAt.y) / 2 },
    size: nodeSize(detached.graph, sized.node),
  });
  const added = addNode(detached.graph, catalog, kind, {
    ...options,
    position,
  });
  if (!added.ok) return added;
  const inbound = connect(
    added.graph,
    { node: edge.from.node, port: edge.from.port },
    added.node.id,
    { back: "auto" },
  );
  if (!inbound.ok) return inbound;
  const outbound = connect(
    inbound.graph,
    { node: added.node.id, port: output },
    edge.to.node,
    { back: "auto" },
  );
  if (!outbound.ok) return outbound;
  return { ok: true, graph: outbound.graph, node: added.node };
}
