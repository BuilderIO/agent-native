import type { OperationDefinitionInput } from "../operations.js";

// Writes go through one host action because a Slack recipient may be an email
// address, which chat.postMessage rejects until it is resolved to a user id.
const postReceipt = { externalRef: "ts", url: "permalink" };

const postOutputs = [
  { name: "ok", type: "boolean" },
  {
    name: "channel",
    type: "string",
    description: "The channel id it landed in.",
  },
  {
    name: "ts",
    type: "string",
    description: "The message time; the same value is externalRef.",
  },
  { name: "threadTs", type: "string", nullable: true },
  { name: "permalink", type: "string", nullable: true },
  {
    name: "permalinkError",
    type: "string",
    description: "Only when Slack gave no permalink.",
  },
  { name: "recipient", type: "object" },
] as const;

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
    description:
      "Reads a whole thread. A message's reactions are everyone's but the app's own bot, whose are listed apart as ownReactions.",
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
    outputs: [...postOutputs],
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
    outputs: [...postOutputs],
    receipt: postReceipt,
    credential: { provider: "slack" },
  },
  {
    id: "slack.addReaction",
    provider: "slack",
    label: "Slack: add a reaction",
    description:
      "Adds an emoji reaction to a message as the bot. channel is an id, not a name; ts is the message's time. A repeat is a success with alreadyReacted true. The bot's own reaction never counts as a person's claim or reply.",
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
        name: "ts",
        type: "string",
        required: true,
        target: true,
        label: "Message",
      },
      {
        name: "name",
        type: "string",
        required: true,
        label: "Emoji name, without colons",
        description:
          "Lowercase letters, digits, _, + and -, such as eyes or white_check_mark.",
      },
    ],
    implementation: {
      type: "action",
      action: "add-slack-reaction",
      argMap: { channel: "channel", ts: "ts", name: "name" },
    },
    outputs: [
      { name: "ok", type: "boolean" },
      {
        name: "alreadyReacted",
        type: "boolean",
        description: "True when the bot had already put this reaction there.",
      },
    ],
    receipt: { externalRef: "externalRef" },
    credential: { provider: "slack" },
  },
];
