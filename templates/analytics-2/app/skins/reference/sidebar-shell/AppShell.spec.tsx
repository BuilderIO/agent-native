// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { afterEach, expect, it, vi } from "vitest";

import {
  button,
  click,
  dispose,
  envelope,
  init,
  mount,
  normalize,
  storageEvents,
} from "../../../testing/sidebar-shell/harness";
import { railFixtures } from "../../../testing/sidebar-shell/models/rails";
import {
  frameFixtures,
  frameModel,
  homeShellFixtures,
  railShellModel,
  useHomeShellModel,
  type HomeShellFixture,
} from "../../../testing/sidebar-shell/models/shell";
import { AppShell } from "./AppShell";

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
function rootEnvelope(name: string): unknown {
  return (
    JSON.parse(
      readFileSync(
        `app/testing/sidebar-shell/reference-fixtures/${name}.json`,
        "utf8",
      ),
    ) as { root: unknown }
  ).root;
}
function markup(root: ParentNode, selector: string) {
  return normalize(
    [...root.querySelectorAll(selector)]
      .map((element) => element.outerHTML)
      .join(""),
  );
}
function Home({ fixture }: { fixture: HomeShellFixture }) {
  return <AppShell model={useHomeShellModel(fixture)} />;
}
function homeGeometry(root: ParentNode) {
  const shell = root.querySelector(".ws-root")?.cloneNode(true);
  if (!(shell instanceof Element)) throw new Error("Missing workspace frame");
  for (const selector of [".ws-sidebar", ".ws-content"]) {
    const owners = shell.querySelectorAll(selector);
    expect(owners).toHaveLength(1);
    owners[0]?.replaceChildren();
  }
  return normalize(shell.outerHTML);
}

it.each(homeShellFixtures)(
  "matches $name mobile header, scrim and main boundary",
  async (fixture) => {
    init({
      ...(fixture.width === undefined ? {} : { width: fixture.width }),
      ...(fixture.dark === undefined ? {} : { dark: fixture.dark }),
      storage: fixture.theme ? { theme: fixture.theme } : {},
    });
    await mount(<Home fixture={fixture} />, fixture.path);
    const expected = baseline(fixture.name);
    expect(homeGeometry(document.body)).toBe(homeGeometry(expected));
    for (const selector of [
      ".ws-mobile-nav",
      ".ws-overlay",
      "[data-workspace-write-error]",
    ])
      expect(markup(document.body, selector), selector).toBe(
        markup(expected, selector),
      );
    const actualMain = document.querySelector(".ws-content");
    const expectedMain = expected.querySelector(".ws-content");
    if (!actualMain || !expectedMain) throw new Error("Missing main boundary");
    expect((actualMain.cloneNode(false) as Element).outerHTML).toBe(
      (expectedMain.cloneNode(false) as Element).outerHTML,
    );
    expect(actualMain.querySelector("[data-domain-content]")).toBeNull();
  },
);

it.each(railFixtures)(
  "matches $name shell geometry with an empty page-owned slot",
  async (fixture) => {
    init();
    const model = railShellModel(fixture);
    if (fixture.name === "settings-member-visible") {
      const previous = railFixtures.find(
        (item) => item.name === "settings-admin-access-group",
      );
      if (!previous) throw new Error("Missing previous rail state");
      const mounted = await mount(
        <AppShell model={railShellModel(previous)} />,
        previous.path,
      );
      await mounted.update(<AppShell model={model} />);
    } else await mount(<AppShell model={model} />, fixture.path);
    const expected = baseline(fixture.name);
    const selector =
      fixture.kind === "settings" ? ".settings-shell" : ".context-area";
    const slotSelector =
      fixture.kind === "settings" ? ".settings-inner" : ".context-area-content";
    const expectedSlot = expected.querySelector(slotSelector);
    const actualSlot = document.querySelector(slotSelector);
    if (!expectedSlot || !actualSlot)
      throw new Error("Missing page-owned slot");
    expect(actualSlot.childNodes).toHaveLength(0);
    expectedSlot.replaceChildren();
    expect(markup(document.body, selector)).toBe(markup(expected, selector));
    expect(envelope()).toEqual(rootEnvelope(fixture.name));
  },
);

it.each(frameFixtures)(
  "matches frozen $name standalone/read-state frame",
  async (fixture) => {
    init();
    await mount(<AppShell model={frameModel(fixture)} />, fixture.path);
    const expected = baseline(fixture.name);
    for (const domain of expected.querySelectorAll("[data-domain-content]"))
      domain.remove();
    expect(document.querySelector("[data-test-host]")?.innerHTML).toBe(
      expected.querySelector("[data-test-host]")?.innerHTML,
    );
    expect(document.querySelector(".ws-sidebar")).toBeNull();
    expect(envelope()).toEqual(rootEnvelope(fixture.name));
  },
);

it("delegates read Retry to the provided effect", async () => {
  init();
  const fixture = frameFixtures.find(
    (item) => item.name === "frame-settings-unavailable",
  );
  if (!fixture) throw new Error("Missing read error fixture");
  const retry = vi.fn();
  await mount(<AppShell model={frameModel(fixture, retry)} />, fixture.path);
  await click(button("Retry"));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(storageEvents).toEqual([]);
});

it("delegates write Retry and removes the banner on Dismiss", async () => {
  init();
  const retry = vi.fn();
  await mount(
    <Home
      fixture={{
        name: "thread-write-error",
        writeError: {
          action: "create-thread",
          message: "Synthetic thread failure",
        },
        retry,
      }}
    />,
  );
  await click(button("Retry"));
  expect(retry).toHaveBeenCalledTimes(1);
  await click(button("Dismiss"));
  expect(document.querySelector("[data-workspace-write-error]")).toBeNull();
});

it("opens and dismisses the drawer and delegates the mobile Search effect", async () => {
  init({ width: 420 });
  const search = vi.fn();
  await mount(
    <Home
      fixture={{
        name: "viewport-420-settled",
        width: 420,
        props: { onOpenSearch: search },
      }}
    />,
  );
  expect(
    document.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
  ).toBe("true");
  await click(button("Open navigation"));
  expect(
    document.querySelector(".ws-sidebar")?.getAttribute("data-closed"),
  ).toBe("false");
  const overlay = document.querySelector<HTMLButtonElement>(".ws-overlay");
  if (!overlay) throw new Error("Missing drawer scrim");
  await click(overlay);
  expect(document.querySelector(".ws-overlay")).toBeNull();
  const mobile = document.querySelector(".ws-mobile-nav");
  if (!mobile) throw new Error("Missing mobile header");
  await click(button("Search", mobile));
  expect(search).toHaveBeenCalledTimes(1);
  expect(
    storageEvents.filter((event) => event.operation === "setItem"),
  ).toEqual([]);
});

it("owns separate mobile and sidebar workspace-menu bindings", async () => {
  init({ width: 420 });
  await mount(<Home fixture={{ name: "viewport-420-settled", width: 420 }} />);
  const mobile = document.querySelector(".ws-mobile-nav");
  const sidebar = document.querySelector(".ws-sidebar");
  if (!mobile || !sidebar) throw new Error("Missing workspace presentations");
  await click(button("Test workspace", mobile));
  expect(mobile.querySelector("button[aria-expanded='true']")).not.toBeNull();
  expect(
    sidebar
      .querySelector("button[aria-haspopup='menu']")
      ?.getAttribute("aria-expanded"),
  ).toBe("false");
});
