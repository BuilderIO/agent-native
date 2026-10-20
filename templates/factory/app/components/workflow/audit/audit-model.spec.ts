import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createItemsStrings } from "../items-strings";
import type { NodeAudit } from "../items/read-types";
import {
  auditAgentContext,
  segmentsLabel as segmentsLabelOf,
  statusSegments,
  type StatusSegment,
} from "./audit-model";

const s = createItemsStrings(createEnglishTranslator());
const segmentsLabel = (segments: readonly StatusSegment[]) =>
  segmentsLabelOf(segments, s);

const counts = (over: Partial<NodeAudit["summary"]["statusCounts"]>) => ({
  running: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  needs_check: 0,
  ...over,
});

describe("statusSegments", () => {
  it("draws only the statuses that happened, in a fixed order, as shares of the whole", () => {
    const segments = statusSegments(counts({ failed: 2, succeeded: 18 }));
    expect(segments.map((s) => s.status)).toEqual(["succeeded", "failed"]);
    expect(segments[0]?.fraction).toBeCloseTo(0.9);
    expect(segments[1]?.fraction).toBeCloseTo(0.1);
  });

  it("draws nothing for a step that never ran", () => {
    expect(statusSegments(counts({}))).toEqual([]);
  });

  it("keeps a single failure visible among many successes", () => {
    const segments = statusSegments(counts({ succeeded: 199, failed: 1 }));
    expect(segments.find((s) => s.status === "failed")?.count).toBe(1);
  });
});

describe("segmentsLabel", () => {
  it("reads the bar aloud", () => {
    expect(
      segmentsLabel(statusSegments(counts({ succeeded: 18, failed: 2 }))),
    ).toBe("18 Done, 2 Failed");
  });
});

describe("auditAgentContext", () => {
  const audit = {
    workflow: { id: "wf1", name: "Bug report", version: 4 },
    graphVersion: 4,
    node: { id: "n1", name: "Assess", kind: "ai" },
    runId: null,
    summary: {
      steps: 20,
      statusCounts: counts({ failed: 3, succeeded: 17 }),
      modeCounts: { live: 20, dry: 0, test: 0 },
      failureRate: 0.15,
      durationMs: null,
    },
    errors: {
      byCode: Array.from({ length: 9 }, (_, i) => ({
        code: `code_${i}`,
        steps: 1,
        lastMessage: "m".repeat(500),
        lastRunId: "r",
        lastAt: "2026-10-18T09:00:00.000Z",
      })),
      recentItemErrors: [],
    },
  } as unknown as NodeAudit;

  it("passes ids and a bounded failure picture", () => {
    const parsed = JSON.parse(auditAgentContext("f1", audit)) as {
      nodeId: string;
      failureRate: number;
      errors: { lastMessage: string }[];
    };
    expect(parsed.nodeId).toBe("n1");
    expect(parsed.failureRate).toBe(0.15);
    expect(parsed.errors).toHaveLength(5);
    expect(parsed.errors[0]?.lastMessage.length).toBeLessThanOrEqual(200);
  });
});
