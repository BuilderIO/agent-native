import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, webkit, type Locator, type Page } from "playwright";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const output = repo + ".tmp/design-system-proof";
const base = process.argv[2] ?? "http://127.0.0.1:6006";
const stories = {
  compact: "patterns-inspector--design-frame",
  auto: "patterns-inspector--auto-layout",
  fill: "patterns-paint-editor--fill",
  themed: "patterns-themed-inspector--two-applications",
  tree: "patterns-layer-tree--large-document",
} as const;
async function open(page: Page, name: keyof typeof stories) {
  const url = new URL("/iframe.html", base);
  url.search = new URLSearchParams({
    id: stories[name],
    viewMode: "story",
    globals: "theme:design;appearance:light",
  }).toString();
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page
    .locator(name === "tree" ? '[role="tree"]' : "aside.inspector")
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard Tab did not reach " + target);
}
async function focused(target: Locator) {
  await target
    .page()
    .waitForFunction(
      (el) => el === document.activeElement,
      await target.elementHandle(),
    );
}

async function overlays(page: Page) {
  await open(page, "themed");
  const region = page.getByTestId("library");
  const trigger = region.getByRole("button", { name: "Frame settings" });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const popup = region.getByRole("dialog", { name: "Frame settings" });
  const anchor = popup.getByRole("button", { name: "Aspect ratio" });
  await focused(anchor);
  await page.keyboard.press("Enter");
  const ratio = region.getByRole("combobox", { name: "Frame ratio" });
  await focused(ratio);
  await page.keyboard.press("ArrowDown");
  const square = region.getByRole("option", { name: "Square", exact: true });
  await square.waitFor();
  await page.keyboard.press("Home");
  await focused(square);
  await page.keyboard.press("Enter");
  await focused(ratio);
  await page.keyboard.press("Escape");
  await focused(anchor);
  await page.keyboard.press("Escape");
  await focused(trigger);
  assert.equal(
    await region.getByLabel("Height", { exact: true }).inputValue(),
    "320",
  );
  assert.equal(
    await page
      .getByTestId("design")
      .getByLabel("Height", { exact: true })
      .inputValue(),
    "240",
  );
}

async function treeKeyboard(page: Page) {
  await open(page, "tree");
  const tree = page.getByRole("tree", { name: "Document layers" });
  const first = tree.getByRole("treeitem", { name: "Section 1", exact: true });
  await tabTo(page, first);
  assert.equal(await first.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Shift+End");
  const last = tree
    .getByRole("treeitem", { name: "Layer 99", exact: true })
    .last();
  await focused(last);
  assert.equal(await last.getAttribute("aria-posinset"), "99");
  assert.equal(await last.getAttribute("aria-level"), "2");
  assert.equal(await last.getAttribute("aria-selected"), "true");
  assert.match(
    await tree.ariaSnapshot(),
    /treeitem "Layer 99"[^\n]*\[selected\]/,
  );
  await page.keyboard.press("Space");
  await page.keyboard.press("F2");
  const name = tree.getByRole("textbox", { name: "Rename Layer 99" });
  await focused(name);
  await page.keyboard.type("Discard");
  await page.keyboard.press("Escape");
  await focused(last);
  if (
    await page.evaluate(() => matchMedia("(forced-colors: active)").matches)
  ) {
    const colors = await last.evaluate((el) => ({
      selected: getComputedStyle(el).backgroundColor,
      canvas: getComputedStyle(el.closest("[role=tree]") ?? el).backgroundColor,
    }));
    assert.notEqual(
      colors.selected,
      colors.canvas,
      "Selected layers remain visible in forced colors",
    );
  }
}

async function matrix(page: Page) {
  await open(page, "auto");
  const matrix = page.getByRole("radiogroup", { name: "Frame alignment" });
  const chosen = matrix.getByRole("radio", { checked: true });
  await tabTo(page, chosen);
  const label = await chosen.getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await chosen.getAttribute("aria-label"), label);
  await focused(chosen);
}
async function forcedPaint(page: Page) {
  await open(page, "fill");
  const trigger = page.getByRole("button", { name: "Edit Linear gradient 1" });
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  const stop = page.getByRole("slider", { name: "Stop 2", exact: true });
  await tabTo(page, stop);
  const value = await stop.getAttribute("aria-valuenow");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await stop.getAttribute("aria-valuenow"), value);
  const track = page.locator(".paint-editor-gradient");
  assert.match(
    await track.evaluate((el) => getComputedStyle(el).backgroundImage),
    /linear-gradient/,
  );
  const cover = page.getByRole("img", { name: "Cover fill preview" });
  assert.match(
    await cover.evaluate((el) => getComputedStyle(el).backgroundImage),
    /linear-gradient/,
  );
  await screenshot(page, "forced-fill");
  await page.keyboard.press("Escape");
  await focused(trigger);
}

