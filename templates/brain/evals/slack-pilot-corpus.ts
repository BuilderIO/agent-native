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
    title: "Slack personal asides stay out of company memory",
    summary:
      "Personal asides from Slack imports should remain ignored raw material, not published knowledge.",
    body: "Slack imports should exclude personal asides from company memory. Short personal scheduling notes, private logistics, and similar non-work material can remain ignored raw captures, but they should not become published knowledge.",
    quote:
      "Exclude personal asides from company memory; keep them ignored as raw captures, not published knowledge.",
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
];

export const slackPilotEvalCases: SlackPilotEvalCase[] = [
  {
    id: "reasoning-effort-control",
    kind: "answer",
    question: "How should Brain control reasoning effort in the Slack pilot?",
    expectedTitle: "Reasoning effort control stays explicit in Brain pilots",
    requiredTerms: [
      "medium reasoning effort",
      "deep debugging",
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
    expectedTitle: "Slack personal asides stay out of company memory",
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
    id: "unsupported-office-catering",
    kind: "not-found",
    question: "Which snack supplier replaced the lunch menu?",
    requiredTerms: ["could not find"],
    forbiddenTerms: ["supplier", "lunch menu", "replaced the lunch"],
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
