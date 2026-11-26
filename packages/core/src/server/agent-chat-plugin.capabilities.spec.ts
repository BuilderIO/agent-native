import { describe, expect, it } from "vitest";

import {
  capabilitiesRouteMatches,
  capabilitiesRouteRequestPath,
  matchesCapabilitiesRoutePath,
} from "./agent-chat-plugin.js";

const capabilitiesPath = "/_agent-native/agent-chat/capabilities";

describe("matchesCapabilitiesRoutePath", () => {
  it("matches the standalone route", () => {
    expect(
      matchesCapabilitiesRoutePath(capabilitiesPath, capabilitiesPath),
    ).toBe(true);
  });

  it("matches the route under a shared-workspace app mount prefix", () => {
    // Held-out negative for the 11/10 defect: the raw req.url keeps the app
    // base path, so exact equality 404'd every mounted app.
    expect(
      matchesCapabilitiesRoutePath(
        `/calendar-app${capabilitiesPath}`,
        capabilitiesPath,
      ),
    ).toBe(true);
    expect(
      matchesCapabilitiesRoutePath(
        `/mail-app${capabilitiesPath}`,
        capabilitiesPath,
      ),
    ).toBe(true);
  });

  it("ignores a query string and a trailing slash", () => {
    expect(
      matchesCapabilitiesRoutePath(`${capabilitiesPath}?a=1`, capabilitiesPath),
    ).toBe(true);
    expect(
      matchesCapabilitiesRoutePath(
        `/crm-app${capabilitiesPath}/`,
        capabilitiesPath,
      ),
    ).toBe(true);
  });

  it("does not match sibling or deeper agent-chat routes", () => {
    expect(
      matchesCapabilitiesRoutePath(
        "/calendar-app/_agent-native/agent-chat/threads",
        capabilitiesPath,
      ),
    ).toBe(false);
    expect(
      matchesCapabilitiesRoutePath(
        `/calendar-app${capabilitiesPath}/extra`,
        capabilitiesPath,
      ),
    ).toBe(false);
    expect(
      matchesCapabilitiesRoutePath("/calendar-app/home", capabilitiesPath),
    ).toBe(false);
  });
});

describe("capabilitiesRouteRequestPath", () => {
  it("prefers the mount-recorded original pathname", () => {
    // The mounted middleware strips event.path to "" and records the client
    // path here; reading event.path alone is what 404'd on the served build.
    expect(
      capabilitiesRouteRequestPath({
        context: { _mountedPathname: `/calendar-app${capabilitiesPath}` },
        path: "/",
      }),
    ).toBe(`/calendar-app${capabilitiesPath}`);
  });

  it("falls back to req.url, then to event.path", () => {
    expect(
      capabilitiesRouteRequestPath({
        node: { req: { url: `/tasks-app${capabilitiesPath}?x=1` } },
        path: "/",
      }),
    ).toBe(`/tasks-app${capabilitiesPath}?x=1`);
    expect(capabilitiesRouteRequestPath({ path: capabilitiesPath })).toBe(
      capabilitiesPath,
    );
    expect(capabilitiesRouteRequestPath({})).toBe("");
  });
});

describe("capabilitiesRouteMatches", () => {
  it("matches when the mount that ran is this route", () => {
    expect(
      capabilitiesRouteMatches(
        { context: { _mountPrefix: capabilitiesPath }, path: "/" },
        capabilitiesPath,
      ),
    ).toBe(true);
  });

  it("matches a stripped mounted request with no mount prefix recorded", () => {
    expect(
      capabilitiesRouteMatches(
        {
          context: { _mountedPathname: `/mail-app${capabilitiesPath}` },
          path: "/",
        },
        capabilitiesPath,
      ),
    ).toBe(true);
  });

  it("rejects a deeper sub-path of the route", () => {
    expect(
      capabilitiesRouteMatches(
        {
          context: {
            _mountPrefix: capabilitiesPath,
            _mountedPathname: `${capabilitiesPath}/extra`,
          },
          path: "/extra",
        },
        capabilitiesPath,
      ),
    ).toBe(true);
    expect(
      capabilitiesRouteMatches(
        {
          context: { _mountedPathname: `${capabilitiesPath}/extra` },
          path: "/extra",
        },
        capabilitiesPath,
      ),
    ).toBe(false);
  });
});

describe("capabilitiesRouteMatches with a stripped mount remainder", () => {
  it("accepts the mount-relative remainder even with no recorded context path", () => {
    // The 11/10 served build answered 404 for the exact route, including POST,
    // which only happens when the path check rejects after the mount matched.
    expect(capabilitiesRouteMatches({ path: "/" }, capabilitiesPath)).toBe(
      true,
    );
    expect(capabilitiesRouteMatches({ path: "" }, capabilitiesPath)).toBe(true);
    expect(capabilitiesRouteMatches({ path: "/?x=1" }, capabilitiesPath)).toBe(
      true,
    );
  });

  it("rejects a deeper remainder", () => {
    expect(capabilitiesRouteMatches({ path: "/extra" }, capabilitiesPath)).toBe(
      false,
    );
  });
});
