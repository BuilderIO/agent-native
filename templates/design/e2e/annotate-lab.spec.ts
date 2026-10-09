import { expect, test, type Page } from "@playwright/test";

import { ANNOTATE_LAB } from "../shared/labs";
import { appPath, enableLab, gotoEditor, readSeedDesignId } from "./helpers";

test.use({ viewport: { width: 1440, height: 1000 } });

const MODES = "[data-design-top-bar] [data-design-mode]";

function mode(page: Page, name: "annotate" | "edit" | "interact") {
  return page.locator(`[data-design-top-bar] [data-design-mode="${name}"]`);
}

async function agentContext(page: Page) {
  const response = await page.request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as { mode?: string; activeTool?: string };
}

test.describe("Annotate lab off (the default)", () => {
  // oracle: none — verifies which controls and states exist behind the Annotate lab, not parity with a design reference.
  test("offers no Annotate mode, Draw item, Draw shortcut row or overlay", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());

    await expect(page.locator(MODES)).toHaveText(["Interact", "Design"]);
    const toolbar = page.locator("[data-design-bottom-toolbar]");
    await expect(toolbar.getByRole("button", { name: "Pen" })).toBeVisible();
    // A single-item Pen has no chevron, so Draw has nowhere to hide either.
    await expect(
      toolbar.getByRole("button", { name: "Pen options" }),
    ).toHaveCount(0);
    await expect(page.locator("[data-draw-overlay]:visible")).toHaveCount(0);

    await page.keyboard.press("Control+Shift+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-shortcut-id="pen-tool"]')).toBeVisible();
    await expect(dialog.locator('[data-shortcut-id="draw-tool"]')).toHaveCount(
      0,
    );
  });

  // oracle: none — verifies which controls and states exist behind the Annotate lab, not parity with a design reference.
  test("Shift+Y leaves the editor on Move and Design", async ({ page }) => {
    await gotoEditor(page, await readSeedDesignId());

    await page.keyboard.press("Shift+Y");

    await expect(mode(page, "edit")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-draw-overlay]:visible")).toHaveCount(0);
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "edit", activeTool: "move" });
  });

  // oracle: none — verifies which controls and states exist behind the Annotate lab, not parity with a design reference.
  test("a Draw URL left from when the lab was on lands on Move and Design, in the UI and for the agent", async ({
    page,
  }) => {
    const designId = await readSeedDesignId();
    // Draw while the lab is on, so the URL carries ?tool=draw, then turn the lab off.
    const restoreLab = await enableLab(page, ANNOTATE_LAB.key);
    try {
      await gotoEditor(page, designId);
      await page.keyboard.press("Shift+Y");
      await expect(mode(page, "annotate")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      await restoreLab();
    }

    await page.goto(appPath(`/design/${designId}?tool=draw`), {
      waitUntil: "domcontentloaded",
    });
    await expect(mode(page, "edit")).toHaveAttribute("aria-pressed", "true");

    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-draw-overlay]:visible")).toHaveCount(0);
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "edit", activeTool: "move" });
  });
});

test.describe("Annotate lab on", () => {
  let restoreLab: (() => Promise<void>) | undefined;

  test.beforeEach(async ({ page }) => {
    restoreLab = await enableLab(page, ANNOTATE_LAB.key);
  });

  test.afterEach(async () => {
    await restoreLab?.();
    restoreLab = undefined;
  });

  // oracle: none — verifies which controls and states exist behind the Annotate lab, not parity with a design reference.
  test("offers Annotate, Draw and the drawing overlay", async ({ page }) => {
    await gotoEditor(page, await readSeedDesignId());

    await expect(page.locator(MODES)).toHaveText([
      "Interact",
      "Design",
      "Annotate",
    ]);
    const toolbar = page.locator("[data-design-bottom-toolbar]");
    await toolbar.getByRole("button", { name: "Pen options" }).click();
    await expect(page.getByRole("menuitem", { name: /Draw/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await mode(page, "annotate").click();
    await expect(mode(page, "annotate")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-draw-overlay]")).toBeVisible();
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "annotate", activeTool: "draw" });
  });

  // A reload with ?tool=draw is applied before the Labs answer arrives; it must
  // wait for it rather than treat the lab as off.
  // oracle: none — verifies which controls and states exist behind the Annotate lab, not parity with a design reference.
  test("Shift+Y starts Draw and a reload on ?tool=draw keeps it", async ({
    page,
  }) => {
    const designId = await readSeedDesignId();
    await gotoEditor(page, designId);
    await page.keyboard.press("Shift+Y");
    await expect(mode(page, "annotate")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-draw-overlay]")).toBeVisible();

    await page.goto(appPath(`/design/${designId}?tool=draw`), {
      waitUntil: "domcontentloaded",
    });
    await expect(mode(page, "annotate")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 30_000 },
    );
    await expect(page.locator("[data-draw-overlay]")).toBeVisible();

    await page.keyboard.press("Control+Shift+/");
    await expect(
      page
        .getByRole("dialog", { name: "Keyboard shortcuts" })
        .locator('[data-shortcut-id="draw-tool"]'),
    ).toBeVisible();
  });
});
