import { expect, test, type Page } from "@playwright/test";

import {
  createFixtureDesign,
  designFrame,
  enterDirectMode,
  gotoEditor,
  installBridge,
  selectByText,
  waitForBridge,
} from "./helpers";

let designId: string;

test.describe.serial("layers menu structure operations", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    designId = await createFixtureDesign(page, `E2E Layers ${testInfo.title}`);
    await gotoEditor(page, designId);
    await openLayerSearch(page, "Button");
  });

  test("selecting rows syncs the canvas and supports additive multi-select", async ({
    page,
  }) => {
    await clickLayerRow(page, "Alpha Button");
    await expect(layerRow(page, "Alpha Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => selectedRowCount(page)).toBe(1);

    await additiveSelectLayerRow(page, "Beta Button");

    await expect.poll(() => selectedRowCount(page)).toBe(2);
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(layerRow(page, "Alpha Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("dragging a sibling row reorders it before its peer", async ({
    page,
  }) => {
    const before = await visibleLayerNames(page);
    expect(before.indexOf("Alpha Button")).toBeGreaterThanOrEqual(0);
    expect(before.indexOf("Beta Button")).toBeGreaterThanOrEqual(0);

    await layerRow(page, "Beta Button").dragTo(layerRow(page, "Alpha Button"), {
      targetPosition: { x: 24, y: 2 },
    });

    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return names.indexOf("Beta Button") < names.indexOf("Alpha Button");
      })
      .toBe(true);

    await clickLayerRow(page, "Alpha Button");
    await expect(layerRow(page, "Alpha Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await layerRow(page, "Alpha Button").dragTo(layerRow(page, "Beta Button"), {
      targetPosition: { x: 24, y: 2 },
    });

    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return names.indexOf("Alpha Button") < names.indexOf("Beta Button");
      })
      .toBe(true);
  });

  test("reparenting into a different parent updates layer grouping", async ({
    page,
  }) => {
    await clickLayerRow(page, "Alpha Button");
    await openLayerSearch(page, "");
    const originalLevel = await rowLevel(page, "Alpha Button");
    await expandLayerRow(page, "Section");
    const sectionLevel = await rowLevel(page, "Section");
    await expect(layerRow(page, "Fixture Card Title")).toBeVisible();

    try {
      await layerRow(page, "Alpha Button").dragTo(layerRow(page, "Section"), {
        targetPosition: { x: 96, y: 16 },
      });

      await expect
        .poll(async () => {
          const names = await visibleLayerNames(page);
          return (
            names.indexOf("Fixture Card Title") <
              names.indexOf("Card body text inside a nested container.") &&
            names.indexOf("Card body text inside a nested container.") <
              names.indexOf("Alpha Button")
          );
        })
        .toBe(true);
      await expect
        .poll(async () => rowLevel(page, "Alpha Button"))
        .toBe(sectionLevel + 1);

      await clickLayerRow(page, "Alpha Button");
      await expect(layerRow(page, "Alpha Button")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      // Put the design back the way the other tests expect: Alpha inside the
      // button container, ahead of Beta.
      try {
        await layerRow(page, "Alpha Button").dragTo(
          layerRow(page, "Beta Button"),
          {
            targetPosition: { x: 96, y: 2 },
          },
        );
        await expect
          .poll(async () => rowLevel(page, "Alpha Button"))
          .toBe(originalLevel);
      } catch {
        // If cleanup fails, the test body already surfaced the useful failure.
      }
    }
  });

  test("dragging onto an empty container reparents inside and persists after reload", async ({
    page,
  }) => {
    await clickLayerRow(page, "Alpha Button");
    await openLayerSearch(page, "");
    const containerLevel = await rowLevel(page, "E2E Token Sample");

    await layerRow(page, "Alpha Button").dragTo(
      layerRow(page, "E2E Token Sample"),
      {
        targetPosition: { x: 96, y: 16 },
      },
    );

    await expect(layerRow(page, "E2E Token Sample")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect
      .poll(async () => rowLevel(page, "Alpha Button"))
      .toBe(containerLevel + 1);
    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return (
          names.indexOf("E2E Token Sample") < names.indexOf("Alpha Button")
        );
      })
      .toBe(true);

    await gotoEditor(page, designId);
    await revealLayerRow(page, "E2E Token Sample");
    const persistedContainerLevel = await rowLevel(page, "E2E Token Sample");
    await expandLayerRow(page, "E2E Token Sample");
    await expect(layerRow(page, "Alpha Button")).toBeVisible();
    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return (
          names.indexOf("E2E Token Sample") >= 0 &&
          names.indexOf("E2E Token Sample") < names.indexOf("Alpha Button")
        );
      })
      .toBe(true);
    await expect
      .poll(async () => rowLevel(page, "Alpha Button"))
      .toBe(persistedContainerLevel + 1);
  });

  test("locking a layer keeps panel selection but blocks canvas selection", async ({
    page,
  }) => {
    await clickLayerRow(page, "Beta Button");
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await clickLayerAction(page, "Beta Button", "Lock layer");
    await expect(
      layerRow(page, "Beta Button").locator(
        'button[aria-label="Unlock layer"]',
      ),
    ).toBeVisible();
    await waitForCanvasLayerState(page, "Beta Button", "locked");
    await clickLayerRow(page, "Beta Button");
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await clickLayerRow(page, "Alpha Button");
    await additiveSelectLayerRow(page, "Beta Button");
    await expect.poll(() => selectedRowCount(page)).toBe(2);
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await expect(await attemptCanvasSelect(page, "Beta Button")).toBeNull();

    await clickLayerAction(page, "Beta Button", "Unlock layer");
    const unlockedPayload = await selectByText(page, "Beta Button");
    expect(unlockedPayload.textContent ?? "").toContain("Beta Button");
  });

  test("hiding a layer keeps panel selection but blocks canvas selection until restored", async ({
    page,
  }) => {
    await clickLayerRow(page, "Beta Button");
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await clickLayerAction(page, "Beta Button", "Hide layer");
    await clickLayerRow(page, "Beta Button");
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await clickLayerRow(page, "Alpha Button");
    await additiveSelectLayerRow(page, "Beta Button");
    await expect.poll(() => selectedRowCount(page)).toBe(2);
    await expect(layerRow(page, "Beta Button")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await expect(designFrame(page).getByText("Beta Button")).toBeHidden();
    await expect(await attemptCanvasSelect(page, "Beta Button")).toBeNull();

    await clickLayerAction(page, "Beta Button", "Show layer");
    await expect(designFrame(page).getByText("Beta Button")).toBeVisible();
    const restoredPayload = await selectByText(page, "Beta Button");
    expect(restoredPayload.textContent ?? "").toContain("Beta Button");
  });
});

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string) {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${cssString(name)}"]`) })
    .first();
}

