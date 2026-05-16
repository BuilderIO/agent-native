import { and, desc, eq } from "drizzle-orm";
import { accessFilter } from "@agent-native/core/sharing";
import { getDb, schema } from "../db/index.js";
import {
  createCapture,
  createSource,
  nowIso,
  parseJson,
  serializeCapture,
  serializeKnowledge,
  serializeProposal,
  serializeSource,
  writeKnowledgeRecord,
  type WriteKnowledgeInput,
} from "./brain.js";
import { searchEverythingRows } from "./search.js";
import type { BrainEvidence, BrainSourceProvider } from "../../shared/types.js";

const DEMO_SEED_ID = "brain-product-decisions-demo-v1";
const RETRIEVAL_EVAL_SEED_ID = "brain-real-channel-retrieval-eval-v1";

type EvalMode = "product-demo" | "retrieval";
type RetrievalEvalKind = "answer" | "not-found";
type TermExpectation = string | string[];

interface DemoSourceSpec {
  key: string;
  title: string;
  provider: BrainSourceProvider;
  config?: Record<string, unknown>;
}

interface DemoCaptureSpec {
  key: string;
  sourceKey: string;
  externalId: string;
  title: string;
  kind: "transcript" | "note" | "message" | "document" | "generic";
  content: string;
  capturedAt: string;
  metadata: Record<string, unknown>;
  status?: "queued" | "distilling" | "distilled" | "ignored";
}

const demoSources: DemoSourceSpec[] = [
  {
    key: "slack-product",
    title: "Demo Slack #product-decisions",
    provider: "slack",
    config: {
      demoSeedId: DEMO_SEED_ID,
      autoSync: false,
      channelIds: ["CDEMO_PRODUCT"],
      reviewRequired: true,
    },
  },
  {
    key: "clips-council",
    title: "Demo Clips Product Council",
    provider: "clips",
    config: {
      demoSeedId: DEMO_SEED_ID,
      autoSync: false,
      sourceKey: "demo-clips",
      reviewRequired: true,
    },
  },
  {
    key: "granola-gtm",
    title: "Demo Granola GTM Notes",
    provider: "granola",
    config: {
      demoSeedId: DEMO_SEED_ID,
      autoSync: false,
      reviewRequired: true,
    },
  },
  {
    key: "webhook-policy",
    title: "Demo Transcript Webhook",
    provider: "generic",
    config: {
      demoSeedId: DEMO_SEED_ID,
      autoSync: false,
      sourceKey: "demo-webhook",
      reviewRequired: true,
    },
  },
];

