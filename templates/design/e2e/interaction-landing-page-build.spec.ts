import { type Page } from "@playwright/test";

import { appPath, designFrame, expandAllLayers } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  test,
  type App,
  type SavedNode,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const LANDING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Landing Page</title></head>
<body style="margin:0;position:relative;width:1440px;min-height:1024px;background:#ffffff;font-family:system-ui,sans-serif">
  <header data-agent-native-node-id="navbar" data-agent-native-layer-name="Navbar" style="position:absolute;left:0;top:0;width:1440px;height:80px;background:#ffffff">
    <div data-agent-native-node-id="brand" data-agent-native-layer-name="Brand" style="position:absolute;left:32px;top:28px;width:96px;height:24px;font-size:20px;font-weight:700">Brand</div>
    <div data-agent-native-node-id="link-home" data-agent-native-layer-name="Home link" style="position:absolute;left:600px;top:28px;width:80px;height:24px">Home</div>
    <div data-agent-native-node-id="link-about" data-agent-native-layer-name="About link" style="position:absolute;left:720px;top:28px;width:80px;height:24px">About</div>
    <div data-agent-native-node-id="link-services" data-agent-native-layer-name="Services link" style="position:absolute;left:840px;top:28px;width:80px;height:24px">Services</div>
    <div data-agent-native-node-id="link-contact" data-agent-native-layer-name="Contact link" style="position:absolute;left:960px;top:28px;width:80px;height:24px">Contact</div>
  </header>
  <section data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="position:absolute;left:0;top:80px;width:1440px;height:640px;box-sizing:border-box;padding:80px;display:flex;flex-direction:row;gap:48px;background:#f8fafc">
    <div data-agent-native-node-id="hero-copy" data-agent-native-layer-name="HeroCopy" style="width:600px;display:flex;flex-direction:column;gap:16px">
      <h1 data-agent-native-node-id="headline" data-agent-native-layer-name="Headline" style="margin:0;font-size:48px">Build products faster</h1>
      <p data-agent-native-node-id="subheading" data-agent-native-layer-name="Subheading" style="margin:0;font-size:18px">Ship in days, not months.</p>
      <div data-agent-native-node-id="hero-cta" data-agent-native-layer-name="HeroCTAGroup" style="display:flex;flex-direction:row;gap:12px">
        <div data-agent-native-node-id="primary-button" data-agent-native-layer-name="PrimaryButton" style="width:160px;height:48px;background:#2563eb;color:#ffffff">Get started</div>
        <div data-agent-native-node-id="secondary-button" data-agent-native-layer-name="SecondaryButton" style="width:160px;height:48px;background:#e2e8f0">Learn more</div>
      </div>
    </div>
    <div data-agent-native-node-id="hero-image" data-agent-native-layer-name="HeroImage" style="width:560px;height:480px;background:#e5e7eb"></div>
  </section>
  <section data-agent-native-node-id="card-row" data-agent-native-layer-name="CardRow" style="position:absolute;left:80px;top:760px;width:1280px;height:200px;display:flex;flex-direction:row;gap:24px">
    <div data-agent-native-node-id="card-1" data-agent-native-layer-name="Card" style="width:400px;height:200px;background:#f1f5f9"></div>
    <div data-agent-native-node-id="card-2" data-agent-native-layer-name="Card 2" style="width:400px;height:200px;background:#f1f5f9"></div>
  </section>
