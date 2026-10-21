import { describe, expect, it } from "vitest";

import { operationItemId } from "../triage/ids.js";
import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  PROVIDER_OUTPUT_BUDGET_CHARS,
  ProviderOperationError,
  boundOutput,
  buildProviderRequest,
  extractReceipt,
  fitItems,
  mapItems,
  parseProviderResponse,
} from "./provider-request.js";

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

function failureOf(run: () => unknown): ProviderOperationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProviderOperationError) return error;
    throw error;
  }
  throw new Error("Expected a ProviderOperationError.");
}

const SINCE = "2026-10-17T10:00:00.000Z";
const UNTIL = "2026-10-17T11:00:00.000Z";
const SCOPE = { orgId: "org-1", factoryId: "factory-1" };

function parseSource(
  def: OperationDefinition,
  body: unknown,
  options: Parameters<typeof parseProviderResponse>[2] = {},
) {
  return parseProviderResponse(def, body, { scope: SCOPE, ...options });
}

describe("buildProviderRequest", () => {
  it("builds the request from the catalog and the field values", () => {
    const built = buildProviderRequest(op("slack.findUserByEmail"), {
      fields: { email: "pat@example.com" },
    });
    expect(built).toEqual({
      method: "GET",
      path: "/users.lookupByEmail",
      query: { email: "pat@example.com" },
      openPlaceholders: [],
    });
  });

  it("drops an unbound optional query key instead of sending an empty one", () => {
    const without = buildProviderRequest(op("github.listCommits"), {
      fields: { repo: "acme/app" },
      window: { from: SINCE, to: UNTIL },
    });
    expect(without.path).toBe("/repos/acme/app/commits");
    expect(without.query).toEqual({
      since: SINCE,
      until: UNTIL,
      per_page: "100",
    });

    const withBranch = buildProviderRequest(op("github.listCommits"), {
      fields: { repo: "acme/app", branch: "release" },
      window: { from: SINCE, to: UNTIL },
    });
    expect(withBranch.query.sha).toBe("release");
  });

  it("drops an unbound optional whole-value body key", () => {
    const without = buildProviderRequest(op("jira.createIssue"), {
      fields: { projectKey: "ENG", title: "Broken" },
    });
    expect(without.body).toEqual({
      fields: {
        project: { key: "ENG" },
        issuetype: { name: "Bug" },
        summary: "Broken",
      },
    });

    const withText = buildProviderRequest(op("jira.createIssue"), {
      fields: { projectKey: "ENG", title: "Broken", description: "Steps" },
    });
    expect(
      (withText.body as { fields: Record<string, unknown> }).fields.description,
    ).toBe("Steps");
  });

  it("keeps a number a number when the whole value is a field", () => {
    const built = buildProviderRequest(op("posthog.usage"), {
      fields: { customerId: "pat@example.com" },
    });
    const query = (built.body as { query: Record<string, unknown> }).query;
    expect(query.values).toEqual({
      customer: "pat@example.com",
      windowDays: 3,
    });
  });

  it("leaves braces that are not declared fields alone", () => {
    const built = buildProviderRequest(op("posthog.usage"), {
      fields: { customerId: "pat@example.com" },
    });
    const sql = (built.body as { query: { query: string } }).query.query;
    expect(sql).toContain("toIntervalDay({windowDays})");
    expect(sql).toContain("distinct_id = {customer}");
  });

  it("keeps / in a repository and a file path, and encodes each segment", () => {
    const built = buildProviderRequest(op("github.readFile"), {
      fields: { repo: "acme/app", path: "docs/my file#1.md", ref: "main" },
    });
    expect(built.path).toBe("/repos/acme/app/contents/docs/my%20file%231.md");
    expect(built.query).toEqual({ ref: "main" });
  });

  it("encodes characters that would end a path segment", () => {
    const built = buildProviderRequest(op("pylon.ticketThread"), {
      fields: { ticketId: "a?b#c%d" },
    });
    expect(built.path).toBe("/issues/a%3Fb%23c%25d/messages");
  });

  it("leaves an unbound optional path placeholder for core to fill", () => {
    const open = buildProviderRequest(op("sentry.issueStatus"), {
      fields: { issueId: "42" },
    });
    expect(open.path).toBe("/organizations/{orgSlug}/issues/42/");
    expect(open.openPlaceholders).toEqual(["orgSlug"]);

    const bound = buildProviderRequest(op("sentry.issueStatus"), {
      fields: { issueId: "42", orgSlug: "acme" },
    });
    expect(bound.path).toBe("/organizations/acme/issues/42/");
    expect(bound.openPlaceholders).toEqual([]);
  });

  describe("path values", () => {
    const ticket = (ticketId: string) => () =>
      buildProviderRequest(op("pylon.ticketThread"), { fields: { ticketId } });

    it.each([
      ["..", ".."],
      ["a dot segment", "."],
      ["an encoded dot dot", "%2e%2e"],
      ["a slash in a one-segment field", "abc/reply"],
      ["a dot dot behind a slash", "x/../y"],
      ["a backslash", "a\\b"],
      ["a control character", "a\u0000b"],
    ])("rejects %s", (_label, value) => {
      const error = failureOf(ticket(value));
      expect(error.code).toBe("unsafe_path_value");
      expect(error.operationId).toBe("pylon.ticketThread");
    });

    it.each([
      ["a dot dot segment", "acme/../app"],
      ["a third segment", "acme/app/extra"],
      ["a single segment", "acme"],
      ["an empty segment", "acme/"],
    ])("rejects %s in a repository", (_label, repo) => {
      const error = failureOf(() =>
        buildProviderRequest(op("github.readFile"), {
          fields: { repo, path: "README.md" },
        }),
      );
      expect(error.code).toBe("unsafe_path_value");
    });

    it("rejects a dot dot or empty segment in a file path", () => {
      for (const path of ["../secrets", "a/./b", "a//b", "/etc/passwd", "a/"]) {
        const error = failureOf(() =>
          buildProviderRequest(op("github.readFile"), {
            fields: { repo: "acme/app", path },
          }),
        );
        expect(error.code, path).toBe("unsafe_path_value");
      }
    });
  });

  describe("a field pasted into SQL", () => {
    const build = (table: string) => () =>
      buildProviderRequest(op("bigquery.billingQuery"), {
        fields: { table },
        window: { from: SINCE, to: UNTIL },
      });

    it("pastes a dotted table name and nothing else", () => {
      const built = build(
        "my-proj.billing_ds.gcp_billing_export_v1_01AB_CD_23",
      )();
      const sql = (built.body as { query: string }).query;
      expect(sql).toContain(
        "FROM `my-proj.billing_ds.gcp_billing_export_v1_01AB_CD_23`",
      );
      expect(sql).not.toContain("{table}");
    });

    it.each([
      ["a closing backtick and a second statement", "p.d.t`; DROP TABLE x; --"],
      ["a backtick", "p.d.t`"],
      ["a quote", "p.d.t'"],
      ["a space", "p.d.t UNION SELECT 1"],
      ["a semicolon", "p.d.t;"],
      ["a newline", "p.d.t\nSELECT 1"],
      ["a comment opener", "p.d.t/*"],
      ["two parts", "dataset.table"],
      ["four parts", "a.b.c.d"],
      ["a leading dot", ".d.t"],
      ["an empty part", "p..t"],
      ["a unicode look-alike dot", "p․d.t"],
    ])("rejects %s", (_label, table) => {
      const error = failureOf(build(table));
      expect(error.code).toBe("invalid_table");
      expect(error.operationId).toBe("bigquery.billingQuery");
    });
  });

  it("refuses to paste a field into body text unless a validator lists it", () => {
    const synthetic = {
      ...op("jira.createIssue"),
      id: "jira.synthetic",
      implementation: {
        type: "provider-request" as const,
        method: "POST" as const,
        pathTemplate: "/rest/api/2/issue",
        bodyTemplate: { jql: "project = {projectKey}" },
      },
    };
    expect(
      failureOf(() =>
        buildProviderRequest(synthetic, {
          fields: { projectKey: "ENG", title: "x" },
        }),
      ).code,
    ).toBe("unsafe_placeholder");
  });

  it("refuses an optional field that sits inside text instead of leaving a hole", () => {
    const synthetic = {
      ...op("github.searchCode"),
      id: "github.synthetic",
      fields: [
        { name: "repo", type: "string" as const },
        { name: "label", type: "string" as const },
      ],
      implementation: {
        type: "provider-request" as const,
        method: "GET" as const,
        pathTemplate: "/search/code",
        query: { q: "{repo} label:{label}" },
      },
    };
    expect(
      failureOf(() =>
        buildProviderRequest(synthetic, { fields: { repo: "acme/app" } }),
      ).code,
    ).toBe("unbound_placeholder");
  });

  it("fills placeholders embedded in a query value", () => {
    const built = buildProviderRequest(op("github.mergedPullRequests"), {
      fields: { repo: "acme/app", since: SINCE },
    });
    expect(built.query.q).toBe(
      `repo:acme/app is:pr is:merged merged:>=${SINCE}`,
    );
  });

  describe("field checks", () => {
    it("names the operation and field for a missing required field", () => {
      const error = failureOf(() =>
        buildProviderRequest(op("pylon.reply"), {
          fields: { ticketId: "t1", bodyHtml: "<p>hi</p>" },
        }),
      );
      expect(error.code).toBe("missing_field");
      expect(error.message).toContain("pylon.reply");
      expect(error.message).toContain("messageId");
    });

    it("treats blank text as missing", () => {
      expect(
        failureOf(() =>
          buildProviderRequest(op("pylon.addNote"), {
            fields: { ticketId: "   ", bodyHtml: "x" },
          }),
        ).code,
      ).toBe("missing_field");
    });

    it("rejects a field the operation does not declare", () => {
      expect(
        failureOf(() =>
          buildProviderRequest(op("pylon.addNote"), {
            fields: { ticketId: "t1", bodyHtml: "x", path: "/issues/other" },
          }),
        ).code,
      ).toBe("unknown_field");
    });

    it("rejects a value of the wrong type", () => {
      expect(
        failureOf(() =>
          buildProviderRequest(op("pylon.addNote"), {
            fields: { ticketId: 12, bodyHtml: "x" },
          }),
        ).code,
      ).toBe("invalid_field");
      expect(
        failureOf(() =>
          buildProviderRequest(op("posthog.usage"), {
            fields: { customerId: "c", days: "3" },
          }),
        ).code,
      ).toBe("invalid_field");
    });

    it("rejects an object where text is needed", () => {
      expect(
        failureOf(() =>
          buildProviderRequest(op("github.searchCode"), {
            fields: { repo: "acme/app", query: { $ne: "" } },
          }),
        ).code,
      ).toBe("invalid_field");
    });
  });

  describe("cursor and window", () => {
    it("sends the stored cursor in the filter", () => {
      const built = buildProviderRequest(op("hubspot.newLeads"), {
        fields: {},
        cursor: "9001",
      });
      const filters = (built.body as { filterGroups: { filters: unknown[] }[] })
        .filterGroups[0].filters;
      expect(filters).toContainEqual({
        propertyName: "hs_object_id",
        operator: "GT",
        value: "9001",
      });
    });

    it("drops the whole cursor filter on a first run, so the request asks for the newest page", () => {
      const hubspot = buildProviderRequest(op("hubspot.newLeads"), {
        fields: {},
      });
      expect(
        (hubspot.body as { filterGroups: { filters: unknown[] }[] })
          .filterGroups[0].filters,
      ).toEqual([
        { propertyName: "lifecyclestage", operator: "EQ", value: "lead" },
      ]);

      const pylon = buildProviderRequest(op("pylon.newTickets"), {
        fields: {},
      });
      expect(pylon.body).toEqual({ limit: 100 });

      const stripe = buildProviderRequest(op("stripe.newSubscriptions"), {
        fields: {},
      });
      expect(stripe.query).not.toHaveProperty("created[gte]");
      expect(stripe.query.status).toBe("active");
    });

    it("fills the window and refuses to run without one", () => {
      const built = buildProviderRequest(op("gong.newCalls"), {
        fields: {},
        window: { from: SINCE, to: UNTIL },
      });
      expect(built.query).toEqual({
        fromDateTime: SINCE,
        toDateTime: UNTIL,
      });
      expect(
        failureOf(() =>
          buildProviderRequest(op("gong.newCalls"), { fields: {} }),
        ).code,
      ).toBe("missing_field");
      expect(
        failureOf(() =>
          buildProviderRequest(op("gong.newCalls"), {
            fields: {},
            window: { from: "yesterday-ish", to: UNTIL },
          }),
        ).code,
      ).toBe("invalid_field");
    });

    it("rejects a cursor or window for an operation that has none", () => {
      expect(
        failureOf(() =>
          buildProviderRequest(op("pylon.addNote"), {
            fields: { ticketId: "t1", bodyHtml: "x" },
            cursor: "1",
          }),
        ).code,
      ).toBe("invalid_field");
      expect(
        failureOf(() =>
          buildProviderRequest(op("pylon.addNote"), {
            fields: { ticketId: "t1", bodyHtml: "x" },
            window: { from: SINCE, to: UNTIL },
          }),
        ).code,
      ).toBe("invalid_field");
    });
  });
});

