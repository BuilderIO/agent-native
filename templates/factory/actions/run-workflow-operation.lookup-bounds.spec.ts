import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAutomationMock = vi.hoisted(() => vi.fn());
const executeRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  isAgentConnectionRequiredError: (error: unknown) =>
    (error as { name?: string } | null)?.name ===
    "AgentConnectionRequiredError",
}));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireAutomationMock,
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: async () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../server/lib/factory-automation-resources.js", () => ({
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));
vi.mock("../server/lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: executeRequestMock,
}));
vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));

import {
  PROVIDER_PAYLOAD_BUDGET_CHARS,
  boundOutput,
} from "../server/workflow-host/provider-request.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import type { WorkflowNode } from "../server/workflow/contract.js";
import { assertStepWithinCap } from "../server/workflow/engine/cap.js";
import type { FlowItem } from "../server/workflow/engine/types.js";
import action from "./run-workflow-operation.js";

const context = {
  caller: "automation" as const,
  userEmail: "owner@example.test",
  actionName: "run-workflow-operation",
  signal: new AbortController().signal,
  automation: { triggerId: "job-1", triggerName: "factories/f1/wf" },
};

type Result = Record<string, any>;

const run = (
  operationId: string,
  fields: Record<string, unknown>,
): Promise<Result> =>
  (
    action as unknown as { run: (i: unknown, c: unknown) => Promise<Result> }
  ).run({ operationId, fields }, context);

/** What core's runtime returns for an HTTP answer. */
function answer(json: unknown) {
  return {
    request: { method: "GET", path: "/ok" },
    response: {
      status: 200,
      ok: true,
      truncated: false,
      size: 100,
      headers: {},
      json,
    },
  };
}

const sizeOf = (value: unknown) => JSON.stringify(value).length;
const budgetOf = (id: string) => OPERATION_CATALOG.get(id)!.answerBudgetChars!;

