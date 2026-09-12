import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveDesignOpenPath } from "./core-routes.js";

const ROUTES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/routes",
);

/**
 * Flat-route filenames turned into matchable path patterns, minus the splat
 * routes. `$.tsx` matches every path, so leaving it in would make a deep link
 * to a non-existent route look valid here while the browser renders not-found.
 */
function concreteRoutePatterns(): RegExp[] {
  return readdirSync(ROUTES_DIR)
    .filter((file) => /\.tsx$/.test(file) && !/\.(test|spec)\.tsx$/.test(file))
    .map((file) => file.replace(/\.tsx$/, ""))
    .filter((route) => route !== "$" && !route.endsWith(".$"))
    .map((route) => {
      const segments =
        route === "_index"
          ? []
          : route
              .split(".")
              .map((segment) => segment.replace(/_$/, ""))
              .filter((segment) => segment && segment !== "_index")
              .map((segment) =>
                segment.startsWith("$") ? "[^/?#]+" : escapeRegExp(segment),
              );
      return new RegExp(`^/${segments.join("/")}$`);
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathnameOf(target: string): string {
  return target.split(/[?#]/, 1)[0] ?? target;
}

describe("resolveDesignOpenPath", () => {
  it("resolves a bare design id to the editor route", () => {
    expect(
      resolveDesignOpenPath({ view: "editor", params: { designId: "d1" } }),
    ).toBe("/design/d1");
  });

  it("resolves a design id with a screen to the overview canvas focused on it", () => {
    expect(
      resolveDesignOpenPath({
        view: "editor",
        params: { designId: "d1", screen: "file-1" },
      }),
    ).toBe("/design/d1?view=overview&screen=file-1");
  });

  it("falls back to /home for an editor view with no design id", () => {
    expect(resolveDesignOpenPath({ view: "editor", params: {} })).toBe("/home");
  });

  it("returns null for an unrecognized view with no design id", () => {
    expect(resolveDesignOpenPath({ view: "templates", params: {} })).toBeNull();
  });

  // `/_agent-native/open?app=design&view=editor&…` is both the embed target and
  // the "open outside the frame" link a host offers when the embed iframe
  // fails. A resolver that answers with a path no route serves makes both dead
  // ends at once, and the only visible symptom is a 404 page.
  it("resolves every editor deep link to a real design route", () => {
    const patterns = concreteRoutePatterns();
    expect(patterns.length).toBeGreaterThan(5);

    const cases: Record<string, string>[] = [
      { designId: "d1" },
      { designId: "d1", screen: "file-1" },
      {},
    ];
    for (const params of cases) {
      const target = resolveDesignOpenPath({ view: "editor", params });
      expect(target, JSON.stringify(params)).not.toBeNull();
      const pathname = pathnameOf(target!);
      expect(
        patterns.some((pattern) => pattern.test(pathname)),
        `${pathname} has no matching design route`,
      ).toBe(true);
    }
  });
});
