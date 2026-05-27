export type SlackPilotEvalKind = "answer" | "not-found";

export interface SlackPilotEvalFixture {
  id: string;
  title: string;
  body: string;
  summary: string;
  quote: string;
  captureTitle: string;
  sourceUrl: string;
  tags: string[];
}

export interface SlackPilotEvalCase {
  id: string;
  kind: SlackPilotEvalKind;
  question: string;
  expectedTitle?: string;
  requiredTerms: string[];
  forbiddenTerms?: string[];
  notes: string;
}

export interface SlackPilotSearchResult {
  type: string;
  title: string;
  snippet: string;
  sourceUrl: string | null;
}

export interface SlackPilotAnswerResult {
  answer: string;
  citations: Array<{
    title?: string;
    sourceName?: string;
    excerpt?: string;
    url?: string | null;
  }>;
}

export interface SlackPilotEvalAdapter {
  search: (question: string) => Promise<SlackPilotSearchResult[]>;
  answer: (question: string) => Promise<SlackPilotAnswerResult>;
}

export const SLACK_PILOT_SOURCE = {
  id: "slack-pilot-source",
  title: "Slack pilot #brain-pilot",
  provider: "slack",
};

export const slackPilotFixtures: SlackPilotEvalFixture[] = [
  {
    id: "reasoning-effort-control",
    title: "Reasoning effort control stays explicit in Brain pilots",
    summary:
      "Brain defaults to medium reasoning effort, with explicit operator control for deeper debugging or routine summaries.",
    body: "The Slack pilot decided Brain should default to medium reasoning effort. Operators may raise reasoning effort only for deep debugging and lower it for routine summaries. The control must stay explicit in pilot docs so the assistant does not silently spend extra work.",
    quote:
      "Default Brain to medium reasoning effort; raise it only for deep debugging and lower it for routine summaries.",
    captureTitle: "#brain-pilot reasoning effort thread",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778841600000100",
    tags: ["reasoning-effort", "pilot-controls", "brain"],
  },
  {
    id: "fusion-missing-branch-pr-13340",
    title: "PR 13340 handles missing Fusion branches honestly",
    summary:
      "PR #13340 changed missing Fusion branch handling to show a clear branch-not-found error without moving the workspace branch.",
    body: "PR #13340 fixed missing Fusion branch error handling. When Fusion references a missing branch, the app should surface a clear branch-not-found message, keep the current workspace branch unchanged, and ask the user to recreate the Fusion run instead of guessing.",
    quote:
      "For PR #13340, missing Fusion branches should show branch-not-found, keep the workspace branch unchanged, and ask for a recreated run.",
    captureTitle: "#brain-pilot missing Fusion branch handling",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778845200000200",
    tags: ["fusion", "branches", "pr-13340"],
  },
  {
    id: "figma-plugin-json-uploader",
    title: "Figma Plugin JSON uploader validates manifests before upload",
    summary:
      "Uploader feedback asks for manifest JSON validation, inline schema errors, and preserving the last successful package.",
    body: "Figma Plugin JSON uploader feedback: validate the manifest JSON before upload, show schema errors inline, keep the last successful package available, and avoid uploading broken plugin metadata.",
    quote:
      "Validate manifest JSON before upload, show schema errors inline, keep the last successful package, and avoid broken plugin metadata.",
    captureTitle: "#brain-pilot Figma Plugin JSON uploader feedback",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778848800000300",
    tags: ["figma", "plugin-json", "uploader-feedback"],
  },
  {
    id: "non-english-support",
    title: "Brain pilot supports non-English questions and citations",
    summary:
      "Brain should answer non-English questions when possible and preserve source-language citation context.",
    body: "Non-English support for Brain means users can ask in Spanish, Portuguese, or Japanese. The answer should use the user's language when possible and preserve source-language citation snippets instead of translating away important context.",
    quote:
      "Support Spanish, Portuguese, and Japanese questions; answer in the user's language when possible and preserve source-language citations.",
    captureTitle: "#brain-pilot non-English support",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778852400000400",
    tags: ["non-english", "localization", "citations"],
  },
  {
    id: "slack-history-opt-in",
    title: "Slack pilot history reads are opt-in and capped",
    summary:
      "Slack pilots do not read history by default; they validate channels first and only read a tiny capped history sample after explicit opt-in.",
    body: "The Slack pilot must not read message history by default. First validate credentials and the channel allow-list. Only after explicit opt-in may it read a tiny capped recent history sample, with regular sync still disabled until review.",
    quote:
      "Do not read Slack history by default; validate channels first, then read a tiny capped recent sample only after explicit opt-in.",
    captureTitle: "#brain-pilot Slack history guardrails",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778856000000500",
    tags: ["slack", "history", "guardrails"],
  },
  {
    id: "honest-not-found-policy",
    title: "Brain should say when citation support is missing",
    summary:
      "Unsupported answers should be refused with a clear not-found response rather than invented from weak matches.",
    body: "Brain answers need citation support from approved knowledge or matching raw captures. When support is missing, the assistant should say it could not find support and avoid making up a decision, owner, date, or policy.",
    quote:
      "When citation support is missing, say Brain could not find support and avoid making up a decision, owner, date, or policy.",
    captureTitle: "#brain-pilot honest not-found behavior",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778859600000600",
    tags: ["not-found", "citations", "honesty"],
  },
  {
    id: "personal-asides-exclusion",
    title: "Slack personal asides stay out of company knowledge",
    summary:
      "Personal asides from Slack imports should remain ignored raw material, not published knowledge.",
    body: "Slack imports should exclude personal asides from company knowledge. Short personal scheduling notes, private logistics, and similar non-work material can remain ignored raw captures, but they should not become published knowledge.",
    quote:
      "Exclude personal asides from company knowledge; keep them ignored as raw captures, not published knowledge.",
    captureTitle: "#brain-pilot personal-content exclusion",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778863200000700",
    tags: ["privacy", "personal-content", "slack"],
  },
  {
    id: "pilot-eval-citations",
    title: "Pilot eval answers require Slack citations",
    summary:
      "The pilot eval passes only when answers include Slack citation links tied to the supporting source messages.",
    body: "The Brain Slack pilot eval should check cited-answer behavior. A passing answer includes at least one Slack citation link tied to the supporting source message, not just a plausible summary.",
    quote:
      "A passing answer includes at least one Slack citation link tied to the supporting source message.",
    captureTitle: "#brain-pilot eval citation requirement",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778866800000800",
    tags: ["evals", "citations", "slack"],
  },
  {
    id: "dev-fusion-project-settings-revert",
    title: "Project settings revert fixed with partial updates and deep merge",
    summary:
      "The project settings revert came from stale frontend values and PATCH /projects/:projectId replacing the whole settings object; the fix is partial frontend updates plus server-side deep merge.",
    body: "The #dev-fusion review found the project settings revert happened because the frontend kept stale settings values and PATCH /projects/:projectId replaced the whole settings object. The durable fix is for the frontend to send partial settings updates and for the server to deep merge settings patches before persistence.",
    quote:
      "Project settings reverted because stale frontend values and PATCH /projects/:projectId replaced the whole settings object; fix with partial frontend updates and server-side deep merge.",
    captureTitle: "#dev-fusion project settings revert RCA",
    sourceUrl:
      "https://slack.example.com/archives/CDEVFUSION/p1778870400000900",
    tags: ["dev-fusion", "project-settings", "deep-merge", "patch"],
  },
  {
    id: "dev-fusion-tanstack-compromise",
    title: "Agent Native TanStack compromise review found no affected packages",
    summary:
      "Agent Native uses TanStack, but the TanStack compromise review concluded Agent Native did not use the affected packages; PR #673 added minimum package age and CI package pinning hardening.",
    body: "The #dev-fusion Agent Native TanStack compromise review concluded that Agent Native does use TanStack, but it did not depend on the affected packages from the compromise. Follow-up hardening in PR #673 added minimum package age checks and CI package pinning so future installs are less exposed to dependency compromise windows.",
    quote:
      "Agent Native uses TanStack but not the affected packages; PR #673 hardened installs with minimum package age and CI package pinning.",
    captureTitle: "#dev-fusion TanStack compromise review",
    sourceUrl:
      "https://slack.example.com/archives/CDEVFUSION/p1778874000001000",
    tags: ["dev-fusion", "tanstack", "supply-chain", "pr-673"],
  },
  {
    id: "connector-eval-gate-product-rationale",
    title: "More Brain connectors wait on retrieval eval gates",
    summary:
      "The product decision is to pause new Brain connectors until retrieval evals cover core knowledge quality because connectors amplify weak retrieval.",
    body: "The Brain pilot product decision is to pause additional connectors until retrieval evals cover product decisions, process and policy knowledge, architecture how-it-works, superseded decision narration, honest not-found behavior, and privacy redaction. The rationale is that connectors amplify weak knowledge retrieval if quality is thin.",
    quote:
      "Pause additional connectors until retrieval evals cover product decisions, process and policy knowledge, architecture how-it-works, superseded decision narration, not-found behavior, and privacy redaction.",
    captureTitle: "#brain-pilot connector eval gate decision",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778881200001200",
    tags: ["connectors", "retrieval-evals", "product-rationale"],
  },
  {
    id: "import-review-policy",
    title: "Brain imports stay review-gated before company knowledge",
    summary:
      "Raw imports can enter Brain as captures, but company-tier knowledge stays reviewed, cited, or explicitly proposed; low-confidence policy items stay in proposals.",
    body: "Process policy for Brain imports: Slack messages, transcripts, and generic documents may enter as raw captures, but company-tier knowledge should be reviewed, cited, or explicitly proposed before it becomes durable knowledge. Low-confidence policy items stay in proposals instead of search-visible knowledge.",
    quote:
      "Raw imports may enter as captures, but company-tier knowledge should be reviewed, cited, or explicitly proposed before it becomes durable knowledge.",
    captureTitle: "#brain-pilot import review policy",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778884800001300",
    tags: ["process", "policy", "review-queue"],
  },
  {
    id: "architecture-sql-retrieval",
    title: "Brain retrieval uses portable SQL before connector breadth",
    summary:
      "Brain retrieval starts with portable SQL over approved knowledge, uses raw-capture fallback only when policy allows, and does not require a vector database in V1.",
    body: "Engineering architecture for Brain retrieval: start with portable SQL over brain_knowledge, then use raw capture fallback only when source policy allows. Citations come from evidence quotes and metadata source URLs. V1 has no vector database requirement, which keeps connector pilots deterministic and portable.",
    quote:
      "Start with portable SQL over brain_knowledge, then use raw capture fallback only when source policy allows; V1 has no vector database requirement.",
    captureTitle: "#brain-pilot retrieval architecture",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778888400001400",
    tags: ["architecture", "retrieval", "sql"],
  },
  {
    id: "superseded-decisions-narration",
    title: "Superseded decisions need originally-then-current narration",
    summary:
      "Brain should explain superseded decisions as originally X, then changed to Y, and should search toward the current decision while preserving older context.",
    body: "Superseded decision behavior: Brain should narrate changes as originally X, then changed to Y, with citations for both points when available. Search should prefer the current decision and use superseded records as context, not as the active recommendation.",
    quote:
      "Narrate changes as originally X, then changed to Y; search should prefer the current decision and use superseded records as context.",
    captureTitle: "#brain-pilot superseded decision narration",
    sourceUrl:
      "https://slack.example.com/archives/CBRAINPILOT/p1778892000001500",
    tags: ["supersedes", "search-quality", "narration"],
  },
  {
    id: "dev-fusion-broad-status-distractor",
    title: "Broad Fusion pilot status stayed informational",
    summary:
      "General Fusion pilot chatter should not outrank specific #dev-fusion memories about project settings or TanStack compromise hardening.",
    body: "This broad Fusion status update says the Fusion pilot had several reviews, Slack follow-ups, and package discussions. It intentionally lacks the project settings revert fix and the TanStack compromise conclusion so evals can verify specific Brain memories rank above generic Fusion matches.",
    quote:
      "Broad Fusion pilot chatter is only background and should not outrank specific #dev-fusion decisions.",
    captureTitle: "#dev-fusion broad pilot status",
    sourceUrl:
      "https://slack.example.com/archives/CDEVFUSION/p1778877600001100",
    tags: ["dev-fusion", "fusion", "distractor"],
  },
];