/** What a cut answer reports: `truncated` first, then where it was cut. */
interface Cut {
  path: string;
  kept?: number;
  of?: number;
  keptChars?: number;
  ofChars?: number;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAutomationMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Answers as the providers send them: the fields a graph reads sit among the
// ones it never does, in the provider's own key order.
// ---------------------------------------------------------------------------

function stripePrice(index: number) {
  return {
    id: `price_${index}`,
    object: "price",
    active: true,
    billing_scheme: "per_unit",
    created: 1_759_312_800,
    currency: "usd",
    custom_unit_amount: null,
    livemode: true,
    lookup_key: null,
    metadata: {},
    nickname: "Pro",
    product: `prod_${index}`,
    recurring: {
      aggregate_usage: null,
      interval: "month",
      interval_count: 1,
      meter: null,
      trial_period_days: null,
      usage_type: "licensed",
    },
    tax_behavior: "unspecified",
    tiers_mode: null,
    transform_quantity: null,
    type: "recurring",
    unit_amount: 4000,
    unit_amount_decimal: "4000",
  };
}

function stripeInvoice(index: number) {
  return {
    id: `in_${index}`,
    object: "invoice",
    account_country: "US",
    account_name: "Example Inc",
    account_tax_ids: null,
    amount_due: 4000,
    amount_paid: 4000,
    amount_remaining: 0,
    amount_shipping: 0,
    application: null,
    application_fee_amount: null,
    attempt_count: 1,
    attempted: true,
    auto_advance: false,
    automatic_tax: { enabled: false, liability: null, status: null },
    billing_reason: "subscription_cycle",
    charge: `ch_${index}`,
    collection_method: "charge_automatically",
    created: 1_759_312_800,
    currency: "usd",
    custom_fields: null,
    customer: "cus_1",
    customer_address: null,
    customer_email: "pat@customer.example.test",
    customer_name: "Pat Customer",
    customer_phone: null,
    customer_shipping: null,
    customer_tax_exempt: "none",
    customer_tax_ids: [],
    default_payment_method: null,
    default_source: null,
    default_tax_rates: [],
    description: null,
    discount: null,
    discounts: [],
    due_date: null,
    effective_at: 1_759_316_400,
    ending_balance: 0,
    footer: null,
    from_invoice: null,
    hosted_invoice_url: `https://invoice.stripe.example.test/i/acct_1/live_${"a".repeat(64)}`,
    invoice_pdf: `https://pay.stripe.example.test/invoice/acct_1/live_${"b".repeat(64)}/pdf`,
    issuer: { type: "self" },
    last_finalization_error: null,
    latest_revision: null,
    lines: {
      object: "list",
      data: [
        {
          id: `il_${index}`,
          object: "line_item",
          amount: 4000,
          amount_excluding_tax: 4000,
          currency: "usd",
          description: "1 × Pro (at $40.00 / month)",
          discount_amounts: [],
          discountable: true,
          discounts: [],
          invoice_item: `ii_${index}`,
          livemode: true,
          metadata: {},
          period: { end: 1_762_991_200, start: 1_760_312_800 },
          plan: { id: `price_${index}`, object: "plan", nickname: "Pro" },
          price: stripePrice(index),
          proration: false,
          proration_details: { credited_items: null },
          quantity: 1,
          subscription: `sub_${index}`,
          tax_amounts: [],
          tax_rates: [],
          type: "subscription",
        },
      ],
      has_more: false,
      total_count: 1,
      url: `/v1/invoices/in_${index}/lines`,
    },
    livemode: true,
    metadata: {},
    next_payment_attempt: null,
    number: `INV-${index}`,
    on_behalf_of: null,
    paid: true,
    payment_intent: `pi_${index}`,
    payment_settings: {
      default_mandate: null,
      payment_method_options: null,
      payment_method_types: null,
    },
    period_end: 1_759_312_800,
    period_start: 1_756_634_400,
    post_payment_credit_notes_amount: 0,
    pre_payment_credit_notes_amount: 0,
    receipt_number: null,
    rendering: null,
    starting_balance: 0,
    statement_descriptor: null,
    status: "paid",
    status_transitions: {
      finalized_at: 1_759_316_400,
      marked_uncollectible_at: null,
      paid_at: 1_759_316_460,
      voided_at: null,
    },
    subscription: `sub_${index}`,
    subtotal: 4000,
    subtotal_excluding_tax: 4000,
    tax: null,
    test_clock: null,
    total: 4000,
    total_discount_amounts: [],
    total_excluding_tax: 4000,
    total_tax_amounts: [],
    transfer_data: null,
    webhooks_delivered_at: 1_759_316_405,
  };
}

/** Keys in Stripe's order: the bulky `items` and the config come before `latest_invoice` and `status`. */
function stripeSubscription(index: number) {
  return {
    id: `sub_${index}`,
    object: "subscription",
    application: null,
    application_fee_percent: null,
    automatic_tax: { enabled: false, liability: null },
    billing_cycle_anchor: 1_759_312_800,
    billing_cycle_anchor_config: null,
    billing_thresholds: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancellation_details: { comment: null, feedback: null, reason: null },
    collection_method: "charge_automatically",
    created: 1_759_312_800,
    currency: "usd",
    current_period_end: 1_762_991_200,
    current_period_start: 1_760_312_800,
    customer: "cus_1",
    days_until_due: null,
    default_payment_method: null,
    default_source: null,
    default_tax_rates: [],
    description: null,
    discount: null,
    discounts: [],
    ended_at: null,
    invoice_settings: { account_tax_ids: null, issuer: { type: "self" } },
    items: {
      object: "list",
      data: [
        {
          id: `si_${index}`,
          object: "subscription_item",
          billing_thresholds: null,
          created: 1_759_312_800,
          discounts: [],
          metadata: {},
          plan: {
            id: `price_${index}`,
            object: "plan",
            active: true,
            aggregate_usage: null,
            amount: 4000,
            amount_decimal: "4000",
            billing_scheme: "per_unit",
            created: 1_759_312_800,
            currency: "usd",
            interval: "month",
            interval_count: 1,
            livemode: true,
            metadata: {},
            meter: null,
            nickname: "Pro",
            product: `prod_${index}`,
            tiers_mode: null,
            transform_usage: null,
            trial_period_days: null,
            usage_type: "licensed",
          },
          price: stripePrice(index),
          quantity: 1,
          subscription: `sub_${index}`,
          tax_rates: [],
        },
      ],
      has_more: false,
      total_count: 1,
      url: `/v1/subscription_items?subscription=sub_${index}`,
    },
    latest_invoice: stripeInvoice(index),
    livemode: true,
    metadata: {},
    next_pending_invoice_item_invoice: null,
    on_behalf_of: null,
    pause_collection: null,
    payment_settings: {
      payment_method_options: null,
      payment_method_types: null,
      save_default_payment_method: "off",
    },
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    plan: {
      id: `price_${index}`,
      object: "plan",
      active: true,
      amount: 4000,
      amount_decimal: "4000",
      billing_scheme: "per_unit",
      currency: "usd",
      interval: "month",
      interval_count: 1,
      livemode: true,
      metadata: {},
      nickname: "Pro",
      product: `prod_${index}`,
      usage_type: "licensed",
    },
    quantity: 1,
    schedule: null,
    start_date: 1_759_312_800,
    status: "active",
    test_clock: null,
    transfer_data: null,
    trial_end: null,
    trial_settings: {
      end_behavior: { missing_payment_method: "create_invoice" },
    },
    trial_start: null,
  };
}

function stripeCustomer(index: number, subscriptions: number) {
  return {
    id: `cus_${index}`,
    object: "customer",
    address: null,
    balance: 0,
    created: 1_740_000_000,
    currency: "usd",
    default_source: null,
    delinquent: false,
    description: null,
    discount: null,
    email: "pat@customer.example.test",
    invoice_prefix: "ABC123",
    invoice_settings: {
      custom_fields: null,
      default_payment_method: null,
      footer: null,
      rendering_options: null,
    },
    livemode: true,
    metadata: {},
    name: "Pat Customer",
    next_invoice_sequence: 12,
    phone: null,
    preferred_locales: [],
    shipping: null,
    tax_exempt: "none",
    test_clock: null,
    subscriptions: {
      object: "list",
      data: Array.from({ length: subscriptions }, (_, sub) =>
        stripeSubscription(index * 100 + sub),
      ),
      has_more: false,
      total_count: subscriptions,
      url: `/v1/customers/cus_${index}/subscriptions`,
    },
  };
}

const stripeList = (customers: number, subscriptions: number) => ({
  object: "list",
  data: Array.from({ length: customers }, (_, index) =>
    stripeCustomer(index + 1, subscriptions),
  ),
  has_more: false,
  url: "/v1/customers",
});

/** The transcript endpoint's answer: one call, speakers taking turns, a start and end on every sentence. */
function gongTranscript(sentences: number) {
  const perTurn = 8;
  return {
    requestId: "req-1",
    records: { totalRecords: 1, currentPageSize: 1, currentPageNumber: 0 },
    callTranscripts: [
      {
        callId: "call-1",
        transcript: Array.from(
          { length: Math.ceil(sentences / perTurn) },
          (_, turn) => ({
            speakerId: `speaker-${turn % 2}`,
            topic: "Planning",
            sentences: Array.from({ length: perTurn }, (_, sentence) => ({
              start: (turn * perTurn + sentence) * 4_000,
              end: (turn * perTurn + sentence + 1) * 4_000,
              text: `We want to roll this out to the whole team after the security review, number ${turn * perTurn + sentence}.`,
            })),
          }),
        ),
      },
    ],
  };
}

function sentryEvent(index: number) {
  return {
    id: `${index}`.padStart(32, "0"),
    "event.type": "error",
    groupID: "4821",
    eventID: `e${String(index).padStart(31, "0")}`,
    projectID: "12",
    message: "TypeError: cannot read 'total' of undefined",
    title: "TypeError: cannot read 'total' of undefined",
    location: "app/cart/summary.ts",
    culprit: "summarize(app/cart/summary)",
    user: {
      id: `u${index}`,
      email: `person.${index}@customer.example.test`,
      ip_address: "203.0.113.7",
      username: null,
    },
    tags: Array.from({ length: 22 }, (_, tag) => ({
      key: `tag_${tag}`,
      value: `value-${tag}-${"v".repeat(12)}`,
    })),
    platform: "javascript",
    dateCreated: `2026-10-19T11:${String(index % 60).padStart(2, "0")}:12Z`,
    crashFile: null,
    metadata: {
      type: "TypeError",
      value: "cannot read 'total' of undefined",
      filename: "app/cart/summary.ts",
      function: "summarize",
    },
  };
}

function sentryIssue(activity: number) {
  return {
    id: "4821",
    shareId: null,
    shortId: "WEB-4821",
    title: "TypeError: cannot read 'total' of undefined",
    culprit: "summarize(app/cart/summary)",
    permalink: "https://sentry.example.test/organizations/acme/issues/4821/",
    logger: null,
    level: "error",
    status: "unresolved",
    statusDetails: {},
    isPublic: false,
    platform: "javascript",
    project: { id: "12", name: "web", slug: "web", platform: "javascript" },
    type: "error",
    metadata: { type: "TypeError", value: "cannot read 'total' of undefined" },
    numComments: 0,
    assignedTo: null,
    isBookmarked: false,
    hasSeen: true,
    count: "412",
    userCount: 37,
    firstSeen: "2026-10-19T10:00:00Z",
    lastSeen: "2026-10-19T12:31:05Z",
    stats: {
      "24h": Array.from({ length: 24 }, (_, hour) => [
        1_760_000_000 + hour,
        hour,
      ]),
    },
    participants: [],
    tags: Array.from({ length: 12 }, (_, tag) => ({
      key: `tag_${tag}`,
      name: `Tag ${tag}`,
      totalValues: 40 + tag,
    })),
    activity: Array.from({ length: activity }, (_, entry) => ({
      id: `${entry}`,
      type: "note",
      dateCreated: "2026-10-19T11:00:00Z",
      data: { text: "Seen again after the deploy of web@2026.10.19-2." },
      user: { id: `${entry}`, name: "Pat", email: "pat@example.test" },
    })),
    seenBy: Array.from({ length: 15 }, (_, user) => ({
      id: `${user}`,
      name: `Person ${user}`,
      email: `person.${user}@example.test`,
      avatarUrl: `https://sentry.example.test/avatar/${"c".repeat(40)}/`,
    })),
  };
}

/** The query endpoint's answer: the count sits after the generated SQL, the timings and the modifiers. */
function posthogAnswer(count: number) {
  return {
    clickhouse: `SELECT count() AS keyEvents FROM events LEFT JOIN (${"SELECT argMax(person_distinct_id_overrides.person_id, version) AS person_id FROM person_distinct_id_overrides GROUP BY distinct_id ".repeat(14)}) AS override WHERE team_id = 12`,
    columns: ["keyEvents"],
    error: null,
    explain: null,
    hasMore: false,
    hogql: `SELECT count() AS keyEvents FROM events WHERE timestamp >= now() - toIntervalDay(3) AND (distinct_id = 'cus_1' OR person.properties.email = 'cus_1') ${"AND event NOT IN ('$feature_flag_called') ".repeat(4)}`,
    limit: 100,
    metadata: null,
    modifiers: {
      bounceRatePageViewMode: "count_pageviews",
      dataWarehouseEventsModifiers: [],
      inCohortVia: "auto",
      materializationMode: "legacy_null_as_null",
      optimizeJoinedFilters: false,
      personsOnEventsMode: "person_id_override_properties_joined",
      sessionTableVersion: "auto",
    },
    offset: 0,
    query: null,
    query_status: null,
    results: [[count]],
    timings: Array.from({ length: 36 }, (_, index) => ({
      k: `./select/where/call/${index}`,
      t: 0.000_01 * index,
    })),
    types: [["keyEvents", "UInt64"]],
  };
}

function githubUser(login: string) {
  const base = `https://api.github.example.test/users/${login}`;
  return {
    login,
    id: 1,
    node_id: "MDQ6VXNlcjE=",
    avatar_url: `https://avatars.example.test/u/1?v=4&s=${"4".repeat(20)}`,
    gravatar_id: "",
    url: base,
    html_url: `https://github.example.test/${login}`,
    followers_url: `${base}/followers`,
    following_url: `${base}/following{/other_user}`,
    gists_url: `${base}/gists{/gist_id}`,
    starred_url: `${base}/starred{/owner}{/repo}`,
    subscriptions_url: `${base}/subscriptions`,
    organizations_url: `${base}/orgs`,
    repos_url: `${base}/repos`,
    events_url: `${base}/events{/privacy}`,
    received_events_url: `${base}/received_events`,
    type: "User",
    site_admin: false,
  };
}

/** A search hit for a merged pull request: the issue object, with its description. */
function mergedPullRequest(number: number) {
  const repo = "https://api.github.example.test/repos/acme/web";
  return {
    url: `${repo}/issues/${number}`,
    repository_url: repo,
    labels_url: `${repo}/issues/${number}/labels{/name}`,
    comments_url: `${repo}/issues/${number}/comments`,
    events_url: `${repo}/issues/${number}/events`,
    html_url: `https://github.example.test/acme/web/pull/${number}`,
    id: number,
    node_id: `PR_${number}`,
    number,
    title: `Scale up the export workers for the nightly queue, change ${number}`,
    user: githubUser("octocat"),
    labels: [{ id: 1, name: "infra", color: "ededed", default: false }],
    state: "closed",
    locked: false,
    assignee: null,
    assignees: [],
    milestone: null,
    comments: 2,
    created_at: "2026-10-18T20:00:00Z",
    updated_at: "2026-10-18T22:10:00Z",
    closed_at: "2026-10-18T22:10:00Z",
    author_association: "MEMBER",
    draft: false,
    pull_request: {
      url: `${repo}/pulls/${number}`,
      html_url: `https://github.example.test/acme/web/pull/${number}`,
      diff_url: `https://github.example.test/acme/web/pull/${number}.diff`,
      patch_url: `https://github.example.test/acme/web/pull/${number}.patch`,
      merged_at: "2026-10-18T22:10:00Z",
    },
    body: `This raises the worker count for the export queue. ${"More about why, and how it was tested. ".repeat(40)}`,
    reactions: { total_count: 0, "+1": 0, "-1": 0, laugh: 0, hooray: 0 },
    timeline_url: `${repo}/issues/${number}/timeline`,
    state_reason: null,
    score: 1,
  };
}

function codeHit(index: number) {
  const repo = "https://api.github.example.test/repos/acme/web";
  return {
    name: `handler-${index}.ts`,
    path: `src/server/routes/handler-${index}.ts`,
    sha: "a".repeat(40),
    url: `${repo}/contents/src/server/routes/handler-${index}.ts?ref=${"b".repeat(40)}`,
    git_url: `${repo}/git/blobs/${"a".repeat(40)}`,
    html_url: `https://github.example.test/acme/web/blob/${"b".repeat(40)}/src/server/routes/handler-${index}.ts`,
    repository: {
      id: 1,
      node_id: "R_1",
      name: "web",
      full_name: "acme/web",
      private: true,
      owner: githubUser("acme"),
      html_url: "https://github.example.test/acme/web",
      description: "The web app",
      fork: false,
      url: repo,
      ...Object.fromEntries(
        [
          "forks",
          "keys",
          "collaborators",
          "teams",
          "hooks",
          "issue_events",
          "events",
          "assignees",
          "branches",
          "tags",
          "blobs",
          "git_tags",
          "git_refs",
          "trees",
          "statuses",
          "languages",
          "stargazers",
          "contributors",
          "subscribers",
          "subscription",
          "commits",
          "git_commits",
          "comments",
          "issue_comment",
          "contents",
          "compare",
          "merges",
          "archive",
          "downloads",
          "issues",
          "pulls",
          "milestones",
          "notifications",
          "labels",
          "releases",
          "deployments",
        ].map((name) => [`${name}_url`, `${repo}/${name}{/placeholder}`]),
      ),
    },
    score: 1,
  };
}

function githubFile(bytes: number) {
  const repo = "https://api.github.example.test/repos/acme/web";
  return {
    type: "file",
    encoding: "base64",
    size: bytes,
    name: "README.md",
    path: "README.md",
    content: Buffer.from("# Web\n".repeat(Math.ceil(bytes / 6)))
      .toString("base64")
      .slice(0, Math.ceil((bytes * 4) / 3)),
    sha: "a".repeat(40),
    url: `${repo}/contents/README.md?ref=main`,
    git_url: `${repo}/git/blobs/${"a".repeat(40)}`,
    html_url: "https://github.example.test/acme/web/blob/main/README.md",
    download_url: `https://raw.github.example.test/acme/web/main/README.md?token=${"t".repeat(30)}`,
    _links: {
      self: `${repo}/contents/README.md?ref=main`,
      git: `${repo}/git/blobs/${"a".repeat(40)}`,
      html: "https://github.example.test/acme/web/blob/main/README.md",
    },
  };
}

// ---------------------------------------------------------------------------

describe("stripe.customerBilling", () => {
  const id = "stripe.customerBilling";

  it("hands on the billing facts of a customer with one subscription, about a tenth of what Stripe sent", async () => {
    const raw = stripeList(1, 1);
    expect(sizeOf(raw)).toBeGreaterThan(5_000);
    console.log("STRIPE raw 1x1", sizeOf(raw));
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, { email: "pat@customer.example.test" });

    expect(result.truncated).toBe(false);
    expect(result.output).not.toHaveProperty("cuts");
    console.log("STRIPE kept 1x1", sizeOf(result.output));
    expect(sizeOf(result.output)).toBeLessThan(2_000);
    const [customer] = result.output.data;
    expect(customer).toMatchObject({
      id: "cus_1",
      email: "pat@customer.example.test",
      currency: "usd",
      delinquent: false,
    });
    const [subscription] = customer.subscriptions.data;
    expect(subscription).toMatchObject({
      id: "sub_100",
      status: "active",
      cancel_at_period_end: false,
      plan: {
        nickname: "Pro",
        amount: 4000,
        currency: "usd",
        interval: "month",
      },
    });
    expect(subscription.items.data[0]).toMatchObject({
      quantity: 1,
      price: {
        nickname: "Pro",
        unit_amount: 4000,
        currency: "usd",
        recurring: { interval: "month" },
      },
    });
    expect(subscription.latest_invoice).toMatchObject({
      id: "in_100",
      number: "INV-100",
      status: "paid",
      currency: "usd",
      total: 4000,
      amount_due: 4000,
      amount_paid: 4000,
      amount_remaining: 0,
      status_transitions: { paid_at: 1_759_316_460 },
    });
    expect(subscription).not.toHaveProperty("payment_settings");
    expect(subscription.latest_invoice).not.toHaveProperty("lines");
  });

  it("hands on, unchanged, an answer that holds only what story 06's fixture gives the model", async () => {
    const small = {
      data: [
        {
          id: "cus_ok",
          email: "ok@customer.example.test",
          subscriptions: {
            data: [
              {
                id: "sub_cus_ok",
                status: "active",
                plan: { nickname: "Pro" },
                latest_invoice: {
                  id: "INV-1",
                  amount_paid: 4000,
                  currency: "usd",
                  status: "paid",
                  status_transitions: { paid_at: "2026-10-01T09:00:00.000Z" },
                },
              },
            ],
          },
        },
      ],
    };
    executeRequestMock.mockResolvedValue(answer(small));

    const result = await run(id, { email: "ok@customer.example.test" });

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual(small);
  });

  it("answers a customer that has no match with the list's own marks, and no entries", async () => {
    executeRequestMock.mockResolvedValue(
      answer({
        object: "list",
        data: [],
        has_more: false,
        url: "/v1/customers",
      }),
    );

    const result = await run(id, { email: "nobody@customer.example.test" });

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual({ object: "list", has_more: false });
  });

  it("does not name a path that matched nothing, as an API request would", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ object: "list", data: [{ id: "cus_9" }], has_more: false }),
    );

    const result = await run(id, { email: "pat@customer.example.test" });

    expect(result.output).toEqual({
      object: "list",
      has_more: false,
      data: [{ id: "cus_9" }],
    });
  });

  it("cuts three customers with several subscriptions to its budget, keeping the first customer's status and invoice and saying what it left out", async () => {
    const raw = stripeList(3, 4);
    expect(sizeOf(raw)).toBeGreaterThan(PROVIDER_PAYLOAD_BUDGET_CHARS);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, { email: "pat@customer.example.test" });

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output.truncated).toBe(true);
    const cuts = result.output.cuts as Cut[];
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts.some((cut) => cut.of !== undefined && cut.kept! < cut.of)).toBe(
      true,
    );
    const [subscription] = result.output.data[0].subscriptions.data;
    expect(subscription.status).toBe("active");
    expect(subscription.latest_invoice).toMatchObject({
      amount_paid: 4000,
      status: "paid",
    });
  });

  it("is the reason the paths are kept: a cut of Stripe's own answer drops the first subscription's status and invoice", () => {
    const cut = boundOutput(stripeList(1, 2), budgetOf(id)).output as any;

    const [subscription] = cut.data[0].subscriptions.data;
    expect(subscription).not.toHaveProperty("status");
    expect(subscription.latest_invoice?.amount_paid).toBeUndefined();
  });
});

