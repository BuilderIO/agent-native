import { describe, expect, it } from "vitest";

import { resolveRoute } from "./registry";

/**
 * The rebuilt shell moved the list surfaces under /home. A bookmark, a shared
 * link or an older receipt URL still asks for the top-level path, and landing on
 * Home silently opened the wrong screen (tester row 544). Each legacy path must
 * send the browser to the list it names.
 */
describe("legacy list deep links", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["/projects", "/home/all"],
    ["/threads", "/home/threads"],
    ["/trash", "/home/trash"],
    ["/data", "/home/data"],
  ];

  it("redirects every legacy list path to its list", () => {
    for (const [from, to] of cases) {
      const route = resolveRoute(from);
      expect(route.to, `${from} should redirect`).toBe(to);
    }
  });

  it("opens /threads/<id> on the saved thread instead of falling through to Home", () => {
    const route = resolveRoute("/threads/thr_123?x=1");
    expect(route.to).toBe("/thread/thr_123?x=1");
  });

  it("keeps a query string and hash on the way through", () => {
    const route = resolveRoute("/trash?sort=recent");
    expect(route.to).toBe("/home/trash?sort=recent");
  });

  it("sends the /home/<alias> spellings to the canonical home list", () => {
    const aliases: ReadonlyArray<[string, string]> = [
      ["/home/projects", "/home/all"],
      ["/home/archived", "/home/archive"],
      ["/home/recent-projects", "/home"],
      ["/home/recents", "/home"],
    ];
    for (const [from, to] of aliases) {
      expect(resolveRoute(from).to, `${from} should redirect`).toBe(to);
    }
    expect(resolveRoute("/home/projects?sort=recent").to).toBe(
      "/home/all?sort=recent",
    );
  });

  it("still resolves the canonical list paths directly", () => {
    expect(resolveRoute("/home/all").view).toBe("all");
    expect(resolveRoute("/home/trash").view).toBe("trash");
  });
});
