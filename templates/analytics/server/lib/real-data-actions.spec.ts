import { describe, expect, it } from "vitest";

import {
  failedDataQueryAttemptMessage,
  GENERIC_NO_DATA_FALLBACK_MESSAGE,
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
  looksLikeStrongCoverageClaim,
  looksLikeAnalyticsDataRequest,
  needsCorpusWorkflowForCoverageSensitiveRequest,
  needsSourceRecordBodyWorkflowForCoverageSensitiveRequest,
  stripInjectedAnalyticsGuardContext,
} from "./real-data-actions";

describe("real data action classification", () => {
  it("treats unstructured source records as real analytics evidence", () => {
    expect(hasDataQueryAttempt([{ name: "gong-calls" }])).toBe(true);
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
          name: "query agent native analytics",
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
});
