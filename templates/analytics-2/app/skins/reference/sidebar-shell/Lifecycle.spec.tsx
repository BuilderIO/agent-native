// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { getThemeInitScript } from "@agent-native/core/client/theme";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import {
  button,
  click,
  dispose,
  envelope,
  init,
  media,
  mount,
  navigate,
  normalize,
  storageEvents,
} from "../../../testing/sidebar-shell/harness";
import {
  bootFixtures,
  themeChoicesModel,
  useWorkspaceJourneyModel,
} from "../../../testing/sidebar-shell/models/lifecycle";
import { AppShell } from "./AppShell";
import { ThemeMenuEntries } from "./ThemeMenuEntries";

afterEach(dispose);
function Fixture({
  theme = false,
  shell = true,
}: {
  theme?: boolean;
  shell?: boolean;
}) {
  const model = useWorkspaceJourneyModel();
  const choices = themeChoicesModel(model);
  return (
    <>
      {shell ? <AppShell model={model} /> : null}
      {theme ? (
        <ThemeMenuEntries
          model={choices.navigation}
          effects={choices.effects}
        />
      ) : null}
    </>
  );
}
function frozen(name: string) {
  return JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/${name}.json`,
      "utf8",
    ),
  ) as {
    root: unknown;
    markup: string;
    phases: { phase: string; root: unknown }[];
  };
}
function boot() {
  new Function(
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    getThemeInitScript(),
  )(window, document, localStorage, sessionStorage);
}
function compareFrameRegions(name: string) {
  const baseline = document.createElement("div");
  baseline.innerHTML = frozen(name).markup;
  for (const selector of [
    ".ws-mobile-nav",
    ".ws-sidebar-header",
    ".ws-tabs",
    ".ws-tabs-scroll > a",
    ".ws-tabs-scroll > button",
    ".ws-footer",
    ".ws-overlay",
  ]) {
    const markup = (root: ParentNode) =>
      normalize(
        [...root.querySelectorAll(selector)]
          .map((element) => element.outerHTML)
          .join(""),
      );
    expect(markup(document.body), `${name}: ${selector}`).toBe(
      markup(baseline),
    );
  }
  const geometry = (root: ParentNode) => {
    const shell = root.querySelector(".ws-root")?.cloneNode(true);
    if (!(shell instanceof Element)) throw new Error("Missing frame geometry");
    for (const selector of [".ws-sidebar", ".ws-content"]) {
      const slot = shell.querySelector(selector);
      if (!slot) throw new Error(`Missing frame slot: ${selector}`);
      slot.replaceChildren();
    }
    return normalize(shell.outerHTML);
  };
  expect(geometry(document.body)).toBe(geometry(baseline));
}

it.each(bootFixtures)(
  "replays exact $name boot, first-commit and settled envelopes",
  async (fixture) => {
    init({
      width: fixture.viewport,
      dark: fixture.systemDark,
      storage: fixture.stored === null ? {} : { theme: fixture.stored },
    });
    boot();
    const phases = [{ phase: "boot", root: envelope() }];
    await mount(<Fixture theme />, "/home", () =>
      phases.push({ phase: "ready", root: envelope() }),
    );
    phases.push({ phase: "settled", root: envelope() });
    expect(phases).toEqual(frozen(fixture.name).phases);
    const expected = frozen(`${fixture.name}-mounted`);
    expect(envelope()).toEqual(expected.root);
    const baseline = document.createElement("div");
    baseline.innerHTML = expected.markup;
    const markup = (root: ParentNode) =>
      normalize(
        [
          ...root.querySelectorAll(
            "[data-test-host] > .ws-menu-heading,[data-test-host] > .ws-menu-item,.ws-mobile-nav,.ws-footer",
          ),
        ]
          .map((element) => element.outerHTML)
          .join(""),
      );
    expect(markup(document.body)).toBe(markup(baseline));
    compareFrameRegions(`${fixture.name}-mounted`);
  },
);

it.each([1280, 1051, 1050, 701, 700, 420])(
  "replays %s viewport route dismissal and responsive transitions",
  async (viewport) => {
    init({ width: viewport });
    await mount(<Fixture />);
    const sidebar = document.querySelector<HTMLElement>(".ws-sidebar");
    if (!sidebar) throw new Error("Missing sidebar");
    expect(sidebar.dataset.closed).toBe(String(viewport <= 1050));
    if (viewport <= 1050) {
      await click(button("Open navigation"));
      expect(sidebar.dataset.closed).toBe("false");
      await act(async () => navigate("/home/data"));
      expect(sidebar.dataset.closed).toBe("true");
      const capture = frozen(`viewport-${viewport}-navigated`);
      const baseline = document.createElement("div");
      baseline.innerHTML = capture.markup;
      expect((sidebar.cloneNode(false) as HTMLElement).outerHTML).toBe(
        (baseline.querySelector(".ws-sidebar")?.cloneNode(false) as HTMLElement)
          .outerHTML,
      );
      expect(
        [...sidebar.querySelectorAll(".ws-nav-row.is-active")].map((entry) =>
          entry.getAttribute("href"),
        ),
      ).toEqual(["/home/data"]);
      compareFrameRegions(`viewport-${viewport}-navigated`);
      await media({ width: 1280 });
      expect(sidebar.dataset.closed).toBe("false");
      await media({ width: 1050 });
      expect(sidebar.dataset.closed).toBe("true");
      compareFrameRegions(`viewport-${viewport}-resized`);
      await click(button("Open navigation"));
      await act(async () => navigate("/home/data#same-path"));
      expect(sidebar.dataset.closed).toBe("false");
    }
    expect(
      storageEvents.filter((event) => event.operation === "setItem"),
    ).toEqual([]);
  },
);

it("keeps system media changes and explicit theme strings through the shared model", async () => {
  init();
  boot();
  await mount(<Fixture theme shell={false} />);
  await media({ dark: true });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await click(button("Light"));
  await media({ dark: false });
  expect(localStorage.getItem("theme")).toBe("light");
  await media({ dark: true });
  expect(document.documentElement.dataset.theme).toBe("light");
  const capture = frozen("theme-explicit-over-media");
  const expected = document.createElement("div");
  expected.innerHTML = capture.markup;
  const markup = (root: ParentNode) =>
    normalize(
      [
        ...root.querySelectorAll(
          "[data-test-host] > .ws-menu-heading,[data-test-host] > .ws-menu-item",
        ),
      ]
        .map((element) => element.outerHTML)
        .join(""),
    );
  expect(markup(document.body)).toBe(
    normalize(expected.querySelector("[data-test-host]")?.innerHTML ?? ""),
  );
  expect(envelope()).toEqual(capture.root);
});
