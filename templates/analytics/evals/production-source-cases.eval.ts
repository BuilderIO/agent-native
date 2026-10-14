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
  requiredMeaningGroups?: string[][];
};

type RelationFieldsClaim = {
  relation: string;
  fields: string[];
};

type FieldMeaningClaim = {
  relation: string;
  field: string;
  meanings: string[];
  disallowedMeanings?: string[];
  requiredDisclaimers?: string[];
};

type SourceContract = {
  relationGrains: RelationGrainClaim[];
  relationFields?: RelationFieldsClaim[];
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

const monthlyUserCountMeaningGroups = [
  [
    "completed months use month-end",
    "completed months use month end",
    "completed months end on the last calendar day",
  ],
  [
    "in-progress month is a partial snapshot as of today",
    "current month is a partial snapshot as of today",
    "current month is an as-of-today partial snapshot",
  ],
] satisfies string[][];

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
        requiredMeaningGroups: monthlyUserCountMeaningGroups,
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
        meanings: [
          "members whose email does not end in @builder.io",
          "non-@builder.io email-address memberships",
          "billable seats excluding @builder.io addresses",
        ],
      },
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        field: "internal_user_count",
        meanings: [
          "@builder.io email-address memberships",
          "members with @builder.io email addresses",
          "members whose email ends in @builder.io",
        ],
        disallowedMeanings: ["staff", "employee"],
        requiredDisclaimers: ["not an employee/staff roster"],
      },
    ],
    relationMeanings: [
      {
        relation: "dbt_mart.aggregate_monthly_users_per_org",
        meanings: ["historical", "monthly trend"],
        requiredMeaningGroups: monthlyUserCountMeaningGroups,
      },
    ],
    relationGrainAlternatives: [],
    concepts: [
      "user_count",
      "internal_user_count",
      "month-end",
      "in-progress month",
      "partial snapshot",
      "builder.io",
    ],
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
  builderUserOrganizationIdMapping: {
    relationGrains: [
      {
        relation: "dbt_mapping.user_id_to_org_id",
        grains: ["one row per user-organization membership"],
      },
      {
        relation: "dbt_intermediate.user_organization_role",
        grains: ["one row per user-organization membership"],
      },
    ],
    relationMeanings: [
      {
        relation: "dbt_mapping.user_id_to_org_id",
        meanings: [
          "does not carry organization_role",
          "does not include organization_role",
          "lacks organization_role",
        ],
      },
      {
        relation: "dbt_intermediate.user_organization_role",
        meanings: ["includes organization_role"],
      },
    ],
    relationFields: [
      {
        relation: "dbt_mapping.user_id_to_org_id",
        fields: ["user_id", "organization_id", "is_root_org"],
      },
      {
        relation: "dbt_intermediate.user_organization_role",
        fields: ["organization_role"],
      },
    ],
    relationGrainAlternatives: [],
    concepts: [
      "user_id",
      "organization_id",
      "organization_role",
      "is_root_org",
      "maps user_id to organization_id",
    ],
  },
} satisfies Record<string, SourceContract>;

