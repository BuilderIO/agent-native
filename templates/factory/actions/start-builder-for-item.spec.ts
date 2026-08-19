import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: vi.fn(),
  workspaceMemberIdentityFromContext: vi.fn(),
}));
vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: vi.fn(),
}));
vi.mock("../server/triage/builder-executor.js", () => ({
  startBuilderRun: vi.fn(),
}));
vi.mock("../server/triage/ids.js", () => ({ stableId: vi.fn() }));
vi.mock("../server/triage/metadata.js", () => ({
  metadataBoolean: vi.fn(),
  parseTriageMetadata: vi.fn(),
  serializeTriageMetadata: vi.fn(),
}));
vi.mock("../server/triage/pr-policy.js", () => ({
  detectOwnerOwnedArea: vi.fn(),
}));
vi.mock("../server/triage/slack-client.js", () => ({
  createSlackReader: vi.fn(),
}));

import { getDb } from "../server/db/index.js";
import { stableId } from "../server/triage/ids.js";
import {
  hasFeedbackCluster,
  isStartedTriageRunStatus,
  ownerOwnedAreaValuesForItem,
  recordAutomaticBuilderDecision,
  relatedDispatchConflictReason,
  replyTextForItem,
  requireBuilderSlackUserId,
} from "./start-builder-for-item.js";

describe("start-builder-for-item Slack handoff", () => {
  it("uses a Slack user-id mention, asks for /address-feedback, and carries repeat links", () => {
    const text = replyTextForItem(
      { id: "item-primary", sourceUrl: "https://slack.example/primary" },
      [
        {
          id: "item-repeat",
          title: "Repeated export failure",
          sourceUrl: "https://slack.example/repeat",
        },
      ],
      "U096KN3EL2Y",
    );

    expect(text).toContain("<@U096KN3EL2Y>");
    expect(text).toContain("/address-feedback");
    expect(text).toContain("item-repeat");
    expect(text).toContain("https://slack.example/repeat");
    expect(text).not.toContain("@builder.io");
    expect(text).not.toContain("@builderio please");
  });

  it("requires a Slack member id from Factory settings", () => {
    expect(requireBuilderSlackUserId("U096KN3EL2Y")).toBe("U096KN3EL2Y");
    expect(requireBuilderSlackUserId("u096kn3el2y")).toBe("U096KN3EL2Y");
    expect(() => requireBuilderSlackUserId("")).toThrow(/Factory settings/);
    expect(() => requireBuilderSlackUserId("@builder.io")).toThrow(
      /Factory settings/,
    );
  });

  it("blocks related items that are already clustered or started", () => {
    expect(
      relatedDispatchConflictReason(
        { id: "item-clustered" },
        { feedbackClusterItemIds: ["item-clustered", "item-primary"] },
        [],
      ),
    ).toContain("already belongs to a feedback cluster");
    expect(
      relatedDispatchConflictReason({ id: "item-started" }, {}, ["completed"]),
    ).toContain("already has a started Builder run");
    expect(isStartedTriageRunStatus("failed")).toBe(false);
    expect(isStartedTriageRunStatus("reconciliation_required")).toBe(true);
    expect(hasFeedbackCluster({})).toBe(false);
  });

  it("includes related item metadata in owner-area detection inputs", () => {
    expect(
      ownerOwnedAreaValuesForItem(
        {
          title: "Export issue",
          summary: "The export fails",
          repository: "BuilderIO/agent-native",
        },
        { productArea: "content", path: "apps/content/routes/index.tsx" },
      ),
    ).toEqual(
      expect.arrayContaining(["content", "apps/content/routes/index.tsx"]),
    );
  });

  it("updates an existing automatic-builder decision when a later skip is recorded", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({
        values: () => ({ onConflictDoUpdate }),
      }),
    } as never);
    vi.mocked(stableId).mockReturnValue("decision-automatic");

    await recordAutomaticBuilderDecision({
      itemId: "item-1",
      userEmail: "owner@example.com",
      orgId: "org-1",
      outcome: "needs_manual",
      reason: "Second skip: still not a clear bug.",
      guardResults: [
        { code: "unknown_change", passed: false, reason: "Not a clear bug." },
      ],
    });

    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          outcome: "needs_manual",
          reason: "Second skip: still not a clear bug.",
        }),
      }),
    );
  });
});
