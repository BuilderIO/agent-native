import { fileURLToPath } from "node:url";

import {
  discoverEvalFiles,
  runEvals,
  type AgentRunOutput,
  type AgentRunner,
  type Eval,
} from "@agent-native/core/eval";
import { describe, expect, it } from "vitest";

import evals from "./dbt-semantic-layer.eval.js";

const [ownerMetricCase, unconnectedCase] = evals as [Eval, Eval];

type ToolCallDetail = NonNullable<AgentRunOutput["toolCallDetails"]>[number];

function runnerFor(output: AgentRunOutput): AgentRunner {
  return {
    engine: {} as AgentRunner["engine"],
    model: "synthetic-fixture",
    runAgent: async () => output,
    analyzeContext: () => ({}) as ReturnType<AgentRunner["analyzeContext"]>,
  };
}

async function scoreCase(evalCase: Eval, output: AgentRunOutput) {
  const report = await runEvals([evalCase], runnerFor(output), {
    persist: false,
  });
  return { report, reason: report.results[0]?.scores[0]?.reason ?? "" };
}

function transcript(
  text: string,
  toolCalls: string[],
  toolCallDetails: ToolCallDetail[] = [],
): AgentRunOutput {
  return {
    text,
    toolCalls,
    toolCallDetails,
    ok: true,
    runId: "eval:synthetic-dbt-routing",
    durationMs: 0,
  };
}

function connectionCall(result: string): ToolCallDetail {
  return {
    name: "get-dbt-connection",
    input: {},
    completed: true,
    isError: false,
    result,
  };
}

function connectionReadiness(readiness: string): ToolCallDetail {
  return connectionCall(
    JSON.stringify({
      connected: readiness === "ready",
      readiness,
      connections: [],
    }),
  );
}

function dbtResult(status: string): ToolCallDetail {
  return {
    name: "query-dbt-semantic-metric",
    input: { metricName: "synthetic_active_accounts" },
    completed: true,
    isError: false,
    result: JSON.stringify({ status }),
  };
}

function warehouseRead(isError = false): ToolCallDetail {
  return {
    name: "bigquery",
    input: {},
    completed: true,
    isError,
    // The production result: runQuery's rows and metadata, with no query_status.
    result: JSON.stringify({
      rows: [],
      totalRows: 0,
      bytesProcessed: 0,
      cached: false,
      truncated: false,
    }),
  };
}

const DISCLOSED =
  "The synthetic_active_accounts value is 10. It reads warehouse tables and is not the owner-approved Semantic Layer definition.";

