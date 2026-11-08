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
    // A range with no calls answers 404 {"requestId", "errors": ["No calls found corresponding to the provided filters"]}.
    emptyRange: { errorIncludes: "no calls found" },
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
    // POST, but it only reads. A 45-minute call is 65 KB or more of sentences
    // with their start and end times, and story 05 reads one per external call
    // of a half hour. Only who spoke, the topic and the words are kept, about
    // 90 characters a sentence where the whole one takes 111. After the call's
    // item and the model's summary each call is about 3 KB more, so 18,000
    // lets three calls through a step, with about 15 minutes of speech from
    // each (a cut keeps 1,500 characters for its own report); a longer
    // transcript keeps its leading turns and says how many it kept. A fourth
    // external call in one half hour fails the step, which names what to do.
    id: "gong.transcript",
    provider: "gong",
    label: "Gong: read a call transcript",
    nodeKinds: ["lookup"],
    effect: "read",
    answerBudgetChars: 18_000,
    answerFields: [
      "records.totalRecords",
      "callTranscripts.callId",
      "callTranscripts.transcript.speakerId",
      "callTranscripts.transcript.topic",
      "callTranscripts.transcript.sentences.text",
    ],
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
