import { describe, expect, it } from "vitest";

import {
  draftClaimsAnalyticsMetrics,
  draftRestatesPriorEvidence,
  failedDataQueryAttemptMessage,
  GENERIC_NO_DATA_FALLBACK_MESSAGE,
  hasCatalogSearchAttempt,
  hasDashboardConstructionAttempt,
  hasExplicitPartialDisclosure,
  hasCorpusWorkflowAttempt,
  hasDataQueryAttempt,
  hasFailedCorpusWorkflowEvidence,
  hasIncompleteDataEvidence,
  hasRequestedSourceRecordEvidence,
  hasOverstatedCoverageConfidenceClaim,
  isGenericNoDataFallback,
  isSafeNoDataAnalyticsResponse,
  looksLikeCoverageSensitiveAnalyticsRequest,
  looksLikeDashboardConstructionRequest,
  looksLikeStrongCoverageClaim,
  looksLikeAnalyticsDataRequest,
  needsCorpusWorkflowForCoverageSensitiveRequest,
  needsSourceRecordBodyWorkflowForCoverageSensitiveRequest,
  registerGroundingActions,
  stripInjectedAnalyticsGuardContext,
} from "./real-data-actions";

// These tests exercise the predicates, not the derivation: the agent-chat
// plugin is what reads `grounding: true` off the shipped action definitions.
registerGroundingActions([
  "account-deep-dive",
  "bigquery",
  "get-session-replay-summary",
  "get-session-replay-timeline",
  "gong-calls",
  "gong-native-insights",
  "hubspot-deals",
  "hubspot-records",
  "jira-search",
  "list-error-issues",
  "list-session-recordings",
  "prometheus",
  "provider-api-request",
  "provider-corpus-job",
  "query-agent-native-analytics",
  "query-staged-dataset",
  "slack-messages",
]);

describe("real data action classification", () => {
  it("treats unstructured source records as real analytics evidence", () => {
    expect(hasDataQueryAttempt([{ name: "gong-calls" }])).toBe(true);
    expect(hasDataQueryAttempt([{ name: "gong-native-insights" }])).toBe(true);
    expect(hasDataQueryAttempt([{ name: "slack-messages" }])).toBe(true);
  });

  it("treats broad HubSpot record lookups as real CRM evidence", () => {
    expect(hasDataQueryAttempt([{ name: "hubspot-records" }])).toBe(true);
  });

  it("treats account deep dives as real source evidence", () => {
    expect(hasDataQueryAttempt([{ name: "account-deep-dive" }])).toBe(true);
  });

  it("treats first-party observability reads as grounded incident evidence", () => {
    expect(
      hasDataQueryAttempt([
        { name: "list-session-recordings" },
        { name: "list-error-issues" },
        { name: "get-session-replay-summary" },
        { name: "get-session-replay-timeline" },
      ]),
    ).toBe(true);
  });

  it("treats connected MCP provider tools as real source evidence", () => {
    expect(
      hasDataQueryAttempt([
        { name: "mcp__codex_apps__hubspot__legacy.__search" },
      ]),
    ).toBe(true);
    expect(
      hasDataQueryAttempt([
        {
          name: "run-code",
          content: "bridgeToolsUsed: mcp__codex_apps__hubspot__legacy.__search",
        },
      ]),
    ).toBe(true);
    expect(
      hasDataQueryAttempt([
        {
          name: "run-code",
          content: "bridgeToolsUsed: provider-api-request",
        },
      ]),
    ).toBe(true);
  });

  it("does not count setup or artifact-only actions as source evidence", () => {
    expect(hasDataQueryAttempt([{ name: "data-source-status" }])).toBe(false);
    expect(hasDataQueryAttempt([{ name: "save-analysis" }])).toBe(false);
    expect(hasDataQueryAttempt([{ name: "generate-chart" }])).toBe(false);
  });

  it("does not count failed source reads as evidence", () => {
    expect(
      hasDataQueryAttempt([{ name: "hubspot-records", isError: true }]),
    ).toBe(false);
    expect(
      hasDataQueryAttempt([
        { name: "mcp__codex_apps__hubspot__legacy.__search", isError: true },
      ]),
    ).toBe(false);
  });

  it("does not count provider error payloads returned as normal action results", () => {
    expect(
      hasDataQueryAttempt([
        {
          name: "gong-calls",
          content: JSON.stringify({
            error: "missing_api_key",
            message: "Connect your Gong account.",
          }),
        },
      ]),
    ).toBe(false);
    expect(
      hasDataQueryAttempt([
        {
          name: "jira-search",
          content: JSON.stringify({
            error: "Jira API error 403",
            details: { missingFields: ["summary", "status"] },
          }),
        },
      ]),
    ).toBe(false);
  });

  it("still counts successful empty result sets as real evidence", () => {
    expect(
      hasDataQueryAttempt([
        {
          name: "hubspot-records",
          content: JSON.stringify({ records: [], total: 0 }),
        },
      ]),
    ).toBe(true);
    expect(
      hasDataQueryAttempt([
        {
          name: "query-agent-native-analytics",
          content: JSON.stringify({ rows: [], schema: [] }),
        },
      ]),
    ).toBe(true);
  });

  it("normalizes data query action name variants from hosted tool surfaces", () => {
    expect(
      hasDataQueryAttempt([
        {
          name: "query_agent_native_analytics",
          content: JSON.stringify({ rows: [{ count: 1 }], schema: [] }),
        },
      ]),
    ).toBe(true);
    expect(
      hasDataQueryAttempt([
        {
          name: "query agent-native analytics",
          content: JSON.stringify({ rows: [{ count: 1 }], schema: [] }),
        },
      ]),
    ).toBe(true);
  });

  it("summarizes failed data query attempts for the final guard", () => {
    const message = failedDataQueryAttemptMessage([
      {
        name: "bigquery",
        content: JSON.stringify({
          error: "bigquery_query_failed",
          message: "Unrecognized name: template",
        }),
      },
    ]);

    expect(message).toContain("I did try `bigquery`");
    expect(message).toContain("bigquery_query_failed");
  });
});

