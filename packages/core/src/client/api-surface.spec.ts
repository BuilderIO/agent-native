import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentNativeApiDisabledError,
  agentNativeApiDisabledReason,
  assertAgentNativeApiEnabled,
  setAgentNativeApiDisabled,
} from "./api-surface.js";
import { tryCallActionKeepalive } from "./use-action.js";

afterEach(() => setAgentNativeApiDisabled(null));

describe("agent-native API surface switch", () => {
  it("is enabled until a surface disables it, and re-enables on null", () => {
    expect(agentNativeApiDisabledReason()).toBeNull();
    setAgentNativeApiDisabled("builder shell canvas");
    expect(agentNativeApiDisabledReason()).toBe("builder shell canvas");
    setAgentNativeApiDisabled(null);
    expect(agentNativeApiDisabledReason()).toBeNull();
  });

  it("treats a blank reason as enabled rather than as a nameless block", () => {
    setAgentNativeApiDisabled("   ");
    expect(agentNativeApiDisabledReason()).toBeNull();
  });

  it("throws a typed error naming the surface and the call", () => {
    setAgentNativeApiDisabled("builder shell canvas");
    let caught: unknown;
    try {
      assertAgentNativeApiEnabled("GET list-designs");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentNativeApiDisabledError);
    expect((caught as AgentNativeApiDisabledError).reason).toBe(
      "builder shell canvas",
    );
    expect(String(caught)).toContain("GET list-designs");
  });

  it("does not throw while enabled", () => {
    expect(() => assertAgentNativeApiEnabled("GET list-designs")).not.toThrow();
  });

  it("refuses a keepalive save without reaching the network", () => {
    // Callers keep the work queued on `accepted: false`; a throw here would
    // instead surface as a failed save that retries forever.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setAgentNativeApiDisabled("builder shell canvas");

    const result = tryCallActionKeepalive(
      "update-design" as never,
      {
        id: "shell",
      } as never,
    );

    expect(result.accepted).toBe(false);
    expect(result.accepted === false && result.reason).toBe("api-disabled");
    expect(result.completion).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
