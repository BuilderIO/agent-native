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

import {
  hasFeedbackCluster,
  isStartedTriageRunStatus,
  ownerOwnedAreaValuesForItem,
  relatedDispatchConflictReason,
  replyTextForItem,
} from "./start-builder-for-item.js";

describe("start-builder-for-item Slack handoff", () => {
  it("uses the Builder.io tag, asks for /address-feedback, and carries repeat links", () => {
    const text = replyTextForItem(
      { id: "item-primary", sourceUrl: "https://slack.example/primary" },
      [
        {
          id: "item-repeat",
          title: "Repeated export failure",
          sourceUrl: "https://slack.example/repeat",
        },
      ],
    );

    expect(text).toContain("@builder.io");
    expect(text).toContain("/address-feedback");
    expect(text).toContain("item-repeat");
    expect(text).toContain("https://slack.example/repeat");
    expect(text).not.toContain("@builderio please");
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
});
