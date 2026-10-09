/**
 * Prefix tree over sessions' step sequences, with deterministic example
 * sessions per node. Pure: recordings arrive already read, so the same input
 * always yields the same tree.
 */
import type { JourneyStep } from "./journey-steps.js";

export type RecordingViewport =
  | { status: "known"; width: number; height: number }
  | { status: "not_captured" }
  | { status: "unreadable" };

export interface JourneyRecording {
  id: string;
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  viewport: RecordingViewport;
}

export interface JourneySession {
  sessionId: string;
  steps: readonly JourneyStep[];
}

export interface ViewportConstraints {
  minAspect?: number;
  maxAspect?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Leave out examples whose viewport was not recorded or cannot be read. */
  requireKnown?: boolean;
}

export interface BuildJourneyTreeOptions {
  maxDepth: number;
  minNodeSessions: number;
  examplesPerNode: number;
  settleMs: number;
  recency: "newest" | "none";
  viewport?: ViewportConstraints;
  /** Absolute URL that opens a recording at an offset, when the caller knows its origin. */
  replayUrlFor?: (recordingId: string, offsetMs: number) => string | undefined;
}

/**
 * Why an example has no viewport. `no_recording`: no accessible recording
 * covers the step. `not_captured`: the recording predates viewport capture.
 * `unreadable`: its metadata could not be parsed.
 */
export type ViewportUnknownReason =
  | "no_recording"
  | "not_captured"
  | "unreadable";

export interface JourneyExample {
  sessionId: string;
  recordingId: string | null;
  /** ISO time of the step in this session. */
  ts: string;
  /** Milliseconds from recording.startedAt to the step; null without a recording. */
  offsetMs: number | null;
  viewport: { width: number; height: number } | null;
  /** Present exactly when `viewport` is null. */
  viewportReason?: ViewportUnknownReason;
  replayUrl?: string;
}

export interface JourneyNode {
  /** Unique path id: the step keys from the first step to this node, joined with " > ". */
  key: string;
  label: string;
  /** Null for first steps. */
  parentKey: string | null;
  /** 1 for first steps. */
  depth: number;
  kind: "step" | "other";
  n: number;
  pctOfRoot: number;
  /** For first steps the parent is the whole cohort, so this equals pctOfRoot. */
  pctOfParent: number;
  /**
   * Sessions whose last observed step is this node (for `other`, anywhere in
   * the merged branches). Sessions cut off at `maxDepth` are not drop-off:
   * `n - dropoffN - sum(children n)` is how many continued.
   */
  dropoffN: number;
  dropoffPct: number;
  examples: JourneyExample[];
}

// Clock skew and recorder start-up mean a step can land just outside the
// recording that shows it.
const COVER_SLACK_MS = 2_000;

interface TrieNode {
  stepKey: string;
  label: string;
  key: string;
  depth: number;
  n: number;
  ends: number;
  refs: Array<{ sessionId: string; tsMs: number }>;
  children: Map<string, TrieNode>;
}

function trieNode(
  stepKey: string,
  label: string,
  key: string,
  depth: number,
): TrieNode {
  return {
    stepKey,
    label,
    key,
    depth,
    n: 0,
    ends: 0,
    refs: [],
    children: new Map(),
  };
}

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 100;

function recordingEndMs(recording: JourneyRecording): number | null {
  if (recording.endedAtMs !== null) return recording.endedAtMs;
  return recording.durationMs !== null
    ? recording.startedAtMs + recording.durationMs
    : null;
}

// A recording with no known end only proves its own start: a later step could
// lie past the chunks that exist, and its offset would not render.
function covers(recording: JourneyRecording, tsMs: number): boolean {
  const lastKnownMs = recordingEndMs(recording) ?? recording.startedAtMs;
  return (
    tsMs >= recording.startedAtMs - COVER_SLACK_MS &&
    tsMs <= lastKnownMs + COVER_SLACK_MS
  );
}