describe("gong.transcript", () => {
  const id = "gong.transcript";

  type Turn = ReturnType<
    typeof gongTranscript
  >["callTranscripts"][number]["transcript"][number];
  /** What a turn keeps: who spoke, the topic and the words, without the times. */
  const spoken = (turn: Turn) => ({
    speakerId: turn.speakerId,
    topic: turn.topic,
    sentences: turn.sentences.map(({ text }) => ({ text })),
  });
  const sentencesIn = (answer: unknown): number =>
    (
      answer as {
        callTranscripts: { transcript: { sentences: unknown[] }[] }[];
      }
    ).callTranscripts[0].transcript.reduce(
      (total, turn) => total + turn.sentences.length,
      0,
    );

  it("cuts a long call to its budget, keeping the call's opening turns and saying how many it kept", async () => {
    const raw = gongTranscript(800);
    expect(sizeOf(raw)).toBeGreaterThan(PROVIDER_PAYLOAD_BUDGET_CHARS);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, { callId: "call-1" });

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output.truncated).toBe(true);
    const cuts = result.output.cuts as Cut[];
    const turns = cuts.find((cut) => cut.path.endsWith("transcript"));
    expect(turns).toMatchObject({ of: 100 });
    expect(turns!.kept).toBeGreaterThan(0);
    expect(result.output.callTranscripts[0].callId).toBe("call-1");
    expect(result.output.callTranscripts[0].transcript[0]).toEqual(
      spoken(raw.callTranscripts[0].transcript[0]),
    );
  });

  it("leaves out the times, the request id and the paging facts, which nothing reads", async () => {
    executeRequestMock.mockResolvedValue(answer(gongTranscript(800)));

    const text = JSON.stringify((await run(id, { callId: "call-1" })).output);

    for (const gone of ['"start"', '"end"', "requestId", "currentPageSize"]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(text).toContain('"speakerId"');
    expect(text).toContain('"topic"');
  });

  it("hands a short call on whole, without its times", async () => {
    const raw = gongTranscript(16);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, { callId: "call-1" });

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual({
      records: { totalRecords: 1 },
      callTranscripts: [
        {
          callId: "call-1",
          transcript: raw.callTranscripts[0].transcript.map(spoken),
        },
      ],
    });
  });

  it("covers a quarter more of a long call than a cut of the whole answer at the same budget", async () => {
    const raw = gongTranscript(800);
    executeRequestMock.mockResolvedValue(answer(raw));

    const kept = sentencesIn((await run(id, { callId: "call-1" })).output);
    const whole = sentencesIn(boundOutput(raw, budgetOf(id)).output);

    expect(whole).toBeGreaterThan(50);
    expect(kept).toBeGreaterThanOrEqual(whole * 1.25);
  });

  it("says a call has no transcript by its record count, not by an empty answer", async () => {
    executeRequestMock.mockResolvedValue(
      answer({
        requestId: "req-1",
        records: { totalRecords: 0, currentPageSize: 0, currentPageNumber: 0 },
        callTranscripts: [],
      }),
    );

    const result = await run(id, { callId: "call-1" });

    expect(result.output).toEqual({ records: { totalRecords: 0 } });
  });
});

