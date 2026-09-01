/**
 * The `realtime` block on `/_agent-native/health`.
 *
 * Registration is otherwise lazy behind the session-gated token mint, so
 * "is this deploy actually on the gateway?" could not be answered without
 * signing in. This block answers it with a curl, and — because resolving a
 * channel registers on a miss — performs the registration too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRegistered = vi.hoisted(() => vi.fn());
const mockHosted = vi.hoisted(() => vi.fn());
vi.mock("./realtime-registration.js", () => ({
  isHostedRealtimeTransport: mockHosted,
  resolveRegisteredRealtimeChannel: mockRegistered,
}));

import * as builderBrowser from "./builder-browser.js";
import { runDbHealthProbe } from "./core-routes-plugin.js";

const okExec = () => ({
  execute: async () => ({ rows: [], rowsAffected: 0 }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHosted.mockReturnValue(true);
  mockRegistered.mockResolvedValue(null);
  delete process.env.BUILDER_PROJECT_ID;
  delete process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET;
});

afterEach(() => {
  delete process.env.BUILDER_PROJECT_ID;
  delete process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET;
});

describe("health: realtime", () => {
  it("reports local transport without touching registration", async () => {
    mockHosted.mockReturnValue(false);
    const { realtime } = await runDbHealthProbe(okExec);
    expect(realtime).toEqual({ transport: "local", registered: false });
    expect(mockRegistered).not.toHaveBeenCalled();
  });

  it("fingerprints a self-registered channel instead of publishing it", async () => {
    mockRegistered.mockResolvedValue({
      channelId: "rt_abc",
      hmacSecret: "s",
    });
    const { realtime } = await runDbHealthProbe(okExec);
    expect(realtime.transport).toBe("hosted");
    expect(realtime.registered).toBe(true);
    // This endpoint is public and the channel id is half the auth story.
    expect(realtime.channelHash).toHaveLength(8);
    expect(JSON.stringify(realtime)).not.toContain("rt_abc");
  });

  it("reports an injected pipeline channel too", async () => {
    // Drive the real resolvers rather than mocking them — these are the env
    // vars a pipeline deploy actually carries.
    process.env.BUILDER_PROJECT_ID = "proj_pipeline";
    process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET = "s".repeat(64);
    const { realtime } = await runDbHealthProbe(okExec);
    expect(realtime.registered).toBe(true);
    expect(mockRegistered).not.toHaveBeenCalled();
  });

  it("never self-registers for an app the pipeline half-provisioned", async () => {
    // This endpoint is PUBLIC and resolving registers on a miss. Falling back
    // on the project id alone would let one anonymous curl POST a pipeline
    // app's database credential to the gateway and start a duplicate channel
    // tailing a database Builder already tails — `resolveBuilderBranchProjectId`
    // also returns "" for an unreadable settings row, so a Neon blip is enough.
    // Either half injected means the pipeline owns this app; the fix for the
    // missing half is a redeploy.
    process.env.BUILDER_PROJECT_ID = "proj_pipeline";
    const { realtime } = await runDbHealthProbe(okExec);
    expect(realtime.registered).toBe(false);
    expect(mockRegistered).not.toHaveBeenCalled();
  });

  it("does not self-register when only the signing secret was injected", async () => {
    process.env.AGENT_NATIVE_REALTIME_HMAC_SECRET = "s".repeat(64);
    const { realtime } = await runDbHealthProbe(okExec);
    expect(realtime.registered).toBe(false);
    expect(mockRegistered).not.toHaveBeenCalled();
  });

  it("says registered:false when hosted but no channel resolves", async () => {
    const { realtime } = await runDbHealthProbe(okExec);
    expect(realtime).toEqual({ transport: "hosted", registered: false });
  });

  it("never lets a failing gateway make the app look unhealthy", async () => {
    mockRegistered.mockRejectedValue(new Error("gateway down"));
    const result = await runDbHealthProbe(okExec);
    expect(result.ok).toBe(true);
    expect(result.ready).toBe(true);
  });

  it("separates 'could not check' from 'no channel configured'", async () => {
    mockRegistered.mockRejectedValue(new Error("gateway down"));
    const failed = await runDbHealthProbe(okExec);
    expect(failed.realtime).toEqual({
      transport: "hosted",
      registered: false,
      unavailable: true,
    });

    // The genuinely-unconfigured case must NOT carry the marker, or the two
    // are indistinguishable again.
    mockRegistered.mockResolvedValue(null);
    const absent = await runDbHealthProbe(okExec);
    expect(absent.realtime.unavailable).toBeUndefined();
  });

  it("bounds the realtime resolution the same way it bounds the DB probe", async () => {
    // The gateway POST bounds itself, but the DB reads on the way to it do
    // not. Against a black-holed Postgres the probe times out on SELECT 1 and
    // would then hang here on the same dead pool — the unbounded /health await
    // that took the docs site down, one layer further in.
    vi.useFakeTimers();
    try {
      mockRegistered.mockReturnValue(new Promise(() => {}));
      const probe = runDbHealthProbe(okExec);
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await probe;
      expect(result.ok).toBe(true);
      expect(result.realtime).toEqual({
        transport: "hosted",
        registered: false,
        unavailable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
