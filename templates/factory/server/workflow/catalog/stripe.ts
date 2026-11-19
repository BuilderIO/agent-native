import type { OperationDefinitionInput } from "../operations.js";

export const stripeOperations: OperationDefinitionInput[] = [
  {
    // Stripe lists run newest first, take no sort, and timestamps are epoch
    // seconds, so the item mapper must read a number in `occurredAt` as
    // seconds. A run sorts what it was sent, oldest first, and takes the oldest
    // subscriptions up to its limit; the rest wait for the next run instead of
    // being skipped. `created[gte]` is inclusive, so a subscription made in the
    // same second as the stored position is offered again and found handled,
    // never missed. That holds only while the page is every subscription since
    // the position, so a page Stripe calls partial (`has_more`) fails the run
    // rather than skip the oldest.
    id: "stripe.newSubscriptions",
    provider: "stripe",
    label: "Stripe: new subscriptions",
    nodeKinds: ["source"],
    effect: "read",
    fields: [],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/subscriptions",
      query: {
        "created[gte]": "{since}",
        status: "active",
        limit: "100",
        "expand[0]": "data.customer",
      },
    },
    cursor: {
      param: "since",
      origin: "0",
      forward: { itemPath: "created", sortInCode: { morePath: "has_more" } },
    },
    itemMapping: {
      kind: "lead",
      itemsPath: "data",
      fields: {
        title: [
          "customer.email",
          "customer.name",
          "Customer {customer.id}",
          "Subscription {id}",
        ],
        author: "customer.email",
        occurredAt: "created",
        "extras.customerId": "customer.id",
        "extras.customerEmail": "customer.email",
        "extras.subscriptionId": "id",
      },
      dedupeKey: "id",
    },
    credential: { provider: "stripe" },
  },
  {
    // Limited to the customers with this email (three at most, so a second
    // match is visible), their subscriptions and each one's latest invoice.
    // Stripe cannot select fields: one customer with one subscription and its
    // expanded invoice is about 7 KB raw, 6 KB more for each further
    // subscription, and it stays attached to every ticket a run sends here.
    // `answerFields` keeps what a billing answer quotes (about 1.2 KB for a
    // customer with one subscription) and the budget holds three such
    // customers, so a cut drops a later customer or subscription whole and
    // never the status or invoice of the first.
    id: "stripe.customerBilling",
    provider: "stripe",
    label: "Stripe: a customer's subscriptions and latest invoices",
    nodeKinds: ["lookup"],
    effect: "read",
    answerBudgetChars: 4_000,
    answerFields: [
      "object",
      "has_more",
      "data.id",
      "data.email",
      "data.name",
      "data.currency",
      "data.balance",
      "data.delinquent",
      "data.subscriptions.has_more",
      "data.subscriptions.data.id",
      "data.subscriptions.data.status",
      "data.subscriptions.data.currency",
      "data.subscriptions.data.collection_method",
      "data.subscriptions.data.start_date",
      "data.subscriptions.data.trial_end",
      "data.subscriptions.data.current_period_start",
      "data.subscriptions.data.current_period_end",
      "data.subscriptions.data.cancel_at_period_end",
      "data.subscriptions.data.cancel_at",
      "data.subscriptions.data.canceled_at",
      "data.subscriptions.data.ended_at",
      "data.subscriptions.data.plan.nickname",
      "data.subscriptions.data.plan.amount",
      "data.subscriptions.data.plan.currency",
      "data.subscriptions.data.plan.interval",
      "data.subscriptions.data.items.data.quantity",
      "data.subscriptions.data.items.data.current_period_start",
      "data.subscriptions.data.items.data.current_period_end",
      "data.subscriptions.data.items.data.price.nickname",
      "data.subscriptions.data.items.data.price.unit_amount",
      "data.subscriptions.data.items.data.price.currency",
      "data.subscriptions.data.items.data.price.recurring.interval",
      "data.subscriptions.data.latest_invoice.id",
      "data.subscriptions.data.latest_invoice.number",
      "data.subscriptions.data.latest_invoice.status",
      "data.subscriptions.data.latest_invoice.currency",
      "data.subscriptions.data.latest_invoice.total",
      "data.subscriptions.data.latest_invoice.amount_due",
      "data.subscriptions.data.latest_invoice.amount_paid",
      "data.subscriptions.data.latest_invoice.amount_remaining",
      "data.subscriptions.data.latest_invoice.created",
      "data.subscriptions.data.latest_invoice.due_date",
      "data.subscriptions.data.latest_invoice.attempt_count",
      "data.subscriptions.data.latest_invoice.next_payment_attempt",
      "data.subscriptions.data.latest_invoice.billing_reason",
      "data.subscriptions.data.latest_invoice.hosted_invoice_url",
      "data.subscriptions.data.latest_invoice.status_transitions",
    ],
    fields: [{ name: "email", type: "string", required: true, label: "Email" }],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/customers",
      query: {
        email: "{email}",
        limit: "3",
        "expand[0]": "data.subscriptions.data.latest_invoice",
      },
    },
    credential: { provider: "stripe" },
  },
];
