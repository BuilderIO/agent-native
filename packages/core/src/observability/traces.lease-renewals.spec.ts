import { afterEach, expect, it, vi } from "vitest";

import {
  LeaseRenewalDiagnostics,
  type LeaseRenewalMetrics,
} from "../agent/lease-renewal-diagnostics.js";
import { observabilityConfig } from "../app-config/observability.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import * as store from "./store.js";
import { instrumentAgentLoop } from "./traces.js";
import type { TraceSpan } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
  unregisterTrackingProvider("lease-diagnostics-test");
});

it.each([
  "success",
  "failed",
  "private",
  "unleased",
  "nested-unleased",
] as const)(
  "keeps lease measurements in the local run trace for a %s run",
  async (mode) => {
    const spans: TraceSpan[] = [];
    const tracked: unknown[] = [];
    vi.spyOn(store, "insertTraceSpan").mockImplementation(async (span) => {
      spans.push(span);
    });
    vi.spyOn(store, "upsertTraceSummary").mockResolvedValue(undefined);
    registerTrackingProvider({
      name: "lease-diagnostics-test",
      track(event) {
        tracked.push(event);
      },
    });
    const diagnostics = new LeaseRenewalDiagnostics("run-lease-trace", {
      intervalMs: 1_500,
      attemptDeadlineMs: 5_000,
      maxPending: 2,
    });
    const outer = new LeaseRenewalDiagnostics("run-outer-lease", {
      intervalMs: 1_500,
      attemptDeadlineMs: 5_000,
      maxPending: 2,
    });
    outer.start(0).settle("renewed");
    diagnostics.start(0).settle("renewed");
    const run = () =>
      instrumentAgentLoop({
        runAgentLoop: async ({ send }) => {
          const pending = diagnostics.start(0);
          pending.deadlineReached();
          if (mode === "failed") throw new Error("Synthetic run failure");
          send({ type: "text", text: "Done" });
          return {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            model: "test",
          };
        },
        loopOpts: {
          engine: { name: "test" },
          model: "test",
          systemPrompt: "",
          tools: [],
          messages: [],
          actions: {},
          send() {},
          signal: new AbortController().signal,
          historyPrivacyState: { private: mode === "private" },
        },
        runId: "run-lease-trace",
        threadId: null,
        userId: null,
        config: {
          ...observabilityConfig.parse({}),
          enabled: true,
          capturePrompts: false,
          inferredSentimentEnabled: false,
          inferredSentimentSampleRate: 0,
        },
      });
    const result =
      mode === "unleased"
        ? run()
        : mode === "nested-unleased"
          ? outer.run(run)
          : diagnostics.run(run);
    const error = await result.then(
      () => null,
      (failure: unknown) => failure,
    );
    const expectedError =
      mode === "failed" ? new Error("Synthetic run failure") : null;
    expect(error).toEqual(expectedError);
    await vi.waitFor(() =>
      expect(spans.some((span) => span.spanType === "agent_run")).toBe(true),
    );
    const parent = spans.find((span) => span.spanType === "agent_run");
    const includesRenewals = mode === "success" || mode === "failed";
    const actual = parent?.metadata?.leaseRenewals as
      | LeaseRenewalMetrics
      | undefined;
    expect(actual).toEqual(
      includesRenewals ? diagnostics.snapshot() : undefined,
    );
    const measuredAttempts = [
      expect.objectContaining({ outcome: "renewed" }),
      expect.objectContaining({
        outcome: "pending",
        deadlineReachedAtMs: expect.any(Number),
      }),
    ];
    const expectedAttempts = includesRenewals ? measuredAttempts : undefined;
    expect(actual?.attempts).toEqual(expectedAttempts);
    expect(JSON.stringify(tracked)).not.toContain("leaseRenewals");
    expect(JSON.stringify(tracked)).not.toContain("deadlineReachedAtMs");
  },
);