export const slackPilotEvalCases: SlackPilotEvalCase[] = [
  {
    id: "reasoning-effort-control",
    kind: "answer",
    question: "Medium reasoning effort Slack pilot control?",
    expectedTitle: "Reasoning effort control stays explicit in Brain pilots",
    requiredTerms: [
      "medium reasoning effort",
      "deeper debugging",
      "routine summaries",
    ],
    notes: "Covers the pilot control for reasoning effort spend.",
  },
  {
    id: "fusion-missing-branch-pr-13340",
    kind: "answer",
    question: "What did PR #13340 change about missing Fusion branches?",
    expectedTitle: "PR 13340 handles missing Fusion branches honestly",
    requiredTerms: [
      "PR #13340",
      "branch-not-found",
      "workspace branch unchanged",
    ],
    notes: "Covers missing Fusion branch error handling.",
  },
  {
    id: "figma-plugin-json-uploader",
    kind: "answer",
    question: "What feedback came from the Figma Plugin JSON uploader?",
    expectedTitle:
      "Figma Plugin JSON uploader validates manifests before upload",
    requiredTerms: [
      "manifest JSON",
      "schema errors inline",
      "last successful package",
    ],
    notes: "Covers Figma Plugin JSON uploader feedback.",
  },
  {
    id: "non-english-support",
    kind: "answer",
    question: "Can Brain answer non-English support questions?",
    expectedTitle: "Brain pilot supports non-English questions and citations",
    requiredTerms: ["Spanish", "Japanese", "source-language citation"],
    notes: "Covers multilingual behavior without storing personal content.",
  },
  {
    id: "slack-history-default",
    kind: "answer",
    question: "Are history reads opt-in and capped by default?",
    expectedTitle: "Slack pilot history reads are opt-in and capped",
    requiredTerms: [
      "do not read history by default",
      "validate channels first",
    ],
    notes: "Covers pilot guardrails for default validation-only runs.",
  },
  {
    id: "slack-history-opt-in",
    kind: "answer",
    question: "When can the Slack pilot sync history?",
    expectedTitle: "Slack pilot history reads are opt-in and capped",
    requiredTerms: ["explicit opt-in", "tiny capped history sample"],
    notes: "Covers bounded history sync behavior.",
  },
  {
    id: "honest-not-found-policy",
    kind: "answer",
    question: "What should Brain do when citation support is missing?",
    expectedTitle: "Brain should say when citation support is missing",
    requiredTerms: ["could not find support", "avoid making up"],
    notes: "Covers the explicit not-found policy.",
  },
  {
    id: "personal-asides-exclusion",
    kind: "answer",
    question: "What should happen to personal asides in Slack imports?",
    expectedTitle: "Slack personal asides stay out of company knowledge",
    requiredTerms: [
      "personal asides",
      "ignored as raw captures",
      "not published knowledge",
    ],
    forbiddenTerms: ["ava.cho@example.com", "+1 415"],
    notes: "Covers personal-content exclusion with redaction-safe fixtures.",
  },
  {
    id: "pilot-eval-citations",
    kind: "answer",
    question: "What does a passing Brain Slack pilot eval require?",
    expectedTitle: "Pilot eval answers require Slack citations",
    requiredTerms: ["Slack citation link", "supporting source message"],
    notes: "Covers cited-answer behavior for the eval itself.",
  },
  {
    id: "dev-fusion-project-settings-revert",
    kind: "answer",
    question: "Why did project settings revert in #dev-fusion?",
    expectedTitle:
      "Project settings revert fixed with partial updates and deep merge",
    requiredTerms: [
      "stale frontend values",
      "PATCH /projects/:projectId",
      "whole settings object",
      "partial frontend updates",
      "server-side deep merge",
    ],
    notes:
      "Covers the durable #dev-fusion knowledge for project-settings revert root cause and fix.",
  },
  {
    id: "dev-fusion-tanstack-compromise",
    kind: "answer",
    question: "Was Agent Native affected by the TanStack compromise?",
    expectedTitle:
      "Agent Native TanStack compromise review found no affected packages",
    requiredTerms: [
      "uses TanStack",
      "not the affected packages",
      "minimum package age",
      "CI package pinning",
      "PR #673",
    ],
    notes:
      "Covers the durable #dev-fusion knowledge for TanStack compromise review and follow-up hardening.",
  },
  {
    id: "connector-eval-gate-product-rationale",
    kind: "answer",
    question: "Why are more Brain connectors waiting on retrieval evals?",
    expectedTitle: "More Brain connectors wait on retrieval eval gates",
    requiredTerms: [
      "pause additional connectors",
      "product decisions",
      "process and policy knowledge",
      "privacy redaction",
      "connectors amplify weak retrieval",
    ],
    notes: "Covers product decision rationale before adding more connectors.",
  },
  {
    id: "import-review-policy",
    kind: "answer",
    question: "What process policy keeps Brain imports review gated?",
    expectedTitle: "Brain imports stay review-gated before company knowledge",
    requiredTerms: [
      "captures",
      "company-tier knowledge",
      "reviewed",
      "low-confidence policy items stay in proposals",
    ],
    notes: "Covers process and policy knowledge retrieval.",
  },
  {
    id: "architecture-sql-retrieval",
    kind: "answer",
    question: "How does Brain retrieval work architecturally?",
    expectedTitle: "Brain retrieval uses portable SQL before connector breadth",
    requiredTerms: [
      "portable SQL",
      "brain_knowledge",
      "raw capture fallback",
      "no vector database requirement",
    ],
    notes: "Covers engineering architecture and how-it-works retrieval.",
  },
  {
    id: "superseded-decisions-narration",
    kind: "answer",
    question: "How should Brain narrate superseded decisions in search?",
    expectedTitle:
      "Superseded decisions need originally-then-current narration",
    requiredTerms: [
      "originally X",
      "then changed to Y",
      "search should prefer the current decision",
      "superseded records as context",
    ],
    notes:
      "Covers superseded decision narration and current-decision search behavior.",
  },
  {
    id: "unsupported-office-catering",
    kind: "not-found",
    question: "Which office snack supplier catered the Friday lunch?",
    requiredTerms: ["could not find"],
    forbiddenTerms: ["supplier", "Friday lunch", "catered"],
    notes: "Covers honest not-found behavior for absent corpus facts.",
  },
];

