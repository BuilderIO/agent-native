import { type Page } from "@playwright/test";

import {
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Rotation direction</title></head>
  <body style="margin:0">
    <main data-agent-native-node-id="rotation-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="rotation-asymmetric" data-agent-native-layer-name="Asymmetric marker" style="position:absolute;left:120px;top:120px;width:140px;height:60px;background:#d94645;transform:translateX(12px) scale(1.2) rotate(0deg);transform-origin:top left">
        <span data-agent-native-node-id="rotation-marker" data-agent-native-layer-name="Corner marker" style="position:absolute;left:0;top:0;width:12px;height:12px;background:#2563eb"></span>
      </div>
      <div data-agent-native-node-id="rotation-first" data-agent-native-layer-name="First angle" style="position:absolute;left:340px;top:120px;width:100px;height:44px;background:#16a34a;transform:translateX(10px) rotate(-10deg) scale(2)"></div>
      <div data-agent-native-node-id="rotation-second" data-agent-native-layer-name="Second angle" style="position:absolute;left:540px;top:120px;width:100px;height:44px;background:#9333ea;transform:translateY(20px) rotate(-30deg) scale(0.5)"></div>
    </main>
  </body>
</html>`;

async function selectLayer(page: Page, name: string): Promise<void> {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .first();
  await expect(row).toBeVisible();
  await row.click();
}

async function readCssRotation(page: Page, nodeId: string): Promise<number> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
    });
}

async function openRotation(app: App) {
  const id = await app.seed(FIXTURE, { title: "Rotation direction" });
  await gotoEditor(app.page, id);
  await enterDirectMode(app.page);
  await expandAllLayers(app.page);
  await app.settled();
  return id;
}

async function selectBothAngles(app: App) {
  const tree = app.page.getByRole("tree", { name: "Layers" });
  await tree.getByRole("button", { name: "First angle", exact: true }).click();
  await tree
    .getByRole("button", { name: "Second angle", exact: true })
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["First angle", "Second angle"]);
}

/** The multi-selection box must enclose every selected layer's rendered (rotated, scaled) bounds. */
async function expectSelectionEnclosesBothAngles(app: App) {
  await expect
    .poll(
      () =>
        designFrame(app.page)
          .locator("body")
          .evaluate(() => {
            const rect = (id: string) =>
              document
                .querySelector(`[data-agent-native-node-id="${id}"]`)!
                .getBoundingClientRect();
            const a = rect("rotation-first");
            const b = rect("rotation-second");
            const box = document
              .querySelector("[data-agent-native-multi-selection-bounds]")
              ?.getBoundingClientRect();
            if (!box) return "no multi-selection box";
            const union = {
              left: Math.min(a.left, b.left),
              top: Math.min(a.top, b.top),
              right: Math.max(a.right, b.right),
              bottom: Math.max(a.bottom, b.bottom),
            };
            return box.left <= union.left + 2 &&
              box.top <= union.top + 2 &&
              box.right >= union.right - 2 &&
              box.bottom >= union.bottom - 2
              ? "encloses"
              : `box ${JSON.stringify({ l: box.left, t: box.top, r: box.right, b: box.bottom })} vs layers ${JSON.stringify(union)}`;
          }),
      { message: "the multi-selection box encloses both rotated layers" },
    )
    .toBe("encloses");
}

test("positive inspector rotation turns counter-clockwise and survives reload", async ({
  app,
  page,
}) => {
  const id = await openRotation(app);
  await selectLayer(page, "Asymmetric marker");
  await expect.poll(() => app.selectedLayers()).toEqual(["Asymmetric marker"]);
  const before = await app.savedNodes(id);
  const rotation = page.locator('input[aria-label="Rotation" i]');
  await rotation.fill("45");
  await rotation.press("Enter");

  await expect
    .poll(() => readCssRotation(page, "rotation-asymmetric"))
    .toBe(-45);
  await expect
    .poll(
      async () =>
        styleOf((await app.savedNodes(id)).get("rotation-asymmetric"))
          .transform,
    )
    .toBe("translateX(12px) scale(1.2) rotate(-45deg)");
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), ["rotation-asymmetric"]);
  await expect(
    designFrame(page).locator('[data-agent-native-node-id="rotation-marker"]'),
  ).toBeVisible();

  await page.reload();
  await gotoEditor(page, id);
  await enterDirectMode(page);
  await expandAllLayers(page);
  await selectLayer(page, "Asymmetric marker");
  await expect(page.locator('input[aria-label="Rotation" i]')).toHaveValue(
    "45deg",
  );
  await expect
    .poll(() => readCssRotation(page, "rotation-asymmetric"))
    .toBe(-45);
});

test("relative rotation math uses degree values for each selected layer", async ({
  app,
  page,
}) => {
  const id = await openRotation(app);
  await selectBothAngles(app);
  const before = await app.savedNodes(id);
  const rotation = page.locator('input[aria-label="Rotation" i]');
  await expect(rotation).toHaveValue("Mixed");
  await rotation.fill("Mixed+15");
  await rotation.press("Enter");

  await expect.poll(() => readCssRotation(page, "rotation-first")).toBe(-25);
  await expect.poll(() => readCssRotation(page, "rotation-second")).toBe(-45);
  await expect
    .poll(async () => {
      const saved = await app.savedNodes(id);
      return [
        styleOf(saved.get("rotation-first")).transform,
        styleOf(saved.get("rotation-second")).transform,
      ];
    })
    .toEqual([
      "translateX(10px) rotate(-25deg) scale(2)",
      "translateY(20px) rotate(-45deg) scale(0.5)",
    ]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), [
    "rotation-first",
    "rotation-second",
  ]);
  await expect(rotation, "the two layers now differ").toHaveValue("Mixed");
  await expectSelectionEnclosesBothAngles(app);
});

// fixme: product bug: After both layers are saved at rotate(-45deg) the Rotation field keeps showing 'Mixed' (15s); the selection box also shows a 51x51 badge
test.fixme("absolute rotation preserves each selected layer's translation and scale", async ({
  app,
  page,
}) => {
  const id = await openRotation(app);
  await selectBothAngles(app);
  const before = await app.savedNodes(id);
  const rotation = page.locator('input[aria-label="Rotation" i]');
  await expect(rotation).toHaveValue("Mixed");
  await rotation.fill("45");
  await rotation.press("Enter");

  await expect
    .poll(async () => {
      const saved = await app.savedNodes(id);
      return [
        styleOf(saved.get("rotation-first")).transform,
        styleOf(saved.get("rotation-second")).transform,
      ];
    })
    .toEqual([
      "translateX(10px) rotate(-45deg) scale(2)",
      "translateY(20px) rotate(-45deg) scale(0.5)",
    ]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), [
    "rotation-first",
    "rotation-second",
  ]);
  await expect(rotation, "both layers now share 45deg").toHaveValue("45deg");
  await expectSelectionEnclosesBothAngles(app);
});
