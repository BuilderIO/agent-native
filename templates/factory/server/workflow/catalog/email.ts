import type { OperationDefinitionInput } from "../operations.js";

export const emailOperations: OperationDefinitionInput[] = [
  {
    id: "email.send",
    provider: "email",
    label: "Email: send a message",
    nodeKinds: ["action"],
    effect: "write",
    fields: [
      { name: "to", type: "string", required: true, target: true, label: "To" },
      { name: "subject", type: "string", required: true, label: "Subject" },
      { name: "body", type: "text", required: true, label: "Body (markdown)" },
      { name: "cc", type: "string", target: true, label: "Cc" },
      { name: "replyTo", type: "string", target: true, label: "Reply-to" },
    ],
    // The framework transport returns no message id, so the host action
    // returns the idempotency key it sent as `messageRef`.
    implementation: {
      type: "action",
      action: "send-factory-email",
      argMap: {
        to: "to",
        subject: "subject",
        body: "body",
        cc: "cc",
        replyTo: "replyTo",
      },
    },
    outputs: [
      { name: "ok", type: "boolean" },
      {
        name: "messageRef",
        type: "string",
        description:
          "The idempotency key sent to the provider; the same value is externalRef.",
      },
      { name: "provider", type: "string" },
      {
        name: "recipients",
        type: "list",
        description: "Addresses the message was sent to.",
      },
      {
        name: "suppressed",
        type: "list",
        description: "Addresses skipped as test identities.",
      },
    ],
    receipt: { externalRef: "messageRef" },
    credential: { provider: "email" },
  },
];
