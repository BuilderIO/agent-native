import { describe, expect, it } from "vitest";

import {
  buildInteractRoutes,
  EMPTY_INTERACT_ROUTE_HISTORY,
  interactRouteBackTarget,
  interactRouteForwardTarget,
  MAX_INTERACT_ROUTE_HISTORY,
  reduceInteractRouteHistory,
  resolveActiveInteractRoute,
  resolveScreenRoute,
  resolveScreenTitle,
  type InteractRouteHistory,
  type InteractRouteHistoryAction,
} from "./interact-routes";

function run(
  actions: InteractRouteHistoryAction[],
  start: InteractRouteHistory = EMPTY_INTERACT_ROUTE_HISTORY,
) {
  return actions.reduce(reduceInteractRouteHistory, start);
}

const visit = (screenId: string, via?: -1 | 1): InteractRouteHistoryAction => ({
  type: "visit",
  screenId,
  via,
});

describe("resolveScreenRoute", () => {
  it("uses the path a prototype link would take to reach a markup screen", () => {
    expect(resolveScreenRoute({ id: "a", filename: "pricing.html" })).toBe(
      "/pricing",
    );
    expect(resolveScreenRoute({ id: "a", filename: "docs/intro.html" })).toBe(
      "/docs/intro",
    );
  });

  it("maps index to the root", () => {
    expect(resolveScreenRoute({ id: "a", filename: "index.html" })).toBe("/");
    expect(resolveScreenRoute({ id: "a", filename: "Index.htm" })).toBe("/");
  });

  it("uses the served path for a URL-backed screen", () => {
    expect(
      resolveScreenRoute({
        id: "a",
        filename: "fusion-home.html",
        url: "http://localhost:3000/home?tab=1",
      }),
    ).toBe("/home?tab=1");
  });

  it("prefers the live path the app has navigated to", () => {
    expect(
      resolveScreenRoute(
        {
          id: "a",
          filename: "fusion-home.html",
          url: "http://localhost:3000/home",
        },
        "/pricing#plans",
      ),
    ).toBe("/pricing#plans");
  });

  it("ignores the location a markup screen reports for itself", () => {
    expect(
      resolveScreenRoute({ id: "a", filename: "pricing.html" }, "srcdoc"),
    ).toBe("/pricing");
  });

  it("falls back to the filename when the URL cannot be parsed", () => {
    expect(
      resolveScreenRoute({
        id: "a",
        filename: "docs.html",
        previewUrl: "not a url",
      }),
    ).toBe("/docs");
  });
});

describe("buildInteractRoutes", () => {
  it("lists every screen with its route and a readable title", () => {
    expect(
      buildInteractRoutes(
        [
          { id: "1", filename: "home.html", title: "Screen 1" },
          { id: "2", filename: "docs.html", url: "http://localhost:3000/docs" },
        ],
        { "2": "/docs/start" },
      ),
    ).toEqual([
      { screenId: "1", route: "/home", title: "Screen 1" },
      { screenId: "2", route: "/docs/start", title: "Docs" },
    ]);
  });
});

describe("resolveScreenTitle", () => {
  it("prefers the screen's own title, then names the file", () => {
    expect(
      resolveScreenTitle({
        id: "a",
        filename: "pricing.html",
        title: " Plans ",
      }),
    ).toBe("Plans");
    expect(resolveScreenTitle({ id: "a", filename: "pricing.html" })).toBe(
      "Pricing",
    );
    expect(resolveScreenTitle({ id: "a", filename: "index.html" })).toBe(
      "Home",
    );
  });
});

describe("resolveActiveInteractRoute", () => {
  const routes = [
    { screenId: "home", route: "/home", title: "Screen 1" },
    { screenId: "docs", route: "/docs", title: "Docs" },
  ];

  it("is the route of the active screen", () => {
    expect(resolveActiveInteractRoute(routes, "docs")).toBe(routes[1]);
  });

  it("is the first page when no screen is active", () => {
    expect(resolveActiveInteractRoute(routes, null)).toBe(routes[0]);
  });

  it("is the first page when the active screen is not a page of the design", () => {
    expect(resolveActiveInteractRoute(routes, "gone")).toBe(routes[0]);
  });

  it("is the only page of a one-page design", () => {
    expect(resolveActiveInteractRoute([routes[0]!], null)).toBe(routes[0]);
  });

  it("is null, not a made-up route, when the design has no pages", () => {
    expect(resolveActiveInteractRoute([], "home")).toBeNull();
  });
});