const demoCaptures: DemoCaptureSpec[] = [
  {
    key: "freemium-decision",
    sourceKey: "slack-product",
    externalId: `${DEMO_SEED_ID}:slack:freemium-decision`,
    title: "#product-decisions freemium retirement thread",
    kind: "message",
    capturedAt: "2026-05-01T17:40:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "slack",
      channelName: "product-decisions",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_PRODUCT/p1777657200000100",
    },
    content: [
      "Slack #product-decisions at 2026-05-01T17:40:00.000Z",
      "Mira: Decision: retire the self-serve freemium path because trial activation stayed under 6% and support load blocked enterprise onboarding.",
      "Omar: Sales-led pilots convert when we promise a named implementation owner.",
      "Priya: Package the change as enterprise-led growth, not as removing the free tier from existing customers.",
    ].join("\n"),
  },
  {
    key: "old-freemium",
    sourceKey: "webhook-policy",
    externalId: `${DEMO_SEED_ID}:doc:old-freemium`,
    title: "Old acquisition brief",
    kind: "document",
    capturedAt: "2026-03-28T09:00:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "generic",
      sourceUrl: "https://docs.example.com/acquisition/old-freemium",
    },
    content:
      "Earlier assumption: keep freemium as the default acquisition path until onboarding conversion data says otherwise.",
  },
  {
    key: "decision-digest",
    sourceKey: "clips-council",
    externalId: `${DEMO_SEED_ID}:clips:decision-digest`,
    title: "Product Council recording: Decision Digest",
    kind: "transcript",
    capturedAt: "2026-05-03T18:00:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "clips",
      sourceUrl: "https://clips.example.com/share/decision-digest-demo",
    },
    content: [
      "Speaker 1: Decision Digest reads approved Brain knowledge first, then drills into raw captures only when the distilled detail is thin.",
      "Speaker 2: Every answer needs citation links, or the agent should say it cannot find support.",
      "Speaker 3: Superseded decisions should be narrated as originally X, changed to Y, with both citations.",
    ].join("\n"),
  },
  {
    key: "product-demo-rationale",
    sourceKey: "granola-gtm",
    externalId: `${DEMO_SEED_ID}:granola:product-demo`,
    title: "GTM sync notes: Brain launch demo",
    kind: "note",
    capturedAt: "2026-05-04T16:30:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "granola",
      sourceUrl: "https://notes.granola.example.com/d/brain-launch-demo",
    },
    content:
      "We will package Brain around product decisions first because why/why-now questions are the strongest demo.",
  },
  {
    key: "retention-open-question",
    sourceKey: "webhook-policy",
    externalId: `${DEMO_SEED_ID}:webhook:retention-open-question`,
    title: "Transcript retention policy import",
    kind: "generic",
    capturedAt: "2026-05-05T20:00:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "generic",
      sourceUrl: "https://legal.example.com/imports/transcript-retention",
    },
    content:
      "Open question: Legal has not confirmed retention settings for meeting transcripts beyond 180 days.",
  },
  {
    key: "redaction-proof",
    sourceKey: "webhook-policy",
    externalId: `${DEMO_SEED_ID}:webhook:redaction-proof`,
    title: "Support escalation owner note",
    kind: "note",
    capturedAt: "2026-05-06T18:15:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "generic",
      sourceUrl: "https://support.example.com/escalations/owner-note",
    },
    content:
      "Do not store personal details from customer calls. The escalation owner is ava.cho@example.com until support automation ships.",
  },
  {
    key: "personal-aside",
    sourceKey: "slack-product",
    externalId: `${DEMO_SEED_ID}:slack:personal-aside`,
    title: "Ignored personal aside",
    kind: "message",
    capturedAt: "2026-05-07T14:00:00.000Z",
    status: "ignored",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "slack",
      excludedReason: "Personal aside; not company memory.",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_PRODUCT/p1778157600000200",
    },
    content:
      "Personal aside: dentist appointment and childcare schedule are not company memory.",
  },
];

const retrievalEvalSources: DemoSourceSpec[] = [
  {
    key: "slack-dev-fusion",
    title: "Demo Slack #dev-fusion",
    provider: "slack",
    config: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      autoSync: false,
      channelIds: ["CDEMO_DEV_FUSION"],
      channels: ["#dev-fusion"],
      reviewRequired: true,
    },
  },
];