function layerRow(page: Page, name: string) {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

async function selectedRowCount(page: Page): Promise<number> {
  return layerTree(page)
    .locator('[role="treeitem"][aria-selected="true"]')
    .count();
}

async function visibleLayerNames(page: Page): Promise<string[]> {
  return await layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? "").trim())
        .filter((name) => name.length > 0),
    );
}

async function rowLevel(page: Page, name: string): Promise<number> {
  const level = await layerRow(page, name).getAttribute("aria-level");
  if (!level) throw new Error(`missing aria-level for layer row ${name}`);
  return Number(level);
}

async function clickLayerRow(page: Page, name: string): Promise<void> {
  const button = await waitForLayerRowButton(page, name);
  await button.click({ force: true });
}

async function waitForLayerRowButton(page: Page, name: string) {
  const button = layerRowButton(page, name);
  await expect(button).toBeVisible();
  return button;
}

async function expandLayerRow(page: Page, name: string): Promise<void> {
  const row = layerRow(page, name);
  await expect(row).toBeVisible();
  if ((await row.getAttribute("aria-expanded")) === "true") return;
  const toggle = row.getByRole("button", { name: "Expand layer" });
  await expect(toggle).toBeVisible();
  await toggle.click({ force: true });
  await expect(row).toHaveAttribute("aria-expanded", "true");
}

async function revealLayerRow(page: Page, name: string): Promise<void> {
  await openLayerSearch(page, name);
  await clickLayerRow(page, name);
  await openLayerSearch(page, "");
  await expect(layerRow(page, name)).toBeVisible();
}

