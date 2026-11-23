// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { compareShellSnapshots } from "@agent-native/toolkit/app-shell/shell-testing";
import { afterEach, expect, it, vi } from "vitest";

import {
  click,
  dispose,
  init,
  mount,
  normalize,
  route,
} from "../../../testing/sidebar-shell/harness";
import { observeNavigationLinks } from "../../../testing/sidebar-shell/link-observations";
import {
  setupFixtures,
  setupModel,
} from "../../../testing/sidebar-shell/models/setup";
import { ContentSlot } from "./ContentSlot";
import { ContextSetupEntry } from "./ContextSetupEntries";

afterEach(dispose);
it.each(setupFixtures)(
  "matches frozen $name child links while leaving the custom parent empty",
  async (fixture) => {
    init();
    const model = setupModel(fixture.state);
    const owner = model.regions[0]?.content;
    if (!owner) throw new Error("Missing setup slot owner");
    await mount(
      <>
        {model.navigation.entries.map((entry) => (
          <ContextSetupEntry
            key={entry.id}
            entry={entry}
            effects={model.effects}
          />
        ))}
        <ContentSlot owner={owner} />
      </>,
    );
    const capture = JSON.parse(
      readFileSync(
        `app/testing/sidebar-shell/reference-fixtures/${fixture.name}.json`,
        "utf8",
      ),
    ) as { markup: string };
    const baseline = document.createElement("div");
    baseline.innerHTML = capture.markup;
    const selector = ".ws-context-header,.ws-context-step";
    const markup = (root: ParentNode) =>
      normalize(
        [...root.querySelectorAll(selector)]
          .map((entry) => entry.outerHTML)
          .join(""),
      );
    expect(markup(document.body)).toBe(markup(baseline));
    const expectedLinks = document.createElement("div");
    for (const link of baseline.querySelectorAll(selector))
      expectedLinks.append(link.cloneNode(true));
    expect(
      compareShellSnapshots(
        observeNavigationLinks(expectedLinks),
        observeNavigationLinks(document.body),
      ).differences,
    ).toEqual([]);
    expect(
      document.querySelector(
        ".ws-context-card,.ws-context-annotation,.ws-context-checklist",
      ),
    ).toBeNull();
  },
);

it("delegates every setup link's navigation callback once", async () => {
  init();
  const fixture = setupFixtures[2];
  if (!fixture) throw new Error("Missing setup fixture");
  const onNavigate = vi.fn();
  const model = setupModel(fixture.state, onNavigate);
  await mount(
    <>
      {model.navigation.entries.map((entry) => (
        <ContextSetupEntry
          key={entry.id}
          entry={entry}
          effects={model.effects}
        />
      ))}
    </>,
  );
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a"))
    await click(link);
  expect(onNavigate).toHaveBeenCalledTimes(7);
  expect(route).toBe("/context-studio/setup");
});
