import { describe, expect, it } from "vitest";

import {
  AGENT_TROUBLE_CAUSES,
  EVENT_FRICTION_SCORE_INPUTS,
  readSessionFrictionSignals,
  REPLAY_FRICTION_SCORE_INPUTS,
  SESSION_FRICTION_SIGNAL_CAP,
  SESSION_FRICTION_SIGNALS,
  SESSION_FRICTION_WEIGHTS,
  sessionFrictionScore,
  topSessionFrictionSignals,
} from "./session-friction";

describe("session friction score", () => {
  it("weights every signal, and scores each part only on its own inputs", () => {
    for (const signal of SESSION_FRICTION_SIGNALS) {
      expect(SESSION_FRICTION_WEIGHTS[signal]).toBeGreaterThan(0);
    }
    expect(
      [...REPLAY_FRICTION_SCORE_INPUTS, ...EVENT_FRICTION_SCORE_INPUTS].sort(),
    ).toEqual([...SESSION_FRICTION_SIGNALS, "errors", "rage_clicks"].sort());
    expect(
      sessionFrictionScore(
        { http_5xx: 1, failed_actions: 1 },
        REPLAY_FRICTION_SCORE_INPUTS,
      ),
    ).toBe(SESSION_FRICTION_WEIGHTS.http_5xx);
  });

  it("caps each signal so one noisy signal cannot bury the rest", () => {
    const capped = sessionFrictionScore(
      { dead_clicks: 500 },
      REPLAY_FRICTION_SCORE_INPUTS,
    );
    expect(capped).toBe(
      SESSION_FRICTION_SIGNAL_CAP * SESSION_FRICTION_WEIGHTS.dead_clicks,
    );
    expect(capped).toBeLessThan(
      sessionFrictionScore(
        { error_then_leave: 1 },
        REPLAY_FRICTION_SCORE_INPUTS,
      ),
    );
  });

  it("lists the heaviest signals first", () => {
    expect(
      topSessionFrictionSignals({
        dead_clicks: 2,
        agent_failures: 1,
        error_then_leave: 1,
        http_4xx: 0,
        quick_backs: 1,
      }),
    ).toEqual([
      { signal: "error_then_leave", count: 1 },
      { signal: "agent_failures", count: 1 },
      { signal: "quick_backs", count: 1 },
    ]);
  });
});

describe("readSessionFrictionSignals", () => {
  it("keeps known signals once and drops anything else", () => {
    expect(
      readSessionFrictionSignals(
        new URLSearchParams(
          "signal=dead_clicks&signal=nope&signal=dead_clicks&signal=thumbs_down",
        ),
      ),
    ).toEqual(["dead_clicks", "thumbs_down"]);
  });
});

it("names exactly the four approved agent trouble causes", () => {
  expect(AGENT_TROUBLE_CAUSES).toEqual([
    "no_model_connected",
    "rate_limit",
    "context_overflow",
    "provider_error",
  ]);
});