describe("sentry.issueEvents", () => {
  const id = "sentry.issueEvents";
  const fields = { issueId: "4821", orgSlug: "acme" };

  it("cuts fifty events to its budget, newest first, and says how many it kept", async () => {
    const raw = Array.from({ length: 50 }, (_, index) => sentryEvent(index));
    expect(sizeOf(raw)).toBeGreaterThan(PROVIDER_PAYLOAD_BUDGET_CHARS);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output).toMatchObject({
      truncated: true,
      totalAvailable: 50,
    });
    expect(result.output.count).toBeGreaterThan(1);
    expect(result.output.count).toBeLessThan(50);
    expect(result.output.value[0]).toEqual(raw[0]);
    expect(result.output.cuts).toContainEqual({
      path: "value",
      kept: result.output.count,
      of: 50,
    });
  });

  it("hands a handful of events on whole and unmarked", async () => {
    const raw = Array.from({ length: 3 }, (_, index) => sentryEvent(index));
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual(raw);
  });
});

describe("sentry.issueStatus", () => {
  const id = "sentry.issueStatus";
  const fields = { issueId: "4821", orgSlug: "acme" };

  it("cuts a busy issue's tail, keeping its identity and status", async () => {
    const raw = sentryIssue(60);
    expect(sizeOf(raw)).toBeGreaterThan(budgetOf(id));
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output.truncated).toBe(true);
    expect(result.output).toMatchObject({
      id: "4821",
      status: "unresolved",
      title: raw.title,
      count: "412",
      lastSeen: raw.lastSeen,
    });
    expect(result.output.cuts.length).toBeGreaterThan(0);
  });

  it("hands a quiet issue on whole and unmarked", async () => {
    const raw = sentryIssue(1);
    expect(sizeOf(raw)).toBeLessThan(budgetOf(id));
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual(raw);
  });
});

