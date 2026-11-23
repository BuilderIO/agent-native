import { resolve } from "node:path";

import { z } from "zod";

import { expect, test } from "./fixtures";
import { seedThread } from "./objects.helpers";

const identitySchema = z.object({
  user: z.object({ email: z.literal("qa-fleet@builder.io") }),
  workspace: z.object({ id: z.string().min(1) }),
});

test("reports QA25/QA26/QA27 threads rows keep the menu clear of the date, name the creator, and More is never empty", async ({
  daily,
}) => {
  const identity = identitySchema.parse(
    await daily.action("get-workspace-shell", {}, "GET"),
  );
  console.log(
    `QA identity ${identity.user.email}, workspace ${identity.workspace.id}`,
  );
  const threadId = await seedThread(daily, "Row layout probe");
  try {
    await daily.open("/home/threads");
    const page = daily.page;
    const table = page.getByRole("table", { name: "Threads" });
    await expect(table).toBeVisible({ timeout: 30_000 });
    await expect(
      table.getByRole("columnheader", { name: "Creator" }),
    ).toBeVisible();
    const row = table
      .getByRole("row")
      .filter({ has: page.locator(`a[href="/thread/${threadId}"]`) });
    await expect(row).toBeVisible();
    const creator = row.getByRole("cell").nth(2);
    await expect(creator).not.toHaveText("—");
    await expect(creator).not.toHaveText("Workspace User");
    await expect(creator).not.toHaveText("");
    const dateCell = row.getByRole("cell").nth(1);
    await expect(dateCell).toHaveText(
      /^(\d+ (secs?|min|hrs?|days?)|1 (sec|min|hr|day)) ago$/,
    );
    const menuButton = row.getByRole("button", { name: /^Actions for / });
    const titleCell = row.getByRole("cell").nth(0);
    await expect(
      titleCell.getByRole("button", { name: /^Actions for / }),
    ).toHaveCount(1);
    const reveal = menuButton.locator("..");
    await expect(reveal).toHaveCSS("opacity", "0");
    await row.hover();
    await expect(reveal).toHaveCSS("opacity", "1");
    const date = await dateCell.boundingBox();
    const text = await dateCell.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    const menu = await menuButton.boundingBox();
    const title = await titleCell.boundingBox();
    if (!date || !menu || !title)
      throw new Error("Row cells were not laid out");
    const intersects = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    console.log(
      `BOXES date-cell ${JSON.stringify(date)} date-text ${JSON.stringify(text)} menu ${JSON.stringify(menu)} title-cell ${JSON.stringify(title)}`,
    );
    expect(intersects(menu, date), "menu overlaps the date cell").toBe(false);
    expect(intersects(menu, text), "menu overlaps the date text").toBe(false);
    expect(
      menu.x + menu.width,
      "menu stays inside the title cell",
    ).toBeLessThanOrEqual(title.x + title.width + 0.5);
    await page.screenshot({
      path: resolve(
        import.meta.dirname,
        "../../../../.tmp/analytics-owner/turn-0052/threads-row-hover.png",
      ),
    });
    const more = page.getByRole("button", { name: "More", exact: true });
    const moreCount = await more.count();
    console.log(`QA27 More trigger count ${moreCount}`);
    if (moreCount) {
      await more.click();
      await expect(
        page.getByRole("menu").getByRole("menuitem").first(),
      ).toBeVisible();
      await page.screenshot({
        path: resolve(
          import.meta.dirname,
          "../../../../.tmp/analytics-owner/turn-0052/more-open.png",
        ),
      });
    }
  } finally {
    await daily.cleanupAction("delete-thread", { threadId });
  }
});
