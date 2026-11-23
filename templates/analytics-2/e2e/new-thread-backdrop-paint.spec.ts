import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

test("thread canvas generates an inert layer with visible area", async ({
  page,
}) => {
  await page.goto(`${BASE}/ask`);
  const panel = page.locator(".analytics-2-new-thread .agent-panel-root");
  await expect(page.locator(".agentkit-composer-stack")).toBeVisible();
  const decoration = await panel.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    const bounds = element.getBoundingClientRect();
    return {
      content: style.content,
      backgroundImage: style.backgroundImage,
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
      top: Number.parseFloat(style.top),
      panelHeight: bounds.height,
      opacity: Number(style.opacity),
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
    };
  });
  expect(decoration.content).not.toBe("none");
  expect(decoration.content).not.toBe("normal");
  expect(decoration.backgroundImage).not.toBe("none");
  expect(decoration.width).toBeGreaterThan(0);
  expect(decoration.height).toBeGreaterThan(0);
  expect(decoration.height + decoration.top).toBeCloseTo(
    decoration.panelHeight,
    0,
  );
  expect(decoration.opacity).toBeGreaterThan(0);
  expect(decoration.visibility).toBe("visible");
  expect(decoration.pointerEvents).toBe("none");
  await page.screenshot({
    path: test.info().outputPath("painted-thread-canvas.png"),
  });
  const navigation = page.getByRole("button", {
    name: "Primary navigation",
    exact: true,
  });
  await navigation.click();
  await expect(
    page.getByRole("button", { name: "Thread", exact: true }),
  ).toBeVisible();
});