describe("Analytics dbt Semantic Layer routing evals", () => {
  it("keeps both cases synthetic, discoverable, and on the routing allowlist", async () => {
    const files = await discoverEvalFiles(
      fileURLToPath(new URL(".", import.meta.url)),
    );

    expect(
      files.some((file) => file.endsWith("/dbt-semantic-layer.eval.ts")),
    ).toBe(true);
    expect(evals).toHaveLength(2);
    expect(
      evals.every((evalCase) => evalCase.name.startsWith("SYNTHETIC:")),
    ).toBe(true);
    expect(evals.every((evalCase) => evalCase.run === undefined)).toBe(true);
    expect(
      evals.every((evalCase) =>
        evalCase.actionAllowlist?.includes("query-dbt-semantic-metric"),
      ),
    ).toBe(true);
    expect(
      evals.map((evalCase) => evalCase.input.prompt).join("\n"),
    ).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  });

  it("passes only when the first source query is the dbt Semantic Layer action", async () => {
    const passing = [
      transcript("Synthetic routing answer.", [
        "find-data",
        "query-dbt-semantic-metric",
        "bigquery",
      ]),
    ];
    const failing: Array<[string, AgentRunOutput, string]> = [
      [
        "bigquery first",
        transcript("Synthetic routing answer.", [
          "find-data",
          "bigquery",
          "query-dbt-semantic-metric",
        ]),
        "first source query was bigquery",
      ],
      [
        "dashboard SQL first",
        transcript("Synthetic routing answer.", [
          "query-dashboard-panel",
          "query-dbt-semantic-metric",
        ]),
        "first source query was query-dashboard-panel",
      ],
      [
        "no source query",
        transcript("Synthetic routing answer.", ["find-data"]),
        "no source query was called",
      ],
      [
        "aborted after the dbt call",
        {
          ...transcript("Synthetic routing answer.", [
            "query-dbt-semantic-metric",
          ]),
          ok: false,
          error: "Agent run timed out.",
        },
        "production run failed or was aborted",
      ],
      [
        "dbt call returned not_found",
        transcript(
          "Synthetic routing answer.",
          ["query-dbt-semantic-metric"],
          [dbtResult("not_found")],
        ),
        "no successful query-dbt-semantic-metric result",
      ],
      [
        "successful result for a different metric",
        transcript(
          "Synthetic routing answer.",
          ["query-dbt-semantic-metric"],
          [
            {
              ...dbtResult("success"),
              input: { metricName: "some_other_metric" },
            },
          ],
        ),
        "no successful query-dbt-semantic-metric result",
      ],
    ];

    // Every passing route also needs a successful dbt result, not just a call.
    for (const output of passing) {
      const { report } = await scoreCase(ownerMetricCase, {
        ...output,
        toolCallDetails: [
          ...(output.toolCallDetails ?? []),
          dbtResult("success"),
        ],
      });
      expect(report).toMatchObject({ total: 1, passed: 1, failed: 0 });
    }
    for (const [label, output, reason] of failing) {
      const result = await scoreCase(ownerMetricCase, output);
      expect(result.report, label).toMatchObject({
        total: 1,
        passed: 0,
        failed: 1,
      });
      expect(result.reason, label).toContain(reason);
    }
  });

  it("passes an unconnected org only with a disclosure that the answer is not the approved definition", async () => {
    const passing: Array<[string, AgentRunOutput]> = [
      [
        "not_connected with direct disclosure",
        transcript(
          DISCLOSED,
          ["get-dbt-connection", "bigquery"],
          [connectionReadiness("not_connected")],
        ),
      ],
      [
        "token_missing with paraphrased disclosure",
        transcript(
          "The value is 10, read from warehouse tables rather than the approved dbt Semantic Layer definition.",
          ["get-dbt-connection", "bigquery"],
          [connectionReadiness("token_missing")],
        ),
      ],
      [
        "several connections, all unconnected",
        transcript(
          DISCLOSED,
          ["get-dbt-connection", "bigquery"],
          [
            connectionCall(
              JSON.stringify({
                connected: false,
                readiness: null,
                connections: [
                  { id: "conn_example_a", readiness: "not_connected" },
                  { id: "conn_example_b", readiness: "token_missing" },
                ],
              }),
            ),
          ],
        ),
      ],
    ];
    const failing: Array<[string, AgentRunOutput, string]> = [
      [
        "no disclosure",
        transcript(
          "The synthetic_active_accounts value is 10.",
          ["get-dbt-connection", "bigquery"],
          [connectionReadiness("not_connected")],
        ),
        "final answer did not disclose",
      ],
      [
        "presented as the approved definition",
        transcript(
          "This is the owner-approved value: 10. It reads warehouse tables and is not the owner-approved Semantic Layer definition.",
          ["get-dbt-connection", "bigquery"],
          [connectionReadiness("not_connected")],
        ),
        "presented the number as the approved definition",
      ],
      [
        "org reported ready",
        transcript(
          DISCLOSED,
          ["get-dbt-connection", "bigquery"],
          [connectionReadiness("ready")],
        ),
        "get-dbt-connection reported ready",
      ],
      [
        "one ready connection among unconnected ones",
        transcript(
          DISCLOSED,
          ["get-dbt-connection", "bigquery"],
          [
            connectionCall(
              JSON.stringify({
                connected: false,
                readiness: null,
                connections: [
                  { id: "conn_example_a", readiness: "not_connected" },
                  { id: "conn_example_b", readiness: "ready" },
                ],
              }),
            ),
          ],
        ),
        "get-dbt-connection reported ready",
      ],
      [
        "no get-dbt-connection result",
        transcript(DISCLOSED, ["bigquery"]),
        "no successful get-dbt-connection result",
      ],
      [
        "unreadable get-dbt-connection result",
        transcript(
          DISCLOSED,
          ["get-dbt-connection", "bigquery"],
          [connectionCall("not json")],
        ),
        "Could not parse get-dbt-connection result",
      ],
    ];

    // Every passing disclosure also needs a successful warehouse read.
    for (const [label, output] of passing) {
      const { report } = await scoreCase(unconnectedCase, {
        ...output,
        toolCallDetails: [...(output.toolCallDetails ?? []), warehouseRead()],
      });
      expect(report, label).toMatchObject({ total: 1, passed: 1, failed: 0 });
    }
    for (const [label, output, reason] of failing) {
      const result = await scoreCase(unconnectedCase, output);
      expect(result.report, label).toMatchObject({
        total: 1,
        passed: 0,
        failed: 1,
      });
      expect(result.reason, label).toContain(reason);
    }
  });

  it("requires a successful warehouse read and catches approval claims in other phrasings", async () => {
    const readiness = [connectionReadiness("not_connected")];
    const withRead = (text: string) =>
      transcript(
        text,
        ["get-dbt-connection", "bigquery"],
        [...readiness, warehouseRead()],
      );

    for (const output of [
      transcript(DISCLOSED, ["get-dbt-connection"], readiness),
      transcript(
        DISCLOSED,
        ["get-dbt-connection", "bigquery"],
        [...readiness, warehouseRead(true)],
      ),
      // A completed, non-error result without rows is not a warehouse read.
      transcript(
        DISCLOSED,
        ["get-dbt-connection", "bigquery"],
        [
          ...readiness,
          {
            name: "bigquery",
            input: {},
            completed: true,
            isError: false,
            result: JSON.stringify({ query_status: "timeout" }),
          },
        ],
      ),
    ]) {
      const { report, reason } = await scoreCase(unconnectedCase, output);
      expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
      expect(reason).toContain("no successful warehouse query");
    }

    for (const text of [
      "This is approved: 10. It reads warehouse tables and is not the owner-approved Semantic Layer definition.",
      "The approved number is 10. It reads warehouse tables and is not the owner-approved Semantic Layer definition.",
      "The value comes from the approved metric. It reads warehouse tables and is not the owner-approved Semantic Layer definition.",
    ]) {
      const { report, reason } = await scoreCase(
        unconnectedCase,
        withRead(text),
      );
      expect(report, text).toMatchObject({ total: 1, passed: 0, failed: 1 });
      expect(reason, text).toContain(
        "presented the number as the approved definition",
      );
    }

    // A negated mention of the approved definition is a correct disclosure.
    const negated =
      "The approved definition is not available for this metric. The value is 10 from warehouse tables and is not the owner-approved Semantic Layer definition.";
    const { report } = await scoreCase(unconnectedCase, withRead(negated));
    expect(report, negated).toMatchObject({ total: 1, passed: 1, failed: 0 });

    const doesNotReflect =
      "The value is 10 from warehouse tables. It does not reflect the approved definition; it is not the owner-approved Semantic Layer definition.";
    const negatedReflect = await scoreCase(
      unconnectedCase,
      withRead(doesNotReflect),
    );
    expect(negatedReflect.report, doesNotReflect).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
    });
  });
});
