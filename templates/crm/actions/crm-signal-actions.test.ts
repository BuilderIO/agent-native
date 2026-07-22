import { describe, expect, it } from "vitest";

import createTracker from "./create-crm-signal-tracker.js";
import manageTracker from "./manage-crm-signal-tracker.js";
import recordInsight from "./record-crm-call-insight.js";
import recordSmartSignal from "./record-crm-smart-signal.js";
import runTrackers from "./run-crm-signal-trackers.js";

describe("CRM signals action boundaries", () => {
  it("requires the correct tracker configuration for each detector kind", () => {
    expect(
      createTracker.schema.safeParse({
        name: "Pricing",
        kind: "keyword",
        keywords: ["pricing"],
      }).success,
    ).toBe(true);
    expect(
      createTracker.schema.safeParse({ name: "Pricing", kind: "keyword" })
        .success,
    ).toBe(false);
    expect(
      createTracker.schema.safeParse({ name: "Objection", kind: "smart" })
        .success,
    ).toBe(false);
  });

  it("requires an explicit tracker operation and state when managing trackers", () => {
    expect(
      manageTracker.schema.safeParse({
        trackerId: "tracker-1",
        operation: "set-enabled",
        enabled: false,
      }).success,
    ).toBe(true);
    expect(
      manageTracker.schema.safeParse({
        trackerId: "tracker-1",
        operation: "set-enabled",
      }).success,
    ).toBe(false);
    expect(
      manageTracker.schema.safeParse({
        trackerId: "tracker-1",
        operation: "delete",
        enabled: false,
      }).success,
    ).toBe(false);
  });

  it("bounds run cohorts and requires a caller-supplied idempotency key", () => {
    expect(
      runTrackers.schema.safeParse({
        recordId: "record-1",
        evidenceIds: Array.from({ length: 21 }, (_, index) => `e-${index}`),
        idempotencyKey: "run-1",
      }).success,
    ).toBe(false);
    expect(runTrackers.schema.safeParse({ recordId: "record-1" }).success).toBe(
      false,
    );
  });

  it("rejects transcript, binary, and oversized delegated results", () => {
    const base = {
      runId: "run-1",
      trackerId: "tracker-1",
      recordId: "record-1",
      evidenceId: "evidence-1",
      confidence: 90,
      model: "example-model",
      idempotencyKey: "smart-1",
    };
    for (const quote of [
      "Transcript: 00:00 Buyer: full call body",
      "data:audio/wav;base64,SGVsbG8=",
      "A".repeat(1_201),
    ]) {
      expect(
        recordSmartSignal.schema.safeParse({ ...base, quote }).success,
      ).toBe(false);
    }
  });

  it("accepts one atomic bounded insight batch and caps it at twenty", () => {
    const insight = {
      evidenceId: "evidence-1",
      kind: "next-step" as const,
      label: "Next step",
      summary: "Send the proposal before Friday.",
      quote: "send the proposal",
      quoteSeconds: 144,
    };
    const base = {
      runId: "run-1",
      recordId: "record-1",
      model: "example-model",
      idempotencyKey: "summary-1",
    };
    expect(
      recordInsight.schema.safeParse({ ...base, insights: [insight] }).success,
    ).toBe(true);
    expect(
      recordInsight.schema.safeParse({
        ...base,
        insights: Array.from({ length: 21 }, () => insight),
      }).success,
    ).toBe(false);
  });
});