describe("posthog.usage", () => {
  const id = "posthog.usage";
  const fields = { customerId: "cus_1", days: 3, projectId: "12" };

  it("keeps the count and its column, a few dozen characters of the several KB PostHog sent", async () => {
    const raw = posthogAnswer(12);
    expect(sizeOf(raw)).toBeGreaterThan(4_000);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual({
      columns: ["keyEvents"],
      error: null,
      hasMore: false,
      results: [[12]],
    });
    expect(result.output.results[0][0]).toBe(12);
  });

  it("answers a query that returned no rows with no rows, not with a count", async () => {
    executeRequestMock.mockResolvedValue(
      answer({ ...posthogAnswer(0), results: [] }),
    );

    const result = await run(id, fields);

    expect(result.output.results).toEqual([]);
  });

  it("is the reason the paths are kept: a cut of PostHog's own answer loses the count", () => {
    const cut = boundOutput(posthogAnswer(12), budgetOf(id)).output as any;

    expect(cut.results).toBeUndefined();
  });
});

describe("github.mergedPullRequests", () => {
  const id = "github.mergedPullRequests";
  const fields = { repo: "acme/web", since: "2026-10-18T00:00:00Z" };

  it("keeps all thirty pull requests as number, title, link, author and times, where a cut of the whole answer kept a few", async () => {
    const raw = {
      total_count: 30,
      incomplete_results: false,
      items: Array.from({ length: 30 }, (_, index) =>
        mergedPullRequest(400 + index),
      ),
    };
    expect(sizeOf(raw)).toBeGreaterThan(PROVIDER_PAYLOAD_BUDGET_CHARS * 2);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(false);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output.total_count).toBe(30);
    expect(result.output.items).toHaveLength(30);
    expect(result.output.items[0]).toEqual({
      number: 400,
      title: raw.items[0].title,
      html_url: "https://github.example.test/acme/web/pull/400",
      state: "closed",
      user: { login: "octocat" },
      created_at: "2026-10-18T20:00:00Z",
      closed_at: "2026-10-18T22:10:00Z",
      pull_request: { merged_at: "2026-10-18T22:10:00Z" },
    });
    const wholeAnswerCut = boundOutput(raw).output as { items: unknown[] };
    expect(wholeAnswerCut.items.length).toBeLessThan(15);
  });

  it("cuts a list of long titles to its budget and says how many pull requests it kept", async () => {
    const raw = {
      total_count: 30,
      incomplete_results: false,
      items: Array.from({ length: 30 }, (_, index) => ({
        ...mergedPullRequest(400 + index),
        title: `${"A very long title. ".repeat(13)}${index}`,
      })),
    };
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    const cuts = result.output.cuts as Cut[];
    expect(cuts).toContainEqual({
      path: "items",
      kept: result.output.items.length,
      of: 30,
    });
    expect(result.output.items.length).toBeGreaterThan(15);
  });
});

