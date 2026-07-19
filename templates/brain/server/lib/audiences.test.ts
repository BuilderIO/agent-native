import { describe, expect, it } from "vitest";

import {
  assertSingleEvidenceTenant,
  computeAudienceAclHash,
  computeCaptureAudienceId,
  filterAudienceIdsByDependencies,
  isAudienceMembershipFresh,
  SLACK_PRIVATE_AUDIENCE_TTL_MS,
} from "./audiences.js";

describe("audience ACL hashes", () => {
  it("is stable when a non-restricted audience resyncs unchanged members", async () => {
    const original = await computeAudienceAclHash("slack-private-channel", [
      "person-b@example.com",
      "person-a@example.com",
    ]);
    const resynced = await computeAudienceAclHash("slack-private-channel", [
      "person-a@example.com",
      "person-b@example.com",
      "person-a@example.com",
    ]);
    const wrongKind = await computeAudienceAclHash("restricted", [
      "person-a@example.com",
      "person-b@example.com",
    ]);

    expect(resynced).toBe(original);
    expect(wrongKind).not.toBe(original);
  });

  it("keeps an upstream partition stable across ACL changes without merging channels", async () => {
    const base = {
      sourceId: "slack-source",
      kind: "slack-private-channel" as const,
    };
    const original = await computeCaptureAudienceId({
      ...base,
      upstreamRefHash: "channel-a-hash",
      aclHash: "members-v1",
    });
    const resynced = await computeCaptureAudienceId({
      ...base,
      upstreamRefHash: "channel-a-hash",
      aclHash: "members-v2",
    });
    const otherChannel = await computeCaptureAudienceId({
      ...base,
      upstreamRefHash: "channel-b-hash",
      aclHash: "members-v1",
    });

    expect(resynced).toBe(original);
    expect(otherChannel).not.toBe(original);
  });

  it("rejects evidence that crosses tenant boundaries", () => {
    expect(() =>
      assertSingleEvidenceTenant([
        { sourceOrgId: "org-a", sourceOwnerEmail: "a@example.com" },
        { sourceOrgId: "org-b", sourceOwnerEmail: "b@example.com" },
      ]),
    ).toThrow(/same tenant/);
    expect(
      assertSingleEvidenceTenant([
        { sourceOrgId: "org-a", sourceOwnerEmail: "a@example.com" },
        { sourceOrgId: "org-a", sourceOwnerEmail: "b@example.com" },
      ]),
    ).toBe("org:org-a");
  });

  it("fails closed when private Slack membership has not been refreshed", () => {
    const now = Date.parse("2026-07-19T12:00:00.000Z");
    expect(
      isAudienceMembershipFresh(
        "slack-private-channel",
        new Date(now - SLACK_PRIVATE_AUDIENCE_TTL_MS + 1).toISOString(),
        now,
      ),
    ).toBe(true);
    expect(
      isAudienceMembershipFresh(
        "slack-private-channel",
        new Date(now - SLACK_PRIVATE_AUDIENCE_TTL_MS - 1).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(
      isAudienceMembershipFresh("meeting", "2020-01-01T00:00:00.000Z", now),
    ).toBe(true);
  });

  it("removes derived audiences when any evidence audience is inaccessible", () => {
    const dependencies = [
      { audienceId: "derived", dependsOnAudienceId: "public" },
      { audienceId: "derived", dependsOnAudienceId: "private-slack" },
    ];
    expect(
      filterAudienceIdsByDependencies(
        ["derived", "public", "private-slack"],
        dependencies,
      ),
    ).toEqual(new Set(["derived", "public", "private-slack"]));
    expect(
      filterAudienceIdsByDependencies(["derived", "public"], dependencies),
    ).toEqual(new Set(["public"]));
  });

  it("removes derived audiences when any evidence source is inaccessible", () => {
    const sourceDependencies = [
      { audienceId: "derived", sourceId: "source-a" },
      { audienceId: "derived", sourceId: "source-b" },
    ];
    expect(
      filterAudienceIdsByDependencies(["derived"], [], sourceDependencies, [
        "source-a",
        "source-b",
      ]),
    ).toEqual(new Set(["derived"]));
    expect(
      filterAudienceIdsByDependencies(["derived"], [], sourceDependencies, [
        "source-a",
      ]),
    ).toEqual(new Set());
  });
});
