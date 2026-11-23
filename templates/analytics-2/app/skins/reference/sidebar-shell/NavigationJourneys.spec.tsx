// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { compareShellSnapshots } from "@agent-native/toolkit/app-shell/shell-testing";
import { afterEach, expect, it } from "vitest";

import { resolveRoutePage } from "../../../components/workspace/pages";
import { resolveRoute } from "../../../routes/routing/registry";
import {
  dispose,
  init,
  mount,
  normalize,
} from "../../../testing/sidebar-shell/harness";
import { observeNavigationLinks } from "../../../testing/sidebar-shell/link-observations";
import {
  navigationJourneyFixtures,
  useNavigationJourneyModel,
} from "../../../testing/sidebar-shell/models/navigation-journeys";
import { AppShell } from "./AppShell";

afterEach(dispose);
function Fixture({
  fixture,
}: {
  fixture: (typeof navigationJourneyFixtures)[number];
}) {
  return <AppShell model={useNavigationJourneyModel(fixture)} />;
}
it.each(navigationJourneyFixtures)(
  "matches $name resolved navigation without resolving routes in the skin",
  async (fixture) => {
    init();
    await mount(<Fixture fixture={fixture} />);
    const capture = JSON.parse(
      readFileSync(
        `app/testing/sidebar-shell/reference-fixtures/${fixture.name}.json`,
        "utf8",
      ),
    ) as { markup: string; extra: { destinations: unknown[] } | null };
    const baseline = document.createElement("div");
    baseline.innerHTML = capture.markup;
    for (const selector of [
      ".ws-tabs",
      ".ws-tabs-scroll > a",
      ".ws-tabs-scroll > button",
      ".ws-popover",
    ]) {
      const markup = (root: ParentNode) =>
        normalize(
          [...root.querySelectorAll(selector)]
            .map((element) => element.outerHTML)
            .join(""),
        );
      expect(markup(document.body), selector).toBe(markup(baseline));
    }
    if (fixture.name === "advertised-targets") {
      expect(
        compareShellSnapshots(
          observeNavigationLinks(baseline),
          observeNavigationLinks(document.body),
        ).differences,
      ).toEqual([]);
      const destinations = [
        ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
      ].map((element) => {
        const href = element.getAttribute("href");
        if (href === null) throw new Error("Missing navigation destination");
        const route = resolveRoute(href, {
          authenticated: true,
          isAdmin: true,
          foldersEnabled: true,
          tasksEnabled: true,
          development: true,
        });
        return {
          href,
          class: element.className,
          current: element.getAttribute("aria-current"),
          frame: route.frame,
          routeId: route.id,
          pageRegistered: !!resolveRoutePage(route),
        };
      });
      expect(destinations).toEqual(capture.extra?.destinations);
    } else {
      expect(
        document.querySelector("a[href='/context-studio/setup']"),
      ).toBeNull();
    }
  },
);