describe("analytics data request classification", () => {
  it("ignores framework-injected screen context when classifying the user ask", () => {
    const text =
      "i want a recurring job this is the .yml file\n\n" +
      "<current-screen>\n" +
      "Onboarding Progress\nCustomers in onboarding status\nMetrics dashboard\n" +
      "</current-screen>";

    expect(stripInjectedAnalyticsGuardContext(text)).toBe(
      "i want a recurring job this is the .yml file",
    );
    expect(looksLikeAnalyticsDataRequest(text)).toBe(false);
  });

  it("does not treat GitHub Actions workflow migrations as analytics requests", () => {
    const text =
      '<attachment name="workflow.yml">\n' +
      "on:\n  schedule:\n    - cron: '0 12 * * *'\n" +
      "jobs:\n  post-message:\n    steps:\n      - run: pnpm script\n" +
      "</attachment>\n\n" +
      "I have a GitHub action from a previous repo and wanted to create a recurring job based on this .yml file.";

    expect(looksLikeAnalyticsDataRequest(text)).toBe(false);
  });

  it("still recognizes real analytics questions after stripping context", () => {
    const text =
      "How many signups came from paid traffic last week?\n\n" +
      "<current-screen>\nSettings page\n</current-screen>";

    expect(looksLikeAnalyticsDataRequest(text)).toBe(true);
  });

  it("strips tagged and legacy A2A transport hints before classifying intent", () => {
    const request =
      "Choose one useful current customer metric and return its value.";
    const transportHint =
      "If you create a dashboard, return a concise answer instead of full transcripts.";
    const tagged = `${request}\n\n<a2a-caller-hint>\n${transportHint}\n</a2a-caller-hint>`;
    const legacy = `${request}\n\n[Note: this request comes from another app via A2A. ${transportHint}]`;

    for (const text of [tagged, legacy]) {
      expect(stripInjectedAnalyticsGuardContext(text)).toBe(request);
      expect(looksLikeCoverageSensitiveAnalyticsRequest(text)).toBe(false);
      expect(looksLikeDashboardConstructionRequest(text)).toBe(false);
      expect(looksLikeAnalyticsDataRequest(text)).toBe(true);
    }
  });

  it("respects explicit real-data markers", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "REAL_DATA_REQUIRED: analyze Slack messages for onboarding objections",
      ),
    ).toBe(true);
  });

  it("keeps non-data app maintenance requests out of the guard", () => {
    expect(looksLikeAnalyticsDataRequest("fix the dashboard layout")).toBe(
      false,
    );
  });

  it("keeps greetings and general math questions out of the guard", () => {
    expect(looksLikeAnalyticsDataRequest("How's it going?")).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "For n = 3, 4, and 5 points in the plane, what is the maximum number of unit-distance pairs?",
      ),
    ).toBe(false);
  });

  it("does not reject source-record analysis just because it mentions integrations", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "Search Gong transcripts and Pylon tickets for customers asking for a deeper Figma integration.",
      ),
    ).toBe(true);
  });

  it("does not reject source searches because quoted context mentions sharing", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        'Find any HubSpot deals with product = "fusion" and look through all Gong transcripts for examples of customers asking for the Figma MCP. The partner manager said they can share that with the team.',
      ),
    ).toBe(true);
  });

  it("does not classify generic chat/message bug reports as data requests", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "the chat keeps typing long messages that disappear",
      ),
    ).toBe(false);
  });

  it("keeps PR/code-review framing out of the guard even when it names analytics vocabulary", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "Is my PR description clear about the events we track?",
      ),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "Can you review this pull request and check the diff for the signups migration?",
      ),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "Does this commit's changelog entry accurately describe the sessions fix?",
      ),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "What did the reviewer say about the release notes for this PR?",
      ),
    ).toBe(false);
  });

  it("keeps analytics questions that merely mention review or pull-request words inside the guard", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "Review this dashboard and tell me the highest conversion step.",
      ),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest(
        "What was the signup conversion rate for the pull request landing page last week?",
      ),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest("How many calls did our reviewers handle?"),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest("How many signups came from each PR?"),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest(
        "Which pull request had the most conversion?",
      ),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest("Did the latest PR increase signups?"),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest(
        "What impact did this pull request have on revenue?",
      ),
    ).toBe(true);
  });

  it("keeps an explicit code-review request out of the guard even when it carries a date", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "Review the signup changelog from last week.",
      ),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "Check the PR diff for the sessions migration from last month.",
      ),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest("Review signup PR from last week."),
    ).toBe(false);
  });
});