describe("parseProviderResponse for a source", () => {
  const leads = {
    results: [
      {
        id: "9003",
        createdAt: "2026-10-17T10:05:00.000Z",
        properties: {
          email: "ada@example.com",
          company: "Analytical",
          hubspot_owner_id: "77",
        },
      },
      {
        id: "9002",
        createdAt: "2026-10-17T10:01:00.000Z",
        properties: { email: "bob@example.com", hubspot_owner_id: null },
      },
    ],
  };

  it("maps each entry to a normalized item and reads the cursor", () => {
    const parsed = parseSource(op("hubspot.newLeads"), leads);
    expect(parsed.cursor).toBe("9003");
    expect(parsed.truncated).toBe(false);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items?.[0]).toMatchObject({
      id: operationItemId(SCOPE, "hubspot.newLeads", "9003"),
      externalId: "9003",
      kind: "lead",
      provider: "hubspot",
      title: "ada@example.com",
      occurredAt: "2026-10-17T10:05:00.000Z",
      extras: { ownerId: "77", company: "Analytical" },
    });
    // A null in the response is an absent value, not the text "null".
    expect(parsed.items?.[1].extras).toEqual({});
  });

  it("returns an empty page and no cursor when the list is empty", () => {
    const parsed = parseSource(op("hubspot.newLeads"), {
      results: [],
    });
    expect(parsed.items).toEqual([]);
    expect(parsed.cursor).toBeUndefined();
  });

  it("treats a response with no list as unexpected, never as an empty page", () => {
    const secret = "sk-live-do-not-leak";
    const error = failureOf(() =>
      parseSource(op("hubspot.newLeads"), {
        message: secret,
        status: "error",
      }),
    );
    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("hubspot.newLeads");
    expect(error.message).not.toContain(secret);
  });

  it("treats a response that is not JSON as unexpected", () => {
    const error = failureOf(() =>
      parseSource(op("hubspot.newLeads"), undefined),
    );
    expect(error.code).toBe("unexpected_response");
  });

  it("fails the response when an item lacks what the mapping needs", () => {
    const secret = "pat-private-text";
    const noKey = failureOf(() =>
      parseSource(op("hubspot.newLeads"), {
        results: [
          {
            createdAt: "2026-10-17T10:05:00.000Z",
            properties: { email: secret },
          },
        ],
      }),
    );
    expect(noKey.code).toBe("unexpected_response");
    expect(noKey.message).toContain("item 0");
    expect(noKey.message).not.toContain(secret);

    for (const broken of [
      { id: "1", createdAt: "not a date", properties: { email: "a@b.co" } },
      { id: "1", properties: { email: "a@b.co" } },
    ]) {
      expect(
        failureOf(() =>
          parseSource(op("hubspot.newLeads"), { results: [broken] }),
        ).code,
      ).toBe("unexpected_response");
    }
  });

  it("fails an item whose url is not http(s)", () => {
    expect(
      failureOf(() =>
        parseSource(op("gong.newCalls"), {
          calls: [
            {
              id: "c1",
              title: "Intro",
              url: "javascript:alert(1)",
              started: "2026-10-17T10:00:00Z",
            },
          ],
        }),
      ).code,
    ).toBe("unexpected_response");
  });

  it("reads epoch seconds as a date", () => {
    const parsed = parseSource(op("stripe.newSubscriptions"), {
      data: [
        {
          id: "sub_1",
          created: 1_700_000_000,
          customer: { id: "cus_1", email: "pat@example.com" },
        },
      ],
    });
    expect(parsed.items?.[0].occurredAt).toBe("2023-11-14T22:13:20.000Z");
    expect(parsed.cursor).toBe("1700000000");
  });

  it("keeps a title to its first line", () => {
    const parsed = parseSource(op("github.listCommits"), [
      {
        sha: "abc123",
        html_url: "https://github.com/acme/app/commit/abc123",
        commit: {
          message: "Fix the thing\n\nA long explanation of why.",
          author: { name: "Ada" },
          committer: { date: "2026-10-17T10:00:00Z" },
        },
      },
    ]);
    expect(parsed.items?.[0].title).toBe("Fix the thing");
    expect(parsed.items?.[0].extras).toEqual({ sha: "abc123" });
  });

  it("truncates a long text and says so", () => {
    const parsed = parseSource(op("github.listSecurityAlerts"), [
      {
        number: 7,
        html_url: "https://github.com/acme/app/security/dependabot/7",
        created_at: "2026-10-17T10:00:00Z",
        security_advisory: {
          summary: "Prototype pollution",
          description: "x".repeat(10_000),
          severity: "high",
          ghsa_id: "GHSA-aaaa",
        },
        dependency: { package: { name: "lodash", ecosystem: "npm" } },
      },
    ]);
    const [item] = parsed.items ?? [];
    expect(item.textTruncated).toBe(true);
    expect(item.text?.length).toBeLessThanOrEqual(2048);
  });

  it("reads BigQuery's cell-by-cell rows", () => {
    const parsed = parseSource(op("bigquery.billingQuery"), {
      rows: [
        {
          f: [
            { v: "Compute Engine" },
            { v: "2026-10-16" },
            { v: "2026-10-16T00:00:00Z" },
            { v: 12.5 },
            { v: "Compute Engine|2026-10-16" },
          ],
        },
      ],
    });
    expect(parsed.items?.[0]).toMatchObject({
      externalId: "Compute Engine|2026-10-16",
      title: "Compute Engine",
      kind: "spike",
      extras: { service: "Compute Engine", date: "2026-10-16", cost: 12.5 },
    });
  });

  it("keeps items under the limit, says how many there were, and holds the cursor back", () => {
    const page = {
      results: ["9003", "9002", "9001"].map((id) => ({
        id,
        createdAt: "2026-10-17T10:00:00Z",
        properties: { email: `${id}@example.com` },
      })),
    };
    const parsed = parseSource(op("hubspot.newLeads"), page, {
      limit: 2,
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.totalAvailable).toBe(3);
    expect(parsed.truncated).toBe(true);
    // A cursor past items it did not return would skip them for good.
    expect(parsed.cursor).toBeUndefined();
  });

  it("holds the cursor back when the character budget cut the page", () => {
    const page = {
      results: Array.from({ length: 60 }, (_, index) => ({
        id: String(9000 - index),
        createdAt: "2026-10-17T10:00:00Z",
        properties: { email: `${"a".repeat(700)}${index}@example.com` },
      })),
    };
    const parsed = parseSource(op("hubspot.newLeads"), page, {
      limit: 100,
    });
    expect(parsed.truncated).toBe(true);
    expect(parsed.items!.length).toBeLessThan(60);
    expect(parsed.totalAvailable).toBe(60);
    expect(parsed.cursor).toBeUndefined();
    expect(JSON.stringify(parsed.items).length).toBeLessThan(
      PROVIDER_OUTPUT_BUDGET_CHARS,
    );
  });

  it("primes a cursor source: the position and no items", () => {
    const parsed = parseSource(op("hubspot.newLeads"), leads, {
      prime: true,
    });
    expect(parsed.items).toEqual([]);
    expect(parsed.cursor).toBe("9003");
    expect(parsed.primed).toBe(true);
    expect(parsed.output).toEqual({ primed: true, skipped: 2 });
  });

  it("primes an empty first page at where the source starts, so it counts as primed", () => {
    const parsed = parseSource(
      op("hubspot.newLeads"),
      { results: [] },
      { prime: true },
    );
    expect(parsed.items).toEqual([]);
    expect(parsed.primed).toBe(true);
    expect(parsed.cursor).toBe(op("hubspot.newLeads").cursor?.origin);
  });

  it("fails a page that has items but no position to save", () => {
    const synthetic = {
      ...op("hubspot.newLeads"),
      cursor: { param: "since", path: "paging.position" },
    };
    const error = failureOf(() =>
      mapItems(
        synthetic,
        {
          results: [
            {
              id: "1",
              createdAt: "2026-10-17T10:00:00Z",
              properties: { email: "a@b.co" },
            },
          ],
        },
        SCOPE,
      ),
    );
    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("paging.position");
  });
});