describe("github.searchCode", () => {
  const id = "github.searchCode";
  const fields = { repo: "acme/web", query: "handler" };

  it("keeps all twenty hits as name, path and link, where each carried its whole repository", async () => {
    const raw = {
      total_count: 20,
      incomplete_results: false,
      items: Array.from({ length: 20 }, (_, index) => codeHit(index)),
    };
    expect(sizeOf(raw)).toBeGreaterThan(PROVIDER_PAYLOAD_BUDGET_CHARS * 2);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(false);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output.items).toHaveLength(20);
    expect(result.output.items[3]).toEqual({
      name: "handler-3.ts",
      path: "src/server/routes/handler-3.ts",
      html_url: raw.items[3].html_url,
    });
  });

  it("cuts hits with very long paths to its budget and says how many it kept", async () => {
    const raw = {
      total_count: 20,
      incomplete_results: false,
      items: Array.from({ length: 20 }, (_, index) => ({
        ...codeHit(index),
        path: `${"nested/".repeat(60)}handler-${index}.ts`,
      })),
    };
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output.cuts).toContainEqual({
      path: "items",
      kept: result.output.items.length,
      of: 20,
    });
  });
});

describe("github.readFile", () => {
  const id = "github.readFile";
  const fields = { repo: "acme/web", path: "README.md" };

  it("clips a large file's content to its budget and says how much it kept", async () => {
    const raw = githubFile(200_000);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(true);
    expect(sizeOf(result.output)).toBeLessThanOrEqual(budgetOf(id));
    expect(result.output).toMatchObject({
      truncated: true,
      type: "file",
      size: 200_000,
      path: "README.md",
    });
    const clip = (result.output.cuts as Cut[]).find(
      (cut) => cut.path === "content",
    );
    expect(clip).toMatchObject({ ofChars: raw.content.length });
    expect(clip!.keptChars).toBeLessThan(raw.content.length);
    expect(result.output.content).toBe(raw.content.slice(0, clip!.keptChars));
    // GitHub sends `content` before `sha` and the links, and the clipped text
    // takes the room, so the cut names what it left out.
    expect(result.output.cuts).toContainEqual(
      expect.objectContaining({ path: "", droppedKeys: expect.any(Array) }),
    );
  });

  it("hands a small file on whole and unmarked", async () => {
    const raw = githubFile(2_000);
    executeRequestMock.mockResolvedValue(answer(raw));

    const result = await run(id, fields);

    expect(result.truncated).toBe(false);
    expect(result.output).toEqual(raw);
  });
});

