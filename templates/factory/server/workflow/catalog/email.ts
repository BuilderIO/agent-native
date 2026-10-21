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
    receipt: { externalRef: "messageRef" },
    credential: { provider: "email" },
  },
];
