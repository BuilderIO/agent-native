import { describe, expect, it } from "vitest";

import { PRIVATE_SNAPSHOT_IDENTITY_FIELDS } from "./private-snapshot.js";

describe("private snapshot identity fields", () => {
  it("retains structural and accounting fields while excluding private content", () => {
    expect([...PRIVATE_SNAPSHOT_IDENTITY_FIELDS]).toEqual([
      "id",
      "type",
      "role",
      "status",
      "runId",
      "threadId",
      "messageId",
      "activeMessageId",
      "toolCallId",
      "invocationId",
      "sequence",
      "lastSequence",
      "occurredAt",
      "createdAt",
      "startedAt",
      "completedAt",
      "updatedAt",
      "parentId",
      "turnId",
      "isError",
      "approvalPause",
      "completedSideEffect",
      "durationMs",
      "elapsedSeconds",
      "progress",
      "size",
      "mediaType",
      "format",
      "version",
      "sequenceByRun",
      "activeRunIds",
      "parentTaskId",
      "assignedAgentId",
      "agentId",
      "agentCallId",
      "taskId",
      "widgetId",
      "itemId",
      "approvalId",
      "optionId",
      "expiresAt",
      "count",
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "cost",
      "currency",
      "omitFromPersistedHistory",
    ]);
    for (const field of [
      "text",
      "content",
      "input",
      "output",
      "prompt",
      "title",
    ]) {
      expect(PRIVATE_SNAPSHOT_IDENTITY_FIELDS.has(field)).toBe(false);
    }
  });
});
