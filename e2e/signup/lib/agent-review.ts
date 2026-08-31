const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TEXT_PER_STEP = 4_000;

export interface JourneyStep {
  label: string;
  url: string;
  visibleText: string;
  screenshot: Buffer;
  consoleErrors: string[];
}

export type FindingSeverity = "high" | "medium" | "low";

export interface AgentFinding {
  severity: FindingSeverity;
  step: string;
  issue: string;
  evidence: string;
}

export interface AgentReview {
  findings: AgentFinding[];
  summary: string;
}

const RUBRIC = `You are reviewing screenshots of a real signup attempt on a deployed web app,
captured in order as one user walked the whole flow with a brand-new email address.

Report only problems a real new user would actually hit. The failures that motivated this
review, so you know the shape of what matters:
- a step that silently does nothing, so the user has to reload the page to continue
- landing back on a signed-out sign-in page after clicking the emailed link
- being signed in to a DIFFERENT app than the one the user signed up for
- an indefinite loading or skeleton state that never resolves
- signed-in state that does not render (no account control, empty shell) even though a session exists
- an error, stack trace, raw JSON, or untranslated/placeholder copy shown to the user

The first-run onboarding welcome screen is expected for a brand-new account. Do NOT report it
just because it has no app shell, account control, or navigation yet; only report onboarding
when a visible action was attempted and the screen demonstrably fails to advance.

The post-link and post-reload captures wait up to 15 seconds for readable content. Treat a
loader that is still present in both captures as a real stall; do not call a single brief
bootstrap loader indefinite when the later capture shows the app or onboarding.

Do NOT report: aesthetic preferences, minor copy wording, anything you cannot see evidence
for in the screenshot or text, or the presence of the test email address itself.

Respond with ONLY a JSON object, no prose or markdown fence, shaped:
{"summary":"one sentence","findings":[{"severity":"high|medium|low","step":"<step label>","issue":"what is wrong","evidence":"what in the screenshot or text shows it"}]}
An empty findings array means the flow looked correct.`;

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for the signup agent review lane.",
    );
  }
  return key;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Agent review returned no JSON object. Raw response: ${text.slice(0, 400)}`,
    );
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function coerceReview(value: unknown): AgentReview {
  if (typeof value !== "object" || value === null) {
    throw new Error("Agent review JSON was not an object.");
  }
  const record = value as { summary?: unknown; findings?: unknown };
  if (!Array.isArray(record.findings)) {
    throw new Error("Agent review JSON has no findings array.");
  }
  const findings = record.findings.map((entry, index): AgentFinding => {
    const item = entry as Partial<AgentFinding>;
    const severity = item.severity;
    if (severity !== "high" && severity !== "medium" && severity !== "low") {
      throw new Error(`Finding ${index} has an unrecognised severity.`);
    }
    return {
      severity,
      step: String(item.step ?? "unknown"),
      issue: String(item.issue ?? "").trim(),
      evidence: String(item.evidence ?? "").trim(),
    };
  });
  return {
    findings,
    summary: String(record.summary ?? "").trim(),
  };
}

/**
 * Ask a model to judge one captured signup journey.
 *
 * Every failure here throws. A review that could not run is not a review that
 * found nothing, and an advisory lane that reports "clean" because the API was
 * unreachable is worse than no lane at all.
 */
export async function reviewSignupJourney(
  app: string,
  environment: string,
  steps: JourneyStep[],
): Promise<AgentReview> {
  if (steps.length === 0) {
    throw new Error("Agent review needs at least one captured step.");
  }
  const apiKey = requireApiKey();
  const model = process.env.SIGNUP_AGENT_MODEL?.trim() || DEFAULT_MODEL;

  const content: unknown[] = [
    {
      type: "text",
      text: `${RUBRIC}\n\nApp: ${app}\nEnvironment: ${environment}\nSteps captured: ${steps.length}`,
    },
  ];
  for (const step of steps) {
    content.push({
      type: "text",
      text: [
        `--- step: ${step.label}`,
        `url: ${step.url}`,
        step.consoleErrors.length > 0
          ? `console errors: ${step.consoleErrors.slice(0, 5).join(" | ")}`
          : "console errors: none",
        `visible text:\n${step.visibleText.slice(0, MAX_TEXT_PER_STEP)}`,
      ].join("\n"),
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: step.screenshot.toString("base64"),
      },
    });
  }

  const response = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2_000,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    // An unreadable body and an empty body are different facts, and the one
    // job this error has is to say why the review did not happen.
    const body = await response.text().then(
      (text) => text.slice(0, 300),
      (error) => `<body unreadable: ${String(error)}>`,
    );
    throw new Error(
      `Agent review request failed: HTTP ${response.status} ${body}`,
    );
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = payload.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new Error("Agent review response contained no text block.");
  }
  return coerceReview(extractJson(text));
}

export function renderReviewMarkdown(
  app: string,
  environment: string,
  review: AgentReview,
): string {
  const lines = [
    `### ${environment} ${app}`,
    "",
    review.summary || "_no summary_",
    "",
  ];
  if (review.findings.length === 0) {
    lines.push("No issues reported.");
    return lines.join("\n");
  }
  lines.push(
    "| Severity | Step | Issue | Evidence |",
    "| --- | --- | --- | --- |",
  );
  for (const finding of review.findings) {
    const cell = (value: string) =>
      value.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(
      `| ${finding.severity} | ${cell(finding.step)} | ${cell(finding.issue)} | ${cell(finding.evidence)} |`,
    );
  }
  return lines.join("\n");
}