// Node keys join step keys with " > ", so a step key holding that delimiter
// (or the escape character) is escaped to keep every path unambiguous.
const escapeKeyPart = (part: string): string =>
  part.replace(/%/g, "%25").replace(/>/g, "%3E");

function violatesViewport(
  viewport: { width: number; height: number },
  constraints: ViewportConstraints,
): boolean {
  const aspect = viewport.width / viewport.height;
  return (
    (constraints.minAspect !== undefined && aspect < constraints.minAspect) ||
    (constraints.maxAspect !== undefined && aspect > constraints.maxAspect) ||
    (constraints.minWidth !== undefined &&
      viewport.width < constraints.minWidth) ||
    (constraints.maxWidth !== undefined &&
      viewport.width > constraints.maxWidth)
  );
}

function hasViewportConstraints(constraints: ViewportConstraints | undefined) {
  return (
    constraints !== undefined &&
    (constraints.requireKnown === true ||
      constraints.minAspect !== undefined ||
      constraints.maxAspect !== undefined ||
      constraints.minWidth !== undefined ||
      constraints.maxWidth !== undefined)
  );
}

interface Candidate {
  sessionId: string;
  tsMs: number;
  recording: JourneyRecording | null;
}

function chooseCandidate(
  ref: { sessionId: string; tsMs: number },
  recordings: readonly JourneyRecording[],
  constraints: ViewportConstraints | undefined,
): Candidate | null {
  const constrained = hasViewportConstraints(constraints);
  const usable = recordings
    .filter((recording) => covers(recording, ref.tsMs))
    .filter(
      (recording) =>
        !constrained ||
        recording.viewport.status !== "known" ||
        !violatesViewport(recording.viewport, constraints!),
    )
    .filter(
      (recording) =>
        !constraints?.requireKnown || recording.viewport.status === "known",
    )
    // Latest start first: the recording that was running when the step fired.
    .sort(
      (a, b) =>
        b.startedAtMs - a.startedAtMs ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  if (usable.length) return { ...ref, recording: usable[0]! };
  // A session whose every covering recording broke a viewport rule is out; a
  // session with no covering recording stays as a flagged, replay-less example.
  const coveringExists = recordings.some((recording) =>
    covers(recording, ref.tsMs),
  );
  if (coveringExists || constraints?.requireKnown) return null;
  return { ...ref, recording: null };
}

function exampleFrom(
  candidate: Candidate,
  options: BuildJourneyTreeOptions,
): JourneyExample {
  const { recording } = candidate;
  const ts = new Date(candidate.tsMs).toISOString();
  if (!recording) {
    return {
      sessionId: candidate.sessionId,
      recordingId: null,
      ts,
      offsetMs: null,
      viewport: null,
      viewportReason: "no_recording",
    };
  }
  const end = recordingEndMs(recording);
  let offsetMs = Math.max(
    0,
    candidate.tsMs - recording.startedAtMs + options.settleMs,
  );
  if (end !== null) {
    offsetMs = Math.min(offsetMs, Math.max(0, end - recording.startedAtMs));
  }
  offsetMs = Math.round(offsetMs);
  const { viewport } = recording;
  const replayUrl = options.replayUrlFor?.(recording.id, offsetMs);
  return {
    sessionId: candidate.sessionId,
    recordingId: recording.id,
    ts,
    offsetMs,
    viewport:
      viewport.status === "known"
        ? { width: viewport.width, height: viewport.height }
        : null,
    ...(viewport.status === "known" ? {} : { viewportReason: viewport.status }),
    ...(replayUrl ? { replayUrl } : {}),
  };
}

function pickExamples(
  refs: ReadonlyArray<{ sessionId: string; tsMs: number }>,
  recordings: ReadonlyMap<string, readonly JourneyRecording[]>,
  options: BuildJourneyTreeOptions,
): JourneyExample[] {
  if (options.examplesPerNode === 0) return [];
  const constrained = hasViewportConstraints(options.viewport);
  const candidates: Candidate[] = [];
  for (const ref of refs) {
    const candidate = chooseCandidate(
      ref,
      recordings.get(ref.sessionId) ?? [],
      options.viewport,
    );
    if (candidate) candidates.push(candidate);
  }
  const rank = (candidate: Candidate): number[] => [
    candidate.recording ? 0 : 1,
    constrained && candidate.recording?.viewport.status !== "known" ? 1 : 0,
    options.recency === "newest" ? -candidate.tsMs : 0,
  ];
  candidates.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    }
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
  return candidates
    .slice(0, options.examplesPerNode)
    .map((candidate) => exampleFrom(candidate, options));
}

