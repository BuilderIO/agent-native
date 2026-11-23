import { mkdir } from "node:fs/promises";

import { expect, type Locator, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box == null) throw new Error("element has no layout box");
  return box;
}

export async function checkInputAdjacent(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    const kinds = async () =>
      (await read()).cells.map((cell) => cell.contents.kind);
    const ids = async () => (await read()).cells.map((cell) => cell.id);
    const nameOf = async (index: number) => {
      const contents = (await read()).cells.at(index)?.contents;
      if (contents?.kind !== "input")
        throw new Error(`cell ${index} is not an input`);
      return contents.name;
    };
    const group = page.locator("[data-nb-inline-group]");
    const slots = group.locator("> div");
    const settingsName = page.getByRole("textbox", {
      name: "Name",
      exact: true,
    });
    const barMenu = page.getByRole("menu", { name: "More" });
    const inputsBarMenu = page.getByRole("menu", { name: "Inputs" });
    const inline = page.getByRole("menu").filter({
      has: page.getByRole("menuitem", { name: "More", exact: true }),
    });
    const plusAt = (index: number) =>
      slots.nth(index).getByRole("button", { name: "Add cell here" });

    const settleNewInput = async (index: number, value: string) => {
      const name = await nameOf(index);
      await expect(settingsName, "settings open on creation").toHaveValue(name);
      await page.keyboard.press("Escape");
      await expect(settingsName).toHaveCount(0);
      const field = slots.nth(index).getByRole("textbox", {
        name: `Value for ${/^input_\d+$/.test(name) ? name.replace(/^input_/, "Input ") : name}`,
      });
      await field.fill(value);
      await field.blur();
      await expect
        .poll(async () => (await read()).cells.at(index)?.contents)
        .toMatchObject({ name, defaultValueString: value });
    };
    const addInputFromBar = async (index: number, value: string) => {
      await page
        .getByRole("button", { name: "Inputs", exact: true })
        .last()
        .click();
      await inputsBarMenu
        .getByRole("menuitem", { name: "Text input", exact: true })
        .click();
      await expect.poll(async () => (await ids()).length).toBe(index + 1);
      await settleNewInput(index, value);
    };

    await addInputFromBar(0, "alpha");
    await addInputFromBar(1, "beta");
    const [first, second] = await ids();

    await expect(slots).toHaveCount(2);
    for (const index of [0, 1]) {
      const card = await boxOf(
        slots.nth(index).locator("[data-notebook-cell]"),
      );
      const plus = await boxOf(plusAt(index));
      expect(
        plus.x,
        `plus ${index} is right of its input`,
      ).toBeGreaterThanOrEqual(card.x + card.width);
      expect(plus.y, `plus ${index} is level with its input`).toBeLessThan(
        card.y + card.height,
      );
    }
    const cardA = await boxOf(slots.nth(0).locator("[data-notebook-cell]"));
    const cardB = await boxOf(slots.nth(1).locator("[data-notebook-cell]"));
    const row = await boxOf(group);
    expect(
      Math.abs(cardA.y - cardB.y),
      "two inputs share one inline row",
    ).toBeLessThan(2);
    expect(cardB.x).toBeGreaterThan(cardA.x + cardA.width);
    expect(cardB.x + cardB.width).toBeLessThanOrEqual(row.x + row.width + 1);

    const plusBox = await boxOf(plusAt(0));
    await plusAt(0).click();
    await expect(inline.getByRole("menuitem")).toHaveText(["Inputs", "More"]);
    await expect
      .poll(async () => (await boxOf(inline)).x, {
        message: "menu opens to the right",
      })
      .toBeGreaterThanOrEqual(plusBox.x + plusBox.width - 1);
    await inline.getByRole("menuitem", { name: "Inputs", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Text input", exact: true })
      .click();
    await expect.poll(async () => (await ids()).length).toBe(3);
    const afterInsert = await ids();
    expect(afterInsert[0]).toBe(first);
    expect(afterInsert[2]).toBe(second);
    expect([first, second]).not.toContain(afterInsert[1]);
    await settleNewInput(1, "gamma");

    await plusAt(2).click();
    await inline.getByRole("menuitem", { name: "More", exact: true }).click();
    await barMenu.getByRole("menuitem", { name: "Text", exact: true }).click();
    await expect.poll(kinds).toEqual(["input", "input", "input", "text"]);
    expect((await ids()).slice(0, 3)).toEqual(afterInsert);

    await plusAt(0).click();
    await inline.getByRole("menuitem", { name: "More", exact: true }).click();
    await barMenu.getByRole("menuitem", { name: "Query", exact: true }).click();
    await expect
      .poll(kinds)
      .toEqual(["input", "sql", "input", "input", "text"]);
    const finalIds = await ids();
    expect(finalIds[0]).toBe(first);

    await expect(group).toHaveCount(2);
    await expect(group.first().locator("[data-notebook-cell]")).toHaveCount(1);
    await expect(group.nth(1).locator("[data-notebook-cell]")).toHaveCount(2);
    const sqlBox = await boxOf(page.locator("[data-notebook-cell]").nth(1));
    const textBox = await boxOf(page.locator("[data-notebook-cell]").nth(4));
    const firstGroup = await boxOf(group.first());
    const secondGroup = await boxOf(group.nth(1));
    expect(sqlBox.width, "SQL stays full width").toBeGreaterThan(
      cardA.width * 2,
    );
    expect(textBox.width, "text stays full width").toBeGreaterThan(
      cardA.width * 2,
    );
    expect(sqlBox.y).toBeGreaterThanOrEqual(firstGroup.y + firstGroup.height);
    expect(secondGroup.y).toBeGreaterThanOrEqual(sqlBox.y + sqlBox.height);
    expect(textBox.y).toBeGreaterThanOrEqual(
      secondGroup.y + secondGroup.height,
    );

    await mkdir(".tmp/analytics-owner", { recursive: true });
    await page.screenshot({
      path: ".tmp/analytics-owner/input-adjacent-local.png",
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-notebook-cell]")).toHaveCount(5);
    expect(await ids()).toEqual(finalIds);
    await expect(group).toHaveCount(2);
    const inputs = page.locator("[data-nb-inline-group] [data-notebook-cell]");
    await expect(inputs).toHaveCount(3);
    for (const [index, value] of ["alpha", "gamma", "beta"].entries()) {
      await expect(
        inputs.nth(index).getByRole("textbox", { name: /^Value for / }),
      ).toHaveValue(value);
    }
  });
}
