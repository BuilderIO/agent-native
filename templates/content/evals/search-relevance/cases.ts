/**
 * Judged queries against the invented corpus in corpus.ts. Every
 * `expectFirst` / `acceptableTop3` value is a corpus document `key`, never a
 * generated document id — the runner resolves keys to ids after seeding.
 *
 * For the `access` class, `expectFirst` / `acceptableTop3` name the
 * distractor document(s) that must never appear anywhere in the returned
 * page, not the expected top result. See README.md for the full scoring
 * contract.
 */

export type SearchEvalCaseClass =
  | "known-item"
  | "passage"
  | "typo"
  | "question"
  | "access";

export interface SearchEvalFilters {
  /** Logical space key, resolved to a real content space id by the runner. */
  spaceId?: "personal" | "org";
  documentType?: "page" | "database";
  searchFields?: "all" | "title";
}

export interface SearchEvalCase {
  id: string;
  class: SearchEvalCaseClass;
  query: string;
  filters?: SearchEvalFilters;
  expectFirst?: string;
  acceptableTop3?: string[];
  rationale: string;
}

export const searchRelevanceCases: SearchEvalCase[] = [
  // ---------------------------------------------------------------------
  // known-item (14)
  // ---------------------------------------------------------------------
  {
    id: "known-exact-title-task-priorities",
    class: "known-item",
    query: "Task Priorities",
    expectFirst: "task-priorities-collection",
    rationale: "Exact title match for the Task Priorities collection page.",
  },
  {
    id: "known-exact-title-q3-roadmap",
    class: "known-item",
    query: "Q3 roadmap",
    expectFirst: "q3-roadmap",
    rationale:
      "Exact title match must win over the near-duplicate (old) and review titles.",
  },
  {
    id: "known-exact-title-q3-roadmap-old",
    class: "known-item",
    query: "Q3 roadmap (old)",
    expectFirst: "q3-roadmap-old",
    rationale: "Exact title match for the superseded near-duplicate roadmap.",
  },
  {
    id: "known-exact-title-roadmap-review",
    class: "known-item",
    query: "Roadmap review Q3",
    expectFirst: "roadmap-review-q3",
    rationale: "Exact title match for the third near-duplicate roadmap title.",
  },
  {
    id: "known-partial-title-task-prio",
    class: "known-item",
    query: "task prio",
    expectFirst: "task-priorities-collection",
    rationale:
      'Partial title prefix ("task prio" is a prefix of "Task Priorities") should still surface the collection page first.',
  },
  {
    id: "known-swapped-word-order-sso-plan",
    class: "known-item",
    query: "rollout SSO enterprise plan",
    expectFirst: "sso-rollout-plan",
    rationale:
      'Title words reordered from "Enterprise SSO rollout plan"; only that document contains all four words.',
  },
  {
    id: "known-title-plus-body-word",
    class: "known-item",
    query: "postmortem webhook retries",
    expectFirst: "incident-postmortem-checkout",
    rationale:
      'Combines a title word ("postmortem") with distinctive body words ("webhook", "retries") unique to this document.',
  },
  {
    id: "known-exact-title-blog-post",
    class: "known-item",
    query: "Why we chose Postgres for analytics workloads",
    expectFirst: "postgres-analytics-blog",
    rationale: "Exact title match for a blog post row inside a collection.",
  },
  {
    id: "known-database-filter-task-priorities",
    class: "known-item",
    query: "priorities",
    filters: { documentType: "database" },
    expectFirst: "task-priorities-collection",
    rationale:
      "documentType=database should scope results to collection pages themselves, not member rows.",
  },
  {
    id: "known-spaceid-filter-personal-reading-list",
    class: "known-item",
    query: "reading list",
    filters: { spaceId: "personal" },
    expectFirst: "personal-reading-list-q3",
    rationale: "spaceId filter should scope the query to the personal space.",
  },
  {
    id: "known-title-only-filter-data-pipeline",
    class: "known-item",
    query: "data pipeline migration",
    filters: { searchFields: "title" },
    expectFirst: "data-pipeline-migration-plan",
    rationale:
      'searchFields="title" must exclude "Sprint 42 retro", which mentions the phrase only in its body.',
  },
  {
    id: "known-exact-title-spanish-refund-policy",
    class: "known-item",
    query: "Política de reembolsos para clientes empresariales",
    expectFirst: "spanish-refund-policy",
    rationale: "Exact accented-title match should work like any other title.",
  },
  {
    id: "known-exact-title-japanese-onboarding",
    class: "known-item",
    query: "オンボーディングガイド",
    expectFirst: "japanese-onboarding-guide",
    rationale: "Exact Japanese title match.",
  },
  {
    id: "known-ambiguous-single-word-roadmap",
    class: "known-item",
    query: "roadmap",
    filters: { spaceId: "org" },
    acceptableTop3: ["q3-roadmap", "q3-roadmap-old", "roadmap-review-q3"],
    rationale:
      "A single ambiguous word should surface one of the three near-duplicate roadmap docs in the top 3.",
  },

  // ---------------------------------------------------------------------
  // passage (9)
  // ---------------------------------------------------------------------
  {
    id: "passage-dynamodb-throttling",
    class: "passage",
    query: "silently throttling under bursty writes",
    expectFirst: "adr-009-postgres-over-dynamodb",
    rationale: "Verbatim phrase recalled from the ADR body.",
  },
  {
    id: "passage-join-heavy-queries",
    class: "passage",
    query: "join-heavy dashboard queries",
    expectFirst: "postgres-analytics-blog",
    rationale: "Verbatim phrase recalled from a blog post body.",
  },
  {
    id: "passage-duplicate-charges",
    class: "passage",
    query: "webhook retries created duplicate charges",
    expectFirst: "incident-postmortem-checkout",
    rationale: "Verbatim phrase recalled from the postmortem body.",
  },
  {
    id: "passage-onboarding-laptop-docker",
    class: "passage",
    query: "your laptop will already have Docker and the repo cloned",
    expectFirst: "new-engineer-onboarding-guide",
    rationale: "Verbatim phrase recalled from the onboarding guide body.",
  },
  {
    id: "passage-staged-rollout-10-percent",
    class: "passage",
    query: "we are staging the rollout at 10 percent for the first 48 hours",
    expectFirst: "mobile-launch-plan",
    rationale: "Verbatim phrase recalled from the launch plan body.",
  },
  {
    id: "passage-saml-jit-provisioning",
    class: "passage",
    query: "just-in-time provisioning for SAML assertions",
    expectFirst: "sso-integration-spec",
    rationale: "Verbatim phrase recalled from the SSO spec body.",
  },
  {
    id: "passage-shipped-four-times-faster",
    class: "passage",
    query: "shipped four times faster than Q1 without adding headcount",
    expectFirst: "q2-retro",
    rationale: "Verbatim phrase recalled from the Q2 retro body.",
  },
  {
    id: "passage-crdts-operational-transforms",
    class: "passage",
    query: "operational transforms gave way to CRDTs",
    expectFirst: "realtime-collab-blog",
    rationale: "Verbatim phrase recalled from a blog post body.",
  },
  {
    id: "passage-spanish-negotiation",
    class: "passage",
    query: "cerramos la negociación con el cliente más grande del trimestre",
    expectFirst: "spanish-sales-meeting-notes",
    rationale:
      "Verbatim accented Spanish phrase recalled from meeting notes body.",
  },

  // ---------------------------------------------------------------------
  // typo (6) — report-only; the substring-matching engine cannot correct
  // these, so most are expected to return zero results today.
  // ---------------------------------------------------------------------
  {
    id: "typo-priority",
    class: "typo",
    query: "prioirty",
    expectFirst: "task-priorities-collection",
    rationale: 'Misspelling of "priority" targeting the Task Priorities page.',
  },
  {
    id: "typo-roadmap",
    class: "typo",
    query: "roadmpa",
    expectFirst: "q3-roadmap",
    rationale: 'Misspelling of "roadmap" targeting the current Q3 roadmap.',
  },
  {
    id: "typo-onboarding",
    class: "typo",
    query: "onboadring guide",
    expectFirst: "new-engineer-onboarding-guide",
    rationale: 'Misspelling of "onboarding" targeting the onboarding guide.',
  },
  {
    id: "typo-postmortem",
    class: "typo",
    query: "posmortem checkout",
    expectFirst: "incident-postmortem-checkout",
    rationale: 'Misspelling of "postmortem" targeting the checkout incident.',
  },
  {
    id: "typo-billing",
    class: "typo",
    query: "billng v2 spec",
    expectFirst: "billing-v2-spec",
    rationale: 'Misspelling of "billing" targeting the billing v2 spec.',
  },
  {
    id: "typo-integration",
    class: "typo",
    query: "sso intergation spec",
    expectFirst: "sso-integration-spec",
    rationale: 'Misspelling of "integration" targeting the SSO spec.',
  },

  // ---------------------------------------------------------------------
  // question (9) — report-only; natural-language questions AND every word
  // together, so filler words rarely all appear in one document today.
  // ---------------------------------------------------------------------
  {
    id: "question-q3-hiring-plan",
    class: "question",
    query: "what document shows our Q3 hiring plan",
    expectFirst: "hiring-plan-q3",
    rationale: "Natural-language question about the Q3 hiring plan doc.",
  },
  {
    id: "question-blogs-about-pricing",
    class: "question",
    query: "get me blogs that talk about pricing",
    expectFirst: "pricing-blog",
    rationale: "Natural-language question about pricing-related blog posts.",
  },
  {
    id: "question-drop-safari-15",
    class: "question",
    query: "where did we decide to drop Safari 15 support",
    expectFirst: "adr-014-drop-safari-15",
    rationale: "Natural-language question about a specific decision record.",
  },
  {
    id: "question-migrating-off-dynamodb",
    class: "question",
    query: "what's our plan for migrating off DynamoDB",
    expectFirst: "adr-009-postgres-over-dynamodb",
    rationale:
      "Natural-language question about the DynamoDB migration decision.",
  },
  {
    id: "question-new-engineer-first-week",
    class: "question",
    query: "how do new engineers get set up in their first week",
    expectFirst: "new-engineer-onboarding-guide",
    rationale: "Natural-language question about onboarding.",
  },
  {
    id: "question-checkout-outage-cause",
    class: "question",
    query: "why did the checkout page go down last month",
    expectFirst: "incident-postmortem-checkout",
    rationale: "Natural-language question about the checkout incident.",
  },
  {
    id: "question-mobile-launch-learnings",
    class: "question",
    query: "what did we learn from the mobile launch",
    expectFirst: "launch-retro-mobile-v1",
    rationale: "Natural-language question about the mobile launch retro.",
  },
  {
    id: "question-oncall-this-quarter",
    class: "question",
    query: "who is on the hook for on-call this quarter",
    expectFirst: "oncall-rotation-q3",
    rationale: "Natural-language question about the on-call schedule.",
  },
  {
    id: "question-current-task-priorities",
    class: "question",
    query: "where can I find the current task priorities",
    expectFirst: "task-priorities-collection",
    rationale: "Natural-language question about the Task Priorities page.",
  },

  // ---------------------------------------------------------------------
  // access (5) — must always pass regardless of baseline.
  // ---------------------------------------------------------------------
  {
    id: "access-outsider-q3-roadmap",
    class: "access",
    query: "Cobalt Metrics Q3 roadmap priorities",
    expectFirst: "outsider-q3-roadmap",
    rationale:
      "The outsider's same-titled roadmap is the best textual match but must never appear for the eval owner.",
  },
  {
    id: "access-outsider-sso-spec",
    class: "access",
    query: "Cobalt Metrics SSO integration rollout",
    expectFirst: "outsider-sso-integration-spec",
    rationale:
      "The outsider's same-titled SSO spec is the best textual match but must never appear for the eval owner.",
  },
  {
    id: "access-hidden-compensation-bands",
    class: "access",
    query: "2026 compensation bands",
    expectFirst: "hidden-compensation-bands",
    rationale:
      "hideFromSearch document is the best textual match but must never appear in query-based search.",
  },
  {
    id: "access-hidden-layoffs-contingency",
    class: "access",
    query: "layoffs contingency plan headcount",
    expectFirst: "hidden-layoffs-contingency-plan",
    rationale:
      "hideFromSearch document is the best textual match but must never appear in query-based search.",
  },
  {
    id: "access-trashed-legacy-billing",
    class: "access",
    query: "legacy billing migration steps",
    expectFirst: "trashed-legacy-billing-spec",
    rationale:
      "Trashed document is the best textual match but must never appear in document discovery.",
  },
];