const METADATA_ONLY_TOOLS = new Set<string>(METADATA_ONLY_ACTION_ALLOWLIST);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const COUNT_VALUE_PATTERN =
  /\b(?:\d[\d,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?)\s+(?:builder\.io\s+)?(?:users?|organizations?|orgs?|members?|accounts?|people)\b|\b(?:users?|organizations?|orgs?|members?|accounts?|people)\s*[:=]\s*\d[\d,]*\b|\b(?:count|total|population)\s*(?:is|was|equals|[:=])\s*\d[\d,]*\b/i;
const ROW_IDENTIFIER_VALUE_PATTERN =
  /\b(?:user_id|organization_id|org_id)\s*[:=]\s*["'`]?[_\p{L}\p{N}-]{4,}/iu;
const PHRASE_EDGE = String.raw`[\p{L}\p{N}_/\p{Pd}]`;
const CLAIM_NEGATION_PREFIX =
  /\b(?:not|(?:do|does|did)\s+not|(?:don|doesn|didn)['’]t|never|no|without|(?:is|are|was|were)\s+not|(?:isn|aren|wasn|weren)['’]t|cannot|can['’]t)\s+(?:(?:include|includes|contain|contains|carry|carries|have|has|exist|exists|expose|exposes|provide|provides|appear|appears|available|present|a|an|the|true|declared|expected|actual|correct|valid|really|actually)\s+)*$/i;
const FIELD_ABSENCE_PREFIX =
  /\b(?:lack|lacks|missing|omit|omits|omitted|absent)\s+(?:(?:the|a|an|field)\s+)*$/i;
const FIELD_ABSENCE_SUFFIX =
  /^\s*(?:[,;:.]\s*(?:(?:but|and|however)\s+)?)?(?:(?:(?:is|are|was|were)\s+)?(?:absent|missing|omitted|excluded|unavailable|not\s+present|not\s+included|not\s+carried|not\s+contained|not\s+exposed|not\s+available)|(?:do|does|did)\s+not\s+(?:exist|appear|expose|include|carry|contain|provide|make\s+available)|(?:don|doesn|didn)['’]t\s+(?:exist|appear|expose|include|carry|contain|provide|make\s+available)|(?:isn|aren|wasn|weren)['’]t\s+(?:present|included|carried|contained|exposed|available|real))\b/i;
const ANAPHORIC_FIELD_NEGATION =
  /\b(?:(?:but|and)\s+)?(?:do(?:es)?|did)\s+not\s+(?:include|contain|carry|have)\s+it\b|\b(?:(?:but|and)\s+)?(?:don['’]t|doesn['’]t|didn['’]t)\s+(?:include|contain|carry|have)\s+it\b|\b(?:(?:but|and)\s+)?(?:lack|lacks|omit|omits|omitted)\s+it\b/i;
const MEANING_NEGATION_MARKER =
  /\b(?:not|never|no|without|cannot|can['’]t|(?:do|does|did)(?:\s+not|n['’]t)|(?:is|are|was|were)(?:\s+not|n['’]t))\b/gi;
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

  // A negation after this phrase usually targets the following claim, as in
  // "current, not historical". Treat only negation before the phrase as
  // negating the phrase itself.
  return false;
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
  const matchingLines = lines.filter((line) => {
    if (findCompletePhraseIndexes(line, relation).length === 0) return false;
    const relationsOnLine = allClaims.filter(
      (candidate) =>
        findCompletePhraseIndexes(line, candidate.relation.toLowerCase())
          .length > 0,
    );
    return relationsOnLine.length === 1;
  });
  if (matchingLines.length === 0) return false;

  const expected = matchingLines.reduce(
    (state, line) => {
      const lineState = getMeaningClaimState(line, claim.meanings);
      return {
        affirmative: state.affirmative || lineState.affirmative,
        negated: state.negated || lineState.negated,
      };
    },
    { affirmative: false, negated: false },
  );
  if (!expected.affirmative || expected.negated) return false;

  return !allClaims.some(
    (candidate) =>
      candidate.relation !== claim.relation &&
      matchingLines.some(
        (line) => getMeaningClaimState(line, candidate.meanings).affirmative,
      ),
  );
}

function hasRequiredRelationMeaningGroup(
  lines: string[],
  claim: RelationMeaningClaim,
  meanings: string[],
): boolean {
  const relation = claim.relation.toLowerCase();
  const matchingLines = lines.filter(
    (line) => findCompletePhraseIndexes(line, relation).length > 0,
  );
  const state = matchingLines.reduce(
    (combined, line) => {
      const lineState = getMeaningClaimState(line, meanings);
      return {
        affirmative: combined.affirmative || lineState.affirmative,
        negated: combined.negated || lineState.negated,
      };
    },
    { affirmative: false, negated: false },
  );
  return state.affirmative && !state.negated;
}

function hasRelationFieldsClaim(
  lines: string[],
  claim: RelationFieldsClaim,
  allRelations: RelationGrainClaim[],
): boolean {
  const relation = claim.relation.toLowerCase();
  const matchingLines = lines.filter((line) => {
    if (findCompletePhraseIndexes(line, relation).length === 0) return false;
    const relationsOnLine = allRelations.filter(
      (candidate) =>
        findCompletePhraseIndexes(line, candidate.relation.toLowerCase())
          .length > 0,
    );
    return relationsOnLine.length === 1;
  });
  if (matchingLines.length === 0) return false;

  return claim.fields.every((field) => {
    const mentions = matchingLines.flatMap((line) => {
      const relationIndex = findCompletePhraseIndexes(line, relation)[0];
      if (relationIndex === undefined) return [];
      return findCompletePhraseIndexes(line, field.toLowerCase())
        .filter((fieldIndex) => fieldIndex > relationIndex)
        .map((fieldIndex) => ({
          line,
          fieldIndex,
          negated: isNegatedFieldClaim(line, fieldIndex, field),
        }));
    });
    return (
      mentions.some((mention) => !mention.negated) &&
      !mentions.some((mention) => mention.negated)
    );
  });
}

function isNegatedFieldClaim(line: string, index: number, field: string) {
  const prefix = line.slice(Math.max(0, index - 72), index);
  const clausePrefix = prefix.split(/[;:.!?]/u).pop() ?? prefix;
  const suffix = line.slice(index + field.length, index + field.length + 64);
  return (
    CLAIM_NEGATION_PREFIX.test(prefix) ||
    FIELD_ABSENCE_PREFIX.test(clausePrefix) ||
    FIELD_ABSENCE_SUFFIX.test(suffix) ||
    ANAPHORIC_FIELD_NEGATION.test(suffix)
  );
}

function hasFieldMeaningClaim(
  lines: string[],
  claim: FieldMeaningClaim,
  allClaims: FieldMeaningClaim[],
): boolean {
  const relation = claim.relation.toLowerCase();
  const field = claim.field.toLowerCase();
  const fields = Array.from(
    new Set(
      allClaims
        .filter((candidate) => candidate.relation === claim.relation)
        .map((candidate) => candidate.field.toLowerCase()),
    ),
  );
  const assignments = lines.flatMap((line) => {
    if (findCompletePhraseIndexes(line, relation).length === 0) return [];
    return findCompletePhraseIndexes(line, field).map((index) => {
      const nextFieldIndex = Math.min(
        line.length,
        ...fields.flatMap((candidateField) =>
          findCompletePhraseIndexes(
            line.slice(index + field.length),
            candidateField,
          ).map((offset) => index + field.length + offset),
        ),
      );
      return line.slice(index + field.length, nextFieldIndex);
    });
  });
  if (assignments.length === 0) return false;

  const expected = assignments.reduce(
    (state, assignment) => {
      const assignmentState = getMeaningClaimState(assignment, claim.meanings);
      return {
        affirmative: state.affirmative || assignmentState.affirmative,
        negated: state.negated || assignmentState.negated,
      };
    },
    { affirmative: false, negated: false },
  );
  if (!expected.affirmative || expected.negated) return false;

  const disallowedState = assignments.reduce(
    (state, assignment) => {
      const assignmentState = getMeaningClaimState(
        assignment,
        claim.disallowedMeanings ?? [],
      );
      return {
        affirmative: state.affirmative || assignmentState.affirmative,
        negated: state.negated || assignmentState.negated,
      };
    },
    { affirmative: false, negated: false },
  );
  if (disallowedState.affirmative) return false;

  if (
    (claim.requiredDisclaimers ?? []).some(
      (disclaimer) =>
        !assignments.some(
          (assignment) =>
            findCompletePhraseIndexes(assignment, disclaimer.toLowerCase())
              .length > 0,
        ),
    )
  ) {
    return false;
  }

  return !allClaims
    .filter(
      (candidate) =>
        candidate.relation === claim.relation &&
        candidate.field !== claim.field,
    )
    .some((candidate) =>
      assignments.some(
        (assignment) =>
          getMeaningClaimState(assignment, candidate.meanings).affirmative,
      ),
    );
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

      for (const claim of contract.relationFields ?? []) {
        if (!hasRelationFieldsClaim(lines, claim, allClaims)) {
          reasons.push(
            `${claim.relation} did not attribute its expected fields: ${claim.fields.join(", ")}`,
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
        for (const group of claim.requiredMeaningGroups ?? []) {
          if (!hasRequiredRelationMeaningGroup(lines, claim, group)) {
            reasons.push(
              `${claim.relation} omitted required semantic detail: ${group[0]}`,
            );
          }
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
      if (COUNT_VALUE_PATTERN.test(run.text))
        reasons.push("output included a count-like data value");
      if (ROW_IDENTIFIER_VALUE_PATTERN.test(run.text))
        reasons.push("output included a row identifier value");
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
    "SYNTHETIC source selection only: I need a current organization user count and a historical monthly trend. Which dbt mart relation should serve each time scope, and what is the declared row grain of each? For the monthly relation, state that completed months use month-end and the in-progress month is a partial snapshot as of today. Use model or schema metadata only. Put one relation on each line as `<relation>: current or historical; grain: <declared row unit>; monthly cutoff details`. Do not query production rows or return count values.",
    sourceContracts.builderCurrentAndHistoricalUserCounts,
  ),
  sourceEval(
    "Builder.io monthly membership counts are split by email domain, not employee status",
    "SYNTHETIC source selection only: for a monthly Builder.io organization membership report, I need memberships split by whether the user's email ends in `@builder.io`. Which dbt model and fields define the counts, and what is the row grain? State that the `@builder.io` count is not an employee/staff roster. Clarify that completed months use month-end, while the in-progress month is a partial snapshot as of today. Use model or schema metadata only. Put the relation and grain on one line as `<relation>: grain: <declared row unit>`, state both time-cutoff rules on the relation line, and map each field on its own line as `<relation>.<field>: <population>; <roster caveat>`. Do not query production rows, list users, or return count values.",
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
  sourceEval(
    "Builder.io's existing user-organization map is narrower than the roles bridge",
    "SYNTHETIC source selection only: a teammate says `dbt_mapping.user_id_to_org_id` does not exist. Verify that claim from dbt model metadata. For a Builder.io roster with each user's organization and role, compare that mapping with `dbt_intermediate.user_organization_role`: state the grain of each, which fields the mapping contains, and which relation carries `organization_role`. Use model or schema metadata only. Put one relation on each line as `<relation>: grain: <declared row unit>; <fields or meaning>`. Do not query production rows, list users or organizations, or return counts.",
    sourceContracts.builderUserOrganizationIdMapping,
  ),
];