describe("Interact route history", () => {
  it("starts with nothing to go back or forward to", () => {
    expect(interactRouteBackTarget(EMPTY_INTERACT_ROUTE_HISTORY)).toBeNull();
    expect(interactRouteForwardTarget(EMPTY_INTERACT_ROUTE_HISTORY)).toBeNull();
  });

  it("records the first visit", () => {
    expect(run([visit("home")])).toEqual({ entries: ["home"], index: 0 });
  });

  it("returns the same state for a repeat visit of the current screen", () => {
    const state = run([visit("home")]);
    expect(reduceInteractRouteHistory(state, visit("home"))).toBe(state);
  });

  it("pushes each new screen and exposes the previous one as Back", () => {
    const state = run([visit("home"), visit("docs"), visit("pricing")]);
    expect(state).toEqual({ entries: ["home", "docs", "pricing"], index: 2 });
    expect(interactRouteBackTarget(state)).toBe("docs");
    expect(interactRouteForwardTarget(state)).toBeNull();
  });

  it("moves along the stack on Back and Forward instead of pushing", () => {
    const afterBack = run([
      visit("home"),
      visit("docs"),
      visit("pricing"),
      visit("docs", -1),
    ]);
    expect(afterBack).toEqual({
      entries: ["home", "docs", "pricing"],
      index: 1,
    });
    expect(interactRouteBackTarget(afterBack)).toBe("home");
    expect(interactRouteForwardTarget(afterBack)).toBe("pricing");

    const afterForward = reduceInteractRouteHistory(
      afterBack,
      visit("pricing", 1),
    );
    expect(afterForward.index).toBe(2);
  });

  it("drops the forward entries when a new screen is visited after Back", () => {
    const state = run([
      visit("home"),
      visit("docs"),
      visit("pricing"),
      visit("docs", -1),
      visit("blog"),
    ]);
    expect(state).toEqual({ entries: ["home", "docs", "blog"], index: 2 });
    expect(interactRouteForwardTarget(state)).toBeNull();
  });

  it("treats a move onto the neighbouring screen as a push when it was not a Back press", () => {
    const state = run([visit("home"), visit("docs"), visit("home")]);
    expect(state).toEqual({ entries: ["home", "docs", "home"], index: 2 });
  });

  it("ignores a Back press that does not land on the previous entry", () => {
    const state = run([visit("home"), visit("docs"), visit("pricing", -1)]);
    expect(state).toEqual({ entries: ["home", "docs", "pricing"], index: 2 });
  });

  it("keeps only the most recent screens once the stack is full", () => {
    const visits = Array.from(
      { length: MAX_INTERACT_ROUTE_HISTORY + 5 },
      (_, position) => visit(`screen-${position}`),
    );
    const state = run(visits);
    expect(state.entries).toHaveLength(MAX_INTERACT_ROUTE_HISTORY);
    expect(state.index).toBe(MAX_INTERACT_ROUTE_HISTORY - 1);
    expect(state.entries[state.index]).toBe(
      `screen-${MAX_INTERACT_ROUTE_HISTORY + 4}`,
    );
  });

  it("forgets everything on reset", () => {
    expect(run([visit("home"), visit("docs"), { type: "reset" }])).toBe(
      EMPTY_INTERACT_ROUTE_HISTORY,
    );
  });

  it("prunes screens that no longer exist and keeps the current position", () => {
    const state = run([
      visit("home"),
      visit("gone"),
      visit("docs"),
      visit("home", undefined),
      { type: "prune", screenIds: ["home", "docs"] },
    ]);
    expect(state.entries).toEqual(["home", "docs", "home"]);
    expect(state.entries[state.index]).toBe("home");
    expect(state.index).toBe(2);
  });

  it("collapses neighbours that become adjacent duplicates after pruning", () => {
    const state = run([
      visit("home"),
      visit("gone"),
      visit("home"),
      visit("docs"),
      { type: "prune", screenIds: ["home", "docs"] },
    ]);
    expect(state.entries).toEqual(["home", "docs"]);
    expect(state.entries[state.index]).toBe("docs");
  });

  it("leaves the state untouched when every entry is still valid", () => {
    const state = run([visit("home"), visit("docs")]);
    expect(
      reduceInteractRouteHistory(state, {
        type: "prune",
        screenIds: ["docs", "home", "other"],
      }),
    ).toBe(state);
  });
});