describe("draftClaimsAnalyticsMetrics qualitative verdicts", () => {
  it("treats a qualitative verdict about a metric as a claim", () => {
    expect(
      draftClaimsAnalyticsMetrics("Signup conversion was strong last week."),
    ).toBe(true);
    expect(
      draftClaimsAnalyticsMetrics("Signups performed poorly this week."),
    ).toBe(true);
    expect(
      draftClaimsAnalyticsMetrics("Revenue spiked after the launch."),
    ).toBe(true);
    expect(draftClaimsAnalyticsMetrics("Signups rose last week.")).toBe(true);
    expect(draftClaimsAnalyticsMetrics("Sessions went up this month.")).toBe(
      true,
    );
    expect(draftClaimsAnalyticsMetrics("Revenue is down.")).toBe(true);
    expect(draftClaimsAnalyticsMetrics("Signups up 12% this week.")).toBe(true);
  });

  it("treats ordinary evaluative adjectives about a metric as a claim", () => {
    expect(
      draftClaimsAnalyticsMetrics("Signup conversion was excellent last week."),
    ).toBe(true);
    expect(draftClaimsAnalyticsMetrics("Retention looks healthy.")).toBe(true);
    expect(
      draftClaimsAnalyticsMetrics("The signups dashboard looks solid now."),
    ).toBe(false);
  });

  it("does not treat a chart position edit as an up/down trend claim", () => {
    expect(
      draftClaimsAnalyticsMetrics("I moved the sessions chart up 2 rows."),
    ).toBe(false);
  });

  it("treats a metric stated before its figure as a claim", () => {
    expect(
      draftClaimsAnalyticsMetrics("The week before that, signups were 480."),
    ).toBe(true);
    expect(draftClaimsAnalyticsMetrics("Conversion: 4.2")).toBe(true);
  });

  it("does not treat an edit summary with the same verbs as a claim", () => {
    expect(
      draftClaimsAnalyticsMetrics(
        "I improved the dashboard layout and saved it.",
      ),
    ).toBe(false);
    expect(
      draftClaimsAnalyticsMetrics(
        "The signup dashboard was improved and saved.",
      ),
    ).toBe(false);
    expect(
      draftClaimsAnalyticsMetrics("Set the sessions panel at 3 columns."),
    ).toBe(false);
    expect(
      draftClaimsAnalyticsMetrics(
        "Confirmed — this is the agreed instrumentation specification, not a live analytics result.",
      ),
    ).toBe(false);
  });
});

describe("draftRestatesPriorEvidence", () => {
  const prior = {
    toolResults: [
      {
        name: "bigquery",
        content: '{"rows":[{"signups":1234,"week":"2026-08-24"}]}',
      },
    ],
    text: 'SELECT COUNT(*) AS signups FROM events WHERE week = "2026-08-24"\n{"rows":[{"signups":1234,"week":"2026-08-24"}]}\nSignups for the week of 2026-08-24 were 1,234.',
  };

  it("accepts a draft whose figures and metrics all come from the prior turn, across comma formatting", () => {
    expect(
      draftRestatesPriorEvidence(
        "So 1,234 signups in the week of 2026-08-24.",
        prior,
      ),
    ).toBe(true);
  });

  it("rejects a draft that states a figure the results never produced", () => {
    expect(
      draftRestatesPriorEvidence("The week before was 980 signups.", prior),
    ).toBe(false);
  });

  it("rejects a prior figure re-attributed to a metric that turn never named", () => {
    expect(
      draftRestatesPriorEvidence(
        "Paying customers were 1,234 this month.",
        prior,
      ),
    ).toBe(false);
  });

  it("rejects a draft with no figures rather than passing it vacuously", () => {
    expect(draftRestatesPriorEvidence("Signups were higher.", prior)).toBe(
      false,
    );
  });

  it("ignores figures that only appear in failed results", () => {
    expect(
      draftRestatesPriorEvidence("Signups were 980.", {
        toolResults: [
          { name: "bigquery", isError: true, content: '{"error":"980 rows"}' },
        ],
        text: "signups 980",
      }),
    ).toBe(false);
  });
});

