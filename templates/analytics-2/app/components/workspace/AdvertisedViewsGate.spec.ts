// @vitest-environment node

import { describe, expect, it } from "vitest";

import { homeSections, settingsSections } from "../../routes/routing/registry";
import { resolveRoutePage } from "./pages";

/**
 * analytics-2.sweep#6 (P1, owner rebuild-analytics-2).
 *
 * The rebuilt app resolves a screen through the route-page registry and renders
 * nothing when a view has no entry, while the rail and the home tabs advertise
 * views from `settingsSections` / `homeSections`. That mismatch shipped three
 * dead settings entries in one night (Notifications, Connected apps,
 * Preferences), each of which a reader could click and get an empty frame.
 *
 * This test does not demand that every advertised view be implemented today -
 * the rebuild is still landing them - it demands that the set of views WITHOUT a
 * page never grows silently. A new tab must come with its page, or with a line
 * added here and a reason, which is the review the dead entries never got.
 */
const KNOWN_WITHOUT_PAGE: Record<"home" | "settings", readonly string[]> = {
  home: [
    "collections",
    "explorations",
    "components",
    "you",
    "sharedWithYou",
    "sharedWithOrg",
    "library",
    "archive",
    "tasks",
    "folders",
    "drafts",
    "trash",
    "agent-dev-tools",
  ],
  settings: [
    "api-keys",
    "compute",
    "agent",
    "trusted-mode",
    "organization",
    "styling",
    "secrets",
    "integrations",
    "environment",
    "scheduled-runs",
    "audit-logs",
    "project-security",
    "data-retention",
  ],
};

const registryRoute = (kind: "home" | "settings", view: string) =>
  ({
    id: kind === "home" ? "home" : "settings",
    view,
  }) as unknown as Parameters<typeof resolveRoutePage>[0];

describe("advertised views without a page stay known", () => {
  it("adds no unlisted home view without a registered page", () => {
    const missing = Object.keys(homeSections).filter(
      (view) => !resolveRoutePage(registryRoute("home", view)),
    );
    const unlisted = missing.filter(
      (view) => !KNOWN_WITHOUT_PAGE.home.includes(view),
    );
    expect(unlisted, "new home views must ship with a page").toEqual([]);
  });

  it("adds no unlisted settings view without a registered page", () => {
    const missing = Object.keys(settingsSections).filter(
      (view) => !resolveRoutePage(registryRoute("settings", view)),
    );
    const unlisted = missing.filter(
      (view) => !KNOWN_WITHOUT_PAGE.settings.includes(view),
    );
    expect(unlisted, "new settings views must ship with a page").toEqual([]);
  });
});
