import {
  createScorer,
  defineEval,
  type AgentRunOutput,
  type Scorer,
} from "@agent-native/core/eval";

type RelationGrainClaim = {
  relation: string;
  grains: string[];
};

type SourceContract = {
  relationGrains: RelationGrainClaim[];
  relationGrainAlternatives: Array<{
    label: string;
    alternatives: RelationGrainClaim[];
  }>;
  concepts: string[];
};

export const METADATA_ONLY_ACTION_ALLOWLIST = [
  "data-source-status",
  "find-data",
  "search-bigquery-schema",
  "tool-search",
] as const;

export const sourceContracts = {
  builderUsersByOrganization: {
    relationGrains: [
      {
        relation: "dbt_mart.dim_users_core",
        grains: ["user grain", "one row per user"],
      },
      {
        relation: "dbt_mart.dim_organizations",
        grains: ["organization grain", "one row per organization"],
      },
    ],
    relationGrainAlternatives: [
      {
        label: "user-organization membership bridge",
        alternatives: [
          {
            relation: "dbt_intermediate.user_organization_role",
            grains: [
              "membership grain",
              "one row per user-organization membership",
            ],
          },
          {
            relation: "dbt_mapping.user_id_to_org_id",
            grains: [
              "membership grain",
              "one row per user-organization membership",
            ],
          },
        ],
      },
    ],
    concepts: ["user", "organization", "membership"],
  },
  builderProductActivity: {
    relationGrains: [
      {
        relation: "fact_builder_activity",
        grains: [
          "one row per (event_date, user_id, org_id, event_type)",
          "one row per user per day per org per builder-activity event",
        ],
      },
    ],
    relationGrainAlternatives: [],
    concepts: ["user", "day", "org", "builder-activity event"],
  },
  agentNativeUsersAndEvents: {
    relationGrains: [
      {
        relation: "dim_agent_native_users",
        grains: ["user/email grain", "one row per user/email"],
      },
      {
        relation: "stg_analytics__first_party_events",
        grains: ["event grain", "one row per event"],
      },
    ],
    relationGrainAlternatives: [],
    concepts: ["user", "email", "event"],
  },
  connectEvents: {
    relationGrains: [
      {
        relation: "stg_analytics__first_party_events",
        grains: ["event grain", "one row per event"],
      },
      {
        relation: "first_party_analytics_events_raw",
        grains: ["event grain", "one row per event"],
      },
    ],
    relationGrainAlternatives: [],
    concepts: ["connect", "event"],
  },
} satisfies Record<string, SourceContract>;

const METADATA_ONLY_TOOLS = new Set<string>(METADATA_ONLY_ACTION_ALLOWLIST);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function hasRelationGrainClaim(
  lines: string[],
  claim: RelationGrainClaim,
  allRelations: string[],
): boolean {
  const relation = claim.relation.toLowerCase();
  const matchingLines = lines.filter((line) => line.includes(relation));
  return matchingLines.some((line) => {
    const relationsOnLine = allRelations.filter((name) =>
      line.includes(name.toLowerCase()),
    );
    return (
      relationsOnLine.length === 1 &&
      claim.grains.some((grain) => line.includes(grain.toLowerCase()))
    );
  });
}

function sourceContractScorer(
  contract: SourceContract,
): Scorer<AgentRunOutput, { passed: boolean; reasons: string[] }> {
  return createScorer<AgentRunOutput, { passed: boolean; reasons: string[] }>({
    name: "exact_source_grains_and_safe_metadata",
    analyze(run) {
      const text = run.text.toLowerCase();
      const lines = text.split(/\r?\n/).map((line) => line.trim());
      const reasons: string[] = [];
      const allClaims = [
        ...contract.relationGrains,
        ...contract.relationGrainAlternatives.flatMap(
          (group) => group.alternatives,
        ),
      ];
      const allRelations = allClaims.map((claim) => claim.relation);
      for (const claim of contract.relationGrains) {
        if (!hasRelationGrainClaim(lines, claim, allRelations)) {
          reasons.push(
            `${claim.relation} did not declare its expected ${claim.grains[0]}`,
          );
        }
      }

      for (const group of contract.relationGrainAlternatives) {
        if (
          !group.alternatives.some((claim) =>
            hasRelationGrainClaim(lines, claim, allRelations),
          )
        ) {
          reasons.push(`missing ${group.label} with its expected grain`);
        }
      }

      const missingConcepts = contract.concepts.filter(
        (term) => !text.includes(term),
      );
      if (missingConcepts.length > 0) {
        reasons.push(
          `missing grain/source concepts: ${missingConcepts.join(", ")}`,
        );
      }

      const unsafeTools = run.toolCalls.filter(
        (tool) => !METADATA_ONLY_TOOLS.has(tool),
      );
      if (unsafeTools.length > 0) {
        reasons.push(`used non-metadata tools: ${unsafeTools.join(", ")}`);
      }
      if (EMAIL_PATTERN.test(run.text))
        reasons.push("output included an email address");
      if (!run.ok || run.error)
        reasons.push("production run failed or was aborted");

      return { passed: reasons.length === 0, reasons };
    },
    generateScore({ passed }) {
      return passed ? 1 : 0;
    },
    generateReason({ analysis }) {
      return analysis.reasons.length === 0
        ? "Expected dbt sources and grains were identified using metadata only."
        : analysis.reasons.join("; ");
    },
  });
}

function sourceEval(name: string, prompt: string, contract: SourceContract) {
  return defineEval({
    name: `SYNTHETIC: ${name}`,
    input: { prompt },
    threshold: 1,
    actionAllowlist: METADATA_ONLY_ACTION_ALLOWLIST,
    scorers: [sourceContractScorer(contract)],
  });
}

export default [
  sourceEval(
    "Builder.io product users by organization use the dbt membership bridge",
    "SYNTHETIC source selection only: I am designing a Builder.io product report that will count distinct product users per organization. Which canonical dbt user and organization relations and membership bridge should define the join, and what is each relation's grain? Use model or schema metadata only. Put one relation on each line as `<relation>: grain: <declared row unit>`. Do not query production rows, list users or organizations, or return counts.",
    sourceContracts.builderUsersByOrganization,
  ),
  sourceEval(
    "Builder.io product activity uses its activity fact",
    "SYNTHETIC source selection only: a proposed report concerns Builder.io product activity rather than user or workspace membership. Which dbt fact should supply product activity, and what grain does its model declare? Use model or schema metadata only. Put one relation on each line as `<relation>: grain: <declared row unit>`. Do not query activity rows or return counts.",
    sourceContracts.builderProductActivity,
  ),
  sourceEval(
    "Agent-Native users and events are separate from Builder.io users",
    "SYNTHETIC source selection only: here, users means people using the Agent-Native product. Which dbt dimension defines those users by email, and which dbt staging model is the first-party Analytics event source? Explain the user and event grains. Use model or schema metadata only. Put one relation on each line as `<relation>: grain: <declared row unit>`. Do not list user identities, event rows, or counts.",
    sourceContracts.agentNativeUsersAndEvents,
  ),
  sourceEval(
    "Connect product events are Analytics telemetry, not Builder.io user counts",
    "SYNTHETIC source selection only: Connect usage here means Analytics first-party Connect setup events, not Builder.io product account membership. Identify the dbt staging model and its upstream Connect dashboard event source, then state the event row grain. Use model or schema metadata only. Put one relation on each line as `<relation>: grain: <declared row unit>`. Do not query events or return counts.",
    sourceContracts.connectEvents,
  ),
];
