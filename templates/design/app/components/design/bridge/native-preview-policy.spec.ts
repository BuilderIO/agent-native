import { describe, expect, it } from "vitest";

import { NativePreviewPolicyController } from "./native-preview-policy";

describe("native preview frame deadlines", () => {
  it("keeps 60 Hz phase across jittered 120 Hz callbacks", () => {
    const policy = new NativePreviewPolicyController();
    let accepted = 0;
    for (let i = 0; i <= 120; i++) {
      if (policy.shouldSubmit(100 + i * 8.1, false)) accepted++;
    }
    expect(accepted).toBeGreaterThanOrEqual(58);
    expect(accepted).toBeLessThanOrEqual(61);
  });
  it("admits slightly early worker callbacks without accepting the intervening half-cycle", () => {
    const policy = new NativePreviewPolicyController();
    const acceptedCallbacks: number[] = [];
    const acceptedTimes: number[] = [];

    for (let callback = 0; callback <= 240; callback++) {
      const now =
        callback === 0
          ? 0
          : (callback * 1000) / 120 - (callback % 4 === 0 ? 1.25 : 0.75);
      if (!policy.isSubmissionDue(now, false, 2)) continue;
      acceptedCallbacks.push(callback);
      acceptedTimes.push(now);
      policy.commitSubmission(now, false);
    }

    expect(acceptedCallbacks).toEqual(
      Array.from({ length: 121 }, (_, index) => index * 2),
    );
    for (let index = 1; index < acceptedTimes.length; index++) {
      expect(acceptedTimes[index] - acceptedTimes[index - 1]).toBeGreaterThan(
        14,
      );
    }

    const defaultPolicy = new NativePreviewPolicyController();
    defaultPolicy.commitSubmission(0, false);
    expect(defaultPolicy.isSubmissionDue(1000 / 60 - 1.25, false)).toBe(false);
  });
  it("does not burst after a long pause and resets phase for dirty or backward time", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.shouldSubmit(100, false)).toBe(true);
    expect(policy.shouldSubmit(1000, false)).toBe(true);
    expect(policy.shouldSubmit(1000, false)).toBe(false);
    expect(policy.shouldSubmit(1001, true)).toBe(true);
    expect(policy.shouldSubmit(1002, false)).toBe(false);
    expect(policy.shouldSubmit(50, false)).toBe(true);
    expect(policy.shouldSubmit(51, false)).toBe(false);
  });
  it("accepts a zero timestamp only once", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.shouldSubmit(0, false)).toBe(true);
    expect(policy.shouldSubmit(0, false)).toBe(false);
  });
  it("keeps a due deadline available when a generated-fill credit is unavailable", () => {
    const policy = new NativePreviewPolicyController();
    const acceptedAt: number[] = [];
    const blockedAt: number[] = [];

    for (let callback = 0; callback <= 6; callback++) {
      const now = (callback * 1000) / 120;
      if (!policy.isSubmissionDue(now, false)) continue;
      const creditAvailable = callback !== 2;
      if (!creditAvailable) {
        blockedAt.push(now);
        continue;
      }
      acceptedAt.push(now);
      policy.commitSubmission(now, false);
    }

    expect(blockedAt).toHaveLength(1);
    expect(blockedAt[0]).toBeCloseTo(1000 / 60, 6);
    expect(acceptedAt).toHaveLength(4);
    expect(acceptedAt[1]).toBeCloseTo(25, 6);
    expect(acceptedAt[2]).toBeCloseTo(1000 / 30, 6);
    expect(acceptedAt[3]).toBeCloseTo(50, 6);
    expect(acceptedAt).not.toContain(1000 / 120);
    expect(acceptedAt).not.toContain((5 * 1000) / 120);
    expect(new Set(acceptedAt).size).toBe(acceptedAt.length);
  });
});

describe("committed animation throughput policy", () => {
  it("recovers near-target cadence using represented commits rather than short completion bursts", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.observeCommittedCadence(40, 8)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
    expect(policy.observeCommittedCadence(1000 / 60, 60)).toBe(false);
    expect(policy.observeCommittedCadence(1000 / 60, 29)).toBe(false);
    expect(policy.observeCommittedCadence(1000 / 60, 1)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(2);
    expect(policy.observeCommittedCadence(1000 / 60, 120)).toBe(false);
  });
  it("requires sustained slow commits and resets on neutral observations", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.observeCommittedCadence(40, 7)).toBe(false);
    expect(policy.observeCommittedCadence(20, 60)).toBe(false);
    expect(policy.observeCommittedCadence(40, 1)).toBe(false);
    expect(policy.observeCommittedCadence(40, 7)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
  });
  it("honors resource budget floors while allowing recovery from additional throughput degradation", () => {
    const policy = new NativePreviewPolicyController();
    expect(policy.observeResourceBudgetExceeded()).toBe(true);
    expect(policy.observeCommittedCadence(40, 8)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.5);
    expect(policy.observeCommittedCadence(17, 90)).toBe(true);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
    expect(policy.observeCommittedCadence(17, 90)).toBe(false);
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
  });
  it("rejects zero or unreadable cadence and invalid counts without treating them as healthy", () => {
    const policy = new NativePreviewPolicyController();
    policy.observeCommittedCadence(40, 8);
    for (const [interval, count] of [
      [0, 90],
      [NaN, 90],
      [Infinity, 90],
      [-1, 90],
      [17, 0],
      [17, 1.5],
    ]) {
      expect(policy.observeCommittedCadence(interval!, count!)).toBe(false);
    }
    expect(policy.status(2).effectivePixelRatio).toBe(1.75);
    expect(policy.observeCommittedCadence(17, 89)).toBe(false);
    policy.resetCommittedCadence();
    expect(policy.observeCommittedCadence(17, 1)).toBe(false);
  });
  it("preserves serial render-wall thresholds and keeps their samples separate", () => {
    const serial = new NativePreviewPolicyController();
    for (let i = 0; i < 7; i++)
      expect(serial.observeRenderWall(17)).toBe(false);
    expect(serial.observeRenderWall(17)).toBe(true);
    const pipeline = new NativePreviewPolicyController();
    expect(pipeline.observeCommittedCadence(17, 120)).toBe(false);
    expect(pipeline.status(2).effectivePixelRatio).toBe(2);
  });
});