const retrievalEvalCaptures: DemoCaptureSpec[] = [
  {
    key: "stale-fusion-branch",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:dev-fusion-stale-branch`,
    title: "#dev-fusion stale Fusion branch handling",
    kind: "message",
    capturedAt: "2026-05-08T18:20:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778264400000100",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778264400000100",
    },
    content: [
      "Slack #dev-fusion at 2026-05-08T18:20:00.000Z",
      "Nora: Decision: when a Fusion run points at a stale or missing branch, show branch-not-found, keep the workspace branch unchanged, and ask the user to recreate the Fusion run.",
      "Lee: Do not run git checkout, reset, stash, or branch repair automatically from this state.",
      "Sam: Answers about this stale Fusion branch guidance should cite the #dev-fusion Slack thread so users can verify the source.",
    ].join("\n"),
    status: "distilled",
  },
];

interface RetrievalEvalCase {
  id: string;
  kind: RetrievalEvalKind;
  label: string;
  question: string;
  requiredTerms: TermExpectation[];
  forbiddenTerms?: string[];
  requireCitation?: boolean;
  requireSlackProvider?: boolean;
}

const retrievalEvalCases: RetrievalEvalCase[] = [
  {
    id: "dev-fusion-stale-branch",
    kind: "answer",
    label: "#dev-fusion stale Fusion branch guidance is retrievable",
    question:
      "In #dev-fusion, what should we do when a Fusion branch is stale or missing?",
    requiredTerms: [
      "fusion",
      ["stale branch", "stale or missing branch"],
      ["branch-not-found", "branch not found"],
      ["workspace branch unchanged", "current branch unchanged"],
      ["recreate", "rerun"],
    ],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "dev-fusion-no-branch-repair",
    kind: "answer",
    label: "Stale Fusion branch answers preserve branch safety",
    question:
      "For a stale Fusion branch, should the agent checkout, reset, stash, or repair the branch automatically?",
    requiredTerms: [
      "fusion",
      ["do not", "don't", "never"],
      "git checkout",
      "reset",
    ],
    forbiddenTerms: ["delete the branch automatically"],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "dev-fusion-citation",
    kind: "answer",
    label: "Real-channel answers carry source citations",
    question:
      "Where should answers cite the stale Fusion branch guidance from?",
    requiredTerms: [["stale Fusion branch", "stale branch"], "fusion"],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "unsupported-cleanup-cron",
    kind: "not-found",
    label: "Unsupported cleanup cron claims are not treated as supported",
    question:
      "Which cleanup cron deletes stale Fusion branches from #dev-fusion?",
    requiredTerms: [
      ["cleanup cron", "cron"],
      ["deletes stale Fusion branches", "delete stale Fusion branches"],
    ],
  },
];

async function findSource(spec: DemoSourceSpec) {
  const [source] = await getDb()
    .select()
    .from(schema.brainSources)
    .where(
      and(
        accessFilter(schema.brainSources, schema.brainSourceShares),
        eq(schema.brainSources.provider, spec.provider),
        eq(schema.brainSources.title, spec.title),
      ),
    )
    .limit(1);
  return source ?? null;
}

async function ensureDemoSource(spec: DemoSourceSpec) {
  return (
    (await findSource(spec)) ??
    (await createSource({
      title: spec.title,
      provider: spec.provider,
      config: spec.config,
      visibility: "org",
    }))
  );
}

async function ensureDemoCapture(sourceId: string, spec: DemoCaptureSpec) {
  return createCapture({
    sourceId,
    externalId: spec.externalId,
    title: spec.title,
    kind: spec.kind,
    content: spec.content,
    capturedAt: spec.capturedAt,
    metadata: spec.metadata,
    status: spec.status,
  });
}

async function findKnowledgeByTitle(title: string) {
  const [knowledge] = await getDb()
    .select()
    .from(schema.brainKnowledge)
    .where(
      and(
        accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
        eq(schema.brainKnowledge.title, title),
      ),
    )
    .limit(1);
  return knowledge ?? null;
}

async function findPendingProposalByTitle(title: string) {
  const [proposal] = await getDb()
    .select()
    .from(schema.brainProposals)
    .where(
      and(
        accessFilter(schema.brainProposals, schema.brainProposalShares),
        eq(schema.brainProposals.title, title),
        eq(schema.brainProposals.status, "pending"),
      ),
    )
    .orderBy(desc(schema.brainProposals.createdAt))
    .limit(1);
  return proposal ?? null;
}

async function upsertDemoKnowledge(input: WriteKnowledgeInput) {
  const existing = await findKnowledgeByTitle(input.title);
  const result = await writeKnowledgeRecord({
    ...input,
    knowledgeId: existing?.id,
    proposalMode: "never",
    publishTier: input.publishTier ?? "company",
  });
  if (result.mode !== "knowledge") {
    throw new Error(`Expected ${input.title} to write directly to knowledge.`);
  }
  return result.knowledge;
}

function evidence(
  capture: typeof schema.brainRawCaptures.$inferSelect,
  quote: string,
  note?: string,
) {
  const metadata = parseJson<Record<string, unknown>>(capture.metadataJson, {});
  return {
    captureId: capture.id,
    quote,
    note,
    sourceUrl:
      typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : undefined,
  };
}

export async function seedBrainDemoData(
  options: {
    publishCanonical?: boolean;
  } = {},
) {
  const sourceByKey = new Map<
    string,
    typeof schema.brainSources.$inferSelect
  >();
  for (const spec of demoSources) {
    sourceByKey.set(spec.key, await ensureDemoSource(spec));
  }

  const captureByKey = new Map<
    string,
    typeof schema.brainRawCaptures.$inferSelect
  >();
  for (const spec of demoCaptures) {
    const source = sourceByKey.get(spec.sourceKey);
    if (!source) throw new Error(`Missing demo source ${spec.sourceKey}`);
    captureByKey.set(spec.key, await ensureDemoCapture(source.id, spec));
  }

  const oldFreemium = await upsertDemoKnowledge({
    title: "Freemium signup was the default acquisition path",
    kind: "decision",
    body: "The previous acquisition assumption kept freemium as the default path until onboarding conversion data justified a change.",
    summary:
      "Freemium was the default acquisition path before the May decision.",
    topic: "Growth",
    tags: ["freemium", "growth", "superseded"],
    entities: [{ type: "product", name: "Freemium" }],
    evidence: [
      evidence(
        captureByKey.get("old-freemium")!,
        "Earlier assumption: keep freemium as the default acquisition path until onboarding conversion data says otherwise.",
      ),
    ],
    confidence: 94,
    publishCanonical: false,
  });

  const retiredFreemium = await upsertDemoKnowledge({
    title: "Freemium signup retired for enterprise-led growth",
    kind: "decision",
    body: "Brain should explain that the team retired the self-serve freemium path because activation stayed under 6% while support load was blocking enterprise onboarding. The new motion emphasizes sales-led pilots with named implementation owners.",
    summary:
      "The self-serve freemium path was retired because low activation and support load hurt enterprise onboarding.",
    topic: "Growth",
    tags: ["freemium", "enterprise", "product-decision"],
    entities: [
      { type: "product", name: "Freemium" },
      { type: "motion", name: "Enterprise-led growth" },
    ],
    evidence: [
      evidence(
        captureByKey.get("freemium-decision")!,
        "Decision: retire the self-serve freemium path because trial activation stayed under 6% and support load blocked enterprise onboarding.",
      ),
      evidence(
        captureByKey.get("freemium-decision")!,
        "Sales-led pilots convert when we promise a named implementation owner.",
      ),
    ],
    confidence: 96,
    supersedesId: oldFreemium.id,
    publishCanonical: options.publishCanonical ?? true,
  });

  const decisionDigest = await upsertDemoKnowledge({
    title: "Decision Digest reads distilled knowledge before raw captures",
    kind: "how-it-works",
    body: "Decision Digest should answer from approved Brain knowledge first. It drills into raw captures only when a distilled entry lacks enough detail, and it must return citation links or say that support is missing.",
    summary:
      "Decision Digest starts from approved knowledge, drills into raw captures when needed, and refuses unsupported answers.",
    topic: "Brain",
    tags: ["decision-digest", "citations", "retrieval"],
    entities: [{ type: "feature", name: "Decision Digest" }],
    evidence: [
      evidence(
        captureByKey.get("decision-digest")!,
        "Decision Digest reads approved Brain knowledge first, then drills into raw captures only when the distilled detail is thin.",
      ),
      evidence(
        captureByKey.get("decision-digest")!,
        "Every answer needs citation links, or the agent should say it cannot find support.",
      ),
    ],
    confidence: 95,
    publishCanonical: options.publishCanonical ?? true,
  });

  const launchDemo = await upsertDemoKnowledge({
    title: "Brain launch demo centers on product decisions",
    kind: "rationale",
    body: "The public Brain template should lead with product-decision memory because why/why-now questions best demonstrate durable, cited institutional context.",
    summary:
      "Product decisions are the strongest Brain demo because they expose why and why-now context.",
    topic: "Positioning",
    tags: ["brain", "demo", "product-decisions"],
    entities: [{ type: "template", name: "Brain" }],
    evidence: [
      evidence(
        captureByKey.get("product-demo-rationale")!,
        "We will package Brain around product decisions first because why/why-now questions are the strongest demo.",
      ),
    ],
    confidence: 93,
    publishCanonical: false,
  });

  const redacted = await upsertDemoKnowledge({
    title: "Escalation owner notes are redacted when personal data appears",
    kind: "policy",
    body: "Brain may preserve durable escalation process context, but personal identifiers from source material are redacted before the entry is queryable.",
    summary:
      "Escalation process context can be retained with personal identifiers redacted.",
    topic: "Privacy",
    tags: ["privacy", "redaction", "support"],
    entities: [{ type: "policy", name: "Personal content exclusion" }],
    evidence: [
      evidence(
        captureByKey.get("redaction-proof")!,
        "The escalation owner is ava.cho@example.com until support automation ships.",
      ),
    ],
    confidence: 95,
    publishCanonical: false,
  });

  const proposalTitle = "Transcript retention policy still needs legal review";
  const existingProposal = await findPendingProposalByTitle(proposalTitle);
  let proposal = existingProposal ? serializeProposal(existingProposal) : null;
  if (!proposal) {
    const result = await writeKnowledgeRecord({
      title: proposalTitle,
      kind: "open-question",
      body: "Legal has not confirmed retention settings for meeting transcripts beyond 180 days.",
      summary: "Transcript retention beyond 180 days needs legal review.",
      topic: "Compliance",
      tags: ["retention", "meetings", "legal-review"],
      entities: [{ type: "policy", name: "Transcript retention" }],
      evidence: [
        evidence(
          captureByKey.get("retention-open-question")!,
          "Open question: Legal has not confirmed retention settings for meeting transcripts beyond 180 days.",
        ),
      ],
      confidence: 62,
      proposalMode: "always",
      publishTier: "company",
      rationale: "Low confidence and policy-sensitive topic require review.",
    });
    if (result.mode !== "proposal") {
      throw new Error("Expected retention item to enter the review queue.");
    }
    proposal = result.proposal;
  }

  return {
    seedId: DEMO_SEED_ID,
    seededAt: nowIso(),
    sources: Array.from(sourceByKey.values()).map(serializeSource),
    captures: Array.from(captureByKey.values()).map(serializeCapture),
    knowledge: [
      oldFreemium,
      retiredFreemium,
      decisionDigest,
      launchDemo,
      redacted,
    ],
    proposal,
    suggestedQuestions: [
      "Why did we retire freemium?",
      "How does Decision Digest work and why?",
      "Why are product decisions the lead Brain demo?",
      "What is our transcript retention policy?",
    ],
  };
}

export async function seedBrainRetrievalEvalData(
  options: {
    publishCanonical?: boolean;
  } = {},
) {
  const sourceByKey = new Map<
    string,
    typeof schema.brainSources.$inferSelect
  >();
  for (const spec of retrievalEvalSources) {
    sourceByKey.set(spec.key, await ensureDemoSource(spec));
  }

  const captureByKey = new Map<
    string,
    typeof schema.brainRawCaptures.$inferSelect
  >();
  for (const spec of retrievalEvalCaptures) {
    const source = sourceByKey.get(spec.sourceKey);
    if (!source)
      throw new Error(`Missing retrieval eval source ${spec.sourceKey}`);
    captureByKey.set(spec.key, await ensureDemoCapture(source.id, spec));
  }

  const staleFusionBranch = await upsertDemoKnowledge({
    title:
      "Stale Fusion branches are reported without moving workspace branches",
    kind: "process",
    body: "When a Fusion run points at a stale or missing branch, Brain should report branch-not-found, keep the workspace branch unchanged, and ask the user to recreate the Fusion run. Agents should not run git checkout, reset, stash, or branch repair automatically from this state. Answers should cite the #dev-fusion Slack thread.",
    summary:
      "Stale Fusion branches should surface branch-not-found, preserve the current workspace branch, avoid git checkout/reset/stash repair, and cite #dev-fusion.",
    topic: "Fusion",
    tags: ["fusion", "dev-fusion", "stale-branches", "retrieval-eval"],
    entities: [
      { type: "channel", name: "#dev-fusion" },
      { type: "product", name: "Fusion" },
    ],
    evidence: [
      evidence(
        captureByKey.get("stale-fusion-branch")!,
        "Decision: when a Fusion run points at a stale or missing branch, show branch-not-found, keep the workspace branch unchanged, and ask the user to recreate the Fusion run.",
      ),
      evidence(
        captureByKey.get("stale-fusion-branch")!,
        "Do not run git checkout, reset, stash, or branch repair automatically from this state.",
      ),
      evidence(
        captureByKey.get("stale-fusion-branch")!,
        "Answers about this stale Fusion branch guidance should cite the #dev-fusion Slack thread so users can verify the source.",
      ),
    ],
    confidence: 96,
    publishCanonical: options.publishCanonical ?? false,
  });

  return {
    seedId: RETRIEVAL_EVAL_SEED_ID,
    seededAt: nowIso(),
    sources: Array.from(sourceByKey.values()).map(serializeSource),
    captures: Array.from(captureByKey.values()).map(serializeCapture),
    knowledge: [staleFusionBranch],
    suggestedQuestions: retrievalEvalCases
      .filter((item) => item.kind === "answer")
      .map((item) => item.question),
  };
}

interface EvalCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  evidence?: unknown;
}

function knowledgeEvidence(row: typeof schema.brainKnowledge.$inferSelect) {
  return parseJson<BrainEvidence[]>(row.evidenceJson, []);
}

function check(
  checks: EvalCheck[],
  id: string,
  label: string,
  passed: boolean,
  detail: string,
  evidence?: unknown,
) {
  checks.push({ id, label, passed, detail, evidence });
}

function includesTerm(value: string, term: string) {
  return value.toLowerCase().includes(term.toLowerCase());
}

function includesTermExpectation(value: string, term: TermExpectation) {
  return Array.isArray(term)
    ? term.some((candidate) => includesTerm(value, candidate))
    : includesTerm(value, term);
}

function includesAnyTerm(value: string, terms: string[] = []) {
  return terms.some((term) => includesTerm(value, term));
}

function searchResultText(
  result: Awaited<ReturnType<typeof searchEverythingRows>>[number],
) {
  return [
    result.type,
    result.title,
    result.snippet,
    result.summary,
    result.provider,
    result.source?.title,
    result.source?.provider,
    result.sourceUrl,
    result.citation?.captureTitle,
    result.citation?.quote,
    result.citation?.sourceUrl,
  ]
    .filter(Boolean)
    .join("\n");
}

function searchResultCitationUrl(
  result: Awaited<ReturnType<typeof searchEverythingRows>>[number],
) {
  return result.citation?.sourceUrl ?? result.sourceUrl ?? null;
}

function hasExpectedCitation(
  result: Awaited<ReturnType<typeof searchEverythingRows>>[number],
  evalCase: RetrievalEvalCase,
) {
  if (!evalCase.requireCitation) return true;
  const url = searchResultCitationUrl(result);
  if (!url?.startsWith("https://")) return false;
  if (!evalCase.requireSlackProvider) return true;
  return (result.provider ?? result.source?.provider) === "slack";
}

function findRetrievalEvalMatch(
  results: Awaited<ReturnType<typeof searchEverythingRows>>,
  evalCase: RetrievalEvalCase,
) {
  return (
    results.find((result) => {
      const text = searchResultText(result);
      return (
        evalCase.requiredTerms.every((term) =>
          includesTermExpectation(text, term),
        ) && !includesAnyTerm(text, evalCase.forbiddenTerms)
      );
    }) ?? null
  );
}

async function evaluateRetrievalEvalCases() {
  const checks: EvalCheck[] = [];
  let answerCaseCount = 0;
  let passedAnswerCases = 0;

  for (const evalCase of retrievalEvalCases) {
    const results = await searchEverythingRows({
      query: evalCase.question,
      limit: 8,
    });
    const match = findRetrievalEvalMatch(results, evalCase);
    const citationOk = match ? hasExpectedCitation(match, evalCase) : false;

    if (evalCase.kind === "answer") {
      answerCaseCount += 1;
      const passed = Boolean(match) && citationOk;
      if (passed) passedAnswerCases += 1;
      check(
        checks,
        evalCase.id,
        evalCase.label,
        passed,
        match
          ? `Matched ${match.type}:${match.title}; citation=${citationOk}.`
          : `No result satisfied the required retrieval terms from ${results.length} result(s).`,
        { match, results },
      );
      continue;
    }

    check(
      checks,
      evalCase.id,
      evalCase.label,
      !match,
      match
        ? `Unexpectedly found citation-backed support in ${match.type}:${match.title}.`
        : `${results.length} broad result(s), but none supported the unsupported claim.`,
      { match, results },
    );
  }

  return { checks, answerCaseCount, passedAnswerCases };
}

export async function runBrainRetrievalEval(
  options: {
    seedIfMissing?: boolean;
    publishCanonical?: boolean;
  } = {},
) {
  const initial = await evaluateRetrievalEvalCases();
  const workspaceHadSupport =
    initial.answerCaseCount > 0 &&
    initial.passedAnswerCases === initial.answerCaseCount;
  let checks = initial.checks;
  let seeded: Awaited<ReturnType<typeof seedBrainRetrievalEvalData>> | null =
    null;
  let fallbackSeeded = false;

  if (!workspaceHadSupport && options.seedIfMissing !== false) {
    seeded = await seedBrainRetrievalEvalData({
      publishCanonical: options.publishCanonical ?? false,
    });
    fallbackSeeded = true;
    checks = (await evaluateRetrievalEvalCases()).checks;
  }

  const passed = checks.filter((item) => item.passed).length;
  return {
    seedId: RETRIEVAL_EVAL_SEED_ID,
    mode: "retrieval" as EvalMode,
    dataset: "real-channel",
    dataMode: fallbackSeeded ? "seeded-fallback" : "workspace",
    workspaceHadSupport,
    fallbackSeeded,
    ok: passed === checks.length,
    passed,
    total: checks.length,
    score: checks.length ? passed / checks.length : 0,
    checks,
    seeded,
  };
}

export async function runBrainDemoEval(
  options: {
    seedIfMissing?: boolean;
    publishCanonical?: boolean;
  } = {},
) {
  const seeded =
    options.seedIfMissing === false
      ? null
      : await seedBrainDemoData({
          publishCanonical: options.publishCanonical ?? false,
        });
  const checks: EvalCheck[] = [];

  const freemium = await findKnowledgeByTitle(
    "Freemium signup retired for enterprise-led growth",
  );
  const oldFreemium = await findKnowledgeByTitle(
    "Freemium signup was the default acquisition path",
  );
  const freemiumEvidence = freemium ? knowledgeEvidence(freemium) : [];
  const freemiumSearch = await searchEverythingRows({
    query: "Why did we retire freemium?",
    limit: 5,
  });
  const topFreemiumSearch = freemiumSearch[0] ?? null;
  check(
    checks,
    "freemium-recall",
    "Freemium decision is published and cited",
    !!freemium &&
      freemium.status === "published" &&
      freemiumEvidence.some((item) => item.sourceUrl ?? item.url),
    freemium
      ? `Found ${freemium.title} with ${freemiumEvidence.length} citation(s).`
      : "Freemium decision was not found.",
    freemium ? serializeKnowledge(freemium) : null,
  );
  check(
    checks,
    "freemium-search-quality",
    "Freemium query retrieves the published current decision first",
    topFreemiumSearch?.type === "knowledge" &&
      topFreemiumSearch.title ===
        "Freemium signup retired for enterprise-led growth" &&
      !freemiumSearch.some(
        (item) =>
          item.type === "knowledge" &&
          item.title === "Freemium signup was the default acquisition path",
      ),
    topFreemiumSearch
      ? `Top result is ${topFreemiumSearch.type}:${topFreemiumSearch.title}.`
      : "Freemium search returned no results.",
    freemiumSearch,
  );
  check(
    checks,
    "search-citation-links",
    "Search results expose usable citation links",
    !!topFreemiumSearch?.citation?.sourceUrl &&
      topFreemiumSearch.citation.sourceUrl.startsWith("https://"),
    topFreemiumSearch?.citation?.sourceUrl
      ? `Top result citation: ${topFreemiumSearch.citation.sourceUrl}.`
      : "Top freemium search result had no citation URL.",
    topFreemiumSearch?.citation ?? null,
  );
  check(
    checks,
    "supersede-chain",
    "Superseded decision chain is represented",
    !!freemium &&
      !!oldFreemium &&
      oldFreemium.status === "archived" &&
      oldFreemium.supersededById === freemium.id &&
      freemium.supersedesId === oldFreemium.id,
    oldFreemium && freemium
      ? `Archived ${oldFreemium.id} in favor of ${freemium.id}.`
      : "Missing old/new freemium knowledge pair.",
  );

  const digest = await findKnowledgeByTitle(
    "Decision Digest reads distilled knowledge before raw captures",
  );
  const digestEvidence = digest ? knowledgeEvidence(digest) : [];
  check(
    checks,
    "how-it-works-recall",
    "How-it-works knowledge is cited",
    !!digest && digest.status === "published" && digestEvidence.length >= 2,
    digest
      ? `Found Decision Digest entry with ${digestEvidence.length} citations.`
      : "Decision Digest entry was not found.",
    digest ? serializeKnowledge(digest) : null,
  );

  const proposal = await findPendingProposalByTitle(
    "Transcript retention policy still needs legal review",
  );
  check(
    checks,
    "proposal-gate",
    "Sensitive low-confidence retention item stays in review",
    !!proposal,
    proposal
      ? `Proposal ${proposal.id} is pending and not queryable as knowledge.`
      : "Pending retention proposal was not found.",
    proposal ? serializeProposal(proposal) : null,
  );
  const retentionKnowledgeSearch = await searchEverythingRows({
    query: "transcript retention policy legal review",
    type: "knowledge",
    limit: 5,
  });
  check(
    checks,
    "proposal-not-queryable",
    "Pending retention proposal is not returned as published knowledge",
    !retentionKnowledgeSearch.some(
      (item) =>
        item.title === "Transcript retention policy still needs legal review",
    ),
    retentionKnowledgeSearch.length
      ? `Knowledge search returned ${retentionKnowledgeSearch.length} other result(s).`
      : "Knowledge search returned no published retention proposal.",
    retentionKnowledgeSearch,
  );

  const redacted = await findKnowledgeByTitle(
    "Escalation owner notes are redacted when personal data appears",
  );
  const redactedText = redacted
    ? JSON.stringify(serializeKnowledge(redacted))
    : "";
  check(
    checks,
    "pii-redaction",
    "PII is redacted before queryable storage",
    !!redacted &&
      redacted.status === "redacted" &&
      !redactedText.includes("ava.cho@example.com"),
    redacted
      ? `Stored redacted knowledge ${redacted.id} without the source email.`
      : "Redacted privacy entry was not found.",
  );
  const redactionSearch = await searchEverythingRows({
    query: "support automation escalation owner",
    type: "capture",
    limit: 5,
  });
  const redactionSearchText = JSON.stringify(redactionSearch);
  check(
    checks,
    "search-pii-redaction",
    "Search output redacts PII from matching raw captures",
    redactionSearch.some((item) => item.type === "capture") &&
      !redactionSearchText.includes("ava.cho@example.com"),
    redactionSearch.length
      ? `Search returned ${redactionSearch.length} redacted capture result(s).`
      : "Search returned no capture result for the redaction fixture.",
    redactionSearch,
  );

  const [personalCapture] = await getDb()
    .select()
    .from(schema.brainRawCaptures)
    .where(
      and(
        eq(
          schema.brainRawCaptures.externalId,
          `${DEMO_SEED_ID}:slack:personal-aside`,
        ),
        eq(schema.brainRawCaptures.status, "ignored"),
      ),
    )
    .limit(1);
  const personalKnowledge = await getDb()
    .select()
    .from(schema.brainKnowledge)
    .where(
      and(
        accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares),
        eq(schema.brainKnowledge.title, "Ignored personal aside"),
      ),
    )
    .limit(1);
  check(
    checks,
    "personal-exclusion",
    "Personal aside is captured only as ignored raw material",
    !!personalCapture && personalKnowledge.length === 0,
    personalCapture
      ? "Personal aside exists as ignored capture and has no knowledge row."
      : "Ignored personal capture was not found.",
  );

  const absentSearch = await searchEverythingRows({
    query: "Which snack supplier replaced the lunch menu?",
    limit: 5,
  });
  check(
    checks,
    "honest-not-found",
    "Unsupported demo questions return no fabricated search support",
    absentSearch.length === 0,
    absentSearch.length
      ? `Unexpectedly found ${absentSearch.length} result(s).`
      : "No search support found for the absent snack-supplier question.",
    absentSearch,
  );

  const passed = checks.filter((item) => item.passed).length;
  return {
    seedId: DEMO_SEED_ID,
    mode: "product-demo" as EvalMode,
    ok: passed === checks.length,
    passed,
    total: checks.length,
    score: checks.length ? passed / checks.length : 0,
    checks,
    seeded,
  };
}
