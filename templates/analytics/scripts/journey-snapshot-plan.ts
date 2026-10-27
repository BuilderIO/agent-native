import { createHash } from "node:crypto";

export const SNAPSHOT_MAX_FRAMES = 36;
export const SNAPSHOT_PRESET = Object.freeze({
  emailFilter: "exclude_builder" as const,
  excludeNonProductionHosts: true,
  followUpMode: "session" as const,
  format: "tree" as const,
  maxDepth: 24,
  maxNodes: 60,
  minNodeSessions: 5,
  examplesPerNode: 3,
  maxEventRows: 40_000,
  maxTotalBytesBilled: 275_000_000_000,
  minWidth: 1100,
  maxWidth: 1920,
  minAspect: 1.25,
  maxAspect: 1.85,
  requireKnownViewport: true,
  recency: "newest" as const,
  settleMs: 300,
});

export interface SnapshotExample {
  sessionId: string;
  recordingId?: string | null;
  ts: string;
  offsetMs: number | null;
  viewport: { width: number; height: number } | null;
  [key: string]: unknown;
}

export interface SnapshotNode {
  key: string;
  label: string;
  parentKey: string | null;
  depth: number;
  n: number;
  pctOfRoot: number;
  pctOfParent: number;
  dropoffN: number;
  dropoffPct: number;
  examples: SnapshotExample[];
  [key: string]: unknown;
}

export interface SnapshotTree {
  window: { from: string; to: string };
  app: string;
  rootN: number;
  coverage: {
    sessionsWithEvents: number;
    sessionsWithReplay: number | null;
    truncated: boolean;
    paginationConsistency?: "stable" | "may_have_shifted";
  };
  nodes: SnapshotNode[];
  notes?: string[];
  followUp?: { status?: string };
  [key: string]: unknown;
}

export interface SnapshotBand {
  key: string;
  tree: SnapshotTree;
}

export function defaultSnapshotWeek(now = new Date()): string {
  if (!Number.isFinite(now.valueOf())) {
    throw new Error("The current date must be valid.");
  }
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday,
  );
  return new Date(thisMonday - 7 * 86_400_000).toISOString().slice(0, 10);
}

export function weekWindow(week: string): {
  week: string;
  dateFrom: string;
  dateTo: string;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    throw new Error("--week must be an ISO date for a Monday, YYYY-MM-DD.");
  }
  const start = new Date(`${week}T00:00:00.000Z`);
  if (
    Number.isNaN(start.valueOf()) ||
    start.toISOString().slice(0, 10) !== week ||
    start.getUTCDay() !== 1
  ) {
    throw new Error("--week must be a real Monday in UTC.");
  }
  const dateFrom = new Date(start.valueOf() - 86_400_000);
  const dateTo = new Date(start.valueOf() + 6 * 86_400_000);
  return {
    week,
    dateFrom: dateFrom.toISOString().slice(0, 10),
    dateTo: dateTo.toISOString().slice(0, 10),
  };
}

