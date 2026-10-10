import { fileURLToPath } from "node:url";

import {
  discoverEvalFiles,
  runEvals,
  type AgentRunOutput,
  type AgentRunner,
  type Eval,
} from "@agent-native/core/eval";
import { describe, expect, it } from "vitest";

import evals, {
  METADATA_ONLY_ACTION_ALLOWLIST,
  sourceContracts,
} from "./production-source-cases.eval.js";

const cases = evals as Eval[];

function outputFor(
  contract: (typeof sourceContracts)[keyof typeof sourceContracts],
  overrides: Partial<AgentRunOutput> = {},
): AgentRunOutput {
  const relationClaims = [
    ...contract.relationGrains,
    ...contract.relationGrainAlternatives.map(
      (group) => group.alternatives[0]!,
    ),
  ];
  const expectedText = [
    ...relationClaims.map((claim) => `${claim.relation}: ${claim.grains[0]}`),
    ...contract.concepts,
  ].join("\n");
  return {
    text: expectedText,
    toolCalls: ["search-bigquery-schema"],
    ok: true,
    runId: "eval:synthetic-fixture",
    durationMs: 0,
    ...overrides,
  };
}

function runnerFor(output: AgentRunOutput): AgentRunner {
  return {
    engine: {} as AgentRunner["engine"],
    model: "synthetic-fixture",
    runAgent: async () => output,
    analyzeContext: () => ({}) as ReturnType<AgentRunner["analyzeContext"]>,
  };
}

