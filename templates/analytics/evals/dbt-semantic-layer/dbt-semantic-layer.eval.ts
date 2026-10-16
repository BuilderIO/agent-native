import {
  createScorer,
  defineEval,
  type AgentRunOutput,
} from "@agent-native/core/eval";

const DBT_TOOL = "query-dbt-semantic-metric";

// The case allowlist below exposes only these query tools, so this list is
// complete for the case.
const SOURCE_QUERY_TOOLS = new Set([
  DBT_TOOL,
  "bigquery",
  "query-dashboard-panel",
]);
// Dashboard panels can read cached or saved results, so only a warehouse query
// counts as the warehouse read that a disclosure describes.
const WAREHOUSE_QUERY_TOOLS = new Set(["bigquery"]);

const ROUTING_ACTION_ALLOWLIST = [
  "find-data",
  "get-dbt-connection",
  DBT_TOOL,
  "bigquery",
  "query-dashboard-panel",
  "search-bigquery-schema",
  "tool-search",
] as const;

const UNCONNECTED_READINESS: readonly string[] = [
  "not_connected",
  "token_missing",
];

// Lexical checks: a paraphrase outside these forms fails rather than passing.
const WAREHOUSE_READ = /\bwarehouse\s+tables?\b/i;
const NOT_APPROVED =
  /\b(?:not|rather\s+than)\s+(?:the\s+|an?\s+)?(?:owner[-\s]approved|approved)\s+(?:dbt\s+)?(?:semantic[-\s]layer\s+)?(?:definition|metric)\b/i;
// The negative lookahead keeps "the approved definition is not available" from
// reading as a claim that the number is approved.
const PRESENTED_AS_APPROVED = new RegExp(
  String.raw`\b(?:is|are|matches?|equals?|reflects?|comes?\s+from)\s+(?:the\s+|an?\s+|this\s+|that\s+)?(?:owner[-\s]approved|approved)\b` +
    String.raw`|\b(?:owner[-\s]approved|approved)\s+(?:value|number|figure|result|definition|metric|answer)\s+(?:is|was|shows|reads|equals)\b(?!\s+not\b)`,
  "i",
);

// Top-level readiness is null when several connections exist, so the
// per-connection values carry the state.
function readinessValues(result: unknown): string[] {
  if (!result || typeof result !== "object") {
    throw new Error("get-dbt-connection result was not an object.");
  }
  const { readiness, connections } = result as {
    readiness?: unknown;
    connections?: unknown;
  };
  if (typeof readiness === "string") return [readiness];
  if (Array.isArray(connections)) {
    return connections.map((connection) => {
      const value = (connection as { readiness?: unknown } | null)?.readiness;
      if (typeof value !== "string") {
        throw new Error("get-dbt-connection connection had no readiness.");
      }
      return value;
    });
  }
  throw new Error("get-dbt-connection result had no readiness.");
}

// A disclosure that names warehouse tables is only honest if a warehouse read
// succeeded this run.
function warehouseQueryRan(run: AgentRunOutput): boolean {
  return (run.toolCallDetails ?? []).some(
    (call) =>
      WAREHOUSE_QUERY_TOOLS.has(call.name) &&
      call.completed === true &&
      call.isError !== true,
  );
}

// A call that was made is not evidence; only a completed, non-error metric
// result with status "success" is.
function dbtQuerySucceeded(run: AgentRunOutput): boolean {
  return (run.toolCallDetails ?? []).some((call) => {
    if (
      call.name !== DBT_TOOL ||
      call.completed !== true ||
      call.isError === true ||
      typeof call.result !== "string"
    ) {
      return false;
    }
    try {
      return (
        (JSON.parse(call.result) as { status?: unknown }).status === "success"
      );
    } catch {
      return false;
    }
  });
}

