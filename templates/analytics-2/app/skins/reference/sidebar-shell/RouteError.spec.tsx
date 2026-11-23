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
  storageEvents,
} from "../../../testing/sidebar-shell/harness";
import { observeNavigationLinks } from "../../../testing/sidebar-shell/link-observations";
import {
  errorFixtures,
  routeErrorModel,
  useRouteErrorModel,
} from "../../../testing/sidebar-shell/models/errors";
import { AppShell } from "./AppShell";

afterEach(dispose);
function Fixture({ error }: { error: unknown }) {
  return <AppShell model={useRouteErrorModel(error, true)} />;
}

it.each(errorFixtures)(
  "matches $name chrome with a declared toolkit report slot",
  async (fixture) => {
    init();
    const model = routeErrorModel(fixture.error, true);
    expect(model.regions[1]?.content).toEqual({
      owner: "kit",
      key: "error-report-actions",
    });
    const listeners = vi.spyOn(window, "addEventListener");
    await mount(<Fixture error={fixture.error} />, "/missing");
    const frozen = JSON.parse(
      readFileSync(
        `app/testing/sidebar-shell/reference-fixtures/${fixture.name}.json`,
        "utf8",
      ),
    ) as { markup: string; root: { html: Record<string, string> } };
    const expected = document.createElement("div");
    expected.innerHTML = frozen.markup;
    const feedback = expected.querySelector(
      "button[aria-label='Send feedback']",
    );
    const reportOwner = feedback?.parentElement;
    if (!reportOwner) throw new Error("Missing frozen toolkit report owner");
    expect(reportOwner.children).toHaveLength(2);
    expect(
      reportOwner.querySelector("a[target='_blank']")?.textContent?.trim(),
    ).toBe("Open GitHub issue");
    reportOwner.remove();
    expect(normalize(document.body.innerHTML)).toBe(
      normalize(expected.innerHTML),
    );
    expect(
      compareShellSnapshots(
        observeNavigationLinks(expected),
        observeNavigationLinks(document.body),
      ).differences,
    ).toEqual([]);
    expect(
      Object.fromEntries(
        [...document.documentElement.attributes].map((attribute) => [
          attribute.name,
          attribute.value,
        ]),
      ),
    ).toEqual(frozen.root.html);
    expect(
      document.querySelector(
        "button[aria-label='Send feedback'],a[target='_blank'],.ws-sidebar",
      ),
    ).toBeNull();
    expect(
      storageEvents.filter((event) => event.operation === "setItem"),
    ).toEqual([]);
    expect(listeners.mock.calls.filter(([type]) => type === "keydown")).toEqual(
      [],
    );
    const home = document.querySelector<HTMLAnchorElement>("a[href='/home']");
    if (!home) throw new Error("Missing Go home recovery");
    await click(home);
    expect(route).toBe("/home");
  },
);

it("keeps development details above skin selection", async () => {
  init();
  const fixture = errorFixtures[3];
  await mount(
    <AppShell model={routeErrorModel(fixture.error, false)} />,
    "/missing",
  );
  expect(document.querySelector("p")?.textContent).toBe(
    "An unexpected error occurred.",
  );
  expect(document.querySelector("pre")).toBeNull();
  expect(document.querySelector("h1")?.textContent).toBe(
    "Something went wrong",
  );
});

it.each(["light", "dark", "system"])(
  "keeps the error owner's existing %s theme policy outside the renderer",
  async (theme) => {
    init({ storage: { theme }, dark: true });
    await mount(<Fixture error="failure" />, "/missing");
    expect(document.documentElement.className).toBe(
      theme === "light" ? "light" : "dark",
    );
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBe(theme);
    expect(
      storageEvents.filter((event) => event.operation === "setItem"),
    ).toEqual([]);
  },
);
