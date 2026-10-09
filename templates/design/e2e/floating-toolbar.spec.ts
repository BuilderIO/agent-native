import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  gotoEditor,
  readSeedDesignId,
  selectByText,
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
  test("offers Move, Frame, Pen and Agent, each with its menu, and no Comment", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());

    expect(await toolbarGroups(page)).toEqual([
      "move",
      "frame",
      "pen",
      "agent",
    ]);
    expect(await menuOptions(page, "Move")).toEqual(["move", "hand", "scale"]);
    expect(await menuOptions(page, "Frame")).toEqual([
      "frame",
      "text",
      "screen",
      "image-video",
      "rect",
      "line",
      "arrow",
      "ellipse",
      "polygon",
      "star",
    ]);
    expect(await menuOptions(page, "Agent")).toEqual([
      "inspiration",
      "debug",
      "polish",
    ]);
    // Pen has one item with the Annotate lab off, so there is no menu to open.
    await expect(
      page.locator(TOOLBAR).getByRole("button", { name: "Pen options" }),
    ).toHaveCount(0);
    await expect(
      page.locator(TOOLBAR).getByRole("button", { name: /comment/i }),
    ).toHaveCount(0);
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("the Agent menu lists skills without shortcuts", async ({ page }) => {
    await gotoEditor(page, await readSeedDesignId());

    await page
      .locator(TOOLBAR)
      .getByRole("button", { name: "Agent options", exact: true })
      .click();
    for (const skill of ["Inspiration", "Debug", "Polish"]) {
      const item = page.getByRole("menuitem", { name: skill, exact: true });
      await expect(item).toBeVisible();
    }
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("Frame's menu arms Text, and the Frame button then keeps offering Text", async ({
    page,
  }) => {
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
  test("C and Shift+C do nothing while the Comment tool is hidden", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());
    const toolbar = page.locator(TOOLBAR);
    const move = toolbar.getByRole("button", { name: "Move", exact: true });
    await expect(move).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("c");
    await page.keyboard.press("Shift+C");

    await expect(move).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "edit", activeTool: "move" });
    await page.keyboard.press("Control+Shift+/");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-shortcut-id="pen-tool"]')).toBeVisible();
    await expect(
      dialog.locator('[data-shortcut-id="comment-tool"]'),
    ).toHaveCount(0);
    await expect(
      dialog.locator('[data-shortcut-id="toggle-comments"]'),
    ).toHaveCount(0);
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("the Agent button arms the Agent tool and opens the Agent panel", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());
    const agent = page
      .locator(TOOLBAR)
      .getByRole("button", { name: "Agent", exact: true });

    await agent.click();

    await expect(agent).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-design-agent-panel]")).toBeVisible();
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ activeTool: "agent" });

    // The pointer is Move on the canvas again once Move is picked.
    await selectTool(page, "Move");
    await expect(agent).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ activeTool: "move" });
  });

  // The e2e app has no model configured, so the chat panel only offers to
  // connect one. What the toolbar owns is the message it hands to the chat, and
  // that is observable where the chat reads it.
  async function recordChatSubmissions(page: Page) {
    await page.evaluate(() => {
      const submitted: unknown[] = [];
      (
        window as unknown as { __chatSubmissions: unknown[] }
      ).__chatSubmissions = submitted;
      window.addEventListener("message", (event) => {
        const data = event.data as { type?: string; data?: unknown } | null;
        if (data?.type === "agentNative.submitChat") {
          submitted.push(data.data);
        }
      });
    });
    return () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __chatSubmissions: Array<{
                message?: string;
                context?: string;
                submit?: boolean;
              }>;
            }
          ).__chatSubmissions,
      );
  }

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("a Debug pick sends its prompt and the selection through the agent chat", async ({
    page,
  }) => {
    const designId = await readSeedDesignId();
    await gotoEditor(page, designId);
    await selectByText(page, "E2E Hero Heading");
    const submissions = await recordChatSubmissions(page);

    await page
      .locator(TOOLBAR)
      .getByRole("button", { name: "Agent options", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Debug", exact: true }).click();

    await expect(page.locator("[data-design-agent-panel]")).toBeVisible();
    await expect.poll(async () => (await submissions()).length).toBe(1);
    const [sent] = await submissions();
    expect(sent).toMatchObject({
      message: "Find layout, overflow, and responsive problems on this screen.",
      submit: true,
    });
    expect(sent?.context).toContain(`designId: ${designId}`);
    expect(sent?.context).toContain("Selected element: <h1>");
    expect(sent?.context).toContain("E2E Hero Heading");
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("Inspiration and Polish send their own prompts", async ({ page }) => {
    await gotoEditor(page, await readSeedDesignId());
    const submissions = await recordChatSubmissions(page);

    for (const [skill, prompt] of [
      [
        "Inspiration",
        "Explore three alternative directions for the selection.",
      ],
      [
        "Polish",
        "Tighten spacing, type scale, and alignment on the selection.",
      ],
    ] as const) {
      await page
        .locator(TOOLBAR)
        .getByRole("button", { name: "Agent options", exact: true })
        .click();
      await page.getByRole("menuitem", { name: skill, exact: true }).click();
      await expect
        .poll(async () => (await submissions()).slice(-1)[0]?.message)
        .toBe(prompt);
    }
    expect(await submissions()).toHaveLength(2);
  });

  // oracle: none — verifies which tools exist and what they do, not parity with a design reference.
  test("Interact narrows the toolbar to Move and Agent and keeps Interact", async ({
    page,
  }) => {
    await gotoEditor(page, await readSeedDesignId());

    await page
      .locator('[data-design-top-bar] [data-design-mode="interact"]')
      .click();

    await expect.poll(() => toolbarGroups(page)).toEqual(["move", "agent"]);
    const toolbar = page.locator(TOOLBAR);
    const move = toolbar.getByRole("button", { name: "Move", exact: true });
    const agent = toolbar.getByRole("button", { name: "Agent", exact: true });
    await expect(move).toHaveAttribute("aria-pressed", "true");
    await expect(
      toolbar.getByRole("button", { name: "Move options" }),
    ).toHaveCount(0);

    await agent.click();
    await expect(agent).toHaveAttribute("aria-pressed", "true");
    await expect(move).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "interact", activeTool: "agent" });

    await move.click();
    await expect(move).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => agentContext(page))
      .toMatchObject({ mode: "interact", activeTool: "move" });
  });
});
