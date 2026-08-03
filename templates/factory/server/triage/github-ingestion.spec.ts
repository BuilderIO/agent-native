import { describe, expect, it } from "vitest";

import { pullRequestSnapshotToEnvelope } from "./github-ingestion.js";

describe("pullRequestSnapshotToEnvelope", () => {
  it("keeps the head SHA in the item identity and preserves evidence coverage", () => {
    const envelope = pullRequestSnapshotToEnvelope({
      repo: "BuilderIO/agent-native",
      pullRequestNumber: 123,
      headSha: "abc123",
      title: "Fix triage",
      sourceUrl: "https://github.com/BuilderIO/agent-native/pull/123",
      summary: "Review fix",
      coverage: "partial",
      changedFiles: ["templates/factory/actions/poll-slack-channel.ts"],
      diffLines: 42,
      reviews: [],
      checks: [],
      observedAt: "2026-07-31T10:00:00.000Z",
    });

    expect(envelope).toMatchObject({
      source: "github",
      externalId: "BuilderIO/agent-native#123@abc123",
      sourceUrl: "https://github.com/BuilderIO/agent-native/pull/123",
      coverage: "partial",
      repository: "BuilderIO/agent-native",
      pullRequestNumber: 123,
      headSha: "abc123",
    });
    expect(envelope.metadata).toEqual({
      changedFiles: ["templates/factory/actions/poll-slack-channel.ts"],
      diffLines: 42,
      reviews: 0,
      checks: 0,
    });
  });
});
