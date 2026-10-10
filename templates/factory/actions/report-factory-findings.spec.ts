import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string): never => {
    throw new Error(message);
  },
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../server/db/schema.js", () => ({
  factoryAuditEvents: {},
  triageDecisions: {},
  triageItems: {},
  triageRuns: {},
}));
vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/factory-scope.js", async () => {
  const { z } = await import("zod");
  return {
    DEFAULT_FACTORY_ID: "product-feedback",
    factoryIdSchema: z.string(),
    factoryStillPresent: vi.fn(),
    orgFactoryItemFilter: vi.fn(),
    orgFactoryRunFilter: vi.fn(),
    readTriageConfigRow: vi.fn(),
    requireExistingFactory: vi.fn(),
  };
});
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: vi.fn(),
  workspaceMemberIdentityFromContext: vi.fn(),
}));
vi.mock("../server/triage/audit.js", () => ({ recordFactoryAudit: vi.fn() }));
vi.mock("../server/triage/slack-client.js", () => ({
  createSlackReader: vi.fn(),
}));

import {
  factoryFindingRollupText,
  reportableFindingSource,
} from "./report-factory-findings.js";
import action from "./report-factory-findings.js";

describe("report-factory-findings", () => {
  it("accepts only issue and Sentry triage jobs, not PR jobs", () => {
    expect(
      reportableFindingSource({ source: "github", template: "github-issues" }),
    ).toBe("github_issue");
    expect(
      reportableFindingSource({ source: "sentry", template: "sentry-errors" }),
    ).toBe("sentry");
    expect(
      reportableFindingSource({ source: "github", template: "pr-governance" }),
    ).toBeNull();
    expect(
      reportableFindingSource({ source: "github", template: "pr-babysit" }),
    ).toBeNull();
    expect(
      reportableFindingSource({ source: "github", template: "blank" }),
    ).toBe("github_issue");
    expect(
      reportableFindingSource({ source: "slack", template: "slack-feedback" }),
    ).toBeNull();
  });

  it("builds one grouped message with the source links and stored evidence", () => {
    const text = factoryFindingRollupText({
      factoryId: "qa",
      source: "github_issue",
      findings: [
        {
          itemId: "triage-1",
          clearBug: true,
          risk: "low",
          confidence: "high",
          productUxImplications: false,
          reason: "The check fails on a concrete export path.",
          id: "triage-1",
          source: "github_issue",
          sourceUrl: "https://github.com/BuilderIO/agent-native/issues/123",
          title: "Export test fails",
          summary: "Summary",
          metadataJson: JSON.stringify({
            errorReport: "Error: export returned an empty file",
          }),
        },
        {
          itemId: "triage-2",
          clearBug: true,
          risk: "low",
          confidence: "high",
          productUxImplications: false,
          reason: "A second issue identifies the same failure boundary.",
          id: "triage-2",
          source: "github_issue",
          sourceUrl: "https://github.com/BuilderIO/agent-native/issues/124",
          title: "Empty export output",
          summary: "Summary",
          metadataJson: JSON.stringify({
            errorReport: "Error: second export case",
          }),
        },
      ],
    });

    expect(text).toContain("GitHub findings for qa (2)");
    expect(text).toContain("/issues/123");
    expect(text).toContain("/issues/124");
    expect(text).toContain("Error: export returned an empty file");
    expect(text).toContain("Error: second export case");
    expect(text).toContain("Why it qualifies:");
  });

  it("limits the batch and requires findings to clear the report gate", () => {
    const schema = (
      action as {
        schema: {
          safeParse: (value: unknown) => { success: boolean };
        };
      }
    ).schema;
    const finding = {
      itemId: "item-1",
      clearBug: true,
      risk: "low",
      confidence: "high",
      productUxImplications: false,
      reason: "Specific failing path.",
    };
    expect(schema.safeParse({ findings: [finding] }).success).toBe(true);
    expect(
      schema.safeParse({ findings: [{ ...finding, confidence: "medium" }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        findings: Array.from({ length: 11 }, (_, index) => ({
          ...finding,
          itemId: `item-${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