async function forcedCheckbox(page: Page) {
  const url = new URL("/iframe.html", base);
  url.search = "?id=components-checkbox--states&viewMode=story";
  await page.goto(url.href);
  const checkbox = (name: string) =>
    page.getByRole("checkbox", { name, exact: true });
  const edge = (name: string) =>
    checkbox(name).evaluate((el) => getComputedStyle(el).borderColor);
  assert.notEqual(await edge("Disabled"), await edge("On"));
  assert.equal(
    await checkbox("Invalid").evaluate(
      (el) => getComputedStyle(el).borderStyle,
    ),
    "dashed",
  );
  for (const name of ["On", "Indeterminate", "Disabled"]) {
    const visible = await checkbox(name).evaluate((el) => {
      const mark = el.querySelector("svg");
      return (
        mark &&
        getComputedStyle(mark).stroke !== getComputedStyle(el).backgroundColor
      );
    });
    assert.ok(
      visible,
      name + " checkbox mark remains visible in forced colors",
    );
  }
}

async function forcedSwitch(page: Page) {
  for (const story of ["variants", "disabled"]) {
    const url = new URL("/iframe.html", base);
    url.search = new URLSearchParams({
      id: "components-switch--" + story,
      viewMode: "story",
    }).toString();
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    const switches = page.getByRole("switch");
    await switches.first().waitFor();
    const palette = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.forcedColorAdjust = "none";
      document.body.append(probe);
      const resolve = (color: string) => {
        probe.style.backgroundColor = color;
        return getComputedStyle(probe).backgroundColor;
      };
      const result = {
        off: resolve("ButtonText"),
        on: resolve("HighlightText"),
        disabled: resolve("GrayText"),
      };
      probe.remove();
      return result;
    });
    for (const direction of ["ltr", "rtl"]) {
      await page.locator("[data-storybook-stage]").evaluate((element, dir) => {
        element.setAttribute("dir", dir);
      }, direction);
      const styles = await switches.evaluateAll((items) =>
        items.map((item) => {
          const thumb = item.querySelector(".switch-thumb");
          if (!thumb) throw new Error("Switch has no thumb");
          const trackBox = item.getBoundingClientRect(),
            thumbBox = thumb.getBoundingClientRect();
          const track = getComputedStyle(item);
          return {
            checked: item.getAttribute("aria-checked") === "true",
            border: parseFloat(track.borderInlineStartWidth),
            track: track.backgroundColor,
            thumb: getComputedStyle(thumb).backgroundColor,
            thumbOnRight:
              thumbBox.x + thumbBox.width / 2 > trackBox.x + trackBox.width / 2,
          };
        }),
      );
      for (const state of styles) {
        assert.ok(
          state.border > 0,
          "Switch track remains outlined in forced colors",
        );
        assert.notEqual(
          state.track,
          state.thumb,
          "Switch thumb remains visible in forced colors",
        );
        assert.equal(
          state.thumb,
          story === "disabled"
            ? palette.disabled
            : state.checked
              ? palette.on
              : palette.off,
        );
        assert.equal(
          state.thumbOnRight,
          direction === "ltr" ? state.checked : !state.checked,
        );
      }
    }
    if (story === "variants") {
      const first = switches.first();
      await tabTo(page, first);
      assert.equal(
        await first.evaluate((el) => getComputedStyle(el).outlineStyle),
        "solid",
      );
      await page.keyboard.press("Space");
      assert.equal(await first.getAttribute("aria-checked"), "true");
    }
  }
}

