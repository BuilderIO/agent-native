// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import { afterEach, expect, it } from "vitest";

import {
  dispose,
  envelope,
  init,
  mount,
} from "../../../testing/sidebar-shell/harness";
import {
  creationFixtures,
  creationRegion,
  publishedFixture,
  publishedModel,
} from "../../../testing/sidebar-shell/models/owners";
import { useHomeShellModel } from "../../../testing/sidebar-shell/models/shell";
import { AppShell } from "./AppShell";

afterEach(dispose);
function Creation({ fixture }: { fixture: (typeof creationFixtures)[number] }) {
  const base = useHomeShellModel({ name: fixture.name });
  return (
    <AppShell
      model={{ ...base, regions: [...base.regions, creationRegion(fixture)] }}
    />
  );
}

it.each(creationFixtures)(
  "retains $name as an empty custom owner without form credit",
  async (fixture) => {
    init();
    const capture = JSON.parse(
      readFileSync(
        `app/testing/sidebar-shell/reference-fixtures/${fixture.name}.json`,
        "utf8",
      ),
    ) as { rows: string[]; markup: string };
    expect(capture.rows).toContain(fixture.row);
    const expected = document.createElement("div");
    expected.innerHTML = capture.markup;
    expect(expected.querySelector("[role='dialog']")).not.toBeNull();
    const region = creationRegion(fixture);
    expect(region.content).toMatchObject({ owner: "custom", key: fixture.key });
    await mount(<Creation fixture={fixture} />);
    expect(document.querySelector(".ws-root")).not.toBeNull();
    expect(
      document.querySelector(
        "[role='dialog'],form,input[type='file'],textarea",
      ),
    ).toBeNull();
  },
);

it("delegates the entire published frame to its page owner without introducing shell chrome", async () => {
  init();
  const model = publishedModel();
  expect(model.frame.key).toBe("published-app");
  expect(model.regions[0]?.content).toEqual({
    owner: "page",
    key: "published-project",
  });
  await mount(<AppShell model={model} />, publishedFixture.path);
  const capture = JSON.parse(
    readFileSync(
      `app/testing/sidebar-shell/reference-fixtures/${publishedFixture.name}.json`,
      "utf8",
    ),
  ) as { markup: string; root: unknown };
  const expected = document.createElement("div");
  expected.innerHTML = capture.markup;
  const page = expected.querySelector("main[data-published-app='true']");
  if (!page) throw new Error("Missing frozen published-page owner");
  expect(page.querySelector("h1")?.textContent).toBe("Synthetic page content");
  page.remove();
  expect(document.body.innerHTML).toBe(expected.innerHTML);
  expect(envelope()).toEqual(capture.root);
});
