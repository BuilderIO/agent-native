import { afterEach, describe, expect, it } from "vitest";

import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import type { TrackingEvent } from "../tracking/types.js";
import { trackRunTerminal } from "./run-terminal-tracking.js";

const PROVIDER = "qa-run-terminal";

function captured(): TrackingEvent[] {
  const events: TrackingEvent[] = [];
  registerTrackingProvider({
    name: PROVIDER,
    track(event) {
      if (event.name === "agent_run_terminal") events.push(event);
    },
  });
  return events;
}

const base = {
  runId: "run-1",
  threadId: "thread-1",
  turnId: "turn-1",
  status: "errored" as const,
  terminalReason: "error:write_tool_outcome_unknown",
};

afterEach(() => {
  unregisterTrackingProvider(PROVIDER);
});

describe("trackRunTerminal", () => {
  it("names the held-back tool and what left it unknown", async () => {
    const events = captured();
    await trackRunTerminal(
      {
        ...base,
        errorCode: "write_tool_outcome_unknown",
        blockedTool: "patch-deck",
        blockedBy: "rejection",
      },
      undefined,
    );

    expect(events[0]?.properties).toMatchObject({
      error_code: "write_tool_outcome_unknown",
      blocked_tool: "patch-deck",
      blocked_by: "rejection",
    });
  });

  it("omits the blocked fields from other terminals", async () => {
    const events = captured();
    await trackRunTerminal(
      { ...base, status: "completed", terminalReason: "completed" },
      undefined,
    );

    expect(events[0]?.properties).not.toHaveProperty("blocked_tool");
    expect(events[0]?.properties).not.toHaveProperty("blocked_by");
  });
});