describe("parseProviderResponse for a lookup or a write", () => {
  it("returns the provider's own JSON as the output", () => {
    const body = { data: [{ id: "m1", body: "hello" }] };
    const parsed = parseProviderResponse(op("pylon.ticketThread"), body);
    expect(parsed).toEqual({ output: body, truncated: false });
  });

  it("reads the receipt from the response", () => {
    const parsed = parseProviderResponse(op("notion.createPage"), {
      id: "page-1",
      url: "https://www.notion.so/page-1",
      object: "page",
    });
    expect(parsed.externalRef).toBe("page-1");
    expect(parsed.url).toBe("https://www.notion.so/page-1");
  });

  it("accepts a numeric reference as text", () => {
    const parsed = parseProviderResponse(op("hubspot.addToList"), {
      recordsIdsAdded: [1234],
    });
    expect(parsed.externalRef).toBe("1234");
  });

  it("fails a write whose response shows no reference", () => {
    const error = failureOf(() =>
      parseProviderResponse(op("pylon.addNote"), { data: {} }),
    );
    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("pylon.addNote");
  });

  it("ignores a link that is not http(s)", () => {
    const receipt = extractReceipt(op("notion.createPage"), {
      id: "page-1",
      url: "file:///etc/passwd",
    });
    expect(receipt).toEqual({ externalRef: "page-1" });
  });

  it("reads the receipt before trimming a large response", () => {
    const parsed = parseProviderResponse(op("pylon.reply"), {
      data: { id: "msg-9" },
      echo: "z".repeat(100_000),
    });
    expect(parsed.truncated).toBe(true);
    expect(parsed.externalRef).toBe("msg-9");
  });

  it("fails a response that is not JSON", () => {
    expect(
      failureOf(() =>
        parseProviderResponse(op("pylon.ticketThread"), undefined),
      ).code,
    ).toBe("unexpected_response");
  });
});

