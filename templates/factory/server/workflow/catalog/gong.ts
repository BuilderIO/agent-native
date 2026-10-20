import type { OperationDefinitionInput } from "../operations.js";

export const gongOperations: OperationDefinitionInput[] = [
  {
    // GET /calls requires both ends of the range and documents no ordering, so
    // this is a window source, not a cursor source.
    id: "gong.newCalls",
    provider: "gong",
    label: "Gong: calls in a window",
    nodeKinds: ["source"],
    effect: "read",
    fields: [],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/calls",
      query: { fromDateTime: "{since}", toDateTime: "{until}" },
    },
    window: { fromParam: "since", toParam: "until" },
    itemMapping: {
      kind: "call",
      itemsPath: "calls",
      fields: {
        title: ["title", "Call {id}"],
        url: "url",
        occurredAt: "started",
        "extras.scope": "scope",
        "extras.duration": "duration",
        "extras.direction": "direction",
      },
      dedupeKey: "id",
    },
    credential: { provider: "gong" },
  },
  {
    // POST, but it only reads.
    id: "gong.transcript",
    provider: "gong",
    label: "Gong: read a call transcript",
    nodeKinds: ["lookup"],
    effect: "read",
    readsViaPost: true,
    fields: [{ name: "callId", type: "string", required: true, label: "Call" }],
    implementation: {
      type: "provider-request",
      method: "POST",
      pathTemplate: "/calls/transcript",
      bodyTemplate: { filter: { callIds: ["{callId}"] } },
    },
    credential: { provider: "gong" },
  },
];
