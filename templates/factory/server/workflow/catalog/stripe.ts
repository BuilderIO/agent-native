import type { OperationDefinitionInput } from "../operations.js";

export const stripeOperations: OperationDefinitionInput[] = [
  {
    // Stripe lists run newest first and timestamps are epoch seconds, so the
    // cursor is the newest `created` and the item mapper must read a number
    // in `occurredAt` as seconds.
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
    cursor: { param: "since", path: "data[0].created", origin: "0" },
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
    id: "stripe.customerBilling",
    provider: "stripe",
    label: "Stripe: a customer's subscriptions and latest invoices",
    nodeKinds: ["lookup"],
    effect: "read",
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