describe("boundOutput", () => {
  it("returns a response under the budget untouched", () => {
    const body = { a: 1, list: [1, 2, 3] };
    expect(boundOutput(body)).toEqual({ output: body, truncated: false });
  });

  it("trims past the budget and flags it", () => {
    const body = {
      id: "call-1",
      sentences: Array.from({ length: 2000 }, (_, index) => ({
        start: index,
        text: `sentence ${index} ${"word ".repeat(10)}`,
      })),
    };
    const bounded = boundOutput(body);
    const output = bounded.output as {
      id: string;
      sentences: { start: number }[];
      truncated: boolean;
    };
    expect(bounded.truncated).toBe(true);
    expect(output.truncated).toBe(true);
    expect(output.id).toBe("call-1");
    expect(output.sentences.length).toBeGreaterThan(10);
    expect(output.sentences.length).toBeLessThan(2000);
    expect(output.sentences[0].start).toBe(0);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      PROVIDER_OUTPUT_BUDGET_CHARS,
    );
  });

  it("descends into one oversized entry instead of dropping it", () => {
    const body = {
      callTranscripts: [
        { callId: "c1", transcript: [{ text: "y".repeat(80_000) }] },
      ],
    };
    const output = boundOutput(body).output as {
      callTranscripts: { callId: string; transcript: { text: string }[] }[];
      truncated: boolean;
    };
    expect(output.truncated).toBe(true);
    expect(output.callTranscripts[0].callId).toBe("c1");
    expect(output.callTranscripts[0].transcript[0].text.length).toBeGreaterThan(
      1000,
    );
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(
      PROVIDER_OUTPUT_BUDGET_CHARS,
    );
  });

  it("wraps a list, or a response that already has a truncated key", () => {
    const list = boundOutput(
      Array.from({ length: 5000 }, (_, i) => `item-${i}`),
    );
    expect(list.output).toMatchObject({ truncated: true });
    expect((list.output as { value: unknown[] }).value.length).toBeLessThan(
      5000,
    );

    const clash = boundOutput({
      truncated: "provider's own",
      pad: "p".repeat(50_000),
    });
    expect(clash.output).toMatchObject({ truncated: true });
    expect(
      (clash.output as { value: { truncated: string } }).value.truncated,
    ).toBe("provider's own");
  });
});

