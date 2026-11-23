import { mkdir } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkInputConfig(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    await expect(
      page.getByRole("button", { name: "Inputs", exact: true }).last(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Inputs", exact: true })
      .last()
      .click();
    const menu = page.getByRole("menu", { name: "Inputs" });
    await expect(
      menu.getByRole("menuitem", { name: "Text input", exact: true }),
    ).toBeVisible();
    await menu
      .getByRole("menuitem", { name: "Text input", exact: true })
      .click();
    await expect.poll(async () => (await read()).cells.length).toBe(1);
    const cell = page.locator("[data-notebook-cell]").first();
    const gear = cell.getByRole("button", { name: "Configure cell" });
    await expect(gear).toBeVisible();
    await gear.click();
    const label = page.getByRole("textbox", { name: "Label", exact: true });
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(label).toBeVisible();
    await label.fill("Customer Region");
    await name.fill("customer_region");
    await name.press("Enter");
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ label: "Customer Region", name: "customer_region" });
    await gear.click();
    await expect(name).toHaveValue("customer_region");
    await name.fill("1 region");
    await expect(page.getByRole("alert")).toContainText(
      "Name must be a valid python identifier",
    );
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ label: "Customer Region", name: "customer_region" });
    await name.fill("customer_region");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const toggle = page.getByRole("switch", { name: "Multiline" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ multiline: true });
    await gear.click();
    const area = cell.locator("textarea");
    await expect(area).toBeVisible();
    await area.fill("first line\nsecond line");
    await area.blur();
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({
        label: "Customer Region",
        name: "customer_region",
        multiline: true,
        defaultValueString: "first line\nsecond line",
      });
    const savedContents = (await read()).cells[0]?.contents;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cell.locator("textarea")).toHaveValue(
      "first line\nsecond line",
    );
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({
        label: "Customer Region",
        name: "customer_region",
        multiline: true,
        defaultValueString: "first line\nsecond line",
      });
    expect((await read()).cells[0]?.contents).toEqual(savedContents);
    await mkdir(".tmp/analytics-owner", { recursive: true });
    await page.screenshot({
      path: ".tmp/analytics-owner/input-config-local.png",
    });
    await gear.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ multiline: false });
    await gear.click();
    await expect(cell.locator('input[type="text"]')).toBeVisible();
  });
}
