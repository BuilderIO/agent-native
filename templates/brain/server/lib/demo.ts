import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";

import type { BrainEvidence, BrainSourceProvider } from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import {
  createCapture,
  createSource,
  nowIso,
  parseJson,
  sanitizeEvidenceCitationUrls,
  serializeCapture,
  serializeKnowledge,
  serializeProposal,
  serializeSource,
  writeKnowledgeRecord,
  type WriteKnowledgeInput,
} from "./brain.js";
import {
  redactSensitiveText,
  redactSensitiveValue,
  searchEverythingRows,
} from "./search.js";

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
    key: "connector-eval-gate",
    sourceKey: "granola-gtm",
    externalId: `${DEMO_SEED_ID}:granola:connector-eval-gate`,
    title: "GTM sync notes: connector sequencing",
    kind: "note",
    capturedAt: "2026-05-04T17:00:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "granola",
      sourceUrl: "https://notes.granola.example.com/d/connector-eval-gate",
    },
    content:
      "Decision: pause additional Brain connectors until retrieval evals pass product decisions, process and policy knowledge, architecture how-it-works, superseded decision narration, honest not-found behavior, and privacy redaction. Rationale: connectors amplify weak knowledge retrieval when the corpus is thin.",
  },
  {
    key: "import-review-policy",
    sourceKey: "webhook-policy",
    externalId: `${DEMO_SEED_ID}:webhook:import-review-policy`,
    title: "Brain import review policy",
    kind: "document",
    capturedAt: "2026-05-04T19:00:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "generic",
      sourceUrl: "https://docs.example.com/brain/import-review-policy",
    },
    content:
      "Policy: raw imports may become captures immediately, but company-tier knowledge must be reviewed, cited, or explicitly proposed before it becomes durable knowledge. Low-confidence policy items stay pending proposals and out of published search.",
  },
  {
    key: "retrieval-architecture",
    sourceKey: "clips-council",
    externalId: `${DEMO_SEED_ID}:clips:retrieval-architecture`,
    title: "Product Council recording: Brain retrieval architecture",
    kind: "transcript",
    capturedAt: "2026-05-04T21:00:00.000Z",
    metadata: {
      demoSeedId: DEMO_SEED_ID,
      provider: "clips",
      sourceUrl: "https://clips.example.com/share/retrieval-architecture-demo",
    },
    content: [
      "Speaker 1: Architecture: Brain retrieval starts with portable SQL over brain_knowledge.",
      "Speaker 2: Raw capture fallback only runs when source policy allows.",
      "Speaker 3: Citations come from evidence quotes and metadata source URLs; V1 does not require a vector database.",
    ].join("\n"),
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
      "Do not store personal details from customer calls. The escalation owner is ava.cho@example.com and phone +1 415 555 1212 until support automation ships.",
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
      excludedReason: "Personal aside; not company knowledge.",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_PRODUCT/p1778157600000200",
    },
    content:
      "Personal aside: dentist appointment and childcare schedule are not company knowledge.",
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
  {
    key: "connector-eval-gate",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:connector-eval-gate`,
    title: "#dev-fusion Brain connector eval gate",
    kind: "message",
    capturedAt: "2026-05-08T18:35:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778265300000200",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778265300000200",
    },
    content: [
      "Slack #dev-fusion at 2026-05-08T18:35:00.000Z",
      "Mira: Product decision: pause additional Brain connectors; connectors amplify weak retrieval.",
      "Omar: The eval gate covers product decisions, process/policy knowledge, architecture how-it-works, privacy redaction, superseded decision narration, and honest not-found behavior.",
    ].join("\n"),
    status: "distilled",
  },
  {
    key: "import-review-policy",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:import-review-policy`,
    title: "#dev-fusion Brain import review policy",
    kind: "message",
    capturedAt: "2026-05-08T18:50:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778266200000300",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778266200000300",
    },
    content: [
      "Slack #dev-fusion at 2026-05-08T18:50:00.000Z",
      "Priya: Process policy: raw imports become captures; company-tier knowledge must be reviewed, cited, or proposed before durable knowledge.",
      "Sam: Low-confidence policy items stay pending proposals and out of published search until review.",
    ].join("\n"),
    status: "distilled",
  },
  {
    key: "retrieval-architecture",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:retrieval-architecture`,
    title: "#dev-fusion Brain retrieval architecture",
    kind: "message",
    capturedAt: "2026-05-08T19:05:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778267100000400",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778267100000400",
    },
    content: [
      "Slack #dev-fusion at 2026-05-08T19:05:00.000Z",
      "Lee: Engineering architecture: Brain retrieval starts with portable SQL over brain_knowledge.",
      "Nora: Raw capture fallback only runs when source policy allows, and citations come from evidence quotes plus metadata source URLs.",
      "Lee: V1 has no vector database requirement.",
    ].join("\n"),
    status: "distilled",
  },
  {
    key: "old-connector-marketplace",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:old-connector-marketplace`,
    title: "#dev-fusion old connector marketplace plan",
    kind: "message",
    capturedAt: "2026-05-07T16:00:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778179200000500",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778179200000500",
    },
    content:
      "Slack #dev-fusion at 2026-05-07T16:00:00.000Z\nOld decision: connector marketplace first was the initial Brain expansion bet before retrieval quality gates were added.",
    status: "distilled",
  },
  {
    key: "connector-eval-replacement",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:connector-eval-replacement`,
    title: "#dev-fusion connector rollout replacement",
    kind: "message",
    capturedAt: "2026-05-08T19:20:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778268000000600",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778268000000600",
    },
    content:
      "Slack #dev-fusion at 2026-05-08T19:20:00.000Z\nCurrent decision: replace connector marketplace first with an eval-first connector gate, narrating the change as originally connector marketplace first, then changed to eval-first connector gate with both citations.",
    status: "distilled",
  },
  {
    key: "privacy-redaction-output",
    sourceKey: "slack-dev-fusion",
    externalId: `${RETRIEVAL_EVAL_SEED_ID}:slack:privacy-redaction-output`,
    title: "#dev-fusion privacy redaction output",
    kind: "message",
    capturedAt: "2026-05-08T19:35:00.000Z",
    metadata: {
      demoSeedId: RETRIEVAL_EVAL_SEED_ID,
      provider: "slack",
      channelName: "dev-fusion",
      channelId: "CDEMO_DEV_FUSION",
      sourceUrl:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778268900000700",
      permalink:
        "https://slack.example.com/archives/CDEMO_DEV_FUSION/p1778268900000700",
    },
    content:
      "Slack #dev-fusion at 2026-05-08T19:35:00.000Z\nPrivacy note: Brain retrieval may preserve durable escalation rotation context, but emails like ava.cho@example.com and phone +1 415 555 1212 must display as [redacted] before results leave Brain.",
    status: "distilled",
  },
];

interface RetrievalEvalCase {
  id: string;
  kind: RetrievalEvalKind;
  label: string;
  question: string;
  expectedTitle?: string;
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
    id: "connector-eval-gate-rationale",
    kind: "answer",
    label: "Product decision rationale is retrievable",
    question: "Why are more Brain connectors waiting on retrieval evals?",
    expectedTitle: "Brain connector rollout waits for retrieval eval gates",
    requiredTerms: [
      "pause additional Brain connectors",
      ["process/policy", "process and policy"],
      "architecture how-it-works",
      "privacy redaction",
      ["connectors amplify weak retrieval", "connectors amplify"],
    ],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "import-review-policy",
    kind: "answer",
    label: "Process and policy knowledge is retrievable",
    question: "What process policy governs Brain imports and proposals?",
    expectedTitle: "Brain import policy keeps company knowledge review-gated",
    requiredTerms: [
      "raw imports",
      "company-tier knowledge",
      ["reviewed", "review"],
      "low-confidence policy items",
      "pending proposals",
    ],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "retrieval-architecture-how-it-works",
    kind: "answer",
    label: "Engineering architecture and how-it-works knowledge is retrievable",
    question:
      "What does the #dev-fusion Brain retrieval architecture say about portable SQL and raw capture fallback?",
    expectedTitle:
      "Brain retrieval uses SQL knowledge first with raw capture fallback",
    requiredTerms: [
      "portable SQL",
      "brain_knowledge",
      "raw capture fallback",
      "source policy",
      "no vector database requirement",
    ],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "superseded-connector-rollout-narration",
    kind: "answer",
    label: "Superseded decisions are narrated toward the current decision",
    question: "What replaced the connector marketplace first plan?",
    expectedTitle:
      "Connector marketplace first was superseded by eval-first gating",
    requiredTerms: [
      "originally connector marketplace first",
      ["then changed to eval-first connector gate", "changed to eval-first"],
      "both citations",
    ],
    forbiddenTerms: ["active recommendation: connector marketplace first"],
    requireCitation: true,
    requireSlackProvider: true,
  },
  {
    id: "privacy-redaction-output",
    kind: "answer",
    label: "PII is redacted from retrieval output",
    question:
      "What does the #dev-fusion privacy redaction output say about durable escalation rotation?",
    expectedTitle: "#dev-fusion privacy redaction output",
    requiredTerms: [
      "durable escalation rotation",
      "[redacted]",
      "before results leave Brain",
    ],
    forbiddenTerms: ["ava.cho@example.com", "+1 415 555 1212"],
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
  {
    id: "unsupported-payroll-provider",
    kind: "not-found",
    label: "Unrelated absent claims are not treated as supported",
    question:
      "Which payroll provider did Brain choose for contractor invoices?",
    requiredTerms: [
      ["payroll provider", "contractor invoices"],
      ["Brain choose", "Brain chose"],
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

function serializeSeedCapture(
  row: typeof schema.brainRawCaptures.$inferSelect,
) {
  const capture = serializeCapture(row);
  return {
    ...capture,
    externalId: capture.externalId
      ? redactSensitiveText(capture.externalId)
      : capture.externalId,
    title: redactSensitiveText(capture.title),
    content: redactSensitiveText(capture.content),
    metadata: redactSensitiveValue(capture.metadata),
    importedBy: capture.importedBy
      ? redactSensitiveText(capture.importedBy)
      : capture.importedBy,
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
    body: "Brain should explain that the team previously treated freemium as the default acquisition path, then retired the self-serve freemium path because activation stayed under 6% while support load was blocking enterprise onboarding. The new motion emphasizes sales-led pilots with named implementation owners.",
    summary:
      "Freemium was previously the default acquisition path; the current decision retired self-serve freemium because low activation and support load hurt enterprise onboarding.",
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
    body: "The public Brain template should lead with product-decision knowledge because why/why-now questions best demonstrate durable, cited institutional context.",
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

  const connectorEvalGate = await upsertDemoKnowledge({
    title: "Brain connector rollout waits for retrieval eval gates",
    kind: "decision",
    body: "The product decision is to pause additional Brain connectors until retrieval evals pass product decisions, process and policy knowledge, architecture how-it-works, superseded decision narration, honest not-found behavior, and privacy redaction. The rationale is that connectors amplify weak knowledge retrieval when the corpus is thin.",
    summary:
      "Additional Brain connectors wait for retrieval eval gates covering process and policy knowledge, architecture how-it-works, privacy redaction, and connectors amplify weak knowledge retrieval.",
    topic: "Brain",
    tags: ["connectors", "retrieval-evals", "product-rationale"],
    entities: [
      { type: "template", name: "Brain" },
      { type: "quality-gate", name: "Retrieval evals" },
    ],
    evidence: [
      evidence(
        captureByKey.get("connector-eval-gate")!,
        "Decision: pause additional Brain connectors until retrieval evals pass product decisions, process and policy knowledge, architecture how-it-works, superseded decision narration, honest not-found behavior, and privacy redaction.",
      ),
      evidence(
        captureByKey.get("connector-eval-gate")!,
        "Rationale: connectors amplify weak knowledge retrieval when the corpus is thin.",
      ),
    ],
    confidence: 94,
    publishCanonical: false,
  });

  const importReviewPolicy = await upsertDemoKnowledge({
    title: "Brain import policy keeps company knowledge review-gated",
    kind: "policy",
    body: "Raw imports may become captures immediately, but company-tier knowledge must be reviewed, cited, or explicitly proposed before it becomes durable knowledge. Low-confidence policy items stay pending proposals and out of published search.",
    summary:
      "Raw imports become captures first; company-tier knowledge stays reviewed, cited, or proposed before durable publication.",
    topic: "Review policy",
    tags: ["process", "policy", "review-queue"],
    entities: [{ type: "policy", name: "Brain import review" }],
    evidence: [
      evidence(
        captureByKey.get("import-review-policy")!,
        "Policy: raw imports may become captures immediately, but company-tier knowledge must be reviewed, cited, or explicitly proposed before it becomes durable knowledge.",
      ),
      evidence(
        captureByKey.get("import-review-policy")!,
        "Low-confidence policy items stay pending proposals and out of published search.",
      ),
    ],
    confidence: 95,
    publishCanonical: false,
  });

  const retrievalArchitecture = await upsertDemoKnowledge({
    title: "Brain retrieval uses SQL knowledge first with raw capture fallback",
    kind: "how-it-works",
    body: "Brain retrieval starts with portable SQL over brain_knowledge, then uses raw capture fallback only when source policy allows. Citations come from evidence quotes and metadata source URLs, and V1 does not require a vector database.",
    summary:
      "Brain retrieval uses portable SQL over brain_knowledge first, raw capture fallback follows source policy, citations use source URLs, and V1 has no vector database requirement.",
    topic: "Brain architecture",
    tags: ["architecture", "retrieval", "sql"],
    entities: [
      { type: "system", name: "Brain retrieval" },
      { type: "table", name: "brain_knowledge" },
    ],
    evidence: [
      evidence(
        captureByKey.get("retrieval-architecture")!,
        "Architecture: Brain retrieval starts with portable SQL over brain_knowledge.",
      ),
      evidence(
        captureByKey.get("retrieval-architecture")!,
        "Raw capture fallback only runs when source policy allows.",
      ),
      evidence(
        captureByKey.get("retrieval-architecture")!,
        "Citations come from evidence quotes and metadata source URLs; V1 does not require a vector database.",
      ),
    ],
    confidence: 95,
    publishCanonical: false,
  });

  const redacted = await upsertDemoKnowledge({
    title: "Escalation owner notes are redacted when personal data appears",
    kind: "policy",
    body: "Brain may preserve durable escalation process context, but email and phone-like personal identifiers from source material are redacted before the entry is queryable.",
    summary:
      "Escalation process context can be retained with email and phone-like personal identifiers redacted.",
    topic: "Privacy",
    tags: ["privacy", "redaction", "support"],
    entities: [{ type: "policy", name: "Personal content exclusion" }],
    evidence: [
      evidence(
        captureByKey.get("redaction-proof")!,
        "The escalation owner is ava.cho@example.com and phone +1 415 555 1212 until support automation ships.",
      ),
    ],
    confidence: 95,
    redactions: ["+1 415 555 1212"],
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
    captures: Array.from(captureByKey.values()).map(serializeSeedCapture),
    knowledge: [
      oldFreemium,
      retiredFreemium,
      decisionDigest,
      launchDemo,
      connectorEvalGate,
      importReviewPolicy,
      retrievalArchitecture,
      redacted,
    ],
    proposal,
    suggestedQuestions: [
      "Why did we retire freemium?",
      "How does Decision Digest work and why?",
      "Why are product decisions the lead Brain demo?",
      "Why are more Brain connectors waiting on retrieval evals?",
      "How does Brain retrieval work architecturally?",
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

  const connectorEvalGate = await upsertDemoKnowledge({
    title: "Brain connector rollout waits for retrieval eval gates",
    kind: "decision",
    body: "The product decision is to pause additional Brain connectors until retrieval evals pass product decisions, process/policy knowledge, architecture how-it-works, superseded decision narration, honest not-found behavior, and privacy redaction. The rationale is that connectors amplify weak retrieval when the knowledge corpus is thin, so quality gates come before connector breadth.",
    summary:
      "Pause additional Brain connectors until retrieval evals cover process/policy knowledge, architecture how-it-works, privacy redaction, and connectors amplify weak retrieval.",
    topic: "Brain connectors",
    tags: ["brain", "connectors", "retrieval-eval", "product-rationale"],
    entities: [
      { type: "template", name: "Brain" },
      { type: "quality-gate", name: "Retrieval evals" },
    ],
    evidence: [
      evidence(
        captureByKey.get("connector-eval-gate")!,
        "Product decision: pause additional Brain connectors; connectors amplify weak retrieval.",
      ),
      evidence(
        captureByKey.get("connector-eval-gate")!,
        "The eval gate covers product decisions, process/policy knowledge, architecture how-it-works, privacy redaction, superseded decision narration, and honest not-found behavior.",
      ),
    ],
    confidence: 95,
    publishCanonical: options.publishCanonical ?? false,
  });

  const importReviewPolicy = await upsertDemoKnowledge({
    title: "Brain import policy keeps company knowledge review-gated",
    kind: "policy",
    body: "Raw imports may become captures immediately, but company-tier knowledge must be reviewed, cited, or explicitly proposed before it becomes durable knowledge. Low-confidence policy items stay pending proposals and out of published search until review.",
    summary:
      "Raw imports become captures first; company-tier knowledge stays reviewed, cited, or proposed, and low-confidence policy items stay pending proposals.",
    topic: "Brain process",
    tags: ["process", "policy", "review-queue", "retrieval-eval"],
    entities: [{ type: "policy", name: "Brain import review" }],
    evidence: [
      evidence(
        captureByKey.get("import-review-policy")!,
        "Process policy: raw imports become captures; company-tier knowledge must be reviewed, cited, or proposed before durable knowledge.",
      ),
      evidence(
        captureByKey.get("import-review-policy")!,
        "Low-confidence policy items stay pending proposals and out of published search until review.",
      ),
    ],
    confidence: 95,
    publishCanonical: options.publishCanonical ?? false,
  });

  const retrievalArchitecture = await upsertDemoKnowledge({
    title: "Brain retrieval uses SQL knowledge first with raw capture fallback",
    kind: "how-it-works",
    body: "Brain retrieval starts with portable SQL over brain_knowledge, then raw capture fallback only runs when source policy allows. Citations come from evidence quotes plus metadata source URLs. V1 has no vector database requirement.",
    summary:
      "Brain retrieval uses portable SQL over brain_knowledge first, raw capture fallback follows source policy, citations use source URLs, and V1 has no vector database requirement.",
    topic: "Brain architecture",
    tags: ["architecture", "retrieval", "sql", "retrieval-eval"],
    entities: [
      { type: "system", name: "Brain retrieval" },
      { type: "table", name: "brain_knowledge" },
    ],
    evidence: [
      evidence(
        captureByKey.get("retrieval-architecture")!,
        "Engineering architecture: Brain retrieval starts with portable SQL over brain_knowledge.",
      ),
      evidence(
        captureByKey.get("retrieval-architecture")!,
        "Raw capture fallback only runs when source policy allows, and citations come from evidence quotes plus metadata source URLs.",
      ),
      evidence(
        captureByKey.get("retrieval-architecture")!,
        "V1 has no vector database requirement.",
      ),
    ],
    confidence: 95,
    publishCanonical: options.publishCanonical ?? false,
  });

  const oldConnectorMarketplace = await upsertDemoKnowledge({
    title: "Connector marketplace was the first Brain expansion bet",
    kind: "decision",
    body: "The old Brain expansion decision put connector marketplace first before retrieval quality gates were added.",
    summary:
      "Connector marketplace first was the original expansion plan before retrieval quality gates.",
    topic: "Brain connectors",
    tags: ["connectors", "superseded", "retrieval-eval"],
    entities: [{ type: "template", name: "Brain" }],
    evidence: [
      evidence(
        captureByKey.get("old-connector-marketplace")!,
        "Old decision: connector marketplace first was the initial Brain expansion bet before retrieval quality gates were added.",
      ),
    ],
    confidence: 91,
    publishCanonical: false,
  });

  const connectorRolloutReplacement = await upsertDemoKnowledge({
    title: "Connector marketplace first was superseded by eval-first gating",
    kind: "decision",
    body: "The current connector rollout should be narrated as originally connector marketplace first, then changed to eval-first connector gate with both citations. Search should treat eval-first gating as the current decision, not the old connector marketplace recommendation.",
    summary:
      "Originally connector marketplace first, then changed to eval-first connector gate with both citations; eval-first gating is current.",
    topic: "Brain connectors",
    tags: ["connectors", "supersedes", "retrieval-eval"],
    entities: [
      { type: "template", name: "Brain" },
      { type: "quality-gate", name: "Eval-first connector gate" },
    ],
    evidence: [
      evidence(
        captureByKey.get("old-connector-marketplace")!,
        "Old decision: connector marketplace first was the initial Brain expansion bet before retrieval quality gates were added.",
      ),
      evidence(
        captureByKey.get("connector-eval-replacement")!,
        "Current decision: replace connector marketplace first with an eval-first connector gate, narrating the change as originally connector marketplace first, then changed to eval-first connector gate with both citations.",
      ),
    ],
    confidence: 95,
    supersedesId: oldConnectorMarketplace.id,
    publishCanonical: options.publishCanonical ?? false,
  });

  const privacyRedaction = await upsertDemoKnowledge({
    title: "Brain retrieval redacts personal escalation identifiers",
    kind: "policy",
    body: "Brain retrieval may preserve durable escalation rotation context, but personal emails and phone numbers must display as [redacted] before results leave Brain.",
    summary:
      "Durable escalation rotation context can be searched, but personal emails and phone numbers are redacted before output.",
    topic: "Privacy",
    tags: ["privacy", "redaction", "retrieval-eval"],
    entities: [{ type: "policy", name: "Brain retrieval redaction" }],
    evidence: [
      evidence(
        captureByKey.get("privacy-redaction-output")!,
        "Privacy note: Brain retrieval may preserve durable escalation rotation context, but emails like ava.cho@example.com and phone +1 415 555 1212 must display as [redacted] before results leave Brain.",
      ),
    ],
    confidence: 95,
    redactions: ["+1 415 555 1212"],
    publishCanonical: false,
  });

  return {
    seedId: RETRIEVAL_EVAL_SEED_ID,
    seededAt: nowIso(),
    sources: Array.from(sourceByKey.values()).map(serializeSource),
    captures: Array.from(captureByKey.values()).map(serializeSeedCapture),
    knowledge: [
      staleFusionBranch,
      connectorEvalGate,
      importReviewPolicy,
      retrievalArchitecture,
      oldConnectorMarketplace,
      connectorRolloutReplacement,
      privacyRedaction,
    ],
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
  return sanitizeEvidenceCitationUrls(
    parseJson<BrainEvidence[]>(row.evidenceJson, []),
  );
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
      if (evalCase.expectedTitle && result.title !== evalCase.expectedTitle) {
        return false;
      }
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

  const connectorSearch = await searchEverythingRows({
    query: "Why are more Brain connectors waiting on retrieval evals?",
    limit: 5,
  });
  const topConnectorSearch = connectorSearch[0] ?? null;
  const connectorSearchText = topConnectorSearch
    ? JSON.stringify(topConnectorSearch)
    : "";
  check(
    checks,
    "product-rationale-search",
    "Product decision rationale for connector sequencing is retrievable",
    topConnectorSearch?.type === "knowledge" &&
      topConnectorSearch.title ===
        "Brain connector rollout waits for retrieval eval gates" &&
      connectorSearchText.includes(
        "connectors amplify weak knowledge retrieval",
      ) &&
      !!topConnectorSearch.citation?.quote,
    topConnectorSearch
      ? `Top result is ${topConnectorSearch.type}:${topConnectorSearch.title}.`
      : "Connector eval-gate rationale search returned no results.",
    connectorSearch,
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
  const freemiumNarrationText = [
    topFreemiumSearch?.summary,
    topFreemiumSearch?.snippet,
  ].join("\n");
  check(
    checks,
    "superseded-search-narration",
    "Current search result narrates the superseded freemium decision",
    topFreemiumSearch?.title ===
      "Freemium signup retired for enterprise-led growth" &&
      includesTerm(freemiumNarrationText, "previously the default") &&
      includesTerm(freemiumNarrationText, "current decision retired") &&
      !freemiumSearch.some(
        (item) =>
          item.type === "knowledge" &&
          item.title === "Freemium signup was the default acquisition path",
      ),
    topFreemiumSearch
      ? `Current result snippet: ${topFreemiumSearch.snippet}`
      : "Freemium search returned no current decision result.",
    freemiumSearch,
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

  const importPolicy = await findKnowledgeByTitle(
    "Brain import policy keeps company knowledge review-gated",
  );
  const importPolicyEvidence = importPolicy
    ? knowledgeEvidence(importPolicy)
    : [];
  check(
    checks,
    "process-policy-recall",
    "Process policy knowledge is published and cited",
    !!importPolicy &&
      importPolicy.status === "published" &&
      importPolicy.kind === "policy" &&
      importPolicyEvidence.length >= 2,
    importPolicy
      ? `Found import review policy with ${importPolicyEvidence.length} citation(s).`
      : "Brain import review policy was not found.",
    importPolicy ? serializeKnowledge(importPolicy) : null,
  );

  const architectureSearch = await searchEverythingRows({
    query:
      "Brain retrieval architecture portable SQL brain_knowledge raw capture fallback",
    limit: 5,
  });
  const topArchitectureSearch = architectureSearch[0] ?? null;
  const architectureSearchText = topArchitectureSearch
    ? JSON.stringify(topArchitectureSearch)
    : "";
  check(
    checks,
    "architecture-search-quality",
    "Engineering architecture how-it-works result is retrievable",
    topArchitectureSearch?.type === "knowledge" &&
      topArchitectureSearch.title ===
        "Brain retrieval uses SQL knowledge first with raw capture fallback" &&
      includesTerm(architectureSearchText, "portable SQL") &&
      includesTerm(architectureSearchText, "brain_knowledge") &&
      includesTerm(architectureSearchText, "no vector database requirement"),
    topArchitectureSearch
      ? `Top result is ${topArchitectureSearch.type}:${topArchitectureSearch.title}.`
      : "Brain retrieval architecture search returned no results.",
    architectureSearch,
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
      !redactedText.includes("ava.cho@example.com") &&
      !redactedText.includes("+1 415 555 1212"),
    redacted
      ? `Stored redacted knowledge ${redacted.id} without the source email or phone.`
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
      !redactionSearchText.includes("ava.cho@example.com") &&
      !redactionSearchText.includes("+1 415 555 1212"),
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
