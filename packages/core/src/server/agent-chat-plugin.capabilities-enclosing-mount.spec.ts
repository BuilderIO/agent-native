import { describe, expect, it } from "vitest";

import { capabilitiesRouteMatches } from "./agent-chat-plugin.js";

const route = "/_agent-native/agent-chat/capabilities";

describe("capabilities under enclosing middleware mounts", () => {
  it.each(["/workspace-app", "/_agent-native"])(
    "compares the original path when %s is the enclosing mount",
    (prefix) => {
      expect(
        capabilitiesRouteMatches(
          {
            context: {
              _mountPrefix: prefix,
              _mountedPathname: `/workspace-app${route}`,
            },
            path: "/",
          },
          route,
        ),
      ).toBe(true);
    },
  );

  it("falls back to the original node request through an enclosing mount", () => {
    expect(
      capabilitiesRouteMatches(
        {
          context: { _mountPrefix: "/workspace-app" },
          node: { req: { url: `/workspace-app${route}?probe=1` } },
          path: "/",
        },
        route,
      ),
    ).toBe(true);
  });

  it.each([`${route}/extra`, `${route}-other`, "/unrelated"])(
    "still refuses a different request path %s",
    (path) => {
      expect(
        capabilitiesRouteMatches(
          {
            context: {
              _mountPrefix: "/workspace-app",
              _mountedPathname: `/workspace-app${path}`,
            },
            path: "/",
          },
          route,
        ),
      ).toBe(false);
    },
  );
});
