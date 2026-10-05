import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  artifactNameForSlot,
  buildDigest,
  classifyMessage,
  decideNotify,
  embedState,
  extractState,
  firstErrorLine,
  ISSUE_BODY_BUDGET,
  lastBetaE2eLine,
  main,
  parseResults,
  renderComment,
  renderIssueBody,
  renderSlack,
  reproduceCommands,
  shortJobName,
  slotForJobName,
  slotFromArtifactName,
  stripAnsi,
  writeOutputs,
  type DigestInput,
  type DigestState,
  type RunJob,
  type SlotResults,
} from "./beta-e2e-digest.ts";

const RUN = 1000;
const NOW = "2026-10-01T12:00:00.000Z";

interface FakeTest {
  describe?: string[];
  title: string;
  status?: "expected" | "unexpected" | "flaky" | "skipped";
  /**
   * For `skipped`: "skipped" is a test.skip / test.fixme; the default "passed"
   * is a test that never ran because the slot stopped (maxFailures or timeout).
   */
  expectedStatus?: "passed" | "skipped";
  error?: string;
  line?: number;
  file?: string;
  project?: string;
  attachments?: Array<{ name: string; path: string }>;
  annotations?: Array<{ type: string; description: string }>;
}

/** The shape Playwright's JSON reporter writes, reduced to what the digest reads. */
function fakeReport(
  file: string,
  tests: FakeTest[],
  extra: { errors?: Array<{ message: string }> } = {},
) {
  const counts = { expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
  const root = {
    title: file,
    file,
    specs: [] as unknown[],
    suites: [] as unknown[],
  };
  for (const test of tests) {
    const status = test.status ?? "unexpected";
    counts[status] += 1;
    const spec = {
      title: test.title,
      file: test.file ?? file,
      line: test.line ?? 10,
      tests: [
        {
          projectName: test.project ?? "journeys-core",
          status,
          expectedStatus:
            status === "skipped" ? (test.expectedStatus ?? "passed") : "passed",
          annotations: test.annotations ?? [],
          // Playwright writes no result for a test it never ran.
          results:
            status === "skipped"
              ? []
              : [
                  {
                    status: status === "expected" ? "passed" : "failed",
                    error: test.error ? { message: test.error } : undefined,
                    attachments: test.attachments ?? [],
                  },
                ],
        },
      ],
    };
    let suite = root;
    for (const title of test.describe ?? []) {
      let next = suite.suites.find(
        (candidate) => (candidate as { title: string }).title === title,
      ) as typeof root | undefined;
      if (!next) {
        next = { title, file, specs: [], suites: [] };
        suite.suites.push(next);
      }
      suite = next;
    }
    suite.specs.push(spec);
  }
  return {
    suites: [root],
    errors: extra.errors ?? [],
    stats: { ...counts, duration: 1 },
  };
}

function slot(name: string, report: unknown): SlotResults {
  return parseResults(report, name, artifactNameForSlot(name, RUN));
}

function job(
  name: string,
  conclusion: string | null,
  steps?: RunJob["steps"],
): RunJob {
  const id = Math.abs(hash(name));
  return {
    id,
    name: `Run beta E2E / ${name}`,
    html_url: `https://github.com/acme/repo/actions/runs/${RUN}/job/${id}`,
    conclusion,
    started_at: "2026-10-01T06:00:00Z",
    completed_at: "2026-10-01T06:45:20Z",
    steps: steps ?? [{ name: "Set up job", conclusion: "success" }],
  };
}

function hash(text: string): number {
  let value = 7;
  for (const char of text)
    value = (value * 31 + char.charCodeAt(0)) % 1_000_003;
  return value + 1;
}

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    runId: RUN,
    runNumber: 42,
    repo: "acme/repo",
    serverUrl: "https://github.com",
    sha: "0123456789abcdef",
    event: "schedule",
    runResult: "success",
    jobs: [],
    artifacts: [],
    slots: [],
    unreadable: [],
    logs: {},
    previous: null,
    now: NOW,
    ...overrides,
  };
}

function redState(overrides: Partial<DigestState> = {}): DigestState {
  return {
    v: 1,
    status: "red",
    run: 900,
    at: "2026-09-30T12:00:00.000Z",
    consecutiveRed: 3,
    firstRed: 800,
    lastGreen: 700,
    lastNotifiedAt: "2026-10-01T06:00:00.000Z",
    failing: [],
    overflow: 0,
    ...overrides,
  };
}

const chatFailure = fakeReport("chat.spec.ts", [
  {
    describe: ["slides agent chat"],
    title: "completes and restores a turn",
    project: "chat",
    line: 65,
    error:
      "\u001b[31mError: slides did not restore the reply after reload\u001b[39m\n\nExpected: visible",
    attachments: [
      {
        name: "screenshot",
        path: "/home/runner/work/r/r/e2e/beta/test-results/authed-chat-slides/x/test-failed-1.png",
      },
      {
        name: "error-context",
        path: "/home/runner/work/r/r/e2e/beta/test-results/authed-chat-slides/x/error-context.md",
      },
    ],
  },
]);

describe("text helpers", () => {
  it("strips ANSI escapes and reports the first real line", () => {
    const raw =
      "\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoMatch\n\nExpected";
    assert.equal(stripAnsi(raw), "expect(received).toMatch\n\nExpected");
    assert.equal(firstErrorLine(raw), "expect(received).toMatch");
    assert.equal(firstErrorLine("\n\n  "), "(no error message recorded)");
  });

  it("truncates a long first line to 200 characters", () => {
    const line = firstErrorLine(`Error: ${"x".repeat(500)}`);
    assert.equal(line.length, 200);
    assert.ok(line.endsWith("…"));
  });

  it("classifies env, infra-timeout, and product messages", () => {
    assert.equal(
      classifyMessage("No beta session credential was supplied"),
      "env",
    );
    assert.equal(
      classifyMessage(
        "Beta session bootstrap for chat resolved to a@b.c, not the expected x@y.z.",
      ),
      "env",
    );
    // An engine-less turn whose account resolves elsewhere is the account's
    // configuration, not a Chat regression.
    assert.equal(
      classifyMessage(
        "Agent chat did not provably run on luna through the dedicated key.\n1 request(s) named no engine, so the server chose it, and nothing proved that engine is ai-sdk:openai: the account resolves to engine builder, not ai-sdk:openai",
      ),
      "env",
    );
    assert.equal(
      classifyMessage(
        "named no engine: the app's default engine is builder, which overrides the account's ai-sdk:openai",
      ),
      "env",
    );
    assert.equal(
      classifyMessage(
        "Agent chat did not provably run on luna through the dedicated key.\nnon-luna models: claude-opus-4-8",
      ),
      "product",
    );
    assert.equal(
      classifyMessage(
        'chat: setup exceeded its 150s deadline while "installing"',
      ),
      "infra-timeout",
    );
    assert.equal(
      classifyMessage("Timed out waiting 11m for the global setup to run"),
      "infra-timeout",
    );
    assert.equal(
      classifyMessage("apiRequestContext.post: Timeout 20000ms exceeded."),
      "infra-timeout",
    );
    assert.equal(
      classifyMessage("expect(locator).toBeVisible() failed\nTimeout: 30000ms"),
      "product",
    );
  });

  it("derives slots from job and artifact names", () => {
    assert.equal(
      slotForJobName("Run beta E2E / slides public sweep"),
      "public-slides",
    );
    assert.equal(slotForJobName("Run beta E2E / Fleet-wide checks"), "fleet");
    assert.equal(
      slotForJobName("Run beta E2E / Advisory findings (non-gating)"),
      "advisory",
    );
    assert.equal(
      slotForJobName("Run beta E2E / Authenticated chat-slides"),
      "authed-chat-slides",
    );
    assert.equal(
      slotForJobName("Run beta E2E / Typecheck and helper tests"),
      null,
    );
    assert.equal(
      shortJobName("Run beta E2E / Authenticated registry"),
      "Authenticated registry",
    );
    assert.equal(
      slotFromArtifactName("beta-e2e-authed-chat-slides-1000", 1000),
      "authed-chat-slides",
    );
    assert.equal(slotFromArtifactName("beta-e2e-fleet-1000", 1000), "fleet");
  });

  it("finds the last [beta-e2e] line without its timestamp or colour", () => {
    const log = [
      "2026-10-01T06:44:31.1Z [beta-e2e] fleet: slides (1 host(s))",
      "2026-10-01T06:44:40.1Z \u001b[32m[beta-e2e]   chat: installing the OpenAI key…\u001b[0m",
      "2026-10-01T07:29:50.1Z ##[error]The operation was canceled.",
    ].join("\n");
    assert.equal(
      lastBetaE2eLine(log),
      "[beta-e2e]   chat: installing the OpenAI key…",
    );
    assert.equal(lastBetaE2eLine("nothing relevant"), null);
  });
});