describe("fitItems", () => {
  const item = (n: number) =>
    ({
      id: `x:${n}`,
      externalId: String(n),
      kind: "lead",
      provider: "x",
      title: `t${n}`,
      occurredAt: "2026-10-17T10:00:00Z",
      extras: {},
    }) as never;

  it("caps at the limit and reports the total", () => {
    const fitted = fitItems([item(1), item(2), item(3)], { limit: 2 });
    expect(fitted.items).toHaveLength(2);
    expect(fitted).toMatchObject({ cut: true, totalAvailable: 3 });
  });

  it("reports nothing when nothing was cut", () => {
    expect(fitItems([item(1)], { limit: 5 })).toEqual({
      items: [item(1)],
      cut: false,
    });
  });
});

describe("provider_shape_unexpected tripwire", () => {
  const SECRET = "sk-live-do-not-leak";

  function observe() {
    const { sink, events } = createCapturingTripwireSink();
    return { events, observe: { tripwire: sink, status: 200 } };
  }

  it("records a source response that has no list, and fails exactly as before", () => {
    const def = op("hubspot.newLeads");
    const body = { message: SECRET, results: "not a list" };
    const { events, observe: watching } = observe();

    const error = failureOf(() => mapItems(def, body, SCOPE, watching));

    const stored = sanitizeDetails(events[0].details).fields;
    expect(JSON.stringify(stored)).not.toContain(SECRET);

    const unobserved = failureOf(() => mapItems(def, body, SCOPE));
    expect(error.code).toBe(unobserved.code);
    expect(error.message).toBe(unobserved.message);
  });

  it("still throws the same error", () => {
    const def = op("hubspot.newLeads");
    const row = (id: string | undefined) => ({
      ...(id === undefined ? {} : { id }),
      createdAt: "2026-10-17T10:05:00.000Z",
      properties: { email: `${id ?? "x"}@example.com` },
    });
    const body = { results: [row("1"), row(undefined), row("3")] };
    const { observe: watching } = observe();

    const error = failureOf(() => mapItems(def, body, SCOPE, watching));

    expect(error.code).toBe("unexpected_response");
  });

  it("records a write whose response carries no receipt reference", () => {
    const def = op("pylon.addNote");
    const { observe: watching } = observe();

    const error = failureOf(() =>
      parseProviderResponse(def, { data: {} }, { observe: watching }),
    );

    expect(error.code).toBe("unexpected_response");
  });

  it("records nothing for a response that is what the catalog promised", () => {
    const def = op("hubspot.newLeads");
    const { observe: watching } = observe();

    const parsed = parseProviderResponse(
      def,
      {
        results: [
          {
            id: "9003",
            createdAt: "2026-10-17T10:05:00.000Z",
            properties: { email: "ada@example.com" },
          },
        ],
      },
      { scope: SCOPE, observe: watching },
    );

    expect(parsed.items).toHaveLength(1);
  });
});