describe("coverage-sensitive analytics request classification", () => {
  const broadProviderQuestion =
    'Find any closed won deal in HubSpot where products = "fusion", then for all those deals look through all Gong call transcripts after close and let me know if you surface anything around Figma MCP.';

  it("flags broad provider searches where absence matters", () => {
    expect(
      looksLikeCoverageSensitiveAnalyticsRequest(broadProviderQuestion),
    ).toBe(true);
    expect(
      looksLikeCoverageSensitiveAnalyticsRequest(
        "Search all Pylon tickets and Gong transcripts for any examples of customers asking for a deeper Figma integration.",
      ),
    ).toBe(true);
  });

  it("does not flag ordinary bounded metric questions as coverage-sensitive", () => {
    expect(
      looksLikeCoverageSensitiveAnalyticsRequest(
        "Show weekly signup trends for the last 30 days.",
      ),
    ).toBe(false);
  });

  it("keeps metadata-only questions out of coverage-sensitive handling", () => {
    expect(
      looksLikeCoverageSensitiveAnalyticsRequest(
        "What Gong and HubSpot tables are available?",
      ),
    ).toBe(false);
  });

  it("distinguishes bounded convenience reads from corpus-capable workflows", () => {
    expect(
      hasCorpusWorkflowAttempt([
        { name: "hubspot-deals" },
        { name: "gong-calls" },
      ]),
    ).toBe(false);
    expect(hasCorpusWorkflowAttempt([{ name: "provider-api-request" }])).toBe(
      true,
    );
    expect(hasCorpusWorkflowAttempt([{ name: "provider-corpus-job" }])).toBe(
      true,
    );
    expect(hasCorpusWorkflowAttempt([{ name: "query-staged-dataset" }])).toBe(
      true,
    );
    expect(hasCorpusWorkflowAttempt([{ name: "run-code" }])).toBe(false);
    expect(
      hasCorpusWorkflowAttempt([
        {
          name: "run-code",
          content:
            'bridgeToolsUsed: provider-api-request\n\nstdout:\n{"rows":10}',
        },
      ]),
    ).toBe(true);
    expect(
      hasCorpusWorkflowAttempt([
        {
          name: "run-code",
          content:
            'bridgeToolsUsed: query-staged-dataset\n\nstdout:\n{"rows":10}',
        },
      ]),
    ).toBe(true);
    expect(
      hasCorpusWorkflowAttempt([
        {
          name: "run-code",
          content:
            'const calls = await providerFetchAll("gong", "/calls", { pagination: { maxPages: 20 } });',
        },
      ]),
    ).toBe(false);
    expect(
      hasCorpusWorkflowAttempt([
        {
          name: "run-code",
          content:
            'const rows = await appAction("query-staged-dataset", { datasetId });',
        },
      ]),
    ).toBe(false);
    expect(
      hasCorpusWorkflowAttempt([
        {
          name: "run-code",
          content: "Processed rows from hubspot-deals and gong-calls.",
        },
      ]),
    ).toBe(false);
    expect(
      hasCorpusWorkflowAttempt([{ name: "mcp__gong__search_transcripts" }]),
    ).toBe(true);
    expect(
      hasCorpusWorkflowAttempt([
        {
          name: "run-code",
          content: "bridgeToolsUsed: mcp__gong__search_transcripts",
        },
      ]),
    ).toBe(true);
  });

  it("requires a corpus workflow for coverage-sensitive answers unless partial coverage is explicit", () => {
    const shortcutOnly = [{ name: "hubspot-deals" }, { name: "gong-calls" }];

    expect(
      needsCorpusWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText: "I found zero mentions of Figma MCP in the transcripts.",
        toolResults: shortcutOnly,
      }),
    ).toBe(true);

    expect(
      needsCorpusWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText:
          "Partial coverage: I only inspected the first 19 calls and found zero mentions.",
        toolResults: shortcutOnly,
      }),
    ).toBe(false);

    expect(
      needsCorpusWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText: "I fetched the full cohort and found one mention.",
        toolResults: [
          { name: "hubspot-deals" },
          { name: "provider-corpus-job" },
        ],
      }),
    ).toBe(false);

    expect(
      needsCorpusWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText: "I fetched the full cohort and found one mention.",
        toolResults: [
          { name: "hubspot-deals" },
          { name: "provider-api-request" },
          { name: "run-code" },
        ],
      }),
    ).toBe(false);

    expect(
      needsCorpusWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText:
          "I checked the shortcut results with code and found nothing.",
        toolResults: [
          { name: "hubspot-deals" },
          { name: "gong-calls" },
          { name: "run-code" },
        ],
      }),
    ).toBe(true);

    expect(
      needsCorpusWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText: "I fetched provider pages in code and found one mention.",
        toolResults: [
          { name: "hubspot-deals" },
          {
            name: "run-code",
            content:
              'bridgeToolsUsed: provider-api-request\n\nstdout:\n{"searched":1000}',
          },
        ],
      }),
    ).toBe(false);
  });

  it("does not let container metadata satisfy requested source-record body searches", () => {
    const metadataCorpusResult = {
      name: "provider-corpus-job",
      content: JSON.stringify({
        job: { status: "completed" },
        source: {
          provider: "gong",
          mode: "paginated-search",
          request: { method: "GET", path: "/calls" },
          pagination: { itemsPath: "calls" },
          search: { textPaths: ["title", "content.brief"] },
        },
        coverage: { itemsProcessed: 13_885, totalHits: 0 },
      }),
    };

    expect(
      hasRequestedSourceRecordEvidence(broadProviderQuestion, [
        metadataCorpusResult,
      ]),
    ).toBe(false);
    expect(
      needsSourceRecordBodyWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText:
          "No mentions were found in any Gong transcripts across the full available corpus.",
        toolResults: [metadataCorpusResult],
      }),
    ).toBe(true);
  });

  it("accepts raw source-record body corpus evidence for coverage-sensitive claims", () => {
    const transcriptCorpusResult = {
      name: "provider-corpus-job",
      content: JSON.stringify({
        job: { status: "completed" },
        source: {
          provider: "gong",
          mode: "batch-search",
          request: { method: "POST", path: "/calls/transcript" },
          batch: {
            itemBodyPath: "filter.callIds",
            responseItemsPath: "callTranscripts",
          },
          search: { textPaths: ["transcript"], idPaths: ["callId"] },
        },
        coverage: { itemsProcessed: 1_100, totalHits: 214 },
        sampleHits: [{ id: "call-1", path: "transcript.sentences.0.text" }],
      }),
    };

    expect(
      hasRequestedSourceRecordEvidence(broadProviderQuestion, [
        transcriptCorpusResult,
      ]),
    ).toBe(true);
    expect(
      needsSourceRecordBodyWorkflowForCoverageSensitiveRequest({
        userText: broadProviderQuestion,
        finalText:
          "I found 214 hits in 183 Gong transcripts across the full available corpus.",
        toolResults: [transcriptCorpusResult],
      }),
    ).toBe(false);
  });
});

describe("metadata and data-dictionary questions (should NOT force a provider call)", () => {
  it("does not flag 'what tables are available' as a data request", () => {
    expect(
      looksLikeAnalyticsDataRequest("what tables are available in BigQuery?"),
    ).toBe(false);
  });

  it("does not flag 'which sources are connected' as a data request", () => {
    expect(looksLikeAnalyticsDataRequest("which sources are connected?")).toBe(
      false,
    );
  });

  it("does not flag metric definition questions as data requests", () => {
    expect(
      looksLikeAnalyticsDataRequest("what does conversion rate mean?"),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "how is revenue defined in the data dictionary?",
      ),
    ).toBe(false);
  });

  it("does not flag schema inspection as a data request", () => {
    expect(
      looksLikeAnalyticsDataRequest("describe the events table schema"),
    ).toBe(false);
    expect(looksLikeAnalyticsDataRequest("list the columns in dim_deals")).toBe(
      false,
    );
  });

  it("does not flag source availability questions as data requests", () => {
    expect(
      looksLikeAnalyticsDataRequest("which providers are configured?"),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest("show me available data sources"),
    ).toBe(false);
  });

  it("still flags real metric queries that happen to mention tables", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "how many signups happened last week in the signups table?",
      ),
    ).toBe(true);
  });

  it("flags provider payment questions as live analytics requests", () => {
    expect(
      looksLikeAnalyticsDataRequest("what were our Stripe payments last week?"),
    ).toBe(true);
  });

  it("does not flag payment connection setup as a live analytics request", () => {
    expect(
      looksLikeAnalyticsDataRequest("how do I connect Stripe payments?"),
    ).toBe(false);
  });

  it("does not classify provider configuration help as a live analytics request", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "How do I configure revenue reports in Stripe?",
      ),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "Can you check my Stripe payment settings?",
      ),
    ).toBe(false);
  });
});