async function dockRoundTrip(page: Page, touch: boolean) {
  await page.goto(
    new URL(
      "/iframe.html?id=patterns-dock-workspace--playground&viewMode=story",
      base,
    ).href,
  );
  const workspace = page.getByRole("region", { name: "Workspace panels" });
  const assets = workspace.getByRole("tab", { name: "Assets", exact: true });
  await assets.click();
  const draft = workspace.getByRole("textbox", { name: "Filter assets" });
  await draft.fill("Icon studies");

  async function move(
    target: "Layers" | "Inspector",
    placement: "before" | "after",
    grip: "label" | "upper shelf" | "lower shelf",
    steps: number,
  ) {
    const from = await assets.boundingBox();
    const to = await workspace
      .getByRole("tab", { name: target, exact: true })
      .boundingBox();
    assert.ok(from && to);
    const y =
      grip === "upper shelf"
        ? from.y - 2
        : grip === "lower shelf"
          ? from.y + from.height + 2
          : from.y + from.height / 2;
    await page.mouse.move(from.x + from.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(
      to.x + (placement === "before" ? 2 : to.width - 2),
      y,
      { steps },
    );
    await page.mouse.up();
    const tabs =
      placement === "before" ? "Assets, " + target : target + ", Assets";
    const group = workspace.getByRole("tablist", { name: tabs, exact: true });
    await group.getByRole("tab", { name: "Assets", selected: true }).waitFor();
    assert.equal(await draft.inputValue(), "Icon studies");
  }

  await move("Inspector", "after", "label", 12);
  await move("Layers", "before", "upper shelf", 1);
  await move("Inspector", "before", "label", 1);
  await move("Layers", "after", "lower shelf", 12);
  await move("Layers", "before", "lower shelf", 1);
  await move("Layers", "after", "upper shelf", 12);

  if (touch) {
    await move("Inspector", "after", "label", 1);
    await workspace.getByRole("separator").press("Home");
    const rail = workspace.getByRole("tablist", { name: "Inspector, Assets" });
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    try {
      async function swipe(returnToLayers: boolean) {
        await assets.evaluate((el) =>
          el.scrollIntoView({ inline: "end", block: "nearest" }),
        );
        const start = await rail.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return {
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
            scroll: el.scrollLeft,
            width: box.width,
          };
        });
        assert.ok(start.scroll > 0, "Assets must begin on a scrolled tab rail");
        const layers = await workspace
          .getByRole("tab", { name: "Layers", exact: true })
          .boundingBox();
        assert.ok(layers);
        const endX = returnToLayers
          ? layers.x + layers.width - 2
          : start.x + start.width / 3;
        for (let i = 0; i <= 15; i++) {
          await session.send("Input.dispatchTouchEvent", {
            type: i === 0 ? "touchStart" : "touchMove",
            touchPoints: [
              {
                x: start.x + ((endX - start.x) * i) / 15,
                y: start.y,
                radiusX: 2,
                radiusY: 2,
              },
            ],
          });
        }
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        if (!returnToLayers) {
          assert.ok(
            (await rail.evaluate((el) => el.scrollLeft)) < start.scroll,
            "A swipe inside the rail must scroll the tab strip",
          );
          assert.equal(
            await rail
              .getByRole("tab", { name: "Assets", selected: true })
              .count(),
            1,
          );
        }
      }
      await swipe(false);
      await swipe(true);
      await workspace
        .getByRole("tablist", { name: "Layers, Assets" })
        .getByRole("tab", { name: "Assets", selected: true })
        .waitFor();
      assert.equal(await draft.inputValue(), "Icon studies");
    } finally {
      await session.send("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
      await session.detach();
    }
  }
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: output + "/" + name + ".png",
    animations: "disabled",
  });
}
execFileSync(process.execPath, ["prototypes/kit/build.ts", "design"], {
  cwd: repo,
  timeout: 30000,
});
await mkdir(output, { recursive: true });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(8000);
    await dockRoundTrip(page, engine === chromium);
    await overlays(page);
    await treeKeyboard(page);
    await matrix(page);
    if (engine === chromium) {
      for (const state of ["compact", "auto", "fill", "themed"] as const) {
        await open(page, state);
        await screenshot(page, state);
      }
      await page.emulateMedia({ forcedColors: "active" });
      await treeKeyboard(page);
      await screenshot(page, "forced-layers");
      await matrix(page);
      await screenshot(page, "forced-layout");
      const widget = page.getByRole("radiogroup", { name: "Frame alignment" });
      const mark = widget
        .getByRole("radio", { checked: true })
        .locator(".alignment-picker-mark")
        .first();
      const ink = await mark.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      const surface = await widget.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      assert.notEqual(ink, "rgba(0, 0, 0, 0)");
      assert.notEqual(
        ink,
        surface,
        "Alignment glyphs remain visible in forced colors",
      );
      await forcedPaint(page);
      await forcedCheckbox(page);
      await forcedSwitch(page);
      await overlays(page);
    }
    const zoom = await browser.newPage({
      viewport: { width: 640, height: 450 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    zoom.setDefaultTimeout(8000);
    for (const state of ["compact", "auto", "fill", "themed"] as const) {
      await open(zoom, state);
      assert.ok(
        await zoom.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Horizontal overflow at 200% equivalent zoom in " + state,
      );
    }
    await overlays(zoom);
    await matrix(zoom);
    console.log(
      engine.name() +
        ": keyboard overlays, focus return, tree, alignment and 200% equivalent reflow passed",
    );
    if (engine === chromium) {
      await page.emulateMedia({ forcedColors: "none" });
      await open(page, "compact");
      const panel = page.getByRole("complementary", {
        name: "Frame properties",
      });
      const rect = await panel.boundingBox(),
        field = await panel
          .getByLabel("Width", { exact: true })
          .locator("..")
          .boundingBox();
      assert.ok(rect && field);
      const sectionHeights = await panel
        .locator("section")
        .evaluateAll((nodes) =>
          nodes
            .map((n) => [
              n.querySelector("h3")?.textContent,
              n.getBoundingClientRect().height,
            ])
            .filter(([name]) => name),
        );
      await page.goto(
        pathToFileURL(repo + "prototypes/design/dist/index.html").href,
      );
      await page.evaluate(
        'S.mode="design"; S.selected="nav"; S.screenSel=false; render()',
      );
      const reference = page.locator("#insp");
      await reference.screenshot({ path: output + "/prototype-nav.png" });
      const refRect = await reference.boundingBox();
      const refField = await reference
        .locator('[data-insp-sec="layout"] .inp')
        .first()
        .boundingBox();
      assert.ok(refRect && refField);
      const referenceHeights = await reference
        .locator("[data-insp-sec]")
        .evaluateAll((nodes) =>
          nodes.map((n) => [
            n.querySelector("h3")?.textContent,
            n.getBoundingClientRect().height,
          ]),
        );
      for (const name of ["Position", "Layout", "Appearance", "Fill"]) {
        const expected = referenceHeights.find(([label]) => label === name);
        assert.ok(expected, "Missing reference section " + name);
        assert.deepEqual(
          sectionHeights.find(([label]) => label === name),
          expected,
        );
      }
      assert.equal(rect.width, refRect.width);
      assert.equal(field.height, refField.height);
      assert.ok(Math.abs(field.width - refField.width) <= 1);
      console.log(
        JSON.stringify({
          panelWidth: [refRect.width, rect.width],
          field: [refField, field],
          referenceHeights,
          sectionHeights,
        }),
      );
    }
  } finally {
    await browser.close();
  }
}
