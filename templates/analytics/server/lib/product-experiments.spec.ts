import { describe, expect, it } from "vitest";

import {
  reduceProductExperimentEvents,
  trackingAppIds,
} from "./product-experiments.js";
const experiment = {
  flagKey: "beta",
  rolloutEpoch: "epoch-1",
  treatmentPercentage: 50,
  primaryEventName: "converted",
};
const event = (
  userKey: string | null,
  eventName: string,
  timestamp: string,
  properties: Record<string, unknown> = {},
) => ({
  userKey,
  eventName,
  timestamp,
  properties: JSON.stringify(
    eventName === "$feature_flag_exposure" && userKey
      ? { user_key: userKey, ...properties }
      : properties,
  ),
});
describe("product experiment results", () => {
  it("queries both directory and framework tracking app identities", () => {
    expect(trackingAppIds("clips")).toEqual(["clips", "agent-native-clips"]);
    expect(trackingAppIds("agent-native-clips")).toEqual([
      "agent-native-clips",
    ]);
  });
  it("excludes pre-exposure conversions, anonymous keys, and contaminated cohorts", () => {
    const result = reduceProductExperimentEvents(experiment, [
      event("user@example.com", "converted", "2026-01-01T00:00:00Z"),
      event(
        "user@example.com",
        "$feature_flag_exposure",
        "2026-01-01T00:01:00Z",
        {
          flag_key: "beta",
          rollout_epoch: "epoch-1",
          rollout_percentage: 50,
          reason: "percentage-treatment",
          bucket: 10,
          value: true,
        },
      ),
      event("user@example.com", "converted", "2026-01-01T00:02:00Z"),
      event(
        "other@example.com",
        "$feature_flag_exposure",
        "2026-01-01T00:00:00Z",
        {
          flag_key: "beta",
          rollout_epoch: "wrong",
          reason: "email",
          value: true,
        },
      ),
      event(
        "other@example.com",
        "$feature_flag_exposure",
        "2026-01-01T00:01:00Z",
        {
          flag_key: "beta",
          rollout_epoch: "epoch-1",
          rollout_percentage: 50,
          reason: "percentage-control",
          bucket: 90,
          value: false,
        },
      ),
    ]);
    expect(result.treatment).toEqual({ exposed: 1, conversions: 1, rate: 1 });
    expect(result.control.exposed).toBe(0);
  });
  it("reports truncation and SRM", () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      event(
        `u${i}@example.com`,
        "$feature_flag_exposure",
        `2026-01-01T00:0${i}:00Z`,
        {
          flag_key: "beta",
          rollout_epoch: "epoch-1",
          rollout_percentage: 50,
          reason: "percentage-treatment",
          bucket: i,
          value: true,
        },
      ),
    );
    const result = reduceProductExperimentEvents(experiment, rows, true);
    expect(result.coverage).toBe("partial");
    expect(result.validityWarning).toContain("truncated");
    expect(result.validityWarning).toContain("Sample-ratio mismatch");
  });
  it("rejects bucket-boundary and mismatched exposure identities", () => {
    const result = reduceProductExperimentEvents(experiment, [
      event(
        "bad@example.com",
        "$feature_flag_exposure",
        "2026-01-01T00:00:00Z",
        {
          flag_key: "beta",
          rollout_epoch: "epoch-1",
          rollout_percentage: 50,
          reason: "percentage-treatment",
          bucket: 80,
          value: true,
        },
      ),
      event(
        "spoof@example.com",
        "$feature_flag_exposure",
        "2026-01-01T00:00:00Z",
        {
          flag_key: "beta",
          rollout_epoch: "epoch-1",
          rollout_percentage: 50,
          reason: "percentage-control",
          bucket: 80,
          value: false,
          user_key: "different@example.com",
        },
      ),
    ]);
    expect(result.sampleSize).toBe(0);
  });
});