function includesAll(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.every((term) => normalized.includes(term.toLowerCase()));
}

function includesAny(value: string, terms: string[] = []) {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

export async function runSlackPilotCorpusEval(adapter: SlackPilotEvalAdapter) {
  const checks = [];

  for (const item of slackPilotEvalCases) {
    const searchResults = await adapter.search(item.question);
    const answer = await adapter.answer(item.question);
    const haystack = [
      answer.answer,
      ...answer.citations.flatMap((citation) => [
        citation.title,
        citation.sourceName,
        citation.excerpt,
        citation.url,
      ]),
    ]
      .filter(Boolean)
      .join("\n");

    if (item.kind === "not-found") {
      checks.push({
        id: item.id,
        kind: item.kind,
        passed:
          searchResults.length === 0 &&
          answer.citations.length === 0 &&
          includesAll(haystack, item.requiredTerms) &&
          !includesAny(haystack, item.forbiddenTerms),
        detail: `${searchResults.length} search result(s), ${answer.citations.length} citation(s).`,
      });
      continue;
    }

    const matchedResult = searchResults.find(
      (result) => result.title === item.expectedTitle,
    );
    const hasSlackCitation = answer.citations.some((citation) =>
      citation.url?.startsWith("https://slack.example.com/"),
    );
    const hasRequiredTerms = includesAll(haystack, item.requiredTerms);
    const hasForbiddenTerms = includesAny(haystack, item.forbiddenTerms);
    checks.push({
      id: item.id,
      kind: item.kind,
      passed:
        Boolean(matchedResult) &&
        answer.citations.length > 0 &&
        hasSlackCitation &&
        hasRequiredTerms &&
        !hasForbiddenTerms,
      detail: matchedResult
        ? `Matched ${matchedResult.title} with ${answer.citations.length} citation(s); slackCitation=${hasSlackCitation}; requiredTerms=${hasRequiredTerms}; forbiddenTerms=${hasForbiddenTerms}.`
        : `Expected search result ${item.expectedTitle ?? "(none)"} was not found.`,
    });
  }

  const passed = checks.filter((check) => check.passed).length;
  return {
    ok: passed === checks.length,
    passed,
    total: checks.length,
    score: checks.length ? passed / checks.length : 0,
    checks,
  };
}
