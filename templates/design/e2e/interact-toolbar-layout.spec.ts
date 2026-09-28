import { expect, test, type Page } from "@playwright/test";

import { cdpScreenshot, gotoEditor, readSeedDesignId } from "./helpers";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointHit {
  targetFound: boolean;
  point: { x: number; y: number } | null;
  elementAtPoint: {
    tag: string;
    ariaLabel: string | null;
    text: string | null;
  } | null;
  hitsTarget: boolean;
}

interface InteractEntrySnapshot {
  bar: Rect | null;
  height: Rect | null;
  heightCenter: PointHit;
  heightTop: PointHit;
  buttons: Record<string, PointHit>;
  screenShellCount: number;
  bottomToolbarCount: number;
  rightPanelCount: number;
}

const actionLabels = ["Edit", "Annotate", "Exit responsive preview"];

async function enterInteractAndSampleImmediately(
  page: Page,
  width: number,
  height: number,
): Promise<InteractEntrySnapshot> {
  await page.setViewportSize({ width, height });
  await gotoEditor(page, await readSeedDesignId());

  const fullView = page.locator("[data-frame-full-view]").last();
  await expect(fullView).toHaveCount(1);
  const screenShell = fullView.locator("xpath=ancestor::*[@data-screen-shell]");
  const previewIframe = screenShell.locator(
    "iframe[data-design-preview-iframe]",
  );
  const previewIframeHandle = await previewIframe.elementHandle();
  if (!previewIframeHandle) throw new Error("screen preview iframe is missing");
  await fullView.click();
  await expect(screenShell).toHaveAttribute(
    "data-screen-interact-mode",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Exit responsive preview" }),
  ).toBeVisible();
  await expect(screenShell.locator("[data-frame-full-view]")).toBeHidden();
  expect(
    await previewIframeHandle.evaluate((before) =>
      Boolean(
        before.isConnected &&
        document.contains(before) &&
        before
          .closest("[data-screen-shell]")
          ?.querySelector("iframe[data-design-preview-iframe]") === before,
      ),
    ),
  ).toBe(true);

  return page.evaluate((labels) => {
    const bounds = (element: Element | null): Rect | null => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const hitAt = (
      target: Element | null,
      point: { x: number; y: number } | null,
      matches: (hit: Element | null) => boolean,
    ): PointHit => {
      const hit = point ? document.elementFromPoint(point.x, point.y) : null;
      return {
        targetFound: target !== null,
        point,
        elementAtPoint: hit
          ? {
              tag: hit.tagName.toLowerCase(),
              ariaLabel: hit.getAttribute("aria-label"),
              text:
                hit.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ??
                null,
            }
          : null,
        hitsTarget: matches(hit),
      };
    };

    const buttons = Object.fromEntries(
      labels.map((label) => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).find((candidate) => candidate.getAttribute("aria-label") === label);
        const rect = bounds(button ?? null);
        const point = rect
          ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
          : null;
        return [
          label,
          hitAt(
            button ?? null,
            point,
            (hit) => hit?.closest("button") === button,
          ),
        ];
      }),
    );

    const heightInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Height"]',
    );
    const heightRect = bounds(heightInput);
    const heightCenterPoint = heightRect
      ? {
          x: heightRect.x + heightRect.width / 2,
          y: heightRect.y + heightRect.height / 2,
        }
      : null;
    const heightTopPoint = heightRect
      ? { x: heightRect.x + heightRect.width / 2, y: heightRect.y + 1 }
      : null;
    let bar: HTMLElement | null = heightInput;
    while (bar && !bar.classList.contains("h-12")) bar = bar.parentElement;

    return {
      bar: bounds(bar),
      height: heightRect,
      heightCenter: hitAt(
        heightInput,
        heightCenterPoint,
        (hit) => hit === heightInput,
      ),
      heightTop: hitAt(
        heightInput,
        heightTopPoint,
        (hit) => hit === heightInput,
      ),
      buttons,
      screenShellCount: document.querySelectorAll("[data-screen-shell]").length,
      bottomToolbarCount: document.querySelectorAll(
        "[data-design-bottom-toolbar]",
      ).length,
      rightPanelCount: document.querySelectorAll(
        '[data-design-chrome-region="right-panel"]',
      ).length,
    };
  }, actionLabels);
}

test("Interact actions clear the right rail at Tiana's 1751×897 viewport", async ({
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(page, 1751, 897);

  expect(snapshot.screenShellCount).toBe(1);
  expect(snapshot.bottomToolbarCount).toBe(0);
  expect(snapshot.rightPanelCount).toBe(0);
  expect(snapshot.bar).not.toBeNull();
  expect(snapshot.bar!.x + snapshot.bar!.width).toBeLessThanOrEqual(1751);
  for (const label of actionLabels) {
    expect
      .soft(snapshot.buttons[label], `${label} center should hit its button`)
      .toMatchObject({ targetFound: true, hitsTarget: true });
  }
  expect
    .soft(snapshot.heightCenter, "Height center should hit its input")
    .toMatchObject({ targetFound: true, hitsTarget: true });
  expect
    .soft(snapshot.heightTop, "Height top should hit its input")
    .toMatchObject({ targetFound: true, hitsTarget: true });

  await cdpScreenshot(page, testInfo.outputPath("tiana-interact.png"));
});

test("Interact height input is unclipped at Damian's 1456×410 viewport", async ({
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(page, 1456, 410);

  expect(snapshot.screenShellCount).toBe(1);
  expect(snapshot.bottomToolbarCount).toBe(0);
  expect(snapshot.rightPanelCount).toBe(0);
  expect(snapshot.bar).not.toBeNull();
  expect(snapshot.height).not.toBeNull();
  expect(snapshot.height!.y).toBeGreaterThanOrEqual(snapshot.bar!.y);
  expect(snapshot.height!.y + snapshot.height!.height).toBeLessThanOrEqual(
    snapshot.bar!.y + snapshot.bar!.height,
  );
  expect
    .soft(snapshot.heightCenter, "Height center should hit its input")
    .toMatchObject({ targetFound: true, hitsTarget: true });
  expect
    .soft(snapshot.heightTop, "Height top should hit its input")
    .toMatchObject({ targetFound: true, hitsTarget: true });

  await cdpScreenshot(page, testInfo.outputPath("damian-interact.png"));
});
