import {
  snapshotComposerContextItems,
  type AgentChatContextItem,
  type ComposerContextSnapshot,
  type Reference,
} from "@agent-native/toolkit/agentkit";

import type { AgentRunOptions, FilePart } from "../protocol/index.js";

export interface AgentKitComposerSubmission {
  readonly threadId: string;
  readonly intent: "immediate" | "queued";
  readonly text: string;
  readonly contextItems?: ComposerContextSnapshot;
  readonly references: readonly Readonly<Reference>[];
  readonly attachments: readonly Readonly<FilePart>[];
  readonly options: Readonly<AgentRunOptions>;
}

function freezeValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeValue(child);
  }
  return value;
}

export function snapshotComposerValue<T>(value: T): T {
  return freezeValue(structuredClone(value));
}

export function createAgentKitComposerSubmission(input: {
  threadId: string;
  intent: AgentKitComposerSubmission["intent"];
  text: string;
  contextItems?: readonly AgentChatContextItem[];
  references: readonly Reference[];
  options: AgentRunOptions;
}): AgentKitComposerSubmission {
  const contextItems = snapshotComposerContextItems(input.contextItems);
  const context = contextItems?.map((item) => item.context).join("\n\n");
  return Object.freeze({
    threadId: input.threadId,
    intent: input.intent,
    text: context
      ? `${input.text}\n\n<context>\n${context}\n</context>`
      : input.text,
    ...(contextItems === undefined ? {} : { contextItems }),
    references: snapshotComposerValue(input.references),
    attachments: Object.freeze([]),
    options: snapshotComposerValue(input.options),
  });
}
