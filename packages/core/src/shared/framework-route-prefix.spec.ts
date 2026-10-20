import { describe, expect, it } from "vitest";

import {
  FRAMEWORK_INTERNAL_ROUTE_PREFIX,
  FrameworkRoutePrefixError,
  isInternalFrameworkPathLeak,
  matchesPathPrefix,
  normalizeFrameworkRoutePrefix,
  stripPathPrefix,
  toInternalFrameworkPath,
  toPublicFrameworkPath,
} from "./framework-route-prefix.js";

const custom = { publicPrefix: "/_platform" };
const customMounted = { publicPrefix: "/_platform", basePath: "/mail" };
const defaults = { publicPrefix: FRAMEWORK_INTERNAL_ROUTE_PREFIX };

describe("normalizeFrameworkRoutePrefix", () => {
  it("resolves an unset value to the internal prefix", () => {
    expect(normalizeFrameworkRoutePrefix(undefined)).toBe("/_agent-native");
  });

  it("accepts one absolute segment of letters, digits, _ and -", () => {
    expect(normalizeFrameworkRoutePrefix("/_platform")).toBe("/_platform");
    expect(normalizeFrameworkRoutePrefix(" /fw-1 ")).toBe("/fw-1");
    expect(normalizeFrameworkRoutePrefix("/_agent-native")).toBe(
      "/_agent-native",
    );
  });

  it.each([
    ["", "empty"],
    ["/", "root"],
    ["/_platform/", "trailing slash"],
    ["_platform", "relative"],
    ["/_platform?x=1", "query"],
    ["/_platform#x", "fragment"],
    ["/a/b", "nested"],
    ["/%5Fplatform", "escape"],
    ["/..", "dot segment"],
    ["/_", "no letter or digit"],
    ["/-", "no letter or digit"],
  ])("rejects %j (%s)", (value) => {
    expect(() => normalizeFrameworkRoutePrefix(value)).toThrow(
      FrameworkRoutePrefixError,
    );
  });

  it("refuses the well-known namespace by shape before it can be reserved", () => {
    expect(() => normalizeFrameworkRoutePrefix("/.well-known")).toThrow(
      FrameworkRoutePrefixError,
    );
  });

  it("rejects non-string values and names the source", () => {
    expect(() => normalizeFrameworkRoutePrefix(5, "runtime.x")).toThrow(
      "runtime.x must be a string",
    );
  });

  it.each(["/api", "/mcp", "/Api", "/sign-in", "/assets"])(
    "rejects the reserved namespace %s",
    (value) => {
      expect(() => normalizeFrameworkRoutePrefix(value)).toThrow(
        /reserved namespace/,
      );
    },
  );
});

describe("segment-aware matching", () => {
  it("matches the exact prefix and its children only", () => {
    expect(matchesPathPrefix("/_platform", "/_platform")).toBe(true);
    expect(matchesPathPrefix("/_platform/actions", "/_platform")).toBe(true);
    expect(matchesPathPrefix("/_platform-extra", "/_platform")).toBe(false);
    expect(matchesPathPrefix("/_platformx/y", "/_platform")).toBe(false);
    expect(matchesPathPrefix("/x", "")).toBe(false);
  });

  it("strips to a leading-slash remainder", () => {
    expect(stripPathPrefix("/_platform", "/_platform")).toBe("/");
    expect(stripPathPrefix("/_platform/a/b", "/_platform")).toBe("/a/b");
    expect(stripPathPrefix("/_platform-extra", "/_platform")).toBeNull();
  });
});

describe("toInternalFrameworkPath", () => {
  it("never translates when the public prefix is the default", () => {
    expect(toInternalFrameworkPath("/_agent-native/actions/x", defaults)).toBe(
      null,
    );
  });

  it("maps the public prefix to the internal one", () => {
    expect(toInternalFrameworkPath("/_platform/actions/x", custom)).toBe(
      "/_agent-native/actions/x",
    );
    expect(toInternalFrameworkPath("/_platform", custom)).toBe(
      "/_agent-native",
    );
    expect(toInternalFrameworkPath("/_platform/", custom)).toBe(
      "/_agent-native/",
    );
  });

  it("leaves similar prefixes, app routes and the internal name alone", () => {
    expect(toInternalFrameworkPath("/_platform-extra/x", custom)).toBeNull();
    expect(toInternalFrameworkPath("/api/x", custom)).toBeNull();
    expect(toInternalFrameworkPath("/_agent-native/x", custom)).toBeNull();
  });

  it("composes with the app base path once", () => {
    expect(
      toInternalFrameworkPath("/mail/_platform/actions/x", customMounted),
    ).toBe("/mail/_agent-native/actions/x");
    expect(toInternalFrameworkPath("/mail/_platform", customMounted)).toBe(
      "/mail/_agent-native",
    );
    expect(toInternalFrameworkPath("/_platform/x", customMounted)).toBe(
      "/_agent-native/x",
    );
    expect(toInternalFrameworkPath("/mailx/_platform/x", customMounted)).toBe(
      null,
    );
  });

  it("is idempotent", () => {
    const once = toInternalFrameworkPath("/_platform/actions/x", custom)!;
    expect(toInternalFrameworkPath(once, custom)).toBeNull();
  });
});