/** Sessions whose last observed step is this node or any node under it. */
function subtreeEnds(node: TrieNode): number {
  let ends = node.ends;
  for (const child of node.children.values()) ends += subtreeEnds(child);
  return ends;
}

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Flat, parents-before-children list of nodes below the (implicit) root, and
 * the number of sessions in the root. Children are ordered by session count
 * (then step key), so a node's rank among its siblings never depends on input
 * order.
 */
export function buildJourneyTree(
  sessions: readonly JourneySession[],
  recordings: ReadonlyMap<string, readonly JourneyRecording[]>,
  options: BuildJourneyTreeOptions,
): { rootN: number; nodes: JourneyNode[] } {
  const root = trieNode("root", "All sessions", "root", 0);
  for (const session of sessions) {
    if (!session.steps.length) continue;
    root.n += 1;
    let node = root;
    const limit = Math.min(session.steps.length, options.maxDepth);
    for (let i = 0; i < limit; i++) {
      const step = session.steps[i]!;
      let child = node.children.get(step.key);
      if (!child) {
        const part = escapeKeyPart(step.key);
        child = trieNode(
          step.key,
          step.label,
          node === root ? part : `${node.key} > ${part}`,
          i + 1,
        );
        node.children.set(step.key, child);
      }
      child.n += 1;
      child.refs.push({ sessionId: session.sessionId, tsMs: step.tsMs });
      node = child;
    }
    // Sessions longer than maxDepth stop being tracked at the cap; they are
    // neither a drop-off nor a child of the node they stop at.
    if (session.steps.length <= options.maxDepth) node.ends += 1;
  }

  const nodes: JourneyNode[] = [];
  const emitChildren = (parent: TrieNode) => {
    const ordered = [...parent.children.values()].sort(
      (a, b) => b.n - a.n || compareKeys(a.stepKey, b.stepKey),
    );
    const parentKey = parent === root ? null : parent.key;
    for (const node of ordered) {
      if (node.n < options.minNodeSessions) continue;
      nodes.push({
        key: node.key,
        label: node.label,
        parentKey,
        depth: node.depth,
        kind: "step",
        n: node.n,
        pctOfRoot: pct(node.n, root.n),
        pctOfParent: pct(node.n, parent.n),
        dropoffN: node.ends,
        dropoffPct: pct(node.ends, node.n),
        examples: pickExamples(node.refs, recordings, options),
      });
      emitChildren(node);
    }
    const merged = ordered.filter((node) => node.n < options.minNodeSessions);
    if (merged.length) {
      const n = merged.reduce((sum, node) => sum + node.n, 0);
      const dropoffN = merged.reduce((sum, node) => sum + subtreeEnds(node), 0);
      nodes.push({
        key: `${parent.key} > other`,
        label: `Other (${merged.length} ${merged.length === 1 ? "branch" : "branches"})`,
        parentKey,
        depth: parent.depth + 1,
        kind: "other",
        n,
        pctOfRoot: pct(n, root.n),
        pctOfParent: pct(n, parent.n),
        dropoffN,
        dropoffPct: pct(dropoffN, n),
        examples: [],
      });
    }
  };
  emitChildren(root);
  return { rootN: root.n, nodes };
}
