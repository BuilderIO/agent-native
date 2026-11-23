import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recover: vi.fn() }));

vi.mock("@agent-native/core/client/route-chunk-recovery", () => ({
  recoverFromStaleChunkError: (error: unknown) => mocks.recover(error),
}));

import { lazyRoute } from "./lazy-route";

const loadOf = (Page: unknown) =>
  (
    Page as { _payload: { _result: () => Promise<{ default: unknown }> } }
  )._payload._result();

/**
 * Row 154: a reader saw "Something went wrong" for a second or two on Search,
 * Settings and Integrations after about half an hour of use, then it went away.
 * A route chunk that cannot be fetched after a deploy does exactly that: handed
 * straight to the router, the rejection renders the route error page until
 * recovery reloads. The wrapper keeps the shell up while recovery runs.
 */
describe("lazyRoute", () => {
  beforeEach(() => {
    mocks.recover.mockReset();
  });

  it("renders nothing while a stale chunk recovers instead of failing the route", async () => {
    mocks.recover.mockReturnValue(true);
    const chunkFailure = new TypeError(
      "Failed to fetch dynamically imported module: /assets/page-abc.js",
    );
    const Page = lazyRoute(async () => {
      throw chunkFailure;
    });

    const loaded = await loadOf(Page);
    expect(mocks.recover).toHaveBeenCalledWith(chunkFailure);
    // A null component keeps the sidebar and header; an error page would not.
    expect(typeof loaded.default).toBe("function");
    expect((loaded.default as () => unknown)()).toBeNull();
  });

  it("still fails the route when recovery does not apply", async () => {
    mocks.recover.mockReturnValue(false);
    const Page = lazyRoute(async () => {
      throw new Error("this page is broken");
    });
    await expect(loadOf(Page)).rejects.toThrow("this page is broken");
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
