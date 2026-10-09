import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAgentEngineStatusCacheSizeForTests,
  getMemoizedAgentEngineStatus,
  invalidateAgentEngineStatusCache,
  memoizeAgentEngineStatus,
} from "./agent-engine-status-cache.js";

describe("memoizeAgentEngineStatus", () => {
  beforeEach(() => {
    invalidateAgentEngineStatusCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    invalidateAgentEngineStatusCache();
    vi.useRealTimers();
  });

  it("shares a short-lived status answer only for the matching user and org", async () => {
    const load = vi.fn(async () => ({ chatEligible: true }));
    const identity = { userEmail: "STEVE@example.test", orgId: "org-1" };

    await expect(memoizeAgentEngineStatus(identity, load)).resolves.toEqual({
      chatEligible: true,
    });
    await expect(
      memoizeAgentEngineStatus(
        { userEmail: "steve@example.test", orgId: "org-1" },
        load,
      ),
    ).resolves.toEqual({ chatEligible: true });
    await expect(
      memoizeAgentEngineStatus(
        { userEmail: "steve@example.test", orgId: "org-2" },
        load,
      ),
    ).resolves.toEqual({ chatEligible: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("expires the answer after one second and clears it after a credential change", async () => {
    let configured = false;
    const load = vi.fn(async () => ({ chatEligible: configured }));
    const identity = { userEmail: "steve@example.test", orgId: "org-1" };

    await expect(memoizeAgentEngineStatus(identity, load)).resolves.toEqual({
      chatEligible: false,
    });
    configured = true;
    invalidateAgentEngineStatusCache();
    await expect(memoizeAgentEngineStatus(identity, load)).resolves.toEqual({
      chatEligible: true,
    });
    expect(load).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1001);
    await memoizeAgentEngineStatus(identity, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not cache failed status lookups", async () => {
    const load = vi
      .fn<() => Promise<{ chatEligible: boolean }>>()
      .mockRejectedValueOnce(new Error("credential store unavailable"))
      .mockResolvedValueOnce({ chatEligible: false });
    const identity = { userEmail: "steve@example.test", orgId: "org-1" };

    await expect(memoizeAgentEngineStatus(identity, load)).rejects.toThrow(
      "credential store unavailable",
    );
    await expect(memoizeAgentEngineStatus(identity, load)).resolves.toEqual({
      chatEligible: false,
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts expired identities when later status requests arrive", async () => {
    await memoizeAgentEngineStatus(
      { userEmail: "inactive@example.test", orgId: "org-1" },
      async () => ({ chatEligible: false }),
    );
    expect(getAgentEngineStatusCacheSizeForTests()).toBe(1);

    await vi.advanceTimersByTimeAsync(1001);
    await memoizeAgentEngineStatus(
      { userEmail: "active@example.test", orgId: "org-1" },
      async () => ({ chatEligible: true }),
    );

    expect(
      getMemoizedAgentEngineStatus({
        userEmail: "inactive@example.test",
        orgId: "org-1",
      }),
    ).toBeUndefined();
    expect(getAgentEngineStatusCacheSizeForTests()).toBe(1);
  });

  it("lets the server gate reuse the same live identity snapshot", async () => {
    const load = vi.fn(async () => ({ chatEligible: true }));
    const identity = { userEmail: "steve@example.test", orgId: "org-1" };

    await memoizeAgentEngineStatus(identity, load);
    await expect(getMemoizedAgentEngineStatus(identity)).resolves.toEqual({
      chatEligible: true,
    });
    expect(load).toHaveBeenCalledOnce();
  });
});
