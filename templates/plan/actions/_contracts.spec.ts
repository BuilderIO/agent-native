import { describe, expect, it } from "vitest";
import {
  buildReviewQueue,
  redactEvidenceText,
  summarizeContract,
} from "./_contracts.js";
import type { ContractItem, Evidence, Verification } from "../shared/types.js";

function item(
  id: string,
  type: ContractItem["type"],
  reviewState: ContractItem["reviewState"],
  risk: ContractItem["risk"] = "medium",
): ContractItem {
  return {
    id,
    contractId: "ctr_1",
    type,
    title: id,
    body: id,
    status: "open",
    risk,
    reviewState,
    actedOn: "unknown",
    impactSummary: null,
    affectedFiles: [],
    sourceRefs: [],
    linkedItemIds: [],
    createdBy: "agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function evidence(id: string, linkedItemIds: string[]): Evidence {
  return {
    id,
    contractId: "ctr_1",
    linkedItemIds,
    type: "test",
    source: "tool_captured",
    trustLevel: "high",
    summary: "test output",
    content: null,
    rawOutputPath: null,
    cwd: null,
    command: "pnpm test",
    exitCode: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    redactionStatus: "not_needed",
    attachedBy: "agent",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function verification(
  criterionItemId: string,
  status: Verification["status"],
): Verification {
  return {
    id: `ver_${criterionItemId}`,
    contractId: "ctr_1",
    criterionItemId,
    evidenceIds: [],
    status,
    verifiedBy: status === "verified" ? "deterministic_check" : null,
    verifiedAt: status === "verified" ? "2026-01-01T00:00:00.000Z" : null,
    note: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Contracts helpers", () => {
  it("keeps unreviewed assumptions and missing proof in the review queue", () => {
    const items = [
      item("assumption-a", "assumption", "unreviewed", "high"),
      item("criterion-a", "acceptance_criterion", "needs_evidence"),
      item("criterion-b", "acceptance_criterion", "accepted"),
    ];
    const queue = buildReviewQueue(
      items,
      [evidence("evd_1", ["criterion-b"])],
      [verification("criterion-b", "verified")],
    );

    expect(queue.map((entry) => entry.id)).toEqual([
      "assumption-a",
      "criterion-a",
    ]);
    expect(summarizeContract(items, [], []).missingEvidenceCount).toBe(2);
  });

  it("redacts obvious secrets in attached evidence", () => {
    const result = redactEvidenceText(
      "API_KEY=abcd Bearer abc.def sk-super-secret-key",
    );

    expect(result.redacted).toBe(true);
    expect(result.text).toBe("API_KEY=[REDACTED] Bearer [REDACTED] [REDACTED]");
  });
});
