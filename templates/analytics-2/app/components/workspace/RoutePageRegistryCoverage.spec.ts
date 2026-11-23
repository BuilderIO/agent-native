import { describe, expect, it } from "vitest";

import { hasRoutePage, resolveRoutePage } from "@/components/workspace/pages";
import { routeCatalog } from "@/routes/routing/registry";

/**
 * The route-page registry is a plain object that several surfaces rewrite, and
 * twice now a landing of ours was merged while a later rewrite of that object
 * dropped the entry: the screen kept its page file and its spec, and the route
 * still resolved to an empty frame. These are the views this app ships a page
 * for, so a drop is a red test rather than a blank screen a tester has to find.
 */
const SHIPPED: ReadonlyArray<[id: string, view: string]> = [
  ["home", "home"],
  ["home", "archive"],
  ["data-browser", "data"],
  ["thread", "thread"],
  ["app", "app"],
  ["app-latest", "app"],
  ["app-base", "app-base"],
  ["trash", "trash"],
  ["new-collection", "new-collection"],
  ["collection", "collections"],
  ["context-studio", "setup"],
  ["context-studio", "connections"],
  ["settings", "data-sources"],
  ["settings", "general"],
  ["settings", "profile"],
  ["settings", "preferences"],
  ["settings", "notifications"],
  ["settings", "connected-apps"],
];

describe("route page registry coverage", () => {
  it.each(SHIPPED)("%s:%s still resolves a page", (id, view) => {
    expect(
      resolveRoutePage({ id, view } as never),
      `${id}:${view} lost its page`,
    ).toBeDefined();
    expect(hasRoutePage(id, view), `${id}:${view} lost its page`).toBe(true);
  });

  // The settings frames are one route per section, so route presence is only
  // meaningful for the ids the route catalogue names outright.
  it.each([
    ["home", "home"],
    ["data-browser", "data"],
    ["thread", "thread"],
    ["app", "app"],
    ["app-latest", "app"],
    ["app-base", "app-base"],
    ["trash", "trash"],
    ["new-collection", "new-collection"],
    ["collection", "collections"],
    ["context-studio", "setup"],
    ["context-studio-models", "models"],
  ] as const)("%s:%s keeps its route", (id, view) => {
    expect(
      routeCatalog.some((route) => route.id === id && route.view === view),
      `${id}:${view} has a page but no route`,
    ).toBe(true);
  });
});
