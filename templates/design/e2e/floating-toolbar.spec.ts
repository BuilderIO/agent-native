import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  gotoEditor,
  readSeedDesignId,
  resetPersistedCanvasState,
  selectTool,
} from "./helpers";

test.use({ viewport: { width: 1440, height: 1000 } });

const TOOLBAR = "[data-design-bottom-toolbar]";

function toolbarGroups(page: Page) {
  return page
    .locator(`${TOOLBAR} [data-design-toolbar-group]`)
    .evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("data-design-toolbar-group")),
    );
}

async function menuOptions(page: Page, group: string) {
  await page
    .locator(TOOLBAR)
    .getByRole("button", { name: `${group} options`, exact: true })
    .click();
  const keys = await page
    .getByRole("menuitem")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-option")),
    );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  return keys;
}

async function agentContext(page: Page) {
  const response = await page.request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as { mode?: string; activeTool?: string };
}

test.describe("floating toolbar", () => {
  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("offers Move, Frame, Shapes, Text, Pen and Comment, each with the menu it needs, and no Agent", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());

    expect(await toolbarGroups(page)).toEqual([
      "move",
      "frame",
      "shapes",
      "text",
      "pen",
      "comment",
    ]);
    await expect(
      page.locator(TOOLBAR).getByRole("button", { name: /agent/i }),
    ).toHaveCount(0);
    expect(await menuOptions(page, "Move")).toEqual(["move", "hand", "scale"]);
    expect(await menuOptions(page, "Frame")).toEqual(["frame", "screen"]);
    expect(await menuOptions(page, "Shapes")).toEqual([
      "rect",
      "line",
      "arrow",
      "ellipse",
      "polygon",
      "star",
      "image-video",
    ]);
    // Text, Pen (with the Annotate lab off) and Comment are one item each, so
    // they are plain buttons with no menu to open.
    for (const group of ["Text", "Pen", "Comment"]) {
      await expect(
        page.locator(TOOLBAR).getByRole("button", { name: `${group} options` }),
      ).toHaveCount(0);
    }
    for (const name of ["Text", "Pen", "Pin comment"]) {
      await expect(
        page.locator(TOOLBAR).getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("Text is a button of its own and follows the tool", async ({ page }) => {
    await gotoEditor(page, await readSeedDesignId());
    const toolbar = page.locator(TOOLBAR);

    await selectTool(page, "Text");

    const text = toolbar.getByRole("button", { name: "Text", exact: true });
    await expect(text).toHaveAttribute("aria-pressed", "true");
    await expect(
      toolbar.getByRole("button", { name: "Move", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");

    await selectTool(page, "Move");
    await expect(text).toHaveAttribute("aria-pressed", "false");
    await text.click();
    await expect(text).toHaveAttribute("aria-pressed", "true");
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("the Shapes button shows the tool in use, and keeps the last one unarmed when the pointer is back on Move", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());
    const toolbar = page.locator(TOOLBAR);
    const shapes = toolbar.locator('[data-design-toolbar-group="shapes"]');
    const shapesButton = shapes.locator("button").first();
    const move = toolbar.getByRole("button", { name: "Move", exact: true });
    await expect(shapesButton).toHaveAttribute("aria-label", "Rectangle");
    await expect(shapesButton).toHaveAttribute("aria-pressed", "false");

    // Hotkeys change the tool under the toolbar, and it follows.
    for (const [key, label] of [
      ["r", "Rectangle"],
      ["l", "Line"],
      ["o", "Ellipse"],
    ] as const) {
      await page.keyboard.press(key);
      await expect(shapesButton).toHaveAttribute("aria-label", label);
      await expect(shapesButton).toHaveAttribute("aria-pressed", "true");
      await expect(move).toHaveAttribute("aria-pressed", "false");
    }

    // Back on Move, the group still offers an Ellipse but is not armed.
    await page.keyboard.press("v");
    await expect(move).toHaveAttribute("aria-pressed", "true");
    await expect(shapesButton).toHaveAttribute("aria-label", "Ellipse");
    await expect(shapesButton).toHaveAttribute("aria-pressed", "false");

    // A second click on the button arms that shape again.
    await shapesButton.click();
    await expect(shapesButton).toHaveAttribute("aria-pressed", "true");
    await expect(move).toHaveAttribute("aria-pressed", "false");

    // Frame is its own group: arming it leaves Shapes unarmed.
    await selectTool(page, "Screen");
    const frameButton = toolbar
      .locator('[data-design-toolbar-group="frame"] button')
      .first();
    await expect(frameButton).toHaveAttribute("aria-label", "Screen");
    await expect(frameButton).toHaveAttribute("aria-pressed", "true");
    await expect(shapesButton).toHaveAttribute("aria-pressed", "false");
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("C pins comments and opens the Threads panel, and its rows are in the shortcuts dialog", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());
    const toolbar = page.locator(TOOLBAR);
    const comment = toolbar.getByRole("button", {
      name: "Pin comment",
      exact: true,
    });
    await expect(comment).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-review-comments-panel]")).toHaveCount(0);

    await page.keyboard.press("c");

    await expect(comment).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-review-comments-panel]")).toBeVisible();
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ activeTool: "comment", leftPanel: "threads" });

    await page.keyboard.press("c");
    await expect(comment).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Control+Shift+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    for (const id of [
      "text-tool",
      "rectangle",
      "comment-tool",
      "toggle-comments",
    ]) {
      await expect(dialog.locator(`[data-shortcut-id="${id}"]`)).toBeVisible();
    }
    // Draw is part of the Annotate lab, which is off by default.
    await expect(dialog.locator('[data-shortcut-id="draw-tool"]')).toHaveCount(
      0,
    );
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("Interact has no bottom toolbar, and tool shortcuts arm nothing there", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());
    const interact = page.locator(
      '[data-design-top-bar] [data-design-mode="interact"]',
    );
    await expect(page.locator(TOOLBAR)).toBeVisible();

    await interact.click();

    await expect(interact).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(TOOLBAR)).toHaveCount(0);
    for (const key of ["r", "t", "p", "h", "k", "f"]) {
      await page.keyboard.press(key);
    }
    await expect(interact).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(TOOLBAR)).toHaveCount(0);
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "interact", activeTool: "move" });
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("a stale ?tool=agent link lands on Move", async ({ page }) => {
    const designId = await readSeedDesignId();
    await resetPersistedCanvasState(page);
    await page.goto(appPath(`/design/${designId}?tool=agent`), {
      waitUntil: "domcontentloaded",
    });
    const toolbar = page.locator(TOOLBAR);
    const move = toolbar.getByRole("button", { name: "Move", exact: true });

    await expect(move).toBeVisible({ timeout: 30_000 });

    await expect(move).toHaveAttribute("aria-pressed", "true");
    await expect(toolbar.getByRole("button", { name: /agent/i })).toHaveCount(
      0,
    );
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ activeTool: "move" });
  });
});
