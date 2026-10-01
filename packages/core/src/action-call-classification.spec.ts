import { describe, expect, it } from "vitest";
import { z } from "zod";

import { actionCallEmitsChange } from "./action-call-classification.js";
import { defineAction } from "./action.js";
import { createAgentEngineScriptEntries } from "./server/agent-chat/script-entries.js";

const emits = (entry: object, params: unknown, fallbackReadOnly = false) =>
  actionCallEmitsChange(entry as never, params, fallbackReadOnly);

describe("actionCallEmitsChange", () => {
  it("does not publish change events for manage-agent-engine reads that the UI polls", async () => {
    const entry = (await createAgentEngineScriptEntries("analytics"))[
      "manage-agent-engine"
    ]!;

    for (const action of ["list", "test", "get-app-default"]) {
      expect(emits(entry, { action }), action).toBe(false);
    }
  });

  it("still publishes for manage-agent-engine writes and for operations it has not classified", async () => {
    const entry = (await createAgentEngineScriptEntries("analytics"))[
      "manage-agent-engine"
    ]!;

    for (const action of ["set", "set-app-default", "reset-app-default"]) {
      expect(emits(entry, { action }), action).toBe(true);
    }
    // A new operation nobody has declared read-only must not go quiet.
    expect(emits(entry, { action: "get-something-new" })).toBe(true);
  });

  it("treats declared read-only actions as quiet and undeclared actions as mutating", () => {
    const get = defineAction({
      description: "read",
      schema: z.object({}),
      http: { method: "GET" },
      run: async () => ({}),
    });
    const flagged = defineAction({
      description: "read",
      schema: z.object({}),
      readOnly: true,
      run: async () => ({}),
    });
    const undeclared = defineAction({
      description: "unknown",
      schema: z.object({}),
      run: async () => ({}),
    });

    expect(emits(get, {})).toBe(false);
    expect(emits(flagged, {})).toBe(false);
    expect(emits(undeclared, {})).toBe(true);
    expect(emits({}, {}, true)).toBe(false);
    expect(emits({}, {}, false)).toBe(true);
  });

  it("lets a mutating action opt out without presenting it as read-only", () => {
    const telemetry = defineAction({
      description: "save playback position",
      schema: z.object({}),
      changeEvents: false,
      run: async () => ({}),
    });

    expect(telemetry.changeEvents).toBe(false);
    expect(emits(telemetry, {})).toBe(false);
    // The opt-out must not leak into read-only semantics (plan mode, result caching).
    expect(telemetry.readOnly).toBeUndefined();
  });

  it("keeps publishing when changeEvents is explicitly true", () => {
    expect(emits({ changeEvents: true }, {})).toBe(true);
  });
});
