import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitDesignSystemWaitlist } from "./design-system-waitlist";

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

const fetchMock = vi.fn();

describe("Design Systems waitlist", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("submits to the shared Builder waitlist and requires confirmation", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, formSubmitted: true }), {
        status: 200,
      }),
    );

    await expect(submitDesignSystemWaitlist()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/builder/branch-waitlist",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "design_systems_empty_state",
          useCase: "design_system_waitlist",
        }),
      }),
    );
  });

  it("does not treat an unsubmitted form as a successful waitlist join", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, formSubmitted: false }), {
        status: 200,
      }),
    );

    await expect(submitDesignSystemWaitlist()).rejects.toThrow(
      "Waitlist signup is unavailable",
    );
  });
});