describe("isGenericNoDataFallback", () => {
  it("matches the exact canned fallback sentence", () => {
    expect(isGenericNoDataFallback(GENERIC_NO_DATA_FALLBACK_MESSAGE)).toBe(
      true,
    );
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(
      isGenericNoDataFallback(
        `  ${GENERIC_NO_DATA_FALLBACK_MESSAGE.toUpperCase()}  `,
      ),
    ).toBe(true);
  });

  it("does not match unrelated safe no-data responses", () => {
    expect(
      isGenericNoDataFallback(
        "I can't retrieve this data right now because BigQuery credentials are not configured.",
      ),
    ).toBe(false);
  });
});

describe("safe no-data analytics responses", () => {
  it("allows explicit unavailable-source answers without forcing another retry", () => {
    expect(
      isSafeNoDataAnalyticsResponse(
        "I can't retrieve this data right now because BigQuery credentials are not configured.",
      ),
    ).toBe(true);
  });

  it("allows clarification questions without unsupported result claims", () => {
    expect(
      isSafeNoDataAnalyticsResponse(
        "Which data source should I use for signups: GA4 or BigQuery?",
      ),
    ).toBe(true);
  });

  it("does not let the generic guard fallback bypass a source-query retry", () => {
    expect(
      isSafeNoDataAnalyticsResponse(
        "I can't provide a grounded analytics result yet because no real data-source query ran successfully. Tell me which source to use or connect the missing source, and I'll run it before giving numbers or source-record conclusions.",
      ),
    ).toBe(false);
  });

  it("blocks unsupported metric claims", () => {
    expect(
      isSafeNoDataAnalyticsResponse("The data shows 42 signups last week."),
    ).toBe(false);
  });
});

