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
    ...relationClaims.map((claim) => {
      const meaning = contract.relationMeanings?.find(
        (candidate) => candidate.relation === claim.relation,
      )?.meanings[0];
      return `${claim.relation}: ${[meaning, claim.grains[0]].filter(Boolean).join("; ")}`;
    }),
    ...(contract.fieldMeanings ?? []).map(
      (claim) => `${claim.relation}.${claim.field}: ${claim.meanings[0]}`,
    ),
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
    expect(cases.map((evalCase) => evalCase.name)).toHaveLength(6);
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

    expect(report).toMatchObject({ total: 6, passed: 6, failed: 0 });
  });

  it("rejects current and historical count relations assigned to the opposite time scopes", async () => {
    const contract = sourceContracts.builderCurrentAndHistoricalUserCounts;
    const report = await runEvals(
      [cases[1]!],
      runnerFor({
        text: [
          "dbt_mart.organization_user_count: historical month-end; one row per organization per date",
          "dbt_mart.aggregate_monthly_users_per_org: current daily; one row per organization per month",
          ...contract.concepts,
        ].join("\n"),
        toolCalls: ["search-bigquery-schema"],
        ok: true,
        runId: "eval:reversed-time-scope-fixture",
        durationMs: 0,
      }),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(report.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.organization_user_count was not assigned to its expected current time scope",
    );
  });

  it("rejects negated and conflicting time-scope claims while accepting a clear scope", async () => {
    const contract = sourceContracts.builderCurrentAndHistoricalUserCounts;
    const relation = "dbt_mart.organization_user_count";
    const monthlyRelation = "dbt_mart.aggregate_monthly_users_per_org";
    const reportFor = (currentScope: string) =>
      runEvals(
        [cases[1]!],
        runnerFor(
          outputFor(contract, {
            text: [
              `${relation}: ${currentScope}; one row per organization per date`,
              `${monthlyRelation}: historical month-end monthly trend; one row per organization per month`,
              ...contract.concepts,
            ].join("\n"),
          }),
        ),
        { persist: false },
      );

    const affirmative = await reportFor(
      "current daily (not the historical month-end scope)",
    );
    const negated = await reportFor("not current daily; historical month-end");
    const conflicting = await reportFor(
      "current daily and historical month-end",
    );

    expect(affirmative).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(negated).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(conflicting).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(negated.results[0]?.scores[0]?.reason).toContain(
      `${relation} was not assigned to its expected current time scope`,
    );
    expect(conflicting.results[0]?.scores[0]?.reason).toContain(
      `${relation} was not assigned to its expected current time scope`,
    );
  });

  it("rejects reversed external and internal user-count field meanings", async () => {
    const contract = sourceContracts.builderExternalAndInternalUserCounts;
    const relation = "dbt_mart.aggregate_monthly_users_per_org";
    const report = await runEvals(
      [cases[2]!],
      runnerFor({
        text: [
          `${relation}: one row per organization per month`,
          `${relation}.user_count: internal Builder.io staff users`,
          `${relation}.internal_user_count: external Builder.io product users`,
          ...contract.concepts,
        ].join("\n"),
        toolCalls: ["search-bigquery-schema"],
        ok: true,
        runId: "eval:reversed-population-fields-fixture",
        durationMs: 0,
      }),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(report.results[0]?.scores[0]?.reason).toContain(
      `${relation}.user_count was not mapped to its expected population`,
    );
    expect(report.results[0]?.scores[0]?.reason).toContain(
      `${relation}.internal_user_count was not mapped to its expected population`,
    );
  });

  it("rejects negated and conflicting population fields while accepting clear mappings", async () => {
    const contract = sourceContracts.builderExternalAndInternalUserCounts;
    const relation = "dbt_mart.aggregate_monthly_users_per_org";
    const reportFor = (userCountMeaning: string) =>
      runEvals(
        [cases[2]!],
        runnerFor(
          outputFor(contract, {
            text: [
              `${relation}: one row per organization per month`,
              `${relation}.user_count: ${userCountMeaning}`,
              `${relation}.internal_user_count: internal Builder.io staff users`,
              ...contract.concepts,
            ].join("\n"),
          }),
        ),
        { persist: false },
      );

    const affirmative = await reportFor("external Builder.io product users");
    const negated = await reportFor(
      "not external Builder.io product users; internal Builder.io staff users",
    );
    const conflicting = await reportFor(
      "external Builder.io product users and internal Builder.io staff users",
    );

    expect(affirmative).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(negated).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(conflicting).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(negated.results[0]?.scores[0]?.reason).toContain(
      `${relation}.user_count was not mapped to its expected population`,
    );
    expect(conflicting.results[0]?.scores[0]?.reason).toContain(
      `${relation}.user_count was not mapped to its expected population`,
    );
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

  it("does not accept a mapping relation absent from the dbt project", async () => {
    const report = await runEvals(
      [cases[0]!],
      runnerFor({
        text: [
          "dbt_mart.dim_users_core: one row per user",
          "dbt_mart.dim_organizations: one row per organization",
          "dbt_mapping.user_id_to_org_id: one row per user-organization membership",
          "user organization membership",
        ].join("\n"),
        toolCalls: ["search-bigquery-schema"],
        ok: true,
        runId: "eval:unknown-membership-relation-fixture",
        durationMs: 0,
      }),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
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
      [cases[4]!],
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

  it("keeps a positive grain when only an alternative grain is negated", async () => {
    const report = await runEvals(
      [cases[0]!],
      runnerFor({
        text: [
          "dbt_mart.dim_users_core: user grain, not organization grain",
          "dbt_mart.dim_organizations: organization grain",
          "dbt_intermediate.user_organization_role: membership grain",
          "user organization membership",
        ].join("\n"),
        toolCalls: ["search-bigquery-schema"],
        ok: true,
        runId: "eval:negated-alternative-grain-fixture",
        durationMs: 0,
      }),
      { persist: false },
    );

    expect(report).toMatchObject({ total: 1, passed: 1, failed: 0 });
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
    const missingUserGrain = await reportFor(
      "dbt_mart.dim_users_core: does not have user grain",
    );
    const notTrueUserGrain = await reportFor(
      "dbt_mart.dim_users_core: not a true user grain",
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
    expect(missingUserGrain).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(notTrueUserGrain).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(descriptiveNo).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(negative.results[0]?.scores[0]?.reason).toContain(
      "dbt_mart.dim_users_core did not declare its expected user grain",
    );
  });

  it("checks every grain mention and catches common negation forms", async () => {
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
          runId: "eval:multiple-grain-mentions-fixture",
          durationMs: 0,
        }),
        { persist: false },
      );

    const positiveAfterNegation = await reportFor(
      "dbt_mart.dim_users_core: not user grain; user grain",
    );
    const competingGrainAfterNegation = await reportFor(
      "dbt_mart.dim_users_core: user grain; not organization grain; organization grain",
    );
    const contraction = await reportFor(
      "dbt_mart.dim_users_core: doesn't have user grain",
    );
    const hedgedNegation = await reportFor(
      "dbt_mart.dim_users_core: user grain is definitely not the declared grain",
    );
    const parentheticalNegation = await reportFor(
      "dbt_mart.dim_users_core: user grain (not the declared grain)",
    );
    const directNegations = await Promise.all(
      [
        "user grain is not correct",
        "user grain is not declared",
        "user grain does not match the declared grain",
      ].map((claim) => reportFor(`dbt_mart.dim_users_core: ${claim}`)),
    );

    expect(positiveAfterNegation).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0,
    });
    expect(competingGrainAfterNegation).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
    });
    expect(contraction).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(hedgedNegation).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(parentheticalNegation).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
    });
    for (const report of directNegations) {
      expect(report).toMatchObject({ total: 1, passed: 0, failed: 1 });
    }
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
      [cases[3]!],
      runnerFor(
        outputFor(sourceContracts.builderProductActivity, {
          text: "fact_builder_activity: activity grain",
        }),
      ),
      { persist: false },
    );
    const userReport = await runEvals(
      [cases[4]!],
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