describe("isInternalFrameworkPathLeak", () => {
  it("flags the internal name only when a custom prefix is configured", () => {
    expect(isInternalFrameworkPathLeak("/_agent-native/x", defaults)).toBe(
      false,
    );
    expect(isInternalFrameworkPathLeak("/_agent-native/x", custom)).toBe(true);
    expect(isInternalFrameworkPathLeak("/_agent-native", custom)).toBe(true);
    expect(isInternalFrameworkPathLeak("/_agent-nativex", custom)).toBe(false);
    expect(
      isInternalFrameworkPathLeak("/mail/_agent-native/x", customMounted),
    ).toBe(true);
    expect(isInternalFrameworkPathLeak("/_platform/x", custom)).toBe(false);
  });
});

describe("toPublicFrameworkPath", () => {
  it("returns every input unchanged under the default prefix", () => {
    for (const path of [
      "/_agent-native/actions/x?y=1",
      "/mail/_agent-native/x",
      "https://app.example/_agent-native/x",
      "/api/x",
    ]) {
      expect(toPublicFrameworkPath(path, defaults)).toBe(path);
    }
  });

  it("renames the internal segment of a pathname", () => {
    expect(toPublicFrameworkPath("/_agent-native/actions/x", custom)).toBe(
      "/_platform/actions/x",
    );
    expect(toPublicFrameworkPath("/_agent-native", custom)).toBe("/_platform");
    expect(toPublicFrameworkPath("/_agent-native/", custom)).toBe(
      "/_platform/",
    );
  });

  it("keeps the query and fragment", () => {
    expect(
      toPublicFrameworkPath("/_agent-native/auth/session?x=1#frag", custom),
    ).toBe("/_platform/auth/session?x=1#frag");
    expect(
      toPublicFrameworkPath("/_agent-native/open?c=/_agent-native/x", custom),
    ).toBe("/_platform/open?c=/_agent-native/x");
  });

  it("keeps the app base path where the caller put it", () => {
    expect(
      toPublicFrameworkPath("/mail/_agent-native/actions/x", customMounted),
    ).toBe("/mail/_platform/actions/x");
    expect(
      toPublicFrameworkPath("/_agent-native/actions/x", customMounted),
    ).toBe("/_platform/actions/x");
  });

  it("renames inside an absolute URL and leaves other origins' paths intact", () => {
    expect(
      toPublicFrameworkPath(
        "https://app.example/_agent-native/google/callback?state=1",
        custom,
      ),
    ).toBe("https://app.example/_platform/google/callback?state=1");
    expect(
      toPublicFrameworkPath(
        "https://app.example/mail/_agent-native/x",
        customMounted,
      ),
    ).toBe("https://app.example/mail/_platform/x");
    expect(toPublicFrameworkPath("https://app.example/api/x", custom)).toBe(
      "https://app.example/api/x",
    );
  });

  it("does not touch app routes, relative paths, or similar prefixes", () => {
    expect(toPublicFrameworkPath("/api/x", custom)).toBe("/api/x");
    expect(toPublicFrameworkPath("_agent-native/x", custom)).toBe(
      "_agent-native/x",
    );
    expect(toPublicFrameworkPath("/_agent-nativex/y", custom)).toBe(
      "/_agent-nativex/y",
    );
    expect(toPublicFrameworkPath("mailto:x@example.com", custom)).toBe(
      "mailto:x@example.com",
    );
  });

  it("round-trips with the incoming translation", () => {
    const publicPath = toPublicFrameworkPath(
      "/mail/_agent-native/events",
      customMounted,
    );
    expect(toInternalFrameworkPath(publicPath, customMounted)).toBe(
      "/mail/_agent-native/events",
    );
  });
});