describe("incomplete evidence detection", () => {
  it("detects aborted and timed-out data source reads", () => {
    expect(
      hasIncompleteDataEvidence([
        {
          name: "gong-calls",
          content: "Error running gong-calls: Run aborted",
        },
      ]),
    ).toBe(true);
    expect(
      hasIncompleteDataEvidence([
        {
          name: "provider-api-request",
          isError: true,
          content: "Tool call timed out",
        },
      ]),
    ).toBe(true);
    expect(
      hasIncompleteDataEvidence([
        {
          name: "provider-api-request",
          content: JSON.stringify({
            response: {
              status: 429,
              ok: false,
              headers: { "retry-after": "3600" },
              json: { errors: ["Access key API calls limit exceeded"] },
            },
          }),
        },
      ]),
    ).toBe(true);
    expect(
      hasIncompleteDataEvidence([
        {
          name: "provider-api-request",
          content: JSON.stringify({
            response: {
              json: {
                calls: [{ id: 1 }],
                records: { cursor: "page-2" },
              },
            },
          }),
        },
      ]),
    ).toBe(true);
    expect(
      hasIncompleteDataEvidence([
        {
          name: "provider-api-request",
          content: JSON.stringify({
            response: {
              json: {
                calls: [{ id: 1, cursor: "speaker-cursor" }],
              },
            },
          }),
        },
      ]),
    ).toBe(false);
  });

  it("detects structured truncation and pagination hints", () => {
    expect(
      hasIncompleteDataEvidence([
        {
          name: "run-code",
          content: JSON.stringify({
            ok: true,
            rows: [{ id: 1 }],
            truncated: true,
          }),
        },
      ]),
    ).toBe(true);
    expect(
      hasIncompleteDataEvidence([
        {
          name: "provider-api-request",
          content: JSON.stringify({
            response: {
              json: {
                data: [{ id: 1 }],
                nextCursor: "abc",
              },
            },
          }),
        },
      ]),
    ).toBe(true);
  });

  it("recognizes strong coverage claims but allows explicit partial wording", () => {
    expect(
      looksLikeStrongCoverageClaim("I found zero mentions in the transcripts."),
    ).toBe(true);
    expect(
      looksLikeStrongCoverageClaim("I reviewed every call in the cohort."),
    ).toBe(true);
    expect(
      hasExplicitPartialDisclosure(
        "This is partial: I only inspected the first 20 calls.",
      ),
    ).toBe(true);
    expect(
      hasExplicitPartialDisclosure(
        "I reviewed 10 of 25 accounts; the remaining accounts are not covered.",
      ),
    ).toBe(true);
    expect(
      hasExplicitPartialDisclosure(
        "I limited the query to closed won Fusion deals and found zero mentions.",
      ),
    ).toBe(false);
    expect(
      hasExplicitPartialDisclosure(
        "The coverage is limited to the first 20 calls.",
      ),
    ).toBe(true);
  });

  it("detects failed corpus workflows and overstated full-coverage confidence", () => {
    expect(
      hasFailedCorpusWorkflowEvidence([
        {
          name: "run-code",
          content: "exitCode: 1\n\nstderr:\nUnhandled error: fetch failed",
        },
      ]),
    ).toBe(true);
    expect(
      hasFailedCorpusWorkflowEvidence([
        {
          name: "provider-api-request",
          content: "Error running provider-api-request: fetch failed",
        },
      ]),
    ).toBe(true);
    expect(
      hasFailedCorpusWorkflowEvidence([
        {
          name: "provider-api-request",
          content: JSON.stringify({
            response: {
              status: 429,
              ok: false,
              json: { errors: ["Too Many Requests"] },
            },
          }),
        },
      ]),
    ).toBe(true);

    expect(
      hasOverstatedCoverageConfidenceClaim(
        "No mentions were found in any Gong transcripts across the full available corpus. This is a defensible absence claim.",
      ),
    ).toBe(true);
    expect(
      hasOverstatedCoverageConfidenceClaim(
        "Partial coverage: I found 0 matches in the 200 calls inspected; this is not exhaustive.",
      ),
    ).toBe(false);
    expect(
      hasOverstatedCoverageConfidenceClaim(
        "Partial coverage: I found 0 matches in the 200 calls inspected; this is a defensible interim read.",
      ),
    ).toBe(false);
  });

  it("treats a Company A template clone for Company B as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a new dashboard for Company B using the Company A User Usage Analytics dashboard as a template",
      ),
    ).toBe(true);
    expect(
      looksLikeDashboardConstructionRequest(
        "Use the same source data as Company A, filter for Company B",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Replicate the DevRel Leaderboard dashboard for the sales team",
      ),
    ).toBe(true);
  });

  it("does not treat an automation targeting a dashboard as dashboard construction", () => {
    const request =
      "Create an automation for the Revenue dashboard and run it every morning";

    expect(looksLikeAnalyticsDataRequest(request)).toBe(false);
    expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
  });

  it("keeps automation terms in dashboard metrics from suppressing construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a dashboard showing automation conversion rate",
      ),
    ).toBe(true);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a dashboard for cron job success rates",
      ),
    ).toBe(true);
  });

  it("preserves dashboard construction in compound dashboard and automation requests", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a dashboard for the sales team and schedule an automation to email it every morning",
      ),
    ).toBe(true);
  });

  it("does not treat dashboard automation compounds as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Build a dashboard automation to email it every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest("Update the dashboard automation"),
    ).toBe(false);
    expect(
      looksLikeAnalyticsDataRequest(
        "Create a dashboard automation to refresh the Revenue dashboard every morning",
      ),
    ).toBe(false);
  });

  it("keeps automation-themed dashboards as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Build an automation dashboard tracking Zapier failure rates",
      ),
    ).toBe(true);
    expect(
      looksLikeDashboardConstructionRequest("Create a workflow dashboard"),
    ).toBe(true);
  });

  it("preserves a separate dashboard request beside dashboard automation", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a sales dashboard and a dashboard automation to email it each morning",
      ),
    ).toBe(true);
  });

  it("preserves explicit dashboard construction beside a scheduled refresh", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a Sales dashboard with a scheduled refresh",
      ),
    ).toBe(true);
  });

  it("preserves dashboard clauses after nested automation actions", () => {
    for (const request of [
      "Create an automation to refresh the Revenue dashboard, build a Sales dashboard",
      "Create an automation to refresh the Revenue dashboard and build a Sales dashboard",
      "Create an automation to refresh Revenue dashboard plus build Sales dashboard",
      "Create an automation to refresh the Revenue dashboard but build a Sales dashboard",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(true);
    }
  });

  it("does not treat dashboard-targeting automation names as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation for our dashboard",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a daily lead summary automation for the Sales dashboard",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a Revenue dashboard email automation",
      ),
    ).toBe(false);
  });

  it("keeps qualified automation subjects as dashboard construction", () => {
    for (const request of [
      "Create a workflow performance dashboard",
      "Build an automation health dashboard",
      "Create a cron job reliability dashboard",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(true);
    }
  });

  it("preserves template-based dashboard construction beside automation", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Use the existing dashboard as a template and update the dashboard automation",
      ),
    ).toBe(true);
  });

  it("does not treat nested dashboard actions as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation to refresh the Revenue dashboard every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a job that refreshes the dashboard",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation to clone the Revenue dashboard template every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a dashboard automation to clone the Revenue dashboard template",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation using the Revenue dashboard template every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation for the Revenue dashboard using a template",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation to build a dashboard with a scheduled refresh",
      ),
    ).toBe(false);
  });

  it("preserves long and automation-first dashboard construction requests", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a quarterly revenue retention forecast dashboard and schedule an automation to email it",
      ),
    ).toBe(true);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation and a dashboard",
      ),
    ).toBe(true);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation, build a sales dashboard",
      ),
    ).toBe(true);
  });

  it("does not treat bare cron automation requests as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a cron to email the Revenue dashboard daily",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Set up cron to refresh the Revenue dashboard daily",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Schedule the Revenue dashboard refresh via cron",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Refresh the Revenue dashboard via cron every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Run the Revenue dashboard refresh on a cron schedule",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest("Schedule a dashboard refresh"),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Schedule a dashboard refresh every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Schedule the dashboard to refresh daily",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Schedule a refresh of the Revenue dashboard every morning",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Schedule a daily refresh of the dashboard",
      ),
    ).toBe(false);
    for (const request of [
      "Could you schedule a dashboard refresh every morning?",
      "Can you schedule the Revenue dashboard to refresh daily?",
      "Create a scheduled refresh of the Revenue dashboard",
      "Configure a scheduled refresh for the Revenue dashboard",
      "Update the Revenue dashboard on a cron schedule",
      "Create a dashboard refresh job",
      "Create a dashboard refresh schedule",
      "Create a job to refresh the dashboard",
      "Set up a job for the dashboard",
      "Create a job for the dashboard",
      "Create a job that refreshes the dashboard",
      "Create a dashboard scheduled refresh",
      "Create a recurring dashboard refresh",
      "Refresh the dashboard every morning",
      "Have the dashboard refresh every morning",
      "Run the dashboard refresh every morning",
      "Refresh the dashboard every 15 minutes",
      "Run the dashboard refresh hourly",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
    }
  });

  it("classifies dashboard refresh jobs and schedules as automation requests", () => {
    for (const request of [
      "Create a dashboard refresh job",
      "Create a dashboard refresh schedule",
      "Create a job to refresh the dashboard",
      "Set up a job for the dashboard",
      "Create a job that refreshes the dashboard",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
      expect(looksLikeAnalyticsDataRequest(request)).toBe(false);
    }
  });

  it("keeps refresh-rate questions as analytics requests", () => {
    for (const request of [
      "What is the dashboard refresh rate via cron?",
      "Show the dashboard refresh rate via cron for the past week.",
      "What is the refresh rate of the dashboard?",
      "Show the refresh rate of the dashboard",
      "What is the dashboard refresh frequency?",
      "What is the widget refresh frequency?",
      "How frequently does the dashboard refresh?",
      "What is the dashboard refresh interval?",
      "How often does the dashboard update?",
      "What is the refresh frequency of the dashboard?",
      "What is the update frequency of the dashboard?",
      "How often is the dashboard refreshed?",
      "What is the dashboard’s refresh frequency?",
      "What is the frequency of dashboard refreshes?",
      "What is the frequency of dashboard updates?",
      "Tell me the dashboard refresh rate",
      "How often does the Revenue dashboard refresh?",
      "What is the refresh frequency for my dashboard?",
      "What is the refresh interval for our dashboard?",
      "Tell me the refresh frequency of our dashboard",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
      expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
    }
  });

  it("keeps schedule dimensions as analytics requests", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "Show the conversion rate by schedule for our automations",
      ),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest(
        "What is the schedule and conversion rate for our workflows?",
      ),
    ).toBe(true);
  });

  it("keeps dashboard automation analytics questions as data requests", () => {
    for (const request of [
      "Show me the dashboard automation conversion rate",
      "How many dashboard automation runs failed?",
      "What is the dashboard automation run count?",
      "Show dashboard automation run count",
      "How many dashboard automation executions occurred?",
      "How many dashboard automations ran?",
      "What is the run count for dashboard automations?",
      "How many dashboard automation job counts are there?",
      "What is the number of dashboard automations?",
      "How many dashboard automations are scheduled?",
      "How many scheduled dashboard automations are there?",
      "Are scheduled dashboard automations active?",
      "How many dashboard automations are there?",
      "How many automation dashboards exist?",
      "What is the status of dashboard automations?",
      "Show dashboard automation status",
      "Are dashboard automations active?",
      "Create a report showing dashboard automation status",
      "Create a report showing the number of dashboard automations",
      "Build a chart of dashboard automation executions",
      "Build a chart of dashboard automation conversion rates",
      "Create a metric for dashboard automation conversion rate",
      "Create a report showing dashboard automation failure rates",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
      expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
    }
  });

  it("keeps automation-first dashboard questions on the analytics path", () => {
    for (const request of [
      "How many automations are scheduled for the dashboard?",
      "How many automations run the Sales dashboard?",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
      expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
    }
  });

  it("keeps dashboard refresh job counts on the analytics path", () => {
    const request = "How many failed dashboard refresh jobs are there?";

    expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
    expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
  });

  it("does not treat bare dashboard status as analytics", () => {
    for (const request of [
      "What is the status of the dashboard?",
      "What is the state of the Revenue dashboard?",
    ]) {
      expect(looksLikeAnalyticsDataRequest(request)).toBe(false);
    }
    expect(
      looksLikeAnalyticsDataRequest(
        "What is the status of the Revenue dashboard automation?",
      ),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest(
        "What is the status of the dashboard? Show revenue",
      ),
    ).toBe(true);
  });

  it("keeps report framing as analytics intent around workflow terms", () => {
    expect(
      looksLikeAnalyticsDataRequest(
        "Create a report showing conversion rate by workflow",
      ),
    ).toBe(true);
    expect(
      looksLikeAnalyticsDataRequest(
        "Create a report of automation conversion rates",
      ),
    ).toBe(true);
  });

  it("keeps report-framed refresh-rate requests as analytics requests", () => {
    for (const request of [
      "Create a report showing the dashboard refresh rate",
      "Create a report of the dashboard refresh rate for the past week.",
      "Create a report of the refresh rate of the dashboard",
      "Create a chart showing the refresh rate of the dashboard",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
      expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
    }
  });

  it("preserves a following dashboard build after a refresh-rate report", () => {
    const request =
      "Create a report showing the dashboard refresh rate, then build a Sales dashboard";

    expect(looksLikeDashboardConstructionRequest(request)).toBe(true);
    expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
  });

  it("preserves a dashboard build after a semicolon refresh-rate report", () => {
    const request =
      "Create a report showing the dashboard refresh rate; build a Sales dashboard";

    expect(looksLikeDashboardConstructionRequest(request)).toBe(true);
    expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
  });

  it("preserves analytics intent in a clause after an automation request", () => {
    for (const request of [
      "Create an automation to send the weekly summary. What was the conversion rate last week?",
      "Create an automation and show the conversion rate last week",
      "Create an automation, then show the conversion rate last week",
      "What was the conversion rate last week? Then create an automation to send it",
    ]) {
      expect(looksLikeAnalyticsDataRequest(request)).toBe(true);
    }
  });

  it("preserves a later dashboard build after a sentence-boundary refresh-rate question", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "What is the refresh rate of the dashboard? Then build a Sales dashboard",
      ),
    ).toBe(true);
  });

  it("preserves modified follow-up dashboard builds after refresh-rate questions", () => {
    for (const request of [
      "What is the dashboard refresh rate and also build a Sales dashboard",
      "What is the dashboard refresh rate and then please build a Sales dashboard",
      "What is the dashboard refresh rate? Please build a Sales dashboard",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(true);
    }
  });

  it("preserves an elliptical dashboard target after a refresh-rate report", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a report showing the dashboard refresh rate and a Sales dashboard",
      ),
    ).toBe(true);
  });

  it("does not treat a dashboard template input as dashboard construction", () => {
    for (const request of [
      "Use a dashboard template to create an automation",
      "Use the dashboard template for an automation",
      "Use the existing dashboard template for an automation",
    ]) {
      expect(looksLikeDashboardConstructionRequest(request)).toBe(false);
    }
  });

  it("masks compound actions inside an automation", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation to refresh and update the Revenue dashboard",
      ),
    ).toBe(false);
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a workflow to update, refresh, and rename the Revenue dashboard",
      ),
    ).toBe(false);
  });

  it("keeps automation dashboards that use a template as construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create an automation dashboard using a template",
      ),
    ).toBe(true);
  });

  it("keeps named dashboards as dashboard construction", () => {
    expect(
      looksLikeDashboardConstructionRequest(
        "Create a dashboard called Automation Health",
      ),
    ).toBe(true);
  });

  it("still treats a plain numeric analytics question as a data request, not construction", () => {
    expect(
      looksLikeAnalyticsDataRequest("What was our conversion rate last week?"),
    ).toBe(true);
    expect(
      looksLikeDashboardConstructionRequest(
        "What was our conversion rate last week?",
      ),
    ).toBe(false);
  });

  it("accepts dashboard reference and inspection actions as construction progress", () => {
    expect(
      hasDashboardConstructionAttempt([
        { name: "get-sql-dashboard", content: '{"id":"company-a-analysis"}' },
      ]),
    ).toBe(true);
    expect(
      hasDashboardConstructionAttempt([
        {
          name: "get-explorer-dashboard",
          content: '{"id":"company-a-explorer"}',
        },
      ]),
    ).toBe(true);
    expect(
      hasDashboardConstructionAttempt([
        { name: "search-dashboard-references", content: "[]" },
      ]),
    ).toBe(true);
    expect(
      hasDashboardConstructionAttempt([
        { name: "get-extension", content: "{}" },
      ]),
    ).toBe(true);
    expect(hasDashboardConstructionAttempt([{ name: "bigquery" }])).toBe(false);
    expect(hasDashboardConstructionAttempt([])).toBe(false);
  });

  it("recognizes catalog/dashboard-reference discovery as a search attempt", () => {
    expect(
      hasCatalogSearchAttempt([
        { name: "search-analytics-query-catalog", content: "[]" },
      ]),
    ).toBe(true);
    expect(
      hasCatalogSearchAttempt([
        { name: "search-dashboard-references", content: "[]" },
      ]),
    ).toBe(true);
    expect(
      hasCatalogSearchAttempt([
        {
          name: "search-analytics-query-catalog",
          isError: true,
          content: "boom",
        },
      ]),
    ).toBe(false);
    expect(hasCatalogSearchAttempt([{ name: "bigquery" }])).toBe(false);
    expect(hasCatalogSearchAttempt([])).toBe(false);
    expect(hasCatalogSearchAttempt(undefined)).toBe(false);
  });

  it("does not treat authoring/saving a dashboard or extension alone as construction progress", () => {
    // update-dashboard/mutate-dashboard/create-extension/update-extension can
    // all author brand-new SQL or extension content, so calling them with no
    // prior inspection/clone step must not be enough to bypass the real-data
    // guard for an invented dashboard or extension.
    expect(
      hasDashboardConstructionAttempt([
        { name: "update-dashboard", content: "{}" },
      ]),
    ).toBe(false);
    expect(
      hasDashboardConstructionAttempt([
        { name: "mutate-dashboard", content: "{}" },
      ]),
    ).toBe(false);
    expect(
      hasDashboardConstructionAttempt([
        { name: "create-extension", content: "{}" },
      ]),
    ).toBe(false);
    expect(
      hasDashboardConstructionAttempt([
        { name: "update-extension", content: "{}" },
      ]),
    ).toBe(false);
    // But it's fine alongside a real inspection/clone step.
    expect(
      hasDashboardConstructionAttempt([
        { name: "get-extension", content: "{}" },
        { name: "update-dashboard", content: "{}" },
      ]),
    ).toBe(true);
    expect(
      hasDashboardConstructionAttempt([
        { name: "get-sql-dashboard", content: "{}" },
        { name: "create-extension", content: "{}" },
      ]),
    ).toBe(true);
  });

  it("still blocks inventing metrics without a data query", () => {
    expect(draftClaimsAnalyticsMetrics("Company B has 12,450 users")).toBe(
      true,
    );
    expect(
      draftClaimsAnalyticsMetrics("Company B signups increased last week"),
    ).toBe(true);
    expect(
      draftClaimsAnalyticsMetrics("Company B had zero signups last week"),
    ).toBe(true);
    expect(
      draftClaimsAnalyticsMetrics(
        "I've cloned the Company A extension for Company B. What org id should I filter on?",
      ),
    ).toBe(false);
  });

  it("treats a qualitative trend claim as a claim, not just an explicit number", () => {
    expect(draftClaimsAnalyticsMetrics("signups increased last week")).toBe(
      true,
    );
    expect(draftClaimsAnalyticsMetrics("traffic dropped this week")).toBe(true);
    expect(
      draftClaimsAnalyticsMetrics("sessions are trending up recently"),
    ).toBe(true);
    expect(draftClaimsAnalyticsMetrics("usage is higher than last month")).toBe(
      true,
    );
    expect(draftClaimsAnalyticsMetrics("churn was lower than expected")).toBe(
      true,
    );
    // Still a topic word, not a claim — no assertion is being made.
    expect(draftClaimsAnalyticsMetrics("what's the trend for signups?")).toBe(
      false,
    );
  });
});
