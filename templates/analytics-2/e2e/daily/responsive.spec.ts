import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  SAMPLE_CONNECTION,
  seedNotebook,
  storedCells,
} from "./notebook.helpers";
import { openHome, openProjectView, openSettings } from "./views.helpers";

test.use({ dailyTouch: true });

test.describe("390px notebook and Context Studio controls", () => {
  test.beforeEach(async ({ daily }) => {
    await daily.page.setViewportSize({ width: 390, height: 844 });
  });

  test("the SQL cell shows the complete connection name", async ({ daily }) => {
    const project = await seedNotebook(daily, [
      { kind: "sql", text: "select 1", connection: SAMPLE_CONNECTION },
    ]);
    await openProjectView(daily, project.id);
    const label = daily.page
      .getByRole("button", { name: "Data connection: [Demo] Public Data" })
      .getByText("[Demo] Public Data", { exact: true });
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeInViewport({ ratio: 1 });
    expect(
      await label.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  });

  test("the expanded Context Studio rail exposes every management link", async ({
    daily,
  }) => {
    await daily.open("/context-studio/guides");
    await daily.page
      .getByRole("button", { name: "Expand Context Studio" })
      .tap();
    const rail = daily.page.getByRole("navigation", { name: "Context Studio" });
    for (const name of [
      "Endorsements",
      "Guides",
      "Semantic models",
      "Repositories",
      "Connections",
    ]) {
      await expect(
        rail.getByRole("link", { name, exact: true }),
      ).toBeInViewport({
        ratio: 1,
      });
    }
  });

  for (const [label, lastOption] of [
    ["More", "Text input"],
    ["Inputs", "Text input"],
  ] as const) {
    test(`${label} opens beside its trigger and keeps its last option reachable`, async ({
      daily,
    }) => {
      const project = await seedNotebook(daily, [
        { kind: "markdown", text: "Menu placement" },
      ]);
      await openProjectView(daily, project.id);
      const trigger = daily.page
        .locator(".nb-add-surface")
        .getByRole("button", { name: label, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      const triggerBox = await trigger.boundingBox();
      await trigger.tap();
      const menu = daily.page.getByRole("menu");
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(menuBox).not.toBeNull();
      if (!triggerBox || !menuBox) throw new Error("Add-cell menu missing");
      expect(menuBox.x).toBeLessThanOrEqual(triggerBox.x + triggerBox.width);
      expect(menuBox.x + menuBox.width).toBeGreaterThanOrEqual(triggerBox.x);
      await expect(menu).toBeInViewport({ ratio: 1 });
      const choice = menu.getByRole("menuitem", {
        name: lastOption,
        exact: true,
      });
      await choice.scrollIntoViewIfNeeded();
      await expect(choice).toBeInViewport({ ratio: 1 });
    });
  }
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test.describe(`${viewport.width}px responsive web`, () => {
    test.beforeEach(async ({ daily }) => {
      await daily.page.setViewportSize(viewport);
    });

    async function fits(locator: Locator) {
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      if (!box) throw new Error("Missing visible surface");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      return box;
    }

    test("Home prompt and navigation fit", async ({ daily }, info) => {
      await openHome(daily);
      await daily.page.screenshot({
        path: info.outputPath("home-before-check.png"),
      });
      await fits(daily.page.locator(".ws-home-composer"));
      await fits(daily.page.locator(".ws-home-prompt-actions"));
      for (const name of ["Analyze in a notebook", "Generate an app"]) {
        const button = daily.page
          .locator(".ws-home-prompt-actions")
          .getByRole("button", { name, exact: true });
        await fits(button);
        const events: string[] = [];
        const record = (message: import("@playwright/test").ConsoleMessage) => {
          if (message.text().startsWith("responsive-intent:"))
            events.push(message.text());
        };
        daily.page.on("console", record);
        await button.evaluate((element) => {
          const start = performance.now();
          for (const event of [
            "pointerdown",
            "touchstart",
            "touchend",
            "click",
          ])
            element.addEventListener(
              event,
              () =>
                console.info(
                  `responsive-intent:${event}:${performance.now() - start}`,
                ),
              { once: true },
            );
        });
        try {
          await button.tap();
        } finally {
          daily.page.off("console", record);
          await info.attach("intent-input-events", {
            body: JSON.stringify({ name, events }),
            contentType: "application/json",
          });
        }
        await expect(
          daily.page
            .locator(".ws-home-composer")
            .getByText(name, { exact: true }),
        ).toBeVisible();
        await expect(
          daily.page.locator(".ws-home-composer [contenteditable='true']"),
        ).toBeFocused();
      }
      await daily.page.screenshot({ path: info.outputPath("home.png") });
    });

    test("Data connection entry remains reachable", async ({ daily }, info) => {
      await daily.open("/home/data");
      await expect(
        daily.page
          .getByRole("button", {
            name: /^(Add data connection|Connect your data)/,
          })
          .first(),
      ).toBeVisible();
      await daily.page.screenshot({
        path: info.outputPath("data-before-check.png"),
      });
      await fits(
        daily.page
          .getByRole("button", {
            name: /^(Add data connection|Connect your data)/,
          })
          .first(),
      );
      await daily.page.screenshot({ path: info.outputPath("data.png") });
    });

    test("Notebook reserves readable content and reachable insertion", async ({
      daily,
    }, info) => {
      const project = await seedNotebook(daily, [
        { kind: "markdown", text: "Responsive notebook content" },
      ]);
      await openProjectView(daily, project.id);
      await daily.page.screenshot({
        path: info.outputPath("notebook-before-check.png"),
      });
      const card = await fits(daily.page.locator(".nb-main-card"));
      expect(card.width).toBeGreaterThanOrEqual(300);
      const tabs = await fits(
        daily.page.getByRole("navigation", { name: "Project views" }),
      );
      const actions = await fits(daily.page.locator(".nb-header-right"));
      expect(
        tabs.y + tabs.height <= actions.y ||
          actions.y + actions.height <= tabs.y ||
          tabs.x + tabs.width <= actions.x ||
          actions.x + actions.width <= tabs.x,
      ).toBe(true);
      const insert = daily.page
        .locator(".nb-add-surface")
        .getByRole("button", { name: "Text", exact: true });
      await insert.scrollIntoViewIfNeeded();
      await fits(insert);
      await insert.tap();
      await expect
        .poll(async () =>
          (await storedCells(daily, project.id)).map((cell) => cell.kind),
        )
        .toEqual(["markdown", "text"]);
      await daily.page.screenshot({ path: info.outputPath("notebook.png") });
    });

    test("report A2-RESPONSIVE-PANEL-JUMP: Find and outline reveal the selected cell", async ({
      daily,
    }) => {
      const project = await seedNotebook(daily, [
        { kind: "markdown", text: "First note", label: "First note" },
        { kind: "markdown", text: "Target note", label: "Target note" },
      ]);
      await openProjectView(daily, project.id);
      for (const panel of ["Find", "Table of contents"]) {
        await daily.page
          .getByRole("button", { name: panel, exact: true })
          .tap();
        const surface = daily.page.getByRole("complementary", {
          name: panel,
          exact: true,
        });
        if (panel === "Find")
          await surface
            .getByRole("searchbox", { name: "Find..." })
            .fill("Target note");
        await surface.getByRole("button", { name: /Target note/ }).tap();
        const target = daily.page.locator(
          `[data-notebook-cell="${project.cellIds[1]}"]`,
        );
        await expect(target).toBeVisible();
        await expect(target).toBeInViewport();
        if (viewport.width > 700)
          await surface
            .getByRole("button", { name: `Close ${panel}`, exact: true })
            .tap();
      }
      await daily.check();
    });

    test("App cards remain within the editor", async ({ daily }, info) => {
      const project = await seedNotebook(daily, [
        { kind: "markdown", text: "First card" },
        { kind: "markdown", text: "Second card" },
      ]);
      await openProjectView(daily, project.id, "/app");
      await daily.page.screenshot({
        path: info.outputPath("app-before-check.png"),
      });
      await expect(daily.page.locator(".nb-app-grid-card")).toHaveCount(2);
      await fits(daily.page.locator(".nb-app-builder"));
      if (viewport.width <= 700 || viewport.width >= 1280) {
        const cards = await daily.page.locator(".nb-app-grid-card").all();
        const first = await fits(cards[0]);
        const second = await fits(cards[1]);
        expect(
          first.y + first.height <= second.y ||
            second.y + second.height <= first.y ||
            first.x + first.width <= second.x ||
            second.x + second.width <= first.x,
        ).toBe(true);
        if (viewport.width <= 700)
          for (const button of await daily.page
            .locator(".nb-app-grid-controls button")
            .all()) {
            const box = await button.boundingBox();
            if (!box) throw new Error("Missing app card control");
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
            expect(box.width).toBeGreaterThanOrEqual(28);
          }
      } else {
        const last = daily.page.locator(".nb-app-grid-card").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
      }
      await daily.page.screenshot({ path: info.outputPath("app.png") });
    });

    test("Settings content keeps a readable width", async ({ daily }, info) => {
      await openSettings(daily);
      await expect(
        daily.page.getByLabel("Loading formatting preferences", {
          exact: true,
        }),
      ).toBeHidden();
      await daily.page.screenshot({
        path: info.outputPath("settings-before-check.png"),
      });
      const content = await fits(daily.page.locator(".settings-scroll"));
      expect(content.width).toBeGreaterThanOrEqual(300);
      const navigation = daily.page.getByRole("navigation", {
        name: "Settings",
      });
      const preferences = navigation.getByRole("link", {
        name: "Preferences",
        exact: true,
      });
      await preferences.scrollIntoViewIfNeeded();
      await preferences.tap();
      await expect(daily.page).toHaveURL(/\/settings\/preferences$/);
      const general = navigation.getByRole("link", {
        name: "General",
        exact: true,
      });
      await general.scrollIntoViewIfNeeded();
      await general.tap();
      await expect(
        daily.page.getByLabel("Loading formatting preferences", {
          exact: true,
        }),
      ).toBeHidden();
      await daily.check();
      await daily.page.screenshot({ path: info.outputPath("settings.png") });
    });
  });
}