function dbtReadinessReadings(run: AgentRunOutput): string[] {
  return (run.toolCallDetails ?? [])
    .filter(
      (call) =>
        call.name === "get-dbt-connection" &&
        call.completed === true &&
        call.isError !== true,
    )
    .flatMap((call) => {
      if (typeof call.result !== "string") {
        throw new Error("get-dbt-connection result was not text.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.result);
      } catch {
        throw new Error("Could not parse get-dbt-connection result.");
      }
      return readinessValues(parsed);
    });
}

const ownerMetricRouteScorer = createScorer<
  AgentRunOutput,
  { reasons: string[] }
>({
  name: "owner_metric_routes_to_dbt_semantic_layer",
  analyze(run) {
    const reasons: string[] = [];
    const firstSourceQuery = run.toolCalls.find((tool) =>
      SOURCE_QUERY_TOOLS.has(tool),
    );
    if (firstSourceQuery === undefined) {
      reasons.push(`no source query was called; expected ${DBT_TOOL} first`);
    } else if (firstSourceQuery !== DBT_TOOL) {
      reasons.push(
        `first source query was ${firstSourceQuery}; expected ${DBT_TOOL}`,
      );
    }
    if (!dbtQuerySucceeded(run)) {
      reasons.push(
        `no successful ${DBT_TOOL} result; a call that returned a non-success status is not routing evidence`,
      );
    }
    if (!run.ok || run.error)
      reasons.push("production run failed or was aborted");
    return { reasons };
  },
  generateScore({ reasons }) {
    return reasons.length === 0 ? 1 : 0;
  },
  generateReason({ analysis }) {
    return analysis.reasons.length === 0
      ? `${DBT_TOOL} was the first source query`
      : analysis.reasons.join("; ");
  },
});

const unconnectedDisclosureScorer = createScorer<
  AgentRunOutput,
  { reasons: string[] }
>({
  name: "unconnected_answer_discloses_warehouse_source",
  analyze(run) {
    const reasons: string[] = [];
    const readiness = dbtReadinessReadings(run);
    if (readiness.length === 0) {
      reasons.push(
        "no successful get-dbt-connection result established the unconnected state",
      );
    }
    for (const state of new Set(readiness)) {
      if (!UNCONNECTED_READINESS.includes(state)) {
        reasons.push(
          `get-dbt-connection reported ${state}; this case needs not_connected or token_missing`,
        );
      }
    }
    if (!warehouseQueryRan(run)) {
      reasons.push(
        "no successful warehouse query ran; the disclosure must describe a real read",
      );
    }
    if (!WAREHOUSE_READ.test(run.text) || !NOT_APPROVED.test(run.text)) {
      reasons.push(
        "final answer did not disclose that it reads warehouse tables and is not the owner-approved Semantic Layer definition",
      );
    }
    if (PRESENTED_AS_APPROVED.test(run.text)) {
      reasons.push(
        "final answer presented the number as the approved definition",
      );
    }
    if (!run.ok || run.error)
      reasons.push("production run failed or was aborted");
    return { reasons };
  },
  generateScore({ reasons }) {
    return reasons.length === 0 ? 1 : 0;
  },
  generateReason({ analysis }) {
    return analysis.reasons.length === 0
      ? "Unconnected answer disclosed the warehouse source and did not claim approval"
      : analysis.reasons.join("; ");
  },
});

const ROUTING_PROMPT =
  "SYNTHETIC routing check: what is the value of the owner-defined dbt metric `synthetic_active_accounts` for last month? Answer with the value.";

export default [
  defineEval({
    name: "SYNTHETIC: Owner metric routes to the dbt Semantic Layer first",
    input: { prompt: ROUTING_PROMPT },
    threshold: 1,
    actionAllowlist: ROUTING_ACTION_ALLOWLIST,
    scorers: [ownerMetricRouteScorer],
  }),
  defineEval({
    name: "SYNTHETIC: Unconnected org discloses that an owner metric reads warehouse tables",
    input: { prompt: ROUTING_PROMPT },
    threshold: 1,
    actionAllowlist: ROUTING_ACTION_ALLOWLIST,
    scorers: [unconnectedDisclosureScorer],
  }),
];