</body></html>`;

type Nodes = Map<string, SavedNode>;

function childrenOf(nodes: Nodes, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

function bodyId(nodes: Nodes) {
  return [...nodes.values()].find((node) => node.tag === "body")!.id;
}

async function openLandingPage(app: App) {
  const id = await app.seed(LANDING_PAGE, { title: "Landing page" });
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function clickDesign(
  app: App,
  x: number,
  y: number,
  modifiers: ("Shift" | "Meta" | "Control")[] = [],
) {
  const point = await app.pagePoint(x, y);
  for (const key of modifiers) await app.page.keyboard.down(key);
  await app.page.mouse.click(point.x, point.y);
  for (const key of modifiers) await app.page.keyboard.up(key);
}

function layerButton(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true });
}

/** Expands the Layers tree until `name` has a row; the tree can still be filling in when first expanded. */
async function revealLayer(page: Page, name: string) {
  await expect
    .poll(async () => {
      await expandAllLayers(page);
      return layerButton(page, name).count();
    })
    .toBeGreaterThan(0);
}

/** Computed values of a saved inline style, so shorthand and longhand writes compare equal. */
async function savedStyle(page: Page, node: SavedNode | undefined) {
  return page.evaluate((css) => {
    const probe = document.createElement("div");
    probe.setAttribute("style", css);
    return {
      display: probe.style.display,
      rowGap: probe.style.rowGap,
      columnGap: probe.style.columnGap,
    };
  }, node?.attrs.style ?? "");
}

test("Shift+A wraps four selected nav links into a horizontal auto-layout frame inside Navbar without moving them", async ({
  app,
}) => {
  const id = await openLandingPage(app);
  await clickDesign(app, 640, 40);
  await clickDesign(app, 760, 40, ["Shift"]);
  await clickDesign(app, 880, 40, ["Shift"]);
  await clickDesign(app, 1000, 40, ["Shift"]);
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["About link", "Contact link", "Home link", "Services link"]);
  const before = await app.savedNodes(id);
  const links = ["link-home", "link-about", "link-services", "link-contact"];

  await app.page.keyboard.press("Shift+A");

  await expect
    .poll(async () => (await app.savedNodes(id)).get("link-home")?.parent)
    .not.toBe("navbar");
  await app.settled();
  const after = await app.savedNodes(id);
  const wrapper = after.get("link-home")!.parent!;
  expect(after.get(wrapper)?.parent, "the new frame sits inside Navbar").toBe(
    "navbar",
  );
  expect(
    childrenOf(after, wrapper),
    "links keep their left-to-right order",
  ).toEqual(links);
  expect(childrenOf(after, "navbar")).toEqual(["brand", wrapper]);
  expectOnlyChanged(before, after, [...links, wrapper]);
  await expect(app.node(wrapper)).toHaveCSS("display", "flex");
  await expect(app.node(wrapper)).toHaveCSS("flex-direction", "row");
  await expect(
    app.node(wrapper),
    "the even 40px spacing becomes the gap",
  ).toHaveCSS("column-gap", "40px");
  for (const [index, link] of links.entries()) {
    expect(await app.designRect(link), `${link} did not move`).toEqual({
      x: 600 + index * 120,
      y: 28,
      width: 80,
      height: 24,
    });
  }
});

test("Cmd+G groups two layers selected in the Layers panel and one Cmd+Z restores the ungrouped document", async ({
  app,
}) => {
  const id = await openLandingPage(app);
  await revealLayer(app.page, "Home link");
  await layerButton(app.page, "Brand").click();
  await layerButton(app.page, "Home link").click({ modifiers: [MOD] });
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["Brand", "Home link"]);
  const before = await app.savedNodes(id);

  await app.page.keyboard.press(`${MOD}+g`);
  await expect
    .poll(async () => (await app.savedNodes(id)).get("brand")?.parent)
    .not.toBe("navbar");
  await app.settled();
  const grouped = await app.savedNodes(id);
  const group = grouped.get("brand")!.parent!;
  expect(childrenOf(grouped, group)).toEqual(["brand", "link-home"]);
  expect(grouped.get(group)?.parent).toBe("navbar");
  await expect.poll(() => app.selectedLayers()).toEqual(["Group"]);

  await app.page.keyboard.press(`${MOD}+z`);
  await app.settled();
  const undone = await app.savedNodes(id);
  expect(undone.has(group), "one undo removes the group").toBe(false);
  expectOnlyChanged(before, undone, []);
  expect(childrenOf(undone, "navbar")).toEqual(childrenOf(before, "navbar"));
});

test("Cmd+D on a screen creates an independent sibling screen: deleting a layer in the copy leaves the original untouched", async ({
  app,
}) => {
  const page = app.page;
  const id = await openLandingPage(app);
  const record = async () =>
    ((
      await (
        await page.request.get(
          appPath(`/_agent-native/actions/get-design?id=${id}`),
        )
      ).json()
    ).files ?? []) as {
      id: string;
      filename: string;
    }[];
  const filesBefore = await record();
  const original = await app.savedNodes(id);
  await page.locator("[data-frame-label]").first().click();
  await expect(page.locator("[data-frame-drag-surface]")).toBeVisible();

  await page.keyboard.press(`${MOD}+d`);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await expect
    .poll(async () => (await record()).length)
    .toBe(filesBefore.length + 1);
  await app.settled();
  const copyFile = (await record()).find(
    (file) => !filesBefore.some((before) => before.id === file.id),
  )!;
  const shape = (nodes: Nodes) =>
    [...nodes.values()].map((node) => [
      node.tag,
      node.attrs["data-agent-native-layer-name"] ?? "",
      node.text,
    ]);
  const copyBefore = await app.savedNodes(id, copyFile.filename);
  expect(shape(copyBefore), "the copy has the same layers and text").toEqual(
    shape(original),
  );
  const copyCards = [...copyBefore.values()]
    .filter((node) => node.attrs["data-agent-native-layer-name"] === "Card")
    .map((node) => node.id);
  expect(copyCards, "precondition: the copy has one Card").toHaveLength(1);
  const [copyCard] = copyCards;
  const copyCardOnCanvas = designFrame(page, copyFile.id).locator(
    `[data-agent-native-node-id="${copyCard}"]`,
  );
  await expect(copyCardOnCanvas).toBeVisible();

  await revealLayer(page, "Card");
  const cards = layerButton(page, "Card");
  await expect(cards, "one Card row per screen").toHaveCount(2);
  await cards.first().click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
  await page.keyboard.press("Backspace");
  await expect
    .poll(async () =>
      (await app.savedNodes(id, copyFile.filename)).has(copyCard),
    )
    .toBe(false);
  await app.settled();
  expectOnlyChanged(copyBefore, await app.savedNodes(id, copyFile.filename), [
    copyCard,
  ]);
  expectOnlyChanged(original, await app.savedNodes(id), []);
  await expect(copyCardOnCanvas).toHaveCount(0);
  await expect(
    designFrame(page, filesBefore[0].id).locator(
      '[data-agent-native-node-id="card-1"]',
    ),
  ).toBeVisible();
});

test("dragging a Layers row below a collapsed sibling reorders the saved document and nothing else", async ({
  app,
}) => {
  const page = app.page;
  const id = await openLandingPage(app);
  await revealLayer(page, "CardRow");
  const row = (name: string) =>
    layerButton(page, name).locator('xpath=ancestor::*[@role="treeitem"][1]');
  await row("Hero").getByRole("button", { name: "Collapse layer" }).click();
  await expect(row("Hero")).toHaveAttribute("aria-expanded", "false");
  const before = await app.savedNodes(id);
  expect(childrenOf(before, bodyId(before))).toEqual([
    "navbar",
    "hero",
    "card-row",
  ]);
  const heroBox = (await row("Hero").boundingBox())!;

  await layerButton(page, "CardRow")
    .locator("[data-layer-row-name]")
    .dragTo(row("Hero"), {
      targetPosition: { x: 24, y: heroBox.height - 2 },
    });

  await expect
    .poll(
      async () => childrenOf(await app.savedNodes(id), bodyId(before)),
      "CardRow now sits behind Hero",
    )
    .toEqual(["navbar", "card-row", "hero"]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
  expect(
    await app.designRect("card-row"),
    "an absolute layer keeps its place on the canvas",
  ).toEqual({
    x: 80,
    y: 760,
    width: 1280,
    height: 200,
  });
});

// fixme: product bug: The inspector Gap field clips its value to the first digit: Hero's '64px' shows as '6' (also '4' for 40px, '2' for 24px, '1' for 12px in
test.fixme("typed Gap values on three nested auto-layout frames each persist when the selection moves on right away", async ({
  app,
}) => {
  const page = app.page;
  const id = await openLandingPage(app);
  await revealLayer(page, "HeroCTAGroup");
  const before = await app.savedNodes(id);
  const gap = page
    .getByRole("heading", { name: "Auto layout", exact: true })
    .locator("xpath=ancestor::section")
    .getByRole("textbox", { name: "Gap", exact: true });
  for (const [name, value] of [
    ["HeroCTAGroup", "16"],
    ["HeroCopy", "24"],
    ["Hero", "64"],
  ]) {
    await layerButton(page, name).click();
    await expect.poll(() => app.selectedLayers()).toEqual([name]);
    await gap.fill(value);
    await gap.press("Enter");
  }

  await expect
    .poll(
      async () =>
        (await savedStyle(page, (await app.savedNodes(id)).get("hero")))
          .columnGap,
    )
    .toBe("64px");
  await app.settled();
  const after = await app.savedNodes(id);
  expect({
    heroCta: (await savedStyle(page, after.get("hero-cta"))).columnGap,
    heroCopy: (await savedStyle(page, after.get("hero-copy"))).rowGap,
    hero: (await savedStyle(page, after.get("hero"))).columnGap,
  }).toEqual({ heroCta: "16px", heroCopy: "24px", hero: "64px" });
  expectOnlyChanged(before, after, ["hero-cta", "hero-copy", "hero"]);
  await expect(
    gap,
    "Hero is still selected and its Gap field reads 64px",
  ).toHaveValue("64px");
  expect(
    await gap.evaluate(
      (input: HTMLInputElement) => input.scrollWidth <= input.clientWidth,
    ),
    "the typed value fits in the Gap field instead of being clipped to its first digit",
  ).toBe(true);
  const primary = await app.designRect("primary-button");
  const secondary = await app.designRect("secondary-button");
  expect(secondary.x - (primary.x + primary.width), "rendered CTA gap").toBe(
    16,
  );
  expect(
    (await app.designRect("hero-image")).x,
    "80px padding + 600px copy + 64px gap",
  ).toBe(744);
});

test("gap mode Auto spreads Hero's children to its padding edges and saves space-between", async ({
  app,
}) => {
  const page = app.page;
  const id = await openLandingPage(app);
  await revealLayer(page, "Hero");
  await layerButton(page, "Hero").click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Hero"]);
  const before = await app.savedNodes(id);

  await page.locator('button[aria-label^="Gap mode"]').first().click();
  await page.getByRole("menuitemcheckbox", { name: "Auto" }).click();

  const justify = async () =>
    page.evaluate(
      (css) => {
        const probe = document.createElement("div");
        probe.setAttribute("style", css);
        return probe.style.justifyContent;
      },
      (await app.savedNodes(id)).get("hero")?.attrs.style ?? "",
    );
  await expect.poll(justify).toBe("space-between");
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), ["hero"]);
  expect(
    (await app.designRect("hero-copy")).x,
    "first child at the left padding",
  ).toBe(80);
  expect(
    (await app.designRect("hero-image")).x,
    "last child flush with the right padding",
  ).toBe(800);
});
