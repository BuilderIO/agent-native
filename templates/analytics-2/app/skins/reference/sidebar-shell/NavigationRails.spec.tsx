// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { compareShellSnapshots } from "@agent-native/toolkit/app-shell/shell-testing";
import { afterEach, expect, it } from "vitest";

import {
  click,
  dispose,
  init,
  mount,
  normalize,
  route,
  storageEvents,
} from "../../../testing/sidebar-shell/harness";
import { observeNavigationLinks } from "../../../testing/sidebar-shell/link-observations";
import {
  railFixtures,
  railModel,
  type RailFixture,
} from "../../../testing/sidebar-shell/models/rails";
import { Sidebar } from "./Sidebar";

afterEach(dispose);

function baseline(name: string) {
  const capture = JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/${name}.json`,
      "utf8",
    ),
  ) as { markup: string };
  const root = document.createElement("div");
  root.innerHTML = capture.markup;
  return root;
}
function selector(fixture: RailFixture) {
  return fixture.kind === "context" ? ".context-area-rail" : ".settings-nav";
}
function rail(root: ParentNode, fixture: RailFixture) {
  const element = root.querySelector(selector(fixture));
  if (!element) throw new Error(`Missing rail: ${fixture.name}`);
  return element;
}

function expectedRail(fixture: RailFixture) {
  const expected = rail(baseline(fixture.name), fixture);
  if (fixture.kind === "context") {
    const unbacked = [
      "overview",
      "suggestions",
      "evals",
      "endorsements",
      "guides",
      "models",
      "repositories",
    ];
    for (const view of unbacked) {
      expected.querySelector(`a[href="/context-studio/${view}"]`)?.remove();
    }
    for (const group of expected.querySelectorAll(".context-rail-group")) {
      if (!group.querySelector("a")) group.remove();
    }
  }
  return expected;
}

it.each(railFixtures)(
  "matches expected $name rail markup and independently observed destinations",
  async (fixture) => {
    init();
    const model = railModel(fixture);
    if (fixture.name === "settings-member-visible") {
      const previous = railModel({
        kind: "settings",
        name: "settings-admin-access-group",
        path: "/settings/sso",
        props: { activeTab: "sso", canManageWorkspace: true },
      });
      const mounted = await mount(
        <Sidebar model={previous.navigation} effects={previous.effects} />,
        "/settings/sso",
      );
      await mounted.update(
        <Sidebar model={model.navigation} effects={model.effects} />,
      );
    } else {
      await mount(
        <Sidebar model={model.navigation} effects={model.effects} />,
        fixture.path,
      );
    }
    const expected = expectedRail(fixture);
    const actual = rail(document.body, fixture);
    expect(normalize(actual.outerHTML)).toBe(normalize(expected.outerHTML));
    expect(
      compareShellSnapshots(
        observeNavigationLinks(expected),
        observeNavigationLinks(actual),
      ).differences,
    ).toEqual([]);
    expect(storageEvents).toEqual([]);
  },
);

it.each(["settings-admin-profile", "context-overview"])(
  "follows every expected %s destination without persisting rail state",
  async (name) => {
    const fixture = railFixtures.find((item) => item.name === name);
    if (!fixture) throw new Error(`Missing fixture: ${name}`);
    init();
    const model = railModel(fixture);
    await mount(
      <Sidebar model={model.navigation} effects={model.effects} />,
      fixture.path,
    );
    const expected = [...expectedRail(fixture).querySelectorAll("a")].map(
      (element) => element.getAttribute("href"),
    );
    for (const target of expected) {
      const control = [
        ...rail(document.body, fixture).querySelectorAll<HTMLAnchorElement>(
          "a",
        ),
      ].find((element) => element.getAttribute("href") === target);
      if (!control) throw new Error(`Missing destination: ${target}`);
      await click(control);
      expect(route).toBe(target);
    }
    expect(storageEvents).toEqual([]);
  },
);

it("requires host-resolved active state rather than resolving routes in the renderer", async () => {
  const fixture = railFixtures.find(
    (item) => item.name === "context-connections-settled",
  );
  if (!fixture) throw new Error("Missing Context Connections fixture");
  init();
  const model = railModel(fixture);
  await mount(
    <Sidebar model={model.navigation} effects={model.effects} />,
    "/unrelated-host-location",
  );
  expect(
    document.querySelector('[aria-current="page"]')?.getAttribute("href"),
  ).toBe("/context-studio/connections");
});
