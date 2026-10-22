import type { OperationDefinitionInput } from "../operations.js";

// Writes go through one host action because a Slack recipient may be an email
// address, which chat.postMessage rejects until it is resolved to a user id.
const postReceipt = { externalRef: "ts", url: "permalink" };

// Unset, the host action posts `<!channel>`, `<!here>` and `<@U...>` as plain
// text. It is a target because it decides who gets notified.
const mentionsField = {
  name: "allowMentions",
  type: "boolean",
  target: true,
  label: "Let the message notify people (@channel, @here, @person)",
} as const;

export const slackOperations: OperationDefinitionInput[] = [
  {
    id: "slack.readThread",
    provider: "slack",
    label: "Slack: read a thread",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [
      { name: "channel", type: "string", required: true, label: "Channel" },
      { name: "threadTs", type: "string", required: true, label: "Thread" },
      { name: "oldest", type: "string", label: "Only replies after" },
    ],
    // A partial thread is a failure, so the action pages to the end or errors.
    implementation: { type: "action", action: "read-slack-thread" },
    credential: { provider: "slack" },
  },
  {
    id: "slack.findUserByEmail",
    provider: "slack",
    label: "Slack: find a person by email",
    nodeKinds: ["lookup"],
    effect: "read",
    fields: [{ name: "email", type: "string", required: true, label: "Email" }],
    implementation: {
      type: "provider-request",
      method: "GET",
      pathTemplate: "/users.lookupByEmail",
      query: { email: "{email}" },
    },
    credential: { provider: "slack" },
  },
  {
    id: "slack.postMessage",
    provider: "slack",
    label: "Slack: post a message",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "to",
        type: "string",
        required: true,
        target: true,
        label: "Channel, person ID or email",
      },
      { name: "text", type: "text", required: true, label: "Message" },
      mentionsField,
    ],
    implementation: {
      type: "action",
      action: "post-slack-message",
      argMap: { to: "to", text: "text", allowMentions: "allowMentions" },
    },
    receipt: postReceipt,
    credential: { provider: "slack" },
  },
  {
    id: "slack.replyInThread",
    provider: "slack",
    label: "Slack: reply in a thread",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      {
        name: "channel",
        type: "string",
        required: true,
        target: true,
        label: "Channel",
      },
      {
        name: "threadTs",
        type: "string",
        required: true,
        target: true,
        label: "Thread",
      },
      { name: "text", type: "text", required: true, label: "Reply" },
      mentionsField,
    ],
    implementation: {
      type: "action",
      action: "post-slack-message",
      argMap: {
        channel: "to",
        threadTs: "threadTs",
        text: "text",
        allowMentions: "allowMentions",
      },
    },
    receipt: postReceipt,
    credential: { provider: "slack" },
  },
];