async function additiveSelectLayerRow(page: Page, name: string): Promise<void> {
  const button = layerRowButton(page, name);
  await button.focus();
  await expect(button).toBeFocused();
  await button.click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(button).toBeFocused();
}

async function clickLayerAction(page: Page, name: string, label: string) {
  const row = layerRow(page, name);
  await row.hover();
  await row.locator(`button[aria-label="${label}"]`).click({
    force: true,
  });
}

async function waitForCanvasLayerState(
  page: Page,
  name: string,
  state: "locked" | "hidden",
): Promise<void> {
  const attribute =
    state === "locked"
      ? "data-agent-native-locked"
      : "data-agent-native-hidden";
  await expect
    .poll(async () =>
      designFrame(page)
        .getByText(name, { exact: false })
        .first()
        .evaluate((element, attr) => {
          const target =
            (element as HTMLElement).closest(`[${attr}="true"]`) ?? element;
          return target.getAttribute(attr) === "true";
        }, attribute)
        .catch(() => false),
    )
    .toBe(true);
}

async function dispatchLayerDrag(
  page: Page,
  sourceName: string,
  targetName: string,
  targetPosition: { x: number; y: number },
): Promise<void> {
  await page.evaluate(
    ({ sourceName, targetName, targetPosition }) => {
      const findRow = (name: string) => {
        const button = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-layer-row-button][data-layer-node-id]",
          ),
        ).find((candidate) => {
          const label = candidate.querySelector<HTMLElement>("span[title]");
          return label?.getAttribute("title") === name;
        });
        const row = button?.closest<HTMLElement>('[role="treeitem"]');
        if (!row) throw new Error(`missing layer row ${name}`);
        return row;
      };
      const source = findRow(sourceName);
      const target = findRow(targetName);
      const dataTransfer = new DataTransfer();
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const sourcePoint = {
        x: sourceRect.left + sourceRect.width * 0.4,
        y: sourceRect.top + sourceRect.height / 2,
      };
      const targetPoint = {
        x: targetRect.left + targetPosition.x,
        y: targetRect.top + targetPosition.y,
      };
      source.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          clientX: sourcePoint.x,
          clientY: sourcePoint.y,
          dataTransfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: targetPoint.x,
          clientY: targetPoint.y,
          dataTransfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: targetPoint.x,
          clientY: targetPoint.y,
          dataTransfer,
        }),
      );
      source.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          cancelable: true,
          clientX: targetPoint.x,
          clientY: targetPoint.y,
          dataTransfer,
        }),
      );
    },
    { sourceName, targetName, targetPosition },
  );
  await page.waitForTimeout(300);
}

function cssString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openLayerSearch(page: Page, query: string): Promise<void> {
  const normalized = query.trim().toLowerCase();
  const deadline = Date.now() + 30_000;
  let lastNames: string[] = [];
  do {
    const input = page.getByPlaceholder("Search layers...");
    if (!(await input.isVisible().catch(() => false))) {
      await page
        .getByRole("button", { name: "Search layers...", exact: true })
        .click();
      await expect(input).toBeVisible();
    }
    await input.fill(query);
    await expect(input).toHaveValue(query);
    const matched = await expect
      .poll(
        async () => {
          lastNames = await visibleLayerNames(page);
          return normalized
            ? lastNames.some((name) => name.toLowerCase().includes(normalized))
            : lastNames.length > 0;
        },
        { timeout: 3_000 },
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (matched) return;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);

  if (!normalized) {
    throw new Error("Layer rows did not become searchable");
  }
  throw new Error(
    `Layer search for ${query} did not match any rows; last rows: ${lastNames.join(", ")}`,
  );
}

async function attemptCanvasSelect(
  page: Page,
  text: string,
): Promise<unknown | null> {
  await enterDirectMode(page);
  await installBridge(page);
  await page.evaluate(() => {
    (window as any).__bridge = [];
  });
  try {
    await designFrame(page)
      .getByText(text, { exact: false })
      .first()
      .click({ force: true, timeout: 8_000 });
  } catch {
    return null;
  }
  try {
    const payload = await waitForBridge(page, "element-select", 1_500);
    return payload?.payload ?? payload;
  } catch {
    return null;
  }
}