describe("digest outcomes", () => {
  it("is green and quiet when nothing failed", () => {
    const digest = buildDigest(
      input({
        slots: [
          slot(
            "public-slides",
            fakeReport("fleet-public.spec.ts", [
              { title: "loads", status: "expected", project: "public" },
            ]),
          ),
        ],
      }),
    );
    assert.equal(digest.status, "green");
    assert.equal(digest.entries.length, 0);
    assert.deepEqual(digest.notify, { shouldNotify: false, reason: null });
    assert.match(renderIssueBody(digest), /Status: GREEN/);
    assert.equal(renderComment(digest), null);
  });

  it("reports a product failure with everything needed to act on it", () => {
    const digest = buildDigest(
      input({
        runResult: "failure",
        jobs: [
          job("Authenticated chat-slides", "failure", [
            { name: "Authenticated chat-slides", conclusion: "failure" },
          ]),
        ],
        artifacts: [{ id: 777, name: "beta-e2e-authed-chat-slides-1000" }],
        slots: [slot("authed-chat-slides", chatFailure)],
      }),
    );
    assert.equal(digest.status, "red");
    const [entry] = digest.entries;
    assert.ok(entry?.test);
    assert.equal(entry.class, "product");
    assert.equal(entry.state, "new");
    assert.equal(entry.test.app, "slides");
    assert.equal(entry.test.project, "chat");
    assert.equal(entry.test.file, "e2e/beta/specs/chat.spec.ts");
    assert.equal(entry.test.line, 65);
    assert.equal(
      entry.test.error,
      "Error: slides did not restore the reply after reload",
    );
    assert.deepEqual(entry.test.attachments, [
      "test-results/authed-chat-slides/x/test-failed-1.png",
      "test-results/authed-chat-slides/x/error-context.md",
    ]);

    const body = renderIssueBody(digest);
    assert.match(body, /Status: RED/);
    assert.match(
      body,
      /\[Authenticated chat-slides\]\(https:\/\/github\.com\/acme\/repo\/actions\/runs\/1000\/job\/\d+\)/,
    );
    assert.match(body, /e2e\/beta\/specs\/chat\.spec\.ts:65/);
    assert.match(body, /slides agent chat > completes and restores a turn/);
    assert.match(body, /\[product\]/);
    assert.match(
      body,
      /https:\/\/github\.com\/acme\/repo\/actions\/runs\/1000\/artifacts\/777/,
    );
    assert.match(
      body,
      /gh run download 1000 -n beta-e2e-authed-chat-slides-1000/,
    );
    assert.match(
      body,
      /gh workflow run beta-e2e\.yml --ref main -f apps=slides -f lane=authed -f grep='slides agent chat completes and restores a turn'/,
    );
    assert.match(
      body,
      /BETA_E2E_APPS=slides pnpm e2e:beta --project=chat --grep 'slides agent chat completes and restores a turn'/,
    );
    assert.match(body, /beta-e2e-state:v1/);
    assert.deepEqual(digest.notify, {
      shouldNotify: true,
      reason: "first-report",
    });
  });

  it("builds a reproduce command that survives quotes and regex characters", () => {
    const { ci, local } = reproduceCommands({
      slot: "public-clips",
      app: "clips",
      project: "public",
      grep: "it's (not) a.b",
    });
    assert.equal(
      ci,
      "gh workflow run beta-e2e.yml --ref main -f apps=clips -f lane=public -f grep='it'\\''s \\(not\\) a\\.b'",
    );
    assert.match(
      local,
      /^BETA_E2E_APPS=clips pnpm e2e:beta --project=public --grep /,
    );
  });

  it("lists flaky tests separately and does not page for them", () => {
    const flakyOnly = fakeReport("registry.spec.ts", [
      {
        describe: ["crm registry"],
        title: "is signed in",
        status: "flaky",
        project: "registry",
      },
      {
        describe: ["crm registry"],
        title: "reaches surfaces",
        status: "expected",
        project: "registry",
      },
    ]);
    const digest = buildDigest(
      input({
        slots: [slot("authed-registry", flakyOnly)],
        previous: redState({ failing: [] }),
      }),
    );
    assert.equal(digest.counts.flaky, 1);
    assert.equal(digest.status, "green");
    assert.equal(digest.entries.length, 0);
    const body = renderIssueBody(digest);
    assert.match(body, /Flaky in this run \(1, passed on retry, not paged\)/);
    // red to green is a recovery, never a flaky page:
    assert.equal(digest.notify.reason, "recovered");
    assert.doesNotMatch(renderSlack(digest), /flaky/i);
  });

  it("keeps advisory findings out of the failing set", () => {
    const advisory = fakeReport("advisory.spec.ts", [
      {
        describe: ["fleet"],
        title: "is not indexable",
        project: "advisory",
        error: "Error: indexable",
      },
    ]);
    const digest = buildDigest(input({ slots: [slot("advisory", advisory)] }));
    assert.equal(digest.status, "green");
    assert.equal(digest.advisory.length, 1);
    assert.match(
      renderIssueBody(digest),
      /Advisory findings \(1, non-gating\)/,
    );
  });

  it("reports tests skipped for the e2e account's setup as not tested, never as failing", () => {
    const storage =
      "[env] e2e account has no private storage; connect Builder storage to the e2e account";
    const report = fakeReport("apps/journey-slides-pdf-import.spec.ts", [
      {
        title:
          "[journey] [slides-import] slides: a PDF upload returns a handle",
        project: "journeys-flows",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [{ type: "skip", description: storage }],
      },
      {
        title: "[journey] [slides-import] slides: Import > PDF creates a deck",
        project: "journeys-flows",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [{ type: "skip", description: storage }],
      },
      {
        // Left out of the run on purpose: not an account-setup gap.
        title: "[journey] [forms] forms: create and publish",
        project: "journeys-flows",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [
          { type: "skip", description: "forms is not in this run's selection" },
        ],
      },
      {
        // A passing test that merely carries an [env] note is not a skip.
        title: "[journey] [dispatch-apps] dispatch opens each app",
        project: "journeys-flows",
        status: "expected",
        annotations: [{ type: "note", description: "[env] informational" }],
      },
    ]);
    const parsed = slot("authed-journeys-flows", report);
    assert.equal(parsed.stats.skipped, 3);
    assert.equal(parsed.envSkipped.length, 2);
    assert.equal(parsed.envSkipped[0]?.app, "slides");
    assert.equal(parsed.envSkipped[0]?.project, "journeys-flows");
    assert.equal(
      parsed.envSkipped[0]?.reason,
      "e2e account has no private storage; connect Builder storage to the e2e account",
    );

    const digest = buildDigest(input({ slots: [parsed] }));
    assert.equal(digest.status, "green");
    assert.equal(digest.entries.length, 0);
    assert.equal(digest.envSkipped.length, 2);

    const body = renderIssueBody(digest);
    assert.match(
      body,
      /- Not tested: 2 tests skipped because the e2e account is not set up for them \(slides\): e2e account has no private storage/,
    );
    assert.match(
      body,
      /### Skipped: the e2e account is not set up for these \(2, not failing\)/,
    );
    assert.match(body, /connect Builder storage to the e2e account/);
    assert.doesNotMatch(body, /forms is not in this run's selection/);
    assert.match(
      renderSlack(digest),
      /NOT TESTED: 2 tests skipped because the e2e account/,
    );
  });

  it("says nothing about account setup when no test skipped for it", () => {
    const digest = buildDigest(
      input({
        slots: [
          slot(
            "authed-journeys-core",
            fakeReport("a.spec.ts", [
              { title: "passes", status: "expected" },
              {
                title: "left out",
                status: "skipped",
                expectedStatus: "skipped",
                annotations: [
                  { type: "skip", description: "design is not selected" },
                ],
              },
            ]),
          ),
        ],
      }),
    );
    assert.equal(digest.envSkipped.length, 0);
    assert.doesNotMatch(
      renderIssueBody(digest),
      /Not tested|account is not set up/,
    );
    assert.doesNotMatch(renderSlack(digest), /NOT TESTED/);
  });

  it("keeps the not-tested line in a red run's Slack message and the issue", () => {
    const failing = fakeReport("chat.spec.ts", [
      {
        describe: ["chat agent chat"],
        title: "completes",
        project: "chat",
        error: "Error: boom",
      },
      {
        title: "[journey] [slides-import] upload",
        project: "journeys-flows",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [{ type: "skip", description: "[env] no storage" }],
      },
    ]);
    const digest = buildDigest(
      input({ slots: [slot("authed-chat-chat", failing)] }),
    );
    assert.equal(digest.status, "red");
    const slack = renderSlack(digest).split("\n");
    assert.ok(slack.length <= 12);
    assert.ok(slack.some((line) => /^NOT TESTED: 1 test skipped/.test(line)));
    assert.match(renderIssueBody(digest), /- Not tested: 1 test skipped/);
  });

  it("reports a test.fixme parked as QUARANTINED with its text, never as a plain skip or a failure", () => {
    const quarantine =
      "QUARANTINED steve until 2026-10-15: the Chat app sends the picked engine in request metadata, so the spend guard cannot prove the dedicated key";
    const report = fakeReport("chat.spec.ts", [
      {
        describe: ["chat agent chat"],
        title: "completes and restores a turn on luna",
        project: "chat",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [{ type: "fixme", description: quarantine }],
      },
      {
        describe: ["chat agent chat"],
        title: "clears the stop button when a turn ends",
        project: "chat",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [{ type: "fixme", description: quarantine }],
      },
      {
        // A fixme with an ordinary reason is a skip, not a quarantine.
        describe: ["chat agent chat"],
        title: "keeps the environment badge clear of the send button",
        project: "chat",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [{ type: "fixme", description: "flaky layout" }],
      },
      {
        describe: ["chat agent chat"],
        title: "renders the composer",
        project: "chat",
        status: "expected",
      },
    ]);
    const parsed = slot("authed-chat-chat", report);
    assert.equal(parsed.stats.skipped, 3);
    assert.equal(parsed.quarantined.length, 2);
    assert.equal(parsed.quarantined[0]?.app, "chat");
    assert.equal(parsed.quarantined[0]?.project, "chat");
    assert.equal(
      parsed.quarantined[0]?.reason,
      quarantine.replace(/^QUARANTINED /, ""),
    );
    assert.equal(parsed.envSkipped.length, 0);

    const digest = buildDigest(input({ slots: [parsed] }));
    assert.equal(digest.status, "green");
    assert.equal(digest.entries.length, 0);
    assert.equal(digest.quarantined.length, 2);

    const body = renderIssueBody(digest);
    assert.match(
      body,
      /- Quarantined: 2 tests not running \(chat\): steve until 2026-10-15: the Chat app sends the picked engine/,
    );
    assert.match(body, /### Quarantined: parked on purpose, not running \(2,/);
    assert.match(body, /completes and restores a turn on luna/);
    assert.doesNotMatch(body, /flaky layout/);
    assert.match(
      renderSlack(digest),
      /QUARANTINED: 2 tests not running \(chat\): steve until 2026-10-15/,
    );
  });

  it("keeps the quarantine line in a red run's Slack message and the issue", () => {
    const failing = fakeReport("chat.spec.ts", [
      {
        describe: ["chat agent chat"],
        title: "completes",
        project: "chat",
        error: "Error: boom",
      },
      {
        describe: ["chat agent chat"],
        title: "parked",
        project: "chat",
        status: "skipped",
        expectedStatus: "skipped",
        annotations: [
          {
            type: "skip",
            description: "QUARANTINED steve until 2026-10-15: x",
          },
        ],
      },
    ]);
    const digest = buildDigest(
      input({ slots: [slot("authed-chat-chat", failing)] }),
    );
    assert.equal(digest.status, "red");
    const slack = renderSlack(digest).split("\n");
    assert.ok(slack.length <= 12);
    assert.ok(
      slack.some((line) => /^QUARANTINED: 1 test not running/.test(line)),
    );
    assert.match(renderIssueBody(digest), /- Quarantined: 1 test not running/);
  });

  it("names a killed job that left no results, with the last [beta-e2e] line", () => {
    const killed = job("Authenticated chat-slides", "cancelled", [
      { name: "Run actions/checkout", conclusion: "success" },
      { name: "Authenticated chat-slides", conclusion: "cancelled" },
    ]);
    const digest = buildDigest(
      input({
        runResult: "cancelled",
        jobs: [killed],
        artifacts: [{ id: 5, name: "beta-e2e-authed-chat-slides-1000" }],
        logs: {
          [killed.id]:
            "2026-10-01T06:50:00Z [beta-e2e]   slides: installing the OpenAI key…\n2026-10-01T07:29:50Z ##[error]The operation was canceled.",
        },
      }),
    );
    assert.equal(digest.status, "red");
    const [entry] = digest.entries;
    assert.equal(entry?.kind, "job");
    assert.equal(entry?.class, "infra-timeout");
    assert.equal(
      entry?.fact?.message,
      'no test results: job "Authenticated chat-slides" cancelled at step "Authenticated chat-slides" after 45m 20s; its artifact holds no results.json; last [beta-e2e] log line: [beta-e2e]   slides: installing the OpenAI key…',
    );
    const body = renderIssueBody(digest);
    assert.match(body, /Jobs and setup without usable test results/);
    assert.match(body, /The operation was canceled/);
    assert.match(body, /actions\/runs\/1000\/artifacts\/5/);
  });

  it("says so when the job log was never fetched", () => {
    const killed = job("Authenticated journeys", "failure", [
      { name: "Authenticated journeys", conclusion: "failure" },
    ]);
    const digest = buildDigest(input({ runResult: "failure", jobs: [killed] }));
    assert.match(
      digest.entries[0]?.fact?.message ?? "",
      /it uploaded no artifact; last \[beta-e2e\] log line: the job log was not fetched/,
    );
  });

  it("classifies setup and credential failures as env, not product", () => {
    const setupFailure = fakeReport("registry.spec.ts", [], {
      errors: [
        {
          message:
            "[beta-e2e] authenticated setup failed for 1 of 12 host(s):\nchat: Beta session bootstrap for chat resolved to a@b.c, not the expected x@y.z.",
        },
      ],
    });
    const digest = buildDigest(
      input({
        runResult: "failure",
        slots: [slot("authed-registry", setupFailure)],
      }),
    );
    const [entry] = digest.entries;
    assert.equal(entry?.kind, "setup");
    assert.equal(entry?.class, "env");
    assert.match(renderIssueBody(digest), /resolved to a@b\.c/);
  });

  it("reports a globalTimeout kill as infra-timeout with the setup message", () => {
    const hung = fakeReport("chat.spec.ts", [], {
      errors: [
        { message: "Timed out waiting 11m for the global setup to run" },
      ],
    });
    const digest = buildDigest(
      input({ runResult: "failure", slots: [slot("authed-chat-chat", hung)] }),
    );
    assert.equal(digest.entries[0]?.class, "infra-timeout");
    assert.match(renderSlack(digest), /Timed out waiting 11m/);
  });

  it("reports unreadable results as a fact instead of dropping them", () => {
    const digest = buildDigest(
      input({
        unreadable: [
          {
            slot: "authed-design",
            artifactName: "beta-e2e-authed-design-1000",
            error: "Unexpected end of JSON input",
          },
        ],
      }),
    );
    assert.equal(digest.status, "red");
    assert.match(
      digest.entries[0]?.carriedReason ?? "",
      /could not be read: Unexpected end of JSON input/,
    );
  });

  it("does not report green when the run failed but nothing explains why", () => {
    const digest = buildDigest(input({ runResult: "failure" }));
    assert.equal(digest.status, "red");
    assert.equal(digest.entries[0]?.class, "unclassified");
    assert.match(renderIssueBody(digest), /no failing test or job identified/);
  });

  it("names the app of a journey test that has no describe, so its reproduce command is valid", () => {
    const journeys = (
      file: string,
      title: string,
      project: string,
      slotName: string,
    ) =>
      buildDigest(
        input({
          runResult: "failure",
          slots: [
            slot(
              slotName,
              fakeReport(file, [{ title, project, error: "Error: x" }]),
            ),
          ],
        }),
      ).entries[0]?.test;
    const forms = journeys(
      "apps/journey-forms-lifecycle.spec.ts",
      "[journey] [forms] forms: create, publish, submit as an anonymous visitor, and see the response",
      "journeys-flows",
      "authed-journeys-flows",
    );
    assert.equal(forms?.app, "forms");
    const pair = journeys(
      "apps/journey-session-stability.spec.ts",
      "[journey] [session] slides then design in a new tab: still signed in on arrival",
      "journeys-session",
      "authed-journeys-session-2",
    );
    assert.equal(pair?.app, "slides");
    const credentials = journeys(
      "apps/journey-credential-state.spec.ts",
      "[journey] [credentials] analytics shows no false credits or connect blocker",
      "journeys-credentials",
      "authed-journeys-credentials",
    );
    assert.equal(credentials?.app, "analytics");
    assert.match(
      reproduceCommands({
        slot: "authed-journeys-credentials",
        app: credentials?.app ?? "",
        project: credentials?.project ?? "",
        grep: credentials?.grep ?? "",
      }).local,
      /^BETA_E2E_APPS=analytics pnpm e2e:beta --project=journeys-credentials /,
    );
    // An untagged title with no describe still reads its first word.
    const untagged = journeys(
      "apps/analytics-dashboard-create-rename.spec.ts",
      "Analytics beta creates, renames, and removes a SQL dashboard",
      "journeys-core",
      "authed-journeys-core",
    );
    assert.equal(untagged?.app, "analytics");
  });

  it("closes an open issue on a green run even when it has no state marker", () => {
    const green = (overrides: Partial<DigestInput>) =>
      buildDigest(
        input({
          slots: [
            slot(
              "authed-registry",
              fakeReport("registry.spec.ts", [
                { title: "ok", status: "expected", project: "registry" },
              ]),
            ),
          ],
          ...overrides,
        }),
      );
    const decide = (digest: ReturnType<typeof green>) => {
      const dir = mkdtempSync(path.join(tmpdir(), "beta-e2e-digest-"));
      try {
        writeOutputs(digest, dir);
        const commentFile = path.join(dir, "comment.md");
        return {
          decision: JSON.parse(
            readFileSync(path.join(dir, "decision.json"), "utf8"),
          ) as { issueAction: string; hasComment: boolean },
          comment: existsSync(commentFile)
            ? readFileSync(commentFile, "utf8")
            : null,
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    // The legacy issue (#3986) has no marker, so `previous` is null.
    const legacy = decide(green({ issueNumber: 3986 }));
    assert.equal(legacy.decision.issueAction, "close");
    assert.equal(legacy.decision.hasComment, true);
    assert.match(legacy.comment ?? "", /still open without a red state/);
    // Nothing open and nothing red before: nothing to close.
    const none = decide(green({}));
    assert.equal(none.decision.issueAction, "none");
    assert.equal(none.comment, null);
  });

  it("flags a slot that stopped at maxFailures", () => {
    const many = fakeReport(
      "settings-navigation.spec.ts",
      Array.from({ length: 8 }, (_, index) => ({
        describe: ["dispatch settings"],
        title: `case ${index}`,
        error: "Error: x",
      })),
    );
    const digest = buildDigest(
      input({ runResult: "failure", slots: [slot("authed-journeys", many)] }),
    );
    assert.deepEqual(digest.stoppedEarly, ["authed-journeys"]);
    assert.match(
      renderIssueBody(digest),
      /Stopped early at maxFailures in: authed-journeys/,
    );
  });
});

describe("transitions against the previous run", () => {
  const failingTests = (titles: string[]): FakeTest[] =>
    titles.map((title) => ({
      describe: ["slides agent chat"],
      title,
      project: "chat",
      error: "Error: nope",
    }));
  const failing = (titles: string[]) =>
    fakeReport("chat.spec.ts", failingTests(titles));

  it("marks NEW, STILL FAILING since a run, and FIXED", () => {
    const before = buildDigest(
      input({
        runId: 900,
        runResult: "failure",
        slots: [
          parseResults(
            failing(["a", "b"]),
            "authed-chat-slides",
            "beta-e2e-authed-chat-slides-900",
          ),
        ],
      }),
    );
    // `a` ran and passed this time, which is what makes it FIXED.
    const digest = buildDigest(
      input({
        runResult: "failure",
        slots: [
          slot(
            "authed-chat-slides",
            fakeReport("chat.spec.ts", [
              {
                describe: ["slides agent chat"],
                title: "a",
                project: "chat",
                status: "expected",
              },
              ...failingTests(["b", "c"]),
            ]),
          ),
        ],
        previous: before.state,
      }),
    );
    const byTitle = Object.fromEntries(
      digest.entries.map((entry) => [
        entry.test?.title.split(" > ").pop(),
        entry,
      ]),
    );
    assert.equal(byTitle.c?.state, "new");
    assert.equal(byTitle.b?.state, "still");
    assert.equal(byTitle.b?.since, 900);
    assert.equal(digest.fixed.length, 1);
    assert.match(
      digest.fixed[0]?.l ?? "",
      /slides · chat · slides agent chat > a/,
    );
    assert.equal(digest.state.consecutiveRed, 2);
    assert.equal(digest.state.firstRed, 900);
    assert.deepEqual(digest.notify, {
      shouldNotify: true,
      reason: "new-failures",
    });

    const body = renderIssueBody(digest);
    assert.match(body, /NEW/);
    assert.match(body, /STILL FAILING since \[#900\]/);
    assert.match(body, /Fixed since the previous run/);
    assert.match(
      renderComment(digest) ?? "",
      /NEW 1, STILL FAILING 1, FIXED 1/,
    );
  });

  it("does not call a failure fixed when its slot produced no results", () => {
    const before = buildDigest(
      input({
        runId: 900,
        runResult: "failure",
        slots: [
          parseResults(
            failing(["a"]),
            "authed-chat-slides",
            "beta-e2e-authed-chat-slides-900",
          ),
        ],
      }),
    );
    const killed = job("Authenticated chat-slides", "cancelled", [
      { name: "Authenticated chat-slides", conclusion: "cancelled" },
    ]);
    const digest = buildDigest(
      input({ runResult: "cancelled", jobs: [killed], previous: before.state }),
    );
    assert.equal(digest.fixed.length, 0);
    const [carried] = digest.notRun;
    assert.ok(carried);
    assert.equal(carried.kind, "carried");
    assert.equal(carried.state, "still");
    assert.match(carried.carriedReason ?? "", /not re-run/);
    // The killed job is what keeps the run red; the carried test does not.
    assert.equal(digest.status, "red");
    assert.equal(digest.entries.length, 1);
    assert.equal(digest.entries[0]?.kind, "job");
  });

  describe("a test that did not run is NOT RUN, never FIXED", () => {
    const redFirst = (titles: string[]) =>
      buildDigest(
        input({
          runId: 900,
          runResult: "failure",
          slots: [
            parseResults(
              failing(titles),
              "authed-journeys-session-1",
              "beta-e2e-authed-journeys-session-1-900",
            ),
          ],
          now: "2026-10-01T06:00:00.000Z",
        }),
      );
    const timedOut = (tests: FakeTest[]) =>
      fakeReport("chat.spec.ts", tests, {
        errors: [
          { message: "Timed out waiting 900s for the test suite to run" },
        ],
      });
    const labelOf = (title: string) =>
      `slides · chat · slides agent chat > ${title}`;

    it("keeps a failure out of FIXED when its slot hit the global timeout before running it", () => {
      const before = redFirst(["a", "b"]);
      const digest = buildDigest(
        input({
          runResult: "failure",
          slots: [
            slot(
              "authed-journeys-session-1",
              timedOut([
                ...failingTests(["b"]),
                // Never executed: Playwright reports it skipped with no result.
                {
                  describe: ["slides agent chat"],
                  title: "a",
                  project: "chat",
                  status: "skipped",
                },
              ]),
            ),
          ],
          previous: before.state,
        }),
      );
      assert.equal(digest.fixed.length, 0);
      assert.equal(digest.status, "red");
      const [notRun] = digest.notRun;
      assert.match(notRun?.label ?? "", /slides agent chat > a$/);
      assert.match(notRun?.carriedReason ?? "", /stopped early/);
      // Still tracked, so it cannot come back as NEW and page anyone.
      assert.ok(digest.state.failing.some((entry) => entry.l.endsWith("> a")));
      assert.equal(digest.totals.notRun, 1);

      const next = buildDigest(
        input({
          runId: 1001,
          runResult: "failure",
          slots: [
            parseResults(
              failing(["a", "b"]),
              "authed-journeys-session-1",
              "beta-e2e-authed-journeys-session-1-1001",
            ),
          ],
          previous: digest.state,
          now: "2026-10-01T13:00:00.000Z",
        }),
      );
      assert.equal(next.counts.newFailures, 0);
      assert.equal(next.notRun.length, 0);
      assert.deepEqual(next.notify, { shouldNotify: false, reason: null });
      assert.ok(
        !(renderComment(next) ?? "").includes("New:"),
        "a failure that was only NOT RUN last time must not be announced as new",
      );
    });

    it("calls a failure FIXED only after it executed and passed", () => {
      const before = redFirst(["a", "b", "c", "d"]);
      const digest = buildDigest(
        input({
          runResult: "failure",
          slots: [
            slot(
              "authed-journeys-session-1",
              fakeReport("chat.spec.ts", [
                {
                  describe: ["slides agent chat"],
                  title: "a",
                  project: "chat",
                  status: "expected",
                },
                {
                  describe: ["slides agent chat"],
                  title: "b",
                  project: "chat",
                  status: "flaky",
                },
                // test.fixme: skipped on purpose, expected to be skipped.
                {
                  describe: ["slides agent chat"],
                  title: "c",
                  project: "chat",
                  status: "skipped",
                  expectedStatus: "skipped",
                },
                // "d" is not in the report at all (renamed or removed).
                ...failingTests(["e"]),
              ]),
            ),
          ],
          previous: before.state,
        }),
      );
      assert.deepEqual(digest.fixed.map((entry) => entry.l).sort(), [
        labelOf("a"),
        labelOf("b"),
      ]);
      const byLabel = Object.fromEntries(
        digest.notRun.map((entry) => [entry.label, entry.carriedReason ?? ""]),
      );
      assert.match(byLabel[labelOf("c")] ?? "", /skipped it this time/);
      assert.match(
        byLabel[labelOf("d")] ?? "",
        /filtered out, renamed, or removed/,
      );
      assert.equal(digest.counts.fixed, 2);
      assert.equal(digest.counts.notRun, 2);
    });

    it("never turns a run red or pages on its own, and a recovery says what was not verified", () => {
      const before = redFirst(["a"]);
      const digest = buildDigest(
        input({
          slots: [
            slot(
              "authed-journeys-session-1",
              fakeReport("chat.spec.ts", [
                {
                  describe: ["slides agent chat"],
                  title: "other",
                  project: "chat",
                  status: "expected",
                },
              ]),
            ),
          ],
          previous: before.state,
          issueNumber: 3986,
          issueUrl: "https://github.com/acme/repo/issues/3986",
        }),
      );
      assert.equal(digest.status, "green");
      assert.equal(digest.counts.notRun, 1);
      assert.equal(digest.notify.reason, "recovered");
      assert.match(
        renderIssueBody(digest),
        /Status: GREEN\.\*\* No gating failures in this run\. 1 previously failing test did not run this time, so it is not verified fixed\./,
      );
      assert.match(
        renderComment(digest) ?? "",
        /1 previously failing test did not run this time/,
      );
      assert.match(renderSlack(digest), /NOT RUN: 1 previously failing test/);
      // A green run drops the tracked state, NOT RUN entries included.
      assert.deepEqual(digest.state.failing, []);
    });

    it("does not comment or notify when only the NOT RUN set changes", () => {
      const before = redFirst(["a", "b"]);
      const digest = buildDigest(
        input({
          runResult: "failure",
          slots: [
            slot(
              "authed-journeys-session-1",
              fakeReport("chat.spec.ts", [
                ...failingTests(["b"]),
                // "a" was fixme'd since the last run: it no longer executes.
                {
                  describe: ["slides agent chat"],
                  title: "a",
                  project: "chat",
                  status: "skipped",
                  expectedStatus: "skipped",
                },
              ]),
            ),
          ],
          previous: before.state,
          now: "2026-10-01T07:00:00.000Z",
        }),
      );
      assert.equal(digest.counts.notRun, 1);
      assert.equal(digest.counts.newFailures, 0);
      assert.equal(digest.counts.fixed, 0);
      assert.equal(digest.stateChanged, false);
      assert.equal(renderComment(digest), null);
      assert.deepEqual(digest.notify, { shouldNotify: false, reason: null });
      assert.ok(
        digest.entries.every((entry) => entry.kind !== "carried"),
        "a NOT RUN entry must never sit among the gating entries",
      );
    });

    it("renders NOT RUN in the issue table and the Slack text", () => {
      const before = redFirst(["a", "b"]);
      const digest = buildDigest(
        input({
          runResult: "failure",
          slots: [
            slot(
              "authed-journeys-session-1",
              timedOut([
                ...failingTests(["b"]),
                {
                  describe: ["slides agent chat"],
                  title: "a",
                  project: "chat",
                  status: "skipped",
                },
              ]),
            ),
          ],
          previous: before.state,
        }),
      );
      const body = renderIssueBody(digest);
      assert.match(body, /NOT RUN 1\./);
      assert.match(body, /### Not run this time \(1, not verified fixed\)/);
      assert.match(body, /\| NOT RUN \(last failed in \[#900\]/);
      assert.match(body, /1 did not run \(a slot stopped early or timed out\)/);
      assert.match(renderSlack(digest), /NOT RUN 1/);
      assert.match(renderComment(digest) ?? "", /NOT RUN 1\)/);
    });

    it("verifies a setup failure by the slot running tests, and carries it otherwise", () => {
      const setupFailure = fakeReport("registry.spec.ts", [], {
        errors: [
          { message: "Timed out waiting 7m for the global setup to run" },
        ],
      });
      const before = buildDigest(
        input({
          runId: 900,
          runResult: "failure",
          slots: [
            parseResults(
              setupFailure,
              "authed-registry",
              "beta-e2e-authed-registry-900",
            ),
          ],
        }),
      );
      assert.equal(before.state.failing[0]?.t, "setup");

      const recovered = buildDigest(
        input({
          slots: [
            slot(
              "authed-registry",
              fakeReport("registry.spec.ts", [
                {
                  title: "reaches surfaces",
                  status: "expected",
                  project: "registry",
                },
              ]),
            ),
          ],
          previous: before.state,
        }),
      );
      assert.equal(recovered.counts.fixed, 1);
      assert.equal(recovered.notRun.length, 0);

      // The slot reports, but no test executed: the setup failure is not shown fixed.
      const idle = buildDigest(
        input({
          runResult: "failure",
          slots: [
            slot(
              "authed-registry",
              fakeReport("registry.spec.ts", [
                {
                  title: "reaches surfaces",
                  status: "skipped",
                  expectedStatus: "skipped",
                  project: "registry",
                },
              ]),
            ),
            slot("authed-chat-slides", chatFailure),
          ],
          previous: before.state,
        }),
      );
      assert.equal(idle.counts.fixed, 0);
      assert.match(
        idle.notRun[0]?.carriedReason ?? "",
        /ran no tests this time/,
      );
    });

    it("reads a marker written before kinds were tracked as test failures", () => {
      const legacy = redState({
        failing: [
          {
            k: "legacy-pass",
            s: "authed-chat-slides",
            r: 900,
            l: "slides · chat · slides agent chat > old",
            c: "product",
          },
        ],
      });
      const digest = buildDigest(
        input({
          slots: [
            slot(
              "authed-chat-slides",
              fakeReport("chat.spec.ts", [
                { title: "x", status: "expected", project: "chat" },
              ]),
            ),
          ],
          previous: legacy,
        }),
      );
      // Not in this run's results, so it is not fixed, whatever its slot did.
      assert.equal(digest.counts.fixed, 0);
      assert.equal(digest.notRun[0]?.carriedKind, "test");
    });
  });

  it("recovers: green after red notifies, comments, and closes", () => {
    const before = buildDigest(
      input({
        runId: 900,
        runResult: "failure",
        slots: [
          parseResults(
            failing(["a"]),
            "authed-chat-slides",
            "beta-e2e-authed-chat-slides-900",
          ),
        ],
      }),
    );
    const digest = buildDigest(
      input({
        previous: before.state,
        slots: [
          slot(
            "authed-chat-slides",
            fakeReport("chat.spec.ts", [
              { title: "a", status: "expected", project: "chat" },
            ]),
          ),
        ],
      }),
    );
    assert.equal(digest.status, "green");
    assert.equal(digest.notify.reason, "recovered");
    assert.equal(digest.state.consecutiveRed, 0);
    assert.equal(digest.state.lastGreen, RUN);
    assert.match(
      renderComment(digest) ?? "",
      /Recovered in .*red for 1 consecutive run/,
    );
    assert.match(renderSlack(digest), /Beta E2E recovered/);
  });

  it("is quiet for an identical red run and comments only on change", () => {
    const first = buildDigest(
      input({
        runId: 900,
        runResult: "failure",
        slots: [
          parseResults(
            failing(["a"]),
            "authed-chat-slides",
            "beta-e2e-authed-chat-slides-900",
          ),
        ],
        now: "2026-10-01T06:00:00.000Z",
      }),
    );
    const second = buildDigest(
      input({
        runResult: "failure",
        slots: [slot("authed-chat-slides", failing(["a"]))],
        previous: first.state,
        now: "2026-10-01T12:00:00.000Z",
      }),
    );
    assert.equal(second.stateChanged, false);
    assert.equal(renderComment(second), null);
    assert.deepEqual(second.notify, { shouldNotify: false, reason: null });
    assert.equal(second.state.lastNotifiedAt, first.state.lastNotifiedAt);
    assert.equal(second.state.consecutiveRed, 2);
  });

  it("seeds last green from a recovered previous state", () => {
    const recovered: DigestState = {
      ...redState(),
      status: "green",
      consecutiveRed: 0,
      firstRed: null,
      lastGreen: 950,
      run: 950,
    };
    const digest = buildDigest(
      input({
        runResult: "failure",
        slots: [slot("authed-chat-slides", chatFailure)],
        previous: recovered,
      }),
    );
    assert.equal(digest.notify.reason, "went-red");
    assert.equal(digest.state.consecutiveRed, 1);
    assert.equal(digest.state.lastGreen, 950);
    assert.match(renderIssueBody(digest), /Last green run: \[#950\]/);
  });
});

describe("decideNotify", () => {
  const hoursAgo = (hours: number) =>
    new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
  const cases: Array<
    [
      string,
      DigestState | null,
      "red" | "green",
      number,
      boolean,
      string | null,
    ]
  > = [
    ["first ever run, red", null, "red", 0, true, "first-report"],
    ["first ever run, green", null, "green", 0, false, null],
    ["green to red", redState({ status: "green" }), "red", 0, true, "went-red"],
    ["red to green", redState(), "green", 0, true, "recovered"],
    ["green to green", redState({ status: "green" }), "green", 0, false, null],
    [
      "red, same failures, notified 2h ago",
      redState({ lastNotifiedAt: hoursAgo(2) }),
      "red",
      0,
      false,
      null,
    ],
    [
      "red, same failures, notified 23h ago",
      redState({ lastNotifiedAt: hoursAgo(23) }),
      "red",
      0,
      false,
      null,
    ],
    [
      "red, same failures, notified 25h ago",
      redState({ lastNotifiedAt: hoursAgo(25) }),
      "red",
      0,
      true,
      "reminder",
    ],
    [
      "red, never notified",
      redState({ lastNotifiedAt: null }),
      "red",
      0,
      true,
      "reminder",
    ],
    [
      "red with a new failure, notified 1h ago",
      redState({ lastNotifiedAt: hoursAgo(1) }),
      "red",
      1,
      true,
      "new-failures",
    ],
  ];
  for (const [
    name,
    previous,
    status,
    newFailures,
    shouldNotify,
    reason,
  ] of cases) {
    it(name, () => {
      assert.deepEqual(decideNotify(previous, status, newFailures, NOW), {
        shouldNotify,
        reason,
      });
    });
  }
});

describe("state marker", () => {
  it("round-trips and survives an issue body around it", () => {
    const state = redState({
      failing: [
        { k: "abc", s: "authed-journeys", r: 900, l: "a --> b", c: "product" },
      ],
    });
    const body = `text\n${embedState(state)}\nmore`;
    assert.equal(body.split("-->").length, 2);
    assert.deepEqual(extractState(body), state);
  });

  it("returns null when absent and throws when damaged", () => {
    assert.equal(extractState(null), null);
    assert.equal(
      extractState("an old comment-style body with no marker"),
      null,
    );
    assert.throws(
      () => extractState('<!-- beta-e2e-state:v1 {"v":1'),
      /truncated/,
    );
    assert.throws(
      () => extractState('<!-- beta-e2e-state:v1 {"v":2,"status":"red"} -->'),
      /unrecognised/,
    );
  });
});

describe("size limits", () => {
  it("keeps the issue body under the cap with the marker intact for hundreds of failures", () => {
    const tests = Array.from({ length: 300 }, (_, index) => ({
      describe: [`app${index % 12} journeys`],
      title: `case ${index} ${"long title ".repeat(8)}`,
      project: "journeys",
      error: `Error: ${"detail ".repeat(400)}`,
    }));
    const digest = buildDigest(
      input({
        runResult: "failure",
        slots: [
          slot(
            "authed-journeys",
            fakeReport("settings-navigation.spec.ts", tests),
          ),
        ],
      }),
    );
    const body = renderIssueBody(digest);
    assert.ok(body.length <= ISSUE_BODY_BUDGET, `body is ${body.length} chars`);
    assert.match(body, /more failing tests not listed here/);
    const state = extractState(body);
    assert.equal(state?.failing.length, 120);
    assert.equal(state?.overflow, 180);
  });

  it("keeps the Slack message to twelve lines with escaped text", () => {
    const tests = Array.from({ length: 20 }, (_, index) => ({
      describe: ["slides <b>agent</b> chat"],
      title: `case ${index} & more`,
      project: "chat",
      error: `Error: expected <div> & ${"x".repeat(300)}`,
    }));
    const killed = job("Authenticated journeys", "cancelled", [
      { name: "Authenticated journeys", conclusion: "cancelled" },
    ]);
    const digest = buildDigest(
      input({
        runResult: "failure",
        issueUrl: "https://github.com/acme/repo/issues/3986",
        issueNumber: 3986,
        jobs: [killed],
        artifacts: [{ id: 9, name: "beta-e2e-authed-chat-slides-1000" }],
        slots: [slot("authed-chat-slides", fakeReport("chat.spec.ts", tests))],
      }),
    );
    const message = renderSlack(digest);
    const lines = message.split("\n");
    assert.ok(lines.length <= 12, `${lines.length} lines`);
    assert.match(
      lines[1] ?? "",
      /<https:\/\/github\.com\/acme\/repo\/issues\/3986\|issue #3986>/,
    );
    assert.match(
      message,
      /<https:\/\/github\.com\/acme\/repo\/actions\/runs\/1000\/job\/\d+\|Authenticated journeys>/,
    );
    assert.match(
      message,
      /actions\/runs\/1000\/artifacts\/9\|beta-e2e-authed-chat-slides-1000>/,
    );
    assert.match(message, /&lt;b&gt;agent&lt;\/b&gt;|&amp; more/);
    assert.doesNotMatch(message, /<div>/);
    assert.match(message, /\+\d+ more in the issue/);
    assert.ok(lines.every((line) => line.length < 420));
  });
});

describe("the workflow's slots and the digest agree on names", () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  type Authed = {
    name?: string;
    env?: Record<string, string>;
    strategy?: { matrix?: { include?: Array<{ slot: string }> } };
    steps?: Array<{ uses?: string; with?: { name?: string } }>;
  };
  const authed = (
    parse(
      readFileSync(
        path.join(repoRoot, ".github", "workflows", "beta-e2e.yml"),
        "utf8",
      ),
    ) as { jobs: { authed: Authed } }
  ).jobs.authed;
  const slots = (authed.strategy?.matrix?.include ?? []).map(
    (entry) => entry.slot,
  );
  const fill = (template: string, slot: string): string =>
    template
      .replace("${{ matrix.slot }}", slot)
      .replace("${{ github.run_id }}", String(RUN));
  const upload = authed.steps?.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );

  it("reads every slot from the matrix", () => {
    assert.ok(slots.length >= 10, `only ${slots.length} slots found`);
  });

  for (const slotName of slots) {
    it(`${slotName}: job name, report folder and artifact map to one digest slot`, () => {
      const digestSlot = `authed-${slotName}`;
      // The job the jobs API reports, the folder Playwright writes results.json
      // to, and the artifact the report job downloads must name one slot, or
      // the digest cannot tell which job a missing results file belongs to.
      assert.equal(
        slotForJobName(`Run beta E2E / ${fill(authed.name ?? "", slotName)}`),
        digestSlot,
      );
      assert.equal(
        fill(authed.env?.BETA_E2E_REPORT_SLOT ?? "", slotName),
        digestSlot,
      );
      // playwright.config.ts keeps [a-z0-9._-] in the folder name.
      assert.equal(digestSlot.replace(/[^a-z0-9._-]/gi, "-"), digestSlot);
      const artifact = fill(upload?.with?.name ?? "", slotName);
      assert.equal(artifact, artifactNameForSlot(digestSlot, RUN));
      assert.equal(slotFromArtifactName(artifact, RUN), digestSlot);
    });
  }
});

describe("command line", () => {
  it("reads downloaded artifacts and writes the issue, Slack, state, and decision files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "beta-e2e-digest-"));
    try {
      const results = path.join(root, "results");
      // One artifact extracted flat (as `gh run download` does for a single
      // artifact) and one in its own directory: the slot comes from the report
      // folder either way.
      const chatDir = path.join(
        results,
        "playwright-report",
        "authed-chat-slides",
      );
      mkdirSync(chatDir, { recursive: true });
      writeFileSync(
        path.join(chatDir, "results.json"),
        JSON.stringify(chatFailure),
      );
      const brokenDir = path.join(
        results,
        "beta-e2e-authed-journeys-1000",
        "playwright-report",
        "authed-journeys",
      );
      mkdirSync(brokenDir, { recursive: true });
      writeFileSync(path.join(brokenDir, "results.json"), '{"suites": [');

      const jobs = path.join(root, "jobs.json");
      writeFileSync(
        jobs,
        JSON.stringify({
          jobs: [
            job("Authenticated chat-slides", "failure", [
              { name: "Authenticated chat-slides", conclusion: "failure" },
            ]),
          ],
        }),
      );
      const artifacts = path.join(root, "artifacts.json");
      writeFileSync(
        artifacts,
        JSON.stringify({
          artifacts: [{ id: 777, name: "beta-e2e-authed-chat-slides-1000" }],
        }),
      );
      const out = path.join(root, "out");

      main([
        "--run-id",
        "1000",
        "--run-number",
        "42",
        "--repo",
        "acme/repo",
        "--run-result",
        "failure",
        "--results-dir",
        results,
        "--jobs",
        jobs,
        "--artifacts",
        artifacts,
        "--out-dir",
        out,
        "--issue-url",
        "https://github.com/acme/repo/issues/1",
        "--issue-number",
        "1",
        "--slack-note",
        "Slack notification not configured (secret QA_SLACK_BOT_TOKEN is empty).",
        "--now",
        NOW,
      ]);

      const decision = JSON.parse(
        readFileSync(path.join(out, "decision.json"), "utf8"),
      );
      assert.equal(decision.status, "red");
      assert.equal(decision.issueAction, "upsert");
      assert.equal(decision.shouldNotify, true);
      assert.equal(decision.hasComment, true);
      const body = readFileSync(path.join(out, "issue.md"), "utf8");
      assert.match(body, /Slack notification not configured/);
      assert.match(
        body,
        /results file in beta-e2e-authed-journeys-1000 could not be read/,
      );
      assert.match(body, /slides agent chat > completes and restores a turn/);
      assert.deepEqual(
        extractState(body),
        JSON.parse(readFileSync(path.join(out, "state.json"), "utf8")),
      );
      assert.ok(
        readFileSync(path.join(out, "slack.txt"), "utf8")
          .split("\n")
          .filter(Boolean).length <= 12,
      );

      // The next run reads the issue body back as its previous state.
      const previousBody = path.join(root, "previous.md");
      writeFileSync(previousBody, body);
      const out2 = path.join(root, "out2");
      const greenJobs = path.join(root, "green-jobs.json");
      writeFileSync(
        greenJobs,
        JSON.stringify({
          jobs: [job("Authenticated chat-slides", "success")],
        }),
      );
      main([
        "--run-id",
        "1001",
        "--repo",
        "acme/repo",
        "--run-result",
        "success",
        "--jobs",
        greenJobs,
        "--artifacts",
        artifacts,
        "--out-dir",
        out2,
        "--previous-state",
        previousBody,
        "--now",
        NOW,
      ]);
      const recovered = JSON.parse(
        readFileSync(path.join(out2, "decision.json"), "utf8"),
      );
      assert.equal(recovered.issueAction, "close");
      assert.equal(recovered.notifyReason, "recovered");
      // This run uploaded no results, so the failures it cannot see are NOT
      // RUN, not FIXED, and are said so rather than dropped.
      assert.equal(recovered.fixed, 0);
      assert.equal(recovered.notRun, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says so in the issue when collection notes are passed or the previous marker is damaged", () => {
    const root = mkdtempSync(path.join(tmpdir(), "beta-e2e-digest-"));
    try {
      const jobs = path.join(root, "jobs.json");
      writeFileSync(jobs, JSON.stringify({ jobs: [] }));
      const artifacts = path.join(root, "artifacts.json");
      writeFileSync(artifacts, JSON.stringify({ artifacts: [] }));
      const previous = path.join(root, "previous.md");
      writeFileSync(previous, "body <!-- beta-e2e-state:v1 {broken");
      const out = path.join(root, "out");
      main([
        "--run-id",
        "1000",
        "--repo",
        "acme/repo",
        "--run-result",
        "failure",
        "--jobs",
        jobs,
        "--artifacts",
        artifacts,
        "--previous-state",
        previous,
        "--note",
        "Downloading the artifacts failed.",
        "--note",
        "Job log for 12 could not be fetched.",
        "--out-dir",
        out,
        "--now",
        NOW,
      ]);
      const body = readFileSync(path.join(out, "issue.md"), "utf8");
      assert.match(body, /Report note: Downloading the artifacts failed\./);
      assert.match(body, /Report note: Job log for 12 could not be fetched\./);
      assert.match(body, /state marker could not be read/);
      // Nothing explained the failed run, and that is said rather than hidden.
      assert.match(body, /no failing test or job identified/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails loudly on a missing required input", () => {
    assert.throws(() => main(["--repo", "acme/repo"]), /--run-id is required/);
    assert.throws(
      () =>
        main([
          "--run-id",
          "1",
          "--repo",
          "a/b",
          "--run-result",
          "success",
          "--jobs",
          "/nope.json",
          "--artifacts",
          "/nope.json",
          "--out-dir",
          "/tmp/x",
        ]),
      /Could not read the jobs list/,
    );
  });
});
