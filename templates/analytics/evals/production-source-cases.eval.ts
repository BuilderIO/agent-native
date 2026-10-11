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

type RelationMeaningClaim = {
  relation: string;
  meanings: string[];
};

type FieldMeaningClaim = {
  relation: string;
  field: string;
  meanings: string[];
};

type SourceContract = {
  relationGrains: RelationGrainClaim[];
  relationMeanings?: RelationMeaningClaim[];
  fieldMeanings?: FieldMeaningClaim[];
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
        ],
      },
    ],
    concepts: ["user", "organization", "membership"],
  },
  builderCurrentAndHistoricalUserCounts: {
    relationGrains: [
      {
        relation: "dbt_mart.organization_user_count",
        grains: [
          "one row per organization per date",
          "organization by date grain",
        ],
      },
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        grains: [
          "one row per organization per month",
          "organization by month grain",
        ],
      },
    ],
    relationMeanings: [
      {
        relation: "dbt_mart.organization_user_count",
        meanings: ["current", "daily"],
      },
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        meanings: ["historical", "month-end", "monthly trend"],
      },
    ],
    relationGrainAlternatives: [],
    concepts: ["current", "historical", "date", "month"],
  },
  builderExternalAndInternalUserCounts: {
    relationGrains: [
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        grains: [
          "one row per organization per month",
          "organization by month grain",
        ],
      },
    ],
    fieldMeanings: [
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        field: "user_count",
        meanings: ["external", "customer", "product users"],
      },
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        field: "internal_user_count",
        meanings: ["internal", "staff", "employee"],
      },
    ],
    relationGrainAlternatives: [],
    concepts: ["user_count", "internal_user_count", "month-end", "builder.io"],
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
const PHRASE_EDGE = String.raw`[\p{L}\p{N}_/\p{Pd}]`;
const CLAIM_NEGATION_PREFIX =
  /\b(?:not|(?:do|does|did)\s+not|(?:don|doesn|didn)['’]t|never|no|(?:is|are|was|were)\s+not|(?:isn|aren|wasn|weren)['’]t|cannot|can['’]t)\s+(?:(?:have|has|a|an|the|true|declared|expected|actual|correct|valid|really|actually)\s+)*$/i;
const MEANING_NEGATION_MARKER =
  /\b(?:not|never|no|cannot|can['’]t|(?:do|does|did)(?:\s+not|n['’]t)|(?:is|are|was|were)(?:\s+not|n['’]t))\b/gi;
const MEANING_NEGATION_SUFFIX =
  /^\s*(?:[,;:]\s*)?(?:(?:but|which|however|this|it|that)\s+)*(?:(?:is|are|was|were|do|does|did|can|should|would)\s+)?(?:(?:a|an|the|true|declared|expected|actual|correct|valid|really|actually)\s+)*(?:not|never|cannot|can['’]t)\b/i;
const GRAIN_NEGATION_MARKER = String.raw`(?:not|never|(?:(?:don|doesn|didn|isn|aren|wasn|weren)['’]t)|cannot|can['’]t)`;
const GRAIN_NEGATION_ADVERBS = String.raw`(?:(?:actually|clearly|definitely|explicitly|likely|necessarily|perhaps|probably|really|truly)\s+)*`;
const GRAIN_NEGATION_TARGET = String.raw`(?:(?:(?:a|an|the)\s+)?(?:declared|expected|actual|correct|true|valid)(?:\s+grain)?\b|(?:match(?:es)?|equal(?:s)?|represent(?:s)?|define(?:s)?|describe(?:s)?|reflect(?:s)?|correspond(?:s)?(?:\s+to)?)\s+(?:(?:a|an|the)\s+)?(?:(?:declared|expected|actual|correct|true|valid)\s+)?(?:grain|row unit)\b)`;
const GRAIN_NEGATION_SUFFIX = new RegExp(
  String.raw`^\s*(?:\(\s*)?(?:(?:is|are|was|were|do|does|did)\s+)?${GRAIN_NEGATION_ADVERBS}${GRAIN_NEGATION_MARKER}\s+${GRAIN_NEGATION_TARGET}`,
  "i",
);
const GRAIN_NEGATION_CLAUSE = new RegExp(
  String.raw`^[,;:.]\s*(?:(?:but|which|however)\s+)?(?:(?:this|it|that|the model|the table|the relation)\s+)?(?:(?:is|are|was|were|do|does|did)\s+)?${GRAIN_NEGATION_ADVERBS}${GRAIN_NEGATION_MARKER}\s+${GRAIN_NEGATION_TARGET}`,
  "i",
);

function findCompletePhraseIndexes(text: string, phrase: string): number[] {
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `(?<!${PHRASE_EDGE})${escapedPhrase}(?!${PHRASE_EDGE})`,
    "gu",
  );
  return Array.from(text.matchAll(expression), (match) => match.index);
}

function isNegatedGrainClaim(line: string, index: number, phrase: string) {
  const prefix = line.slice(Math.max(0, index - 64), index);
  const suffix = line.slice(index + phrase.length, index + phrase.length + 112);
  return (
    CLAIM_NEGATION_PREFIX.test(prefix) ||
    GRAIN_NEGATION_SUFFIX.test(suffix) ||
    GRAIN_NEGATION_CLAUSE.test(suffix)
  );
}

function isNegatedMeaningClaim(line: string, index: number, phrase: string) {
  const prefix = line.slice(Math.max(0, index - 72), index);
  if (CLAIM_NEGATION_PREFIX.test(prefix)) return true;

  const clausePrefix = prefix.split(/[,;:.!?]/u).at(-1) ?? prefix;
  const negationMarkers = Array.from(
    clausePrefix.matchAll(MEANING_NEGATION_MARKER),
  );
  const lastNegation = negationMarkers.at(-1);
  if (lastNegation?.index !== undefined) {
    const interveningText = clausePrefix.slice(
      lastNegation.index + lastNegation[0].length,
    );
    if (
      interveningText.length <= 56 &&
      !/\b(?:but|however|instead|rather|yet|although|only)\b/i.test(
        interveningText,
      )
    ) {
      return true;
    }
  }

  const suffix = line.slice(index + phrase.length, index + phrase.length + 96);
  return MEANING_NEGATION_SUFFIX.test(suffix);
}

function getMeaningClaimState(text: string, meanings: string[]) {
  let affirmative = false;
  let negated = false;
  for (const meaning of meanings) {
    const phrase = meaning.toLowerCase();
    for (const index of findCompletePhraseIndexes(text, phrase)) {
      if (isNegatedMeaningClaim(text, index, phrase)) negated = true;
      else affirmative = true;
    }
  }
  return { affirmative, negated };
}

function hasRelationGrainClaim(
  lines: string[],
  claim: RelationGrainClaim,
  allClaims: RelationGrainClaim[],
): boolean {
  const relation = claim.relation.toLowerCase();
  const matchingLines = lines.filter(
    (line) => findCompletePhraseIndexes(line, relation).length > 0,
  );
  return matchingLines.some((line) => {
    const relationsOnLine = allClaims.filter(
      (candidate) =>
        findCompletePhraseIndexes(line, candidate.relation.toLowerCase())
          .length > 0,
    );
    if (relationsOnLine.length !== 1) return false;

    const expectedGrain = claim.grains[0]?.toLowerCase();
    if (!expectedGrain) return false;
    const competingGrain = allClaims.some(
      (candidate) =>
        candidate.grains[0]?.toLowerCase() !== expectedGrain &&
        candidate.grains.some((grain) => {
          const phrase = grain.toLowerCase();
          return findCompletePhraseIndexes(line, phrase).some(
            (index) => !isNegatedGrainClaim(line, index, phrase),
          );
        }),
    );
    if (competingGrain) return false;

    return claim.grains.some((grain) => {
      const phrase = grain.toLowerCase();
      return findCompletePhraseIndexes(line, phrase).some(
        (index) => !isNegatedGrainClaim(line, index, phrase),
      );
    });
  });
}

function hasRelationMeaningClaim(
  lines: string[],
  claim: RelationMeaningClaim,
  allClaims: RelationMeaningClaim[],
): boolean {
  const relation = claim.relation.toLowerCase();
  return lines.some((line) => {
    if (findCompletePhraseIndexes(line, relation).length === 0) return false;
    const relationsOnLine = allClaims.filter(
      (candidate) =>
        findCompletePhraseIndexes(line, candidate.relation.toLowerCase())
          .length > 0,
    );
    if (relationsOnLine.length !== 1) return false;

    const expected = getMeaningClaimState(line, claim.meanings);
    if (!expected.affirmative || expected.negated) return false;
    return !allClaims.some(
      (candidate) =>
        candidate.relation !== claim.relation &&
        getMeaningClaimState(line, candidate.meanings).affirmative,
    );
  });
}

function hasFieldMeaningClaim(
  lines: string[],
  claim: FieldMeaningClaim,
  allClaims: FieldMeaningClaim[],
): boolean {
  const relation = claim.relation.toLowerCase();
  const field = claim.field.toLowerCase();
  const otherFields = allClaims
    .filter(
      (candidate) =>
        candidate.relation === claim.relation &&
        candidate.field !== claim.field,
    )
    .map((candidate) => candidate.field.toLowerCase());
  return lines.some((line) => {
    if (findCompletePhraseIndexes(line, relation).length === 0) return false;
    return findCompletePhraseIndexes(line, field).some((index) => {
      const nextFieldIndex = Math.min(
        line.length,
        ...otherFields.flatMap((otherField) =>
          findCompletePhraseIndexes(
            line.slice(index + field.length),
            otherField,
          ).map((offset) => index + field.length + offset),
        ),
      );
      const assignment = line.slice(index + field.length, nextFieldIndex);
      const expected = getMeaningClaimState(assignment, claim.meanings);
      if (!expected.affirmative || expected.negated) return false;
      const competing = allClaims
        .filter(
          (candidate) =>
            candidate.relation === claim.relation &&
            candidate.field !== claim.field,
        )
        .some(
          (candidate) =>
            getMeaningClaimState(assignment, candidate.meanings).affirmative,
        );
      return !competing;
    });
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
      for (const claim of contract.relationGrains) {
        if (!hasRelationGrainClaim(lines, claim, allClaims)) {
          reasons.push(
            `${claim.relation} did not declare its expected ${claim.grains[0]}`,
          );
        }
      }

      for (const group of contract.relationGrainAlternatives) {
        if (
          !group.alternatives.some((claim) =>
            hasRelationGrainClaim(lines, claim, allClaims),
          )
        ) {
          reasons.push(`missing ${group.label} with its expected grain`);
        }
      }

      for (const claim of contract.relationMeanings ?? []) {
        if (
          !hasRelationMeaningClaim(
            lines,
            claim,
            contract.relationMeanings ?? [],
          )
        ) {
          reasons.push(
            `${claim.relation} was not assigned to its expected ${claim.meanings[0]} time scope`,
          );
        }
      }

      for (const claim of contract.fieldMeanings ?? []) {
        if (!hasFieldMeaningClaim(lines, claim, contract.fieldMeanings ?? [])) {
          reasons.push(
            `${claim.relation}.${claim.field} was not mapped to its expected population`,
          );
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
    "Builder.io user roster and roles use the dbt membership bridge",
    "SYNTHETIC source selection only: I am designing a Builder.io product roster with each user's organization and role. Which canonical dbt user and organization relations and membership bridge should define the join, and what is each relation's grain? Use model or schema metadata only. Put one relation on each line as `<relation>: grain: <declared row unit>`. Do not query production rows, list users or organizations, or return counts.",
    sourceContracts.builderUsersByOrganization,
  ),
  sourceEval(
    "Builder.io current and historical organization user counts have different grains",
    "SYNTHETIC source selection only: I need a current organization user count and a historical month-end trend. Which dbt mart relation should serve each time scope, and what is the declared row grain of each? Use model or schema metadata only. Put one relation on each line as `<relation>: current or historical; grain: <declared row unit>`. Do not query production rows or return count values.",
    sourceContracts.builderCurrentAndHistoricalUserCounts,
  ),
  sourceEval(
    "Builder.io month-end customer and internal user counts are separate",
    "SYNTHETIC source selection only: for a month-end organization report, I need external Builder.io product users and Builder staff users shown separately. Which dbt model and fields define those counts, and what is its row grain? Use model or schema metadata only. Put the relation and grain on one line as `<relation>: grain: <declared row unit>`, then map each field on its own line as `<relation>.<field>: <population>`. Do not query production rows, list users, or return count values.",
    sourceContracts.builderExternalAndInternalUserCounts,
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
