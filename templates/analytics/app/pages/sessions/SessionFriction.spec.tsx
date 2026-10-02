import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import type { SessionFriction } from "../../../shared/session-friction";
import { SessionFrictionStrip } from "./SessionFriction";

const measuredEvents = {
  agent_failures: 0,
  stuck_chats: 0,
  thumbs_down: null,
  failed_actions: 0,
  quick_backs: 0,
  cancelled_runs: null,
};

function strip(friction: SessionFriction, sortSignal?: "thumbs_down") {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SessionFrictionStrip friction={friction} sortSignal={sortSignal} />
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
});
