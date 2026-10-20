import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, params?: Record<string, string>): string =>
      params ? `${key}(${Object.values(params).join("|")})` : key,
}));

import type {
  SessionFriction,
  SessionFrictionSignal,
} from "../../../shared/session-friction";
import {
  SessionFrictionBreakdown,
  SessionFrictionPanel,
  SessionFrictionStrip,
} from "./SessionFriction";

const measuredEvents = {
  agent_failures: 0,
  stuck_chats: 0,
  thumbs_down: null,
  failed_actions: 0,
  quick_backs: 0,
  cancelled_runs: null,
};

function strip(
  friction: SessionFriction,
  sortSignal?: "thumbs_down",
  filterSignals?: SessionFrictionSignal[],
) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SessionFrictionStrip
        friction={friction}
        sortSignal={sortSignal}
        filterSignals={filterSignals}
      />
    </MemoryRouter>,
  );
}

describe("SessionFrictionStrip", () => {
  const calm: SessionFriction = {
    score: 0,
    replay: null,
    events: measuredEvents,
    topSignals: [],
    troubles: [],
    errorIssues: [],
  };

  it("renders nothing for a calm session with no issues", () => {
    expect(strip(calm)).toBe("");
  });

  it("says issue links are unknown instead of showing none", () => {
    expect(strip({ ...calm, errorIssues: null })).toContain(
      "sessions.issueLinksUnavailable",
    );
  });

  it("says a sorted signal was not measured instead of passing for zero", () => {
    expect(strip(calm, "thumbs_down")).toContain("sessions.signalNotMeasured");
    expect(
      strip(
        { ...calm, events: { ...measuredEvents, thumbs_down: 0 } },
        "thumbs_down",
      ),
    ).toBe("");
  });

  it("leads with the signal a row was filtered by, even a light one", () => {
    const busy: SessionFriction = {
      ...calm,
      score: 9,
      events: {
        ...measuredEvents,
        agent_failures: 2,
        stuck_chats: 1,
        failed_actions: 2,
        quick_backs: 1,
      },
      topSignals: [
        { signal: "agent_failures", count: 2 },
        { signal: "failed_actions", count: 2 },
        { signal: "stuck_chats", count: 1 },
      ],
    };
    const html = strip(busy, undefined, ["quick_backs"]);
    const chips = html.match(/sessions\.frictionSignalCount\(([^|]+)/g);
    expect(chips).toEqual([
      "sessions.frictionSignalCount(sessions.signalQuickBacks",
      "sessions.frictionSignalCount(sessions.signalAgentFailures",
      "sessions.frictionSignalCount(sessions.signalFailedActions",
    ]);
    expect(strip(busy)).not.toContain("signalQuickBacks");
  });
});

describe("SessionFrictionBreakdown", () => {
  const measured: SessionFriction = {
    score: 9,
    replay: {
      error_then_leave: 0,
      http_5xx: 2,
      retry_loops: 0,
      error_toasts: 0,
      dead_clicks: 1,
      stalled_requests: 0,
      http_4xx: 3,
    },
    events: { ...measuredEvents, agent_failures: 4 },
    topSignals: [],
    troubles: [
      {
        kind: "agent",
        label: "no_model_connected",
        status: null,
        cause: "no_model_connected",
        count: 4,
      },
    ],
    errorIssues: null,
  };

  function breakdown(friction: SessionFriction) {
    return renderToStaticMarkup(
      <MemoryRouter>
        <SessionFrictionBreakdown friction={friction} />
      </MemoryRouter>,
    );
  }

  it("counts every signal, 4xx apart from 5xx, and names agent trouble by cause", () => {
    const html = breakdown(measured);
    expect(html).toContain(
      "sessions.frictionSignalCount(sessions.signalHttp4xx|3)",
    );
    expect(html).toContain(
      "sessions.frictionSignalCount(sessions.signalHttp5xx|2)",
    );
    expect(html).toContain(
      "sessions.frictionSignalCount(sessions.signalRetryLoops|0)",
    );
    expect(html).toContain(
      "sessions.frictionSignalCount(sessions.causeNoModelConnected|4)",
    );
    expect(html).toContain("sessions.issueLinksUnavailable");
  });

  it("says which signals were not measured instead of showing zero", () => {
    const html = breakdown(measured);
    expect(html).toContain(
      "sessions.signalNotMeasured(sessions.signalThumbsDown)",
    );
    expect(html).not.toContain(
      "sessions.frictionSignalCount(sessions.signalThumbsDown",
    );
    const replayOnly = breakdown({ ...measured, events: null, troubles: [] });
    expect(replayOnly).toContain(
      "sessions.signalNotMeasured(sessions.signalAgentFailures)",
    );
    expect(
      breakdown({ ...measured, replay: null, events: null, troubles: [] }),
    ).toContain("sessions.frictionNotMeasured");
  });

  it("links issues, and shows nothing for a session with none", () => {
    const html = breakdown({
      ...measured,
      errorIssues: [{ id: "issue-a", title: "Save failed", count: 1 }],
    });
    expect(html).toContain("issue=issue-a");
    expect(breakdown({ ...measured, errorIssues: [] })).not.toContain(
      "sessions.issueLinksUnavailable",
    );
  });

  it("offers a retry for a failed read rather than an empty breakdown", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SessionFrictionPanel
          friction={undefined}
          failed
          fetching={false}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("sessions.frictionUnavailable");
    expect(html).toContain("sidebar.retry");
    expect(html).not.toContain("sessions.frictionSignalCount");
  });
});
