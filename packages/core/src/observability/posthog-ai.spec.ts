import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import {
  MAX_AI_CONTENT_BYTES,
  boundAiContent,
  emitAiFeedbackSurveyEvent,
  toAiErrorDetail,
} from "./posthog-ai.js";

function captureEvents(): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  registerTrackingProvider({
    name: "qa-posthog-ai",
    track(event) {
      events.push(event);
    },
  });
  return events;
}

describe("emitAiFeedbackSurveyEvent", () => {
  afterEach(() => {
    unregisterTrackingProvider("qa-posthog-ai");
    vi.unstubAllEnvs();
  });

  const base = {
    runId: "run-1",
    threadId: "thread-1",
    userId: "alice@example.test",
    feedbackType: "thumbs_down" as const,
    value: "thumbs_down",
    submissionId: "sub-1",
    model: "claude-test",
  };

  it("emits nothing when no survey id is configured", async () => {
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "");
    const events = captureEvents();

    expect(emitAiFeedbackSurveyEvent(base)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });

  it("emits PostHog's `survey sent` linked to the AI trace", async () => {
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    const events = captureEvents();

    expect(emitAiFeedbackSurveyEvent(base)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("survey sent");
    expect(events[0].userId).toBe("alice@example.test");
    expect(events[0].properties).toMatchObject({
      $survey_id: "survey-abc",
      $survey_response: "thumbs_down",
      $survey_submission_id: "sub-1",
      $survey_completed: true,
      $ai_trace_id: "run-1",
      $ai_session_id: "thread-1",
      $ai_model: "claude-test",
      feedback_type: "thumbs_down",
    });
  });

  it("uses the per-question response key when a question id is configured", async () => {
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_ID", "survey-abc");
    vi.stubEnv("POSTHOG_AI_FEEDBACK_SURVEY_QUESTION_ID", "q1");
    const events = captureEvents();

    emitAiFeedbackSurveyEvent({ ...base, feedbackType: "text", value: "slow" });
    await new Promise((r) => setTimeout(r, 0));

    expect(events[0].properties?.["$survey_response_q1"]).toBe("slow");
    expect(events[0].properties).not.toHaveProperty("$survey_response");
  });
});

describe("boundAiContent", () => {
  it("passes small payloads through untouched", () => {
    const value = [{ role: "user", content: "hi" }];
    expect(boundAiContent(value)).toEqual({ value, truncated: false });
  });

  it("replaces oversized payloads with a marker instead of a partial one", () => {
    const huge = [{ role: "user", content: "x".repeat(MAX_AI_CONTENT_BYTES) }];
    const result = boundAiContent(huge);

    expect(result.truncated).toBe(true);
    expect(String(result.value)).toContain("truncated");
    // Never a silently shortened version of the real content.
    expect(String(result.value)).not.toContain("xxxx");
  });

  it("marks unserializable values rather than dropping them silently", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(boundAiContent(cyclic)).toEqual({
      value: "[unserializable]",
      truncated: true,
    });
  });
});

describe("toAiErrorDetail", () => {
  it("returns undefined for a healthy run", () => {
    expect(toAiErrorDetail(null)).toBeUndefined();
    expect(toAiErrorDetail(undefined, {})).toBeUndefined();
  });

  it("carries terminal classification alongside the message", () => {
    expect(
      toAiErrorDetail("model refused", {
        state: "failed",
        code: "provider_error",
        retryable: true,
      }),
    ).toEqual({
      message: "model refused",
      terminal_state: "failed",
      terminal_code: "provider_error",
      retryable: true,
    });
  });

  it("redacts secrets in the error message", () => {
    const detail = toAiErrorDetail("failed with authorization: Bearer abc123");

    expect(detail?.message).not.toContain("abc123");
  });
});