// ---------------------------------------------------------------------------
// What a step carries once the answers are on its items.
// ---------------------------------------------------------------------------

const stepNode = {
  id: "step",
  name: "step",
  kind: "lookup",
} as unknown as WorkflowNode;

/** Items as a step hands them on: the item itself and each earlier answer still attached to it. */
function withAnswers(
  count: number,
  item: Record<string, unknown>,
  nodes: Record<string, unknown>,
): FlowItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    data: { ...item, title: `${item.title} ${index}` },
    nodes,
    inbox: true,
  }));
}

/** The answer as the engine would hold it for one item. */
const answerOf = async (
  id: string,
  fields: Record<string, unknown>,
  raw: unknown,
): Promise<unknown> => {
  executeRequestMock.mockResolvedValue(answer(raw));
  return (await run(id, fields)).output;
};

describe("a step that carries these answers on its items", () => {
  it("story 06: four billing tickets fit with their threads and the model's answer, where Stripe's answers cut at the provider-wide budget do not", async () => {
    const ticket = {
      title: "Was I charged twice for October?",
      author: "pat@customer.example.test",
      url: `https://app.pylon.example.test/issues/${"x".repeat(80)}`,
      thread: { ticketId: "issue_1" },
    };
    const thread = { data: [{ id: "msg_1", message_html: "m".repeat(4_900) }] };
    const classify = {
      category: "billing",
      severity: "medium",
      confidence: "high",
      summary: "s".repeat(600),
    };
    const reply = {
      answer: "a".repeat(600),
      supported: true,
      confidence: "high",
    };
    const bounded = await answerOf(
      "stripe.customerBilling",
      { email: "pat@customer.example.test" },
      stripeList(3, 4),
    );
    const cutOnlyAtProviderBudget = boundOutput(
      stripeList(3, 4),
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    ).output;

    const fits = withAnswers(4, ticket, {
      thread,
      classify,
      stripe: bounded,
      answer: reply,
    });
    const overflows = withAnswers(4, ticket, {
      thread,
      classify,
      stripe: cutOnlyAtProviderBudget,
      answer: reply,
    });

    expect(() => assertStepWithinCap(stepNode, fits)).not.toThrow();
    expect(() => assertStepWithinCap(stepNode, overflows)).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
  });

  it("story 05: three external calls fit with the model's summary and the post, a fourth does not, and transcripts cut at the provider-wide budget fit only one", async () => {
    const call = {
      title: "Quarterly review with a customer",
      url: `https://app.gong.example.test/call?id=${"9".repeat(60)}`,
      extras: { scope: "External", duration: 2700, direction: "Conference" },
    };
    const extract = {
      summary: "s".repeat(600),
      actionItems: Array.from({ length: 5 }, () => ({
        text: "Send the pricing sheet by Friday".repeat(2),
        owner: "Pat",
        due: "Friday",
      })),
      risks: ["The security review may block the rollout."],
      nextStep: "n".repeat(100),
    };
    const post = {
      ok: true,
      channel: "C0CALLS",
      ts: "1760004000.000001",
      permalink: `https://slack.example.test/archives/C0CALLS/p${"1".repeat(40)}`,
    };
    const raw = gongTranscript(1_200);
    const bounded = await answerOf(
      "gong.transcript",
      { callId: "call-1" },
      raw,
    );

    const wholeAnswerCut = boundOutput(
      raw,
      PROVIDER_PAYLOAD_BUDGET_CHARS,
    ).output;
    const carry = (calls: number, transcript: unknown) =>
      withAnswers(calls, call, { transcript, extract, post });

    expect(() =>
      assertStepWithinCap(stepNode, carry(3, bounded)),
    ).not.toThrow();
    expect(() => assertStepWithinCap(stepNode, carry(4, bounded))).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
    // What the story took before the bound: one call fit, a second failed the step.
    expect(() =>
      assertStepWithinCap(stepNode, carry(1, wholeAnswerCut)),
    ).not.toThrow();
    expect(() =>
      assertStepWithinCap(stepNode, carry(2, wholeAnswerCut)),
    ).toThrow(expect.objectContaining({ code: "output_over_cap" }));
  });

  it("story 07: four resolved incidents fit with their events and the postmortem, where events cut at the provider-wide budget do not", async () => {
    const incident = {
      title: "TypeError: cannot read 'total' of undefined",
      url: "https://sentry.example.test/organizations/acme/issues/4821/",
      extras: { count: 412 },
    };
    const postmortem = {
      title: "t".repeat(80),
      summary: "s".repeat(500),
      timeline: Array.from({ length: 6 }, () => ({
        at: "2026-10-19T11:40:12.000Z",
        what: "w".repeat(80),
        eventId: "e".repeat(32),
        link: "https://sentry.example.test/organizations/acme/issues/4821/events/e1/",
      })),
      body: "b".repeat(2_000),
    };
    const raw = Array.from({ length: 50 }, (_, index) => sentryEvent(index));
    const bounded = await answerOf(
      "sentry.issueEvents",
      { issueId: "4821", orgSlug: "acme" },
      raw,
    );

    const fits = withAnswers(4, incident, { gather: bounded, postmortem });
    const overflows = withAnswers(4, incident, {
      gather: boundOutput(raw, PROVIDER_PAYLOAD_BUDGET_CHARS).output,
      postmortem,
    });

    expect(() => assertStepWithinCap(stepNode, fits)).not.toThrow();
    expect(() => assertStepWithinCap(stepNode, overflows)).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
  });

  it("story 09: the fifty subscriptions a run takes fit with their usage count, where PostHog's whole answer on each does not", async () => {
    const subscription = {
      title: "pat@customer.example.test",
      author: "pat@customer.example.test",
      extras: {
        customerId: "cus_1",
        customerEmail: "pat@customer.example.test",
        subscriptionId: "sub_1",
      },
    };
    const raw = posthogAnswer(2);
    const bounded = await answerOf(
      "posthog.usage",
      { customerId: "cus_1", days: 3 },
      raw,
    );

    const fits = withAnswers(50, subscription, { usage: bounded });
    const overflows = withAnswers(50, subscription, { usage: raw });

    expect(() => assertStepWithinCap(stepNode, fits)).not.toThrow();
    expect(() => assertStepWithinCap(stepNode, overflows)).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
  });
});
