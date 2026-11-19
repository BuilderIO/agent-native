import { OptionalPeerDependencyError } from "../shared/optional-peer.js";

export type Status =
  | "selected"
  | "no-match"
  | "unavailable"
  | "failed"
  | "timed_out";
export type Candidate = {
  id: string;
  kind: "tool" | "skill" | "memory" | "app";
  name: string;
  description: string;
  use:
    | { type: "tools/call" | "ask_app" }
    | { type: "open_app"; app: string; path: string }
    | { type: "resources"; action: "read"; path: string; scope: string };
  callable: boolean;
  reason: string;
};
// This object must be built by the authenticated host, never from model arguments.
export type CallerContext = {
  authority: string;
  workspace: string;
  accountEpoch: string;
  session: string;
  run: string;
  target: string;
  revocation: string;
};
export type Ranking = { status: Status; ids: readonly string[] };
export type Boundaries = {
  // Both operations must validate the current authenticated context and fail closed.
  grantedIds: (
    context: CallerContext,
    candidates: readonly Candidate[],
    signal: AbortSignal,
  ) => Promise<readonly string[]>;
  rank: (
    context: CallerContext,
    task: string,
    candidates: readonly Candidate[],
    signal: AbortSignal,
  ) => Promise<Ranking>;
  bm25: (task: string, candidates: readonly Candidate[]) => readonly string[];
  // The host must check authorization at the actual execution boundary, atomically with dispatch.
  executeAuthorized: <T>(
    context: CallerContext,
    candidate: Candidate,
    operation: () => Promise<T>,
  ) => Promise<T>;
};
export type Result = {
  ranking: "jev" | "bm25";
  status: Status;
  recommendations: Candidate[];
};

function complete(
  context: CallerContext | null | undefined,
): context is CallerContext {
  return (
    !!context &&
    [
      context.authority,
      context.workspace,
      context.accountEpoch,
      context.session,
      context.run,
      context.target,
      context.revocation,
    ].every((value) => typeof value === "string" && value.trim().length > 0)
  );
}
function select(
  ids: readonly string[],
  candidates: readonly Candidate[],
): Candidate[] {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const candidate = byId.get(id);
    if (!candidate || seen.has(id)) return [];
    seen.add(id);
    return [candidate];
  });
}
async function bounded<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Timeout());
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
class Timeout extends Error {}

/**
 * Broker-bound adapter retained for a future host that supplies the full caller
 * context. MCP currently uses rankGrantedTask after its own grant filtering;
 * these boundaries are not its execution authorization mechanism.
 */
export async function rankTask(
  context: CallerContext | null,
  task: string,
  candidates: readonly Candidate[],
  boundaries: Boundaries,
): Promise<Result> {
  if (!complete(context) || !task.trim())
    return { ranking: "bm25", status: "unavailable", recommendations: [] };
  // Duplicate identities are ambiguous and must not reach a grant or ranking boundary.
  if (
    new Set(candidates.map((candidate) => candidate.id)).size !==
    candidates.length
  )
    return { ranking: "bm25", status: "failed", recommendations: [] };
  const deadline = Date.now() + 1300;
  let granted: Candidate[];
  try {
    const ids = await bounded(1300, (signal) =>
      boundaries.grantedIds(context, candidates, signal),
    );
    granted = select(ids, candidates);
  } catch (error) {
    return {
      ranking: "bm25",
      status: error instanceof Timeout ? "timed_out" : "unavailable",
      recommendations: [],
    };
  }
  if (!granted.length)
    return { ranking: "bm25", status: "unavailable", recommendations: [] };
  return rankGrantedTask(task, granted, {
    rank: (signal) => boundaries.rank(context, task, granted, signal),
    bm25: () => boundaries.bm25(task, granted),
    deadline,
  });
}

/** Only for candidates already filtered by the authenticated host's current grants. */
export async function rankGrantedTask(
  task: string,
  granted: readonly Candidate[],
  options: {
    rank: (signal: AbortSignal) => Promise<Ranking>;
    bm25: () => readonly string[];
    deadline?: number;
  },
): Promise<Result> {
  if (!task.trim() || !granted.length)
    return { ranking: "bm25", status: "unavailable", recommendations: [] };
  if (new Set(granted.map((candidate) => candidate.id)).size !== granted.length)
    return { ranking: "bm25", status: "failed", recommendations: [] };
  let result: Ranking;
  try {
    const remaining = (options.deadline ?? Date.now() + 1300) - Date.now();
    if (remaining <= 0) throw new Timeout();
    result = await bounded(Math.min(750, remaining), options.rank);
  } catch (error) {
    result = {
      status:
        error instanceof Timeout
          ? "timed_out"
          : error instanceof OptionalPeerDependencyError
            ? "unavailable"
            : "failed",
      ids: [],
    };
  }
  if (result.status === "selected") {
    const recommendations = select(result.ids, granted);
    if (recommendations.length)
      return { ranking: "jev", status: "selected", recommendations };
    result = { status: "failed", ids: [] };
  }
  if (result.status === "no-match")
    return { ranking: "jev", status: "no-match", recommendations: [] };
  try {
    return {
      ranking: "bm25",
      status: result.status,
      recommendations: select(options.bm25(), granted),
    };
  } catch {
    return { ranking: "bm25", status: "failed", recommendations: [] };
  }
}

export async function executeRecommendation<T>(
  context: CallerContext | null,
  candidate: Candidate,
  boundaries: Boundaries,
  operation: () => Promise<T>,
): Promise<T> {
  if (!complete(context))
    throw new Error("Authenticated caller context unavailable");
  return boundaries.executeAuthorized(context, candidate, operation);
}