describe("Analytics synthetic production source evals", () => {
  it("keeps all cases synthetic, runner-discoverable, and free of custom run callbacks", async () => {
    const files = await discoverEvalFiles(
      fileURLToPath(new URL("..", import.meta.url)),
      "production-source-cases",
    );

    expect(files.map((file) => file.split("/").at(-1))).toContain(
      "production-source-cases.eval.ts",
    );
    expect(cases.map((evalCase) => evalCase.name)).toHaveLength(4);
    expect(
      cases.every((evalCase) => evalCase.name.startsWith("SYNTHETIC:")),
    ).toBe(true);
    expect(cases.every((evalCase) => evalCase.run === undefined)).toBe(true);
    expect(
      cases.every(
        (evalCase) =>
          evalCase.actionAllowlist === METADATA_ONLY_ACTION_ALLOWLIST,
      ),
    ).toBe(true);
    expect(
      cases.map((evalCase) => evalCase.input.prompt).join("\n"),
    ).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  });

  it("accepts the expected source and grain contracts using metadata tools only", async () => {
    const contracts = Object.values(sourceContracts);
    let contractIndex = 0;
    const report = await runEvals(
      cases,
      {
        engine: {} as AgentRunner["engine"],
        model: "synthetic-fixture",
        runAgent: async (_input) => {
          const contract = contracts[contractIndex++];
          if (!contract) throw new Error("Synthetic eval contract is missing.");
          return outputFor(contract);
        },
        analyzeContext: () => ({}) as ReturnType<AgentRunner["analyzeContext"]>,
      } as AgentRunner,
      { persist: false },
    );

    expect(report).toMatchObject({ total: 4, passed: 4, failed: 0 });
  });

  it("accepts the complete user-organization membership row unit", async () => {
    const report = await runEvals(
      [cases[0]!],
      runnerFor({
        text: [
          "dbt_mart.dim_users_core: one row per user",
          "dbt_mart.dim_organizations: one row per organization",
          "dbt_intermediate.user_organization_role: one row per user-organization membership",
          "user organization membership",
        ].join("\n"),
        toolCalls: ["search-bigquery-schema"],
        ok: true,
        runId: "eval:membership-row-unit-fixture",
        durationMs: 0,
      }),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 1, failed: 0 });
  });

  it("fails closed on an aborted or failed production run, even with matching text", async () => {
    const report = await runEvals(
      [cases[0]!],
      runnerFor(
        outputFor(sourceContracts.builderUsersByOrganization, {
          ok: false,
          error: "Agent run timed out.",
        }),
      ),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(report.results[0]?.status).toBe("failed");
    expect(report.results[0]?.scores[0]?.score).toBe(0);
  });

  it("fails if an eval reads event or product rows instead of metadata", async () => {
    const report = await runEvals(
      [cases[2]!],
      runnerFor(
        outputFor(sourceContracts.agentNativeUsersAndEvents, {
          toolCalls: ["query-agent-native-analytics"],
        }),
      ),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
  });

  it("fails when every relation is named but user and organization grains are swapped", async () => {
    const report = await runEvals(
      [cases[0]!],
      runnerFor({
        text: [
          "dbt_mart.dim_users_core: organization grain",
          "dbt_mart.dim_organizations: user grain",
          "dbt_intermediate.user_organization_role: membership grain",
          "user organization membership",
        ].join("\n"),
        toolCalls: ["search-bigquery-schema"],
        ok: true,
        runId: "eval:swapped-grain-fixture",
        durationMs: 0,
      }),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(report.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.dim_users_core did not declare its expected user grain",
    );
  });

  it("rejects a grain phrase that is negated or contradicted", async () => {
    const contract = sourceContracts.builderUsersByOrganization;
    const run = (userGrainLine: string) =>
      runEvals(
        [cases[0]!],
        runnerFor({
          text: [
            userGrainLine,
            "dbt_mart.dim_organizations: organization grain",
            "dbt_intermediate.user_organization_role: membership grain",
            "user organization membership",
          ].join("\n"),
          toolCalls: ["search-bigquery-schema"],
          ok: true,
          runId: "eval:contradictory-grain-fixture",
          durationMs: 0,
        }),
        { persist: false },
      );

    const negated = await run(
      "dbt_mart.dim_users_core: not user grain; organization grain",
    );
    const contradictory = await run(
      "dbt_mart.dim_users_core: user grain and organization grain",
    );

    expect(negated).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(contradictory).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(negated.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.dim_users_core did not declare its expected user grain",
    );
    expect(contradictory.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.dim_users_core did not declare its expected user grain",
    );
    expect(contract.relationGrains).toHaveLength(2);
  });

  it("rejects a negation that follows the expected grain phrase", async () => {
    const reportFor = (userGrainLine: string) =>
      runEvals(
        [cases[0]!],
        runnerFor({
          text: [
            userGrainLine,
            "dbt_mart.dim_organizations: organization grain",
            "dbt_intermediate.user_organization_role: membership grain",
            "user organization membership",
          ].join("\n"),
          toolCalls: ["search-bigquery-schema"],
          ok: true,
          runId: "eval:trailing-grain-negation-fixture",
          durationMs: 0,
        }),
        { persist: false },
      );

    const positive = await reportFor(
      "dbt_mart.dim_users_core: user grain is documented",
    );
    const negative = await reportFor(
      "dbt_mart.dim_users_core: user grain is not the declared grain",
    );
    const commaSeparatedNegative = await reportFor(
      "dbt_mart.dim_users_core: user grain, but this is not the declared grain",
    );
    const descriptiveNo = await reportFor(
      "dbt_mart.dim_users_core: user grain with no duplicate users",
    );

    expect(positive).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(negative).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(commaSeparatedNegative).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
    });
    expect(descriptiveNo).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(negative.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.dim_users_core did not declare its expected user grain",
    );
  });

  it("requires complete relation identifiers instead of accepting a prefixed name", async () => {
    const reportFor = (userRelation: string) =>
      runEvals(
        [cases[0]!],
        runnerFor({
          text: [
            `${userRelation}: user grain`,
            "dbt_mart.dim_organizations: organization grain",
            "dbt_intermediate.user_organization_role: membership grain",
            "user organization membership",
          ].join("\n"),
          toolCalls: ["search-bigquery-schema"],
          ok: true,
          runId: "eval:complete-relation-identifier-fixture",
          durationMs: 0,
        }),
        { persist: false },
      );

    const complete = await reportFor("dbt_mart.dim_users_core");
    const prefixed = await reportFor("_backupdbt_mart.dim_users_core");

    expect(complete).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(prefixed).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(prefixed.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.dim_users_core did not declare its expected user grain",
    );
  });

  it("rejects outdated activity and account grain labels", async () => {
    const activityReport = await runEvals(
      [cases[1]!],
      runnerFor(
        outputFor(sourceContracts.builderProductActivity, {
          text: "fact_builder_activity: activity grain",
        }),
      ),
      { persist: false },
    );
    const userReport = await runEvals(
      [cases[2]!],
      runnerFor(
        outputFor(sourceContracts.agentNativeUsersAndEvents, {
          text: [
            "dim_agent_native_users: one row per account",
            "stg_analytics__first_party_events: event grain",
            "one row per event user email",
          ].join("\n"),
        }),
      ),
      { persist: false },
    );

    expect(activityReport).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(activityReport.results[0]?.scores[0]?.reason).toContain(
      "fact_builder_activity did not declare its expected one row per (event_date, user_id, org_id, event_type)",
    );
    expect(userReport).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(userReport.results[0]?.scores[0]?.reason).toContain(
      "dim_agent_native_users did not declare its expected user/email grain",
    );
  });
});
