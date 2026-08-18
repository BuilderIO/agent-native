import { describe, expect, it } from "vitest";

import {
  BUILDER_STATUS_ROUTE_SUFFIXES,
  mountBuilderStatusRouteAliases,
} from "./core-routes-plugin.js";

describe("Builder status route aliases", () => {
  it("retains the legacy path and mounts the neutral connection-status alias", () => {
    expect(BUILDER_STATUS_ROUTE_SUFFIXES).toEqual([
      "/builder/status",
      "/connection-status/builder",
    ]);
  });

  it("mounts both aliases with the exact same handler", () => {
    const handler = () => ({ configured: false });
    const mounted: Array<{ path: string; handler: typeof handler }> = [];

    mountBuilderStatusRouteAliases(
      (path, mountedHandler) => {
        mounted.push({ path, handler: mountedHandler });
      },
      "/_agent-native",
      handler,
    );

    expect(mounted.map(({ path }) => path)).toEqual([
      "/_agent-native/builder/status",
      "/_agent-native/connection-status/builder",
    ]);
    expect(mounted[0]?.handler).toBe(handler);
    expect(mounted[1]?.handler).toBe(handler);
  });
});
