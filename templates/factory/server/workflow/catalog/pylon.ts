import type { OperationDefinitionInput } from "../operations.js";

const ticket = {
  name: "ticketId",
  type: "string",
  required: true,
  label: "Ticket",
} as const;

// A reply or note lands on this ticket, so a model never picks it.
const ticketTarget = { ...ticket, target: true } as const;

export const pylonOperations: OperationDefinitionInput[] = [
  {
    // The cursor is the newest created_at seen. It assumes search results come
    // newest first, which the docs do not state.
    id: "pylon.newTickets",
    provider: "pylon",
    label: "Pylon: new tickets",
    nodeKinds: ["source"],
    effect: "read",
    readsViaPost: true,
    fields: [],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/issues/search",
      bodyTemplate: {
        filter: {
          field: "created_at",
          operator: "time_is_after",
          value: "{since}",
        },
        limit: 100,
      },
    },
    cursor: {
      param: "since",
      path: "data[0].created_at",
      origin: "1970-01-01T00:00:00Z",
    },
    itemMapping: {
      kind: "ticket",
      itemsPath: "data",
      fields: {
        title: ["title", "Ticket {id}"],
        url: "link",
        author: "requester.email",
        occurredAt: "created_at",
        "thread.ticketId": "id",
        "extras.state": "state",
      },
      dedupeKey: "id",
    },
    credential: { provider: "pylon" },
  },
  {
    id: "pylon.ticketThread",
    provider: "pylon",
    label: "Pylon: read a ticket's messages",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [ticket],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/issues/{ticketId}/messages",
      query: { limit: "100" },
    },
    credential: { provider: "pylon" },
  },
  {
    // Pylon requires the top-level message the reply answers.
    id: "pylon.reply",
    provider: "pylon",
    label: "Pylon: reply to the customer",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      ticketTarget,
      {
        name: "messageId",
        type: "string",
        required: true,
        target: true,
        label: "Message to answer",
      },
      { name: "bodyHtml", type: "text", required: true, label: "Reply (HTML)" },
    ],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/issues/{ticketId}/reply",
      bodyTemplate: { body_html: "{bodyHtml}", message_id: "{messageId}" },
    },
    receipt: { externalRef: "data.id" },
    credential: { provider: "pylon" },
  },
  {
    id: "pylon.addNote",
    provider: "pylon",
    label: "Pylon: add an internal note",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      ticketTarget,
      { name: "bodyHtml", type: "text", required: true, label: "Note (HTML)" },
    ],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/issues/{ticketId}/note",
      bodyTemplate: { body_html: "{bodyHtml}" },
    },
    receipt: { externalRef: "data.id" },
    credential: { provider: "pylon" },
  },
];