export function snapshotPresetHash(input: {
  app: string;
  dateFrom: string;
  dateTo: string;
  experimentId?: string;
  splitDesignFirstTouch: boolean;
  sourceUrl?: string;
}): string {
  const canonical = JSON.stringify({
    snapshotFormatVersion: 2,
    ...SNAPSHOT_PRESET,
    ...input,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function frameable(node: SnapshotNode): boolean {
  return node.examples.some((example) => {
    const viewport = example.viewport;
    const aspect = viewport ? viewport.width / viewport.height : 0;
    return (
      typeof example.recordingId === "string" &&
      example.recordingId.length > 0 &&
      Number.isFinite(example.offsetMs) &&
      example.offsetMs !== null &&
      viewport !== null &&
      viewport.width >= SNAPSHOT_PRESET.minWidth &&
      viewport.width <= SNAPSHOT_PRESET.maxWidth &&
      aspect >= SNAPSHOT_PRESET.minAspect &&
      aspect <= SNAPSHOT_PRESET.maxAspect
    );
  });
}

function priority(node: SnapshotNode): number {
  const value = `${node.key} ${node.label}`.toLowerCase();
  if (
    /recording_ready|clip saved|generation completed|design output|first output/.test(
      value,
    )
  ) {
    return 8;
  }
  if (
    /custom.?keys|storage|builder connected|connection.*(failed|success)|connected/.test(
      value,
    )
  ) {
    return 7;
  }
  if (
    /choice|role|signup|first.touch|onboarding completed|app entered/.test(
      value,
    )
  ) {
    return 6;
  }
  if (/builder|api key|skip|setup/.test(value)) return 5;
  return 1;
}

function comparePriority(a: SnapshotNode, b: SnapshotNode): number {
  return (
    priority(b) - priority(a) ||
    b.n - a.n ||
    a.depth - b.depth ||
    a.key.localeCompare(b.key)
  );
}

export function selectCaptureTree<T extends SnapshotTree>(
  tree: T,
  frameLimit: number,
): { tree: T; frameCount: number } {
  if (!Number.isSafeInteger(frameLimit) || frameLimit < 1) {
    throw new Error("frameLimit must be a positive integer.");
  }
  const byKey = new Map(tree.nodes.map((node) => [node.key, node]));
  const frameableNodes = tree.nodes.filter(frameable);
  const frameableKeys = new Set(frameableNodes.map((node) => node.key));
  const children = new Map<string, number>();
  for (const node of tree.nodes) {
    if (node.parentKey) {
      children.set(node.parentKey, (children.get(node.parentKey) ?? 0) + 1);
    }
  }
  const leaves = frameableNodes
    .filter((node) => !children.has(node.key))
    .sort(comparePriority);
  const selected = new Set<string>();
  const pathFor = (node: SnapshotNode): SnapshotNode[] | null => {
    const path: SnapshotNode[] = [];
    let current: SnapshotNode | undefined = node;
    while (current) {
      if (!frameableKeys.has(current.key)) return null;
      path.push(current);
      current = current.parentKey ? byKey.get(current.parentKey) : undefined;
      if (path.length > tree.nodes.length) return null;
    }
    return path.reverse();
  };

  for (const leaf of leaves) {
    const path = pathFor(leaf);
    if (!path) continue;
    const additions = path.filter((node) => !selected.has(node.key));
    if (selected.size + additions.length <= frameLimit) {
      for (const node of additions) selected.add(node.key);
    }
  }

  for (const node of [...frameableNodes].sort(comparePriority)) {
    if (selected.has(node.key)) continue;
    const path = pathFor(node);
    if (!path) continue;
    const additions = path.filter((entry) => !selected.has(entry.key));
    if (selected.size + additions.length <= frameLimit) {
      for (const entry of additions) selected.add(entry.key);
    }
  }

  const ordered = tree.nodes.filter((node) => selected.has(node.key));
  const examplesByNode = new Map<string, SnapshotExample[]>();
  for (const node of ordered) {
    const valid = node.examples.filter((example) => {
      const viewport = example.viewport;
      const aspect = viewport ? viewport.width / viewport.height : 0;
      return (
        typeof example.recordingId === "string" &&
        example.recordingId.length > 0 &&
        example.offsetMs !== null &&
        Number.isFinite(example.offsetMs) &&
        viewport !== null &&
        viewport.width >= SNAPSHOT_PRESET.minWidth &&
        viewport.width <= SNAPSHOT_PRESET.maxWidth &&
        aspect >= SNAPSHOT_PRESET.minAspect &&
        aspect <= SNAPSHOT_PRESET.maxAspect
      );
    });
    examplesByNode.set(node.key, valid.slice(0, 1));
  }
  let frameCount = ordered.length;
  const alternates = [...ordered].sort(comparePriority);
  for (let exampleIndex = 1; frameCount < frameLimit; exampleIndex += 1) {
    let added = false;
    for (const node of alternates) {
      const available = node.examples.filter((example) => {
        const viewport = example.viewport;
        const aspect = viewport ? viewport.width / viewport.height : 0;
        return (
          typeof example.recordingId === "string" &&
          example.recordingId.length > 0 &&
          example.offsetMs !== null &&
          Number.isFinite(example.offsetMs) &&
          viewport !== null &&
          viewport.width >= SNAPSHOT_PRESET.minWidth &&
          viewport.width <= SNAPSHOT_PRESET.maxWidth &&
          aspect >= SNAPSHOT_PRESET.minAspect &&
          aspect <= SNAPSHOT_PRESET.maxAspect
        );
      });
      const examples = examplesByNode.get(node.key);
      if (!examples) {
        throw new Error(
          `Selected journey node ${node.key} has no example list.`,
        );
      }
      const example = available[exampleIndex];
      if (example) {
        examples.push(example);
        frameCount += 1;
        added = true;
        if (frameCount >= frameLimit) break;
      }
    }
    if (!added) break;
  }

  return {
    tree: {
      ...tree,
      nodes: ordered.map((node) => ({
        ...node,
        examples: examplesByNode.get(node.key) ?? [],
      })),
    },
    frameCount,
  };
}

export function allocateFrameBudgets(
  bands: readonly SnapshotBand[],
  maxFrames = SNAPSHOT_MAX_FRAMES,
): Map<string, number> {
  const eligible = bands.filter((band) => band.tree.nodes.some(frameable));
  const budgets = new Map<string, number>();
  if (!eligible.length) return budgets;
  const base = Math.floor(maxFrames / eligible.length);
  let remainder = maxFrames % eligible.length;
  for (const band of eligible) {
    budgets.set(band.key, base + (remainder > 0 ? 1 : 0));
    remainder -= 1;
  }
  return budgets;
}

export function treeTopForks(
  tree: SnapshotTree,
  limit = 5,
): Array<{
  step: string;
  branches: Array<{ label: string; n: number; pctOfParent: number }>;
  dropoffN: number;
  dropoffPct: number;
}> {
  const children = new Map<string | null, SnapshotNode[]>();
  for (const node of tree.nodes) {
    const list = children.get(node.parentKey) ?? [];
    list.push(node);
    children.set(node.parentKey, list);
  }
  return tree.nodes
    .filter((node) => (children.get(node.key)?.length ?? 0) > 1)
    .sort(
      (a, b) => b.n - a.n || a.depth - b.depth || a.key.localeCompare(b.key),
    )
    .slice(0, limit)
    .map((node) => ({
      step: node.label,
      branches: (children.get(node.key) ?? [])
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
        .map((child) => ({
          label: child.label,
          n: child.n,
          pctOfParent: child.pctOfParent,
        })),
      dropoffN: node.dropoffN,
      dropoffPct: node.dropoffPct,
    }));
}

export function compareTrees(
  current: SnapshotTree,
  previous: SnapshotTree,
  thresholdPoints = 5,
  excludedKeys: readonly string[] = [],
): Array<{
  key: string;
  label: string;
  currentPct: number;
  previousPct: number;
  currentN: number;
  currentParentN: number;
  previousN: number;
  previousParentN: number;
  deltaPoints: number;
}> {
  const previousByKey = new Map(previous.nodes.map((node) => [node.key, node]));
  const currentByKey = new Map(current.nodes.map((node) => [node.key, node]));
  const excluded = new Set(excludedKeys);
  return current.nodes.flatMap((node) => {
    const pathSegments = node.key.split(" > ");
    const terminalKey = pathSegments[pathSegments.length - 1];
    const excludedTerminal =
      terminalKey &&
      [...excluded].some(
        (key) => terminalKey === key || terminalKey.startsWith(`${key}:`),
      );
    if (excluded.has(node.key) || excludedTerminal) {
      return [];
    }
    const before = previousByKey.get(node.key);
    if (!before) return [];
    const currentPct = node.pctOfParent;
    const previousPct = before.pctOfParent;
    const deltaPoints = Math.round((currentPct - previousPct) * 10) / 10;
    return Math.abs(deltaPoints) > thresholdPoints
      ? [
          {
            key: node.key,
            label: node.label,
            currentPct,
            previousPct,
            currentN: node.n,
            currentParentN: node.parentKey
              ? (currentByKey.get(node.parentKey)?.n ?? current.rootN)
              : current.rootN,
            previousN: before.n,
            previousParentN: before.parentKey
              ? (previousByKey.get(before.parentKey)?.n ?? previous.rootN)
              : previous.rootN,
            deltaPoints,
          },
        ]
      : [];
  });
}
