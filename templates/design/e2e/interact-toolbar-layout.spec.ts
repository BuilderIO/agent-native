import type { Page } from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import { appPath, cdpScreenshot } from "./helpers";
import { expect, test, type App } from "./rails";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointHit {
  targetFound: boolean;
  hitsTarget: boolean;
  hit: string | null;
}

interface ControlSample {
  rect: Rect | null;
  visible: boolean;
  /** A disabled button lets clicks fall through, so it is not hit-tested. */
  disabled: boolean;
  hit: PointHit;
}

const CONTROL_SELECTORS = {
  modeSwitch: "[data-design-top-bar] [data-design-mode-switch]",
  device: "[data-design-top-bar] [data-design-interact-device]",
  theme: "[data-design-top-bar] [data-design-interact-theme]",
  back: "[data-design-top-bar] button[aria-label='Back']",
  forward: "[data-design-top-bar] button[aria-label='Forward']",
  screen: "[data-design-top-bar] [data-design-interact-route]",
  reload: "[data-design-top-bar] button[aria-label='Reload preview']",
  zoom: "[data-design-top-bar] [data-design-interact-zoom]",
} as const;

type ControlName = keyof typeof CONTROL_SELECTORS;

// The overview keeps every screen's preview mounted; only one is interactive.
const INTERACTIVE_FRAME =
  '[data-screen-interact-mode="true"] iframe[data-design-preview-iframe]';

interface InteractEntrySnapshot {
  topBar: Rect | null;
  leftShell: Rect | null;
  topBarInteractPressed: string | null | undefined;
  controls: Record<ControlName, ControlSample>;
  removedControls: {
    heightInput: number;
    exitButton: number;
    editButton: number;
    annotateButton: number;
  };
  screenShellCount: number;
  bottomToolbarCount: number;
  rightPanelCount: number;
}

async function enterInteractAndSampleImmediately(
  app: App,
  width: number,
  height: number,
  { phone = false }: { phone?: boolean } = {},
): Promise<InteractEntrySnapshot> {
  const page = app.page;
  await page.setViewportSize({ width, height });
  await app.open(await app.seed(FIXTURE_HTML));

  const screenShell = page.locator("[data-screen-shell]");
  await expect(screenShell).toHaveCount(1);
  await expect(screenShell).toHaveAttribute(
    "data-screen-interact-mode",
    "false",
  );
  const previewIframe = screenShell.locator(
    "iframe[data-design-preview-iframe]",
  );
  await expect(previewIframe).toBeVisible();
  // Below `md` the open left panel is a drawer over the canvas, and so over
  // the top bar; close it to reach the mode switch.
  if (phone) {
    await page.getByRole("button", { name: "Layers", exact: true }).click();
  }
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  await expect(screenShell).toHaveAttribute(
    "data-screen-interact-mode",
    "true",
  );
  await expect(page.locator(CONTROL_SELECTORS.screen)).toBeVisible();
  if (phone) {
    await expect
      .poll(() =>
        page.evaluate((selector) => {
          const target = document.querySelector(selector);
          if (!target) return false;
          const { x, y, width, height } = target.getBoundingClientRect();
          return target.contains(
            document.elementFromPoint(x + width / 2, y + height / 2),
          );
        }, CONTROL_SELECTORS.modeSwitch),
      )
      .toBe(true);
  }
  await expect(screenShell.locator("[data-frame-full-view]")).toBeHidden();
  // Interact loads the page afresh, with only its own bridges, so the preview
  // is a new iframe. The screen still has exactly one.
  await expect(previewIframe).toHaveCount(1);
  await expect(previewIframe).toBeVisible();

  return page.evaluate((selectors) => {
    const bounds = (element: Element | null): Rect | null => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const controls = Object.fromEntries(
      Object.entries(selectors).map(([name, selector]) => {
        const target = document.querySelector(selector);
        const rect = bounds(target);
        const visible = Boolean(rect && rect.width > 0 && rect.height > 0);
        const point =
          rect && visible
            ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            : null;
        const hit = point ? document.elementFromPoint(point.x, point.y) : null;
        return [
          name,
          {
            rect,
            visible,
            disabled: target instanceof HTMLButtonElement && target.disabled,
            hit: {
              targetFound: target !== null,
              hitsTarget: Boolean(target && hit && target.contains(hit)),
              hit: hit?.tagName.toLowerCase() ?? null,
            },
          },
        ];
      }),
    ) as unknown as Record<ControlName, ControlSample>;
    const count = (selector: string) =>
      document.querySelectorAll(selector).length;
    return {
      topBar: bounds(document.querySelector("[data-design-top-bar]")),
      leftShell: bounds(
        document.querySelector('[data-design-chrome-region="left-shell"]'),
      ),
      topBarInteractPressed: document
        .querySelector('[data-design-top-bar] [data-design-mode="interact"]')
        ?.getAttribute("aria-pressed"),
      controls,
      removedControls: {
        heightInput: count('input[aria-label="Height"]'),
        exitButton: count('button[aria-label="Exit responsive preview"]'),
        editButton: count('button[aria-label="Edit"]'),
        annotateButton: count('button[aria-label="Annotate"]'),
      },
      screenShellCount: document.querySelectorAll("[data-screen-shell]").length,
      bottomToolbarCount: count("[data-design-bottom-toolbar]"),
      rightPanelCount: document.querySelectorAll(
        '[data-design-chrome-region="right-panel"]',
      ).length,
    };
  }, CONTROL_SELECTORS);
}

function expectInsideBar(snapshot: InteractEntrySnapshot, name: ControlName) {
  const bar = snapshot.topBar!;
  const rect = snapshot.controls[name].rect!;
  expect.soft(rect.x, `${name} left edge`).toBeGreaterThanOrEqual(bar.x);
  expect
    .soft(rect.x + rect.width, `${name} right edge`)
    .toBeLessThanOrEqual(bar.x + bar.width + 0.5);
  expect.soft(rect.y, `${name} top edge`).toBeGreaterThanOrEqual(bar.y);
  expect
    .soft(rect.y + rect.height, `${name} bottom edge`)
    .toBeLessThanOrEqual(bar.y + bar.height + 0.5);
}

test("Interact controls sit in the top bar and clear the right edge at Tiana's 1751×897 viewport", async ({
  app,
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(app, 1751, 897);

  expect(snapshot.screenShellCount).toBe(1);
  // Nothing in a live preview is selectable, so Interact shows no bottom toolbar.
  expect(snapshot.bottomToolbarCount).toBe(0);
  expect(snapshot.rightPanelCount).toBe(0);
  expect(snapshot.topBar).toMatchObject({ y: 0, height: 48 });
  expect(snapshot.leftShell).not.toBeNull();
  expect(snapshot.topBar!.x).toBe(
    snapshot.leftShell!.x + snapshot.leftShell!.width,
  );
  expect(snapshot.topBar!.x + snapshot.topBar!.width).toBe(1751);
  expect(snapshot.topBarInteractPressed).toBe("true");

  for (const name of Object.keys(CONTROL_SELECTORS) as ControlName[]) {
    const control = snapshot.controls[name];
    expect.soft(control.visible, `${name} is visible`).toBe(true);
    if (!control.disabled) {
      expect
        .soft(control.hit, `${name} center should hit itself`)
        .toMatchObject({ targetFound: true, hitsTarget: true });
    }
    if (control.rect) expectInsideBar(snapshot, name);
  }
  // Nothing has been visited yet, so there is nowhere to go back or forward to.
  expect(snapshot.controls.back.disabled).toBe(true);
  expect(snapshot.controls.forward.disabled).toBe(true);

  // Figma frame 2382-4622: mode switch · device · theme, then back/forward ·
  // screen · reload, then zoom, all on one 24px control row.
  const x = (name: ControlName) => snapshot.controls[name].rect!.x;
  expect(x("modeSwitch")).toBeLessThan(x("device"));
  expect(x("device")).toBeLessThan(x("theme"));
  expect(x("theme")).toBeLessThan(x("back"));
  expect(x("back")).toBeLessThan(x("forward"));
  expect(x("forward")).toBeLessThan(x("screen"));
  expect(x("screen")).toBeLessThan(x("reload"));
  expect(x("reload")).toBeLessThan(x("zoom"));
  for (const name of ["device", "theme", "screen", "back", "reload"] as const) {
    expect(snapshot.controls[name].rect!.height, `${name} height`).toBe(24);
  }
  expect(snapshot.controls.screen.rect!.width).toBeCloseTo(264, 0);
  // The picker names a screen; it does not read like a route picker.
  await expect(page.locator(CONTROL_SELECTORS.screen)).not.toContainText("/");
  await expect(page.locator(CONTROL_SELECTORS.screen)).toHaveAttribute(
    "aria-label",
    "Screen",
  );

  // No width/height inputs and no Edit/Annotate/Exit buttons: the mode switch
  // is the way out.
  expect(snapshot.removedControls).toEqual({
    heightInput: 0,
    exitButton: 0,
    editButton: 0,
    annotateButton: 0,
  });

  await cdpScreenshot(page, testInfo.outputPath("tiana-interact.png"));
});

// oracle: none — verifies hit-testing and layout bounds, not parity with a design reference.
test("Interact controls stay inside the 48px bar at Damian's 1456×410 viewport", async ({
  app,
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(app, 1456, 410);

  expect(snapshot.screenShellCount).toBe(1);
  expect(snapshot.bottomToolbarCount).toBe(0);
  expect(snapshot.rightPanelCount).toBe(0);
  for (const name of Object.keys(CONTROL_SELECTORS) as ControlName[]) {
    const control = snapshot.controls[name];
    expect.soft(control.visible, `${name} is visible`).toBe(true);
    if (!control.disabled) {
      expect
        .soft(control.hit, `${name} center should hit itself`)
        .toMatchObject({ targetFound: true, hitsTarget: true });
    }
    if (control.rect) expectInsideBar(snapshot, name);
  }

  // At 410px tall the preview is limited by height. It takes the space the
  // bottom toolbar used to reserve and ends one 24px gutter above the window's
  // bottom edge, where it used to end 72px above it.
  await expect
    .poll(async () => {
      const box = await page.locator(INTERACTIVE_FRAME).boundingBox();
      return box ? 410 - (box.y + box.height) : null;
    })
    .toBeLessThan(48);

  await cdpScreenshot(page, testInfo.outputPath("damian-interact.png"));
});

// oracle: none — verifies layout bounds on a phone-width viewport.
test("Interact keeps the mode switch, device, theme and screen on a 390px viewport", async ({
  app,
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(app, 390, 844, {
    phone: true,
  });

  // The mode switch (the way out), device and theme fit; the screen dropdown
  // starts inside the bar and the bar scrolls sideways to the rest.
  for (const name of ["modeSwitch", "device", "theme"] as const) {
    const control = snapshot.controls[name];
    expect.soft(control.visible, `${name} is visible`).toBe(true);
    expect
      .soft(control.hit, `${name} center should hit itself`)
      .toMatchObject({ targetFound: true, hitsTarget: true });
    if (control.rect) expectInsideBar(snapshot, name);
  }
  expect(snapshot.controls.screen.visible).toBe(true);
  expect(snapshot.controls.screen.rect!.x).toBeLessThan(
    snapshot.topBar!.x + snapshot.topBar!.width,
  );
  await page.locator(CONTROL_SELECTORS.screen).scrollIntoViewIfNeeded();
  const screen = await page.locator(CONTROL_SELECTORS.screen).boundingBox();
  expect(screen!.x + screen!.width).toBeLessThanOrEqual(390.5);
  // Back, forward and reload give way below `sm`; the screen dropdown stays.
  for (const name of ["back", "forward", "reload"] as const) {
    expect
      .soft(snapshot.controls[name].visible, `${name} is hidden`)
      .toBe(false);
  }
  expect(snapshot.removedControls.exitButton).toBe(0);

  await cdpScreenshot(page, testInfo.outputPath("phone-interact.png"));
});

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `action ${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

const html = (title: string, extra = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;font:20px system-ui;background:#ffffff;color:#111111}${extra}</style></head><body><h1 id="title">${title}</h1><a id="link" href="/pricing">Pricing link</a></body></html>`;

// An option is the screen's name and nothing else: no route sits beside it.
function screenOption(page: Page, name: string) {
  return page.getByRole("option", { name, exact: true });
}

const DARK_CSS =
  "@media (prefers-color-scheme: dark){body{background:#111111;color:#ffffff}}";

// The editor writes its overview URL a moment after it loads. A click on
// Interact that lands before that is overwritten by it and drops back to Design.
async function enterInteractOnceSettled(page: Page): Promise<void> {
  await page.waitForURL(/editorView=overview/);
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
}

function seedRoutedDesign(app: App): Promise<string> {
  return app.seed(html("Home screen", DARK_CSS), {
    title: "Interact routes",
    files: {
      "pricing.html": html("Pricing screen", DARK_CSS),
      "docs.html": html("Docs screen"),
    },
  });
}

// oracle: none — drives the Interact screen, device and theme controls end to end.
test("screen picker, history, reload, device and theme drive the preview", async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  await app.open(await seedRoutedDesign(app));

  await enterInteractOnceSettled(page);
  const screen = page.locator(CONTROL_SELECTORS.screen);
  await expect(screen).toBeVisible();
  const back = page.locator(CONTROL_SELECTORS.back);
  const forward = page.locator(CONTROL_SELECTORS.forward);
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  const startScreen = (await screen.innerText()).trim();
  const jumpTo = async (target: string) => {
    await screen.click();
    await screenOption(page, target).click();
    await expect(screen).toHaveText(target);
  };
  const other = startScreen === "Pricing" ? "Docs" : "Pricing";

  // The list names screens and carries no route text.
  await screen.click();
  await expect(screenOption(page, "Pricing")).toBeVisible();
  const names = (await page.getByRole("option").allInnerTexts()).map((name) =>
    name.trim(),
  );
  expect(names).toEqual(expect.arrayContaining(["Home", "Pricing", "Docs"]));
  expect(names.filter((name) => name.includes("/"))).toEqual([]);
  // Re-picking the current screen closes the list without leaving it.
  await screenOption(page, startScreen).click();
  await expect(screen).toHaveText(startScreen);

  await jumpTo(other);
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(screen).toHaveText(startScreen);
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect(screen).toHaveText(other);

  // Reload remounts the preview document.
  const frameHandle = await page.locator(INTERACTIVE_FRAME).elementHandle();
  await page.locator(CONTROL_SELECTORS.reload).click();
  await expect
    .poll(() => frameHandle!.evaluate((frame) => frame.isConnected))
    .toBe(false);
  await expect(screen).toHaveText(other);

  // Device: a preset resizes the preview and keeps its choice across screens.
  await page.locator(CONTROL_SELECTORS.device).click();
  await page.getByRole("option", { name: /iPhone 17\b(?! P)/ }).click();
  await expect(page.locator(CONTROL_SELECTORS.device)).toContainText(
    "iPhone 17",
  );
  await jumpTo(startScreen);
  await expect(page.locator(CONTROL_SELECTORS.device)).toContainText(
    "iPhone 17",
  );
  await expect
    .poll(async () =>
      page
        .locator(INTERACTIVE_FRAME)
        .evaluate((frame) => (frame as HTMLIFrameElement).clientWidth),
    )
    .toBe(402);
});

// oracle: none — checks the emulated color scheme against the design's own CSS.
test("System shows the design as authored, Light and Dark force a scheme, and only Dark without dark styles asks the agent", async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  await page.emulateMedia({ colorScheme: "light" });
  await app.open(await seedRoutedDesign(app));

  await enterInteractOnceSettled(page);
  const screen = page.locator(CONTROL_SELECTORS.screen);
  await expect(screen).toBeVisible();
  const theme = page.locator(CONTROL_SELECTORS.theme);

  const pick = async (label: string) => {
    await theme.click();
    await page.getByRole("menuitemradio", { name: label }).click();
    // Let the menu finish closing before the next one opens.
    await expect(page.getByRole("menuitemradio")).toHaveCount(0);
  };
  const background = () =>
    page
      .frameLocator(INTERACTIVE_FRAME)
      .locator("body")
      .evaluate((body) => getComputedStyle(body).backgroundColor);
  const prefersDark = () =>
    page
      .frameLocator(INTERACTIVE_FRAME)
      .locator("body")
      .evaluate(
        () => window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
  const publishedInteract = () =>
    page.evaluate(
      () =>
        (window as unknown as { __designSelection?: { interact?: unknown } })
          .__designSelection?.interact,
    );

  // Home has dark styles. Interact opens on System, which forces nothing, so
  // the design follows the browser's own scheme.
  await screen.click();
  await screenOption(page, "Home").click();
  await expect(theme).toContainText("System");
  await expect.poll(background).toBe("rgb(255, 255, 255)");
  expect(await prefersDark()).toBe(false);
  expect(await publishedInteract()).toMatchObject({ theme: "system" });

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe("rgb(17, 17, 17)");
  expect(await prefersDark()).toBe(true);

  // Light forces Light even while the browser prefers dark.
  await pick("Light");
  await expect.poll(background).toBe("rgb(255, 255, 255)");
  expect(await prefersDark()).toBe(false);
  await page.emulateMedia({ colorScheme: "light" });

  await pick("Dark");
  await expect.poll(background).toBe("rgb(17, 17, 17)");
  expect(await prefersDark()).toBe(true);
  expect(await publishedInteract()).toMatchObject({ theme: "dark" });

  // The picker offers Light, Dark and System.
  await theme.click();
  await expect(page.getByRole("menuitemradio")).toHaveText([
    "Light",
    "Dark",
    "System",
  ]);
  // Re-picking the current mode closes the menu without changing it.
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);

  // Back on System the override is gone and the design is as authored again.
  await pick("System");
  await expect.poll(background).toBe("rgb(255, 255, 255)");
  expect(await prefersDark()).toBe(false);
  expect(await publishedInteract()).toMatchObject({ theme: "system" });

  // Docs has no dark styles. System shows it as authored, with the browser's
  // own scheme untouched, and asks nothing of the agent.
  await page.emulateMedia({ colorScheme: "dark" });
  await screen.click();
  await screenOption(page, "Docs").click();
  await expect.poll(background).toBe("rgb(255, 255, 255)");
  expect(await prefersDark()).toBe(true);
  await expect(page.getByText(/Add a dark theme to this design/)).toHaveCount(
    0,
  );
  await page.emulateMedia({ colorScheme: "light" });

  // Dark is listed as unavailable, and choosing it leaves the preview as it is
  // and puts the request in the agent chat, unsent.
  await pick("Light");
  await theme.click();
  const dark = page.getByRole("menuitemradio", { name: "Dark" });
  await expect(dark).toHaveAttribute("data-design-theme-unavailable", "true");
  await dark.hover();
  await expect(page.getByText("This design has no dark styles.")).toBeVisible();
  await dark.click();
  await expect.poll(background).toBe("rgb(255, 255, 255)");
  expect(await prefersDark()).toBe(false);
  await expect(page.getByText(/Add a dark theme to this design/)).toBeVisible();
  await theme.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Light" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
});

// oracle: none — a URL screen is another page's document, which the editor does not script.
test("a URL screen has no theme picker at all, while screens and reload still work", async ({
  app,
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  // A loopback URL is a localhost screen, which needs a bridge connection to
  // render at all; any other host is a plain URL screen, answered here.
  const url = "https://preview.example.test/robots.txt";
  await page.route(url, (route) =>
    route.fulfill({
      contentType: "text/plain",
      body: "User-agent: *\nAllow: /\n",
    }),
  );
  const designId = await app.seed(html("Home screen"), {
    title: "URL screen",
    files: { "app.html": url },
  });
  const appId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "app.html",
  )?.id;
  if (!appId) throw new Error("seeded design has no app.html screen");
  await postAction(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", appId],
        value: { sourceType: "url", url, width: 1280, height: 800 },
      },
    ],
  });
  await app.open(designId);

  await enterInteractOnceSettled(page);
  const screen = page.locator(CONTROL_SELECTORS.screen);
  await expect(screen).toBeVisible();
  const theme = page.locator(CONTROL_SELECTORS.theme);
  const device = page.locator(CONTROL_SELECTORS.device);
  await expect(theme).toBeEnabled();
  const screenBefore = await screen.boundingBox();

  await screen.click();
  await screenOption(page, "App").click();
  await expect(screen).toHaveText("App");
  await expect(page.locator(INTERACTIVE_FRAME)).toHaveAttribute("src", url);
  // Hidden, not disabled: no picker and no explanation, and the rest of the
  // bar stays where it was.
  await expect(theme).toHaveCount(0);
  await expect(
    page.locator("[data-design-interact-theme-unavailable]"),
  ).toHaveCount(0);
  await expect(device).toBeVisible();
  const screenAfter = await screen.boundingBox();
  expect(screenAfter!.x).toBeCloseTo(screenBefore!.x, 0);
  expect(screenAfter!.width).toBeCloseTo(screenBefore!.width, 0);

  // Back still walks the screens visited, and Reload remounts the URL frame.
  const frame = await page.locator(INTERACTIVE_FRAME).elementHandle();
  await page.locator(CONTROL_SELECTORS.reload).click();
  await expect
    .poll(() => frame!.evaluate((element) => element.isConnected))
    .toBe(false);
  await expect(theme).toHaveCount(0);
  await page.locator(CONTROL_SELECTORS.back).click();
  await expect(theme).toBeEnabled();
});

// oracle: none — Escape and the mode switch both leave Interact.
test("Escape and the mode switch leave Interact", async ({ app, page }) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  await app.open(await app.seed(FIXTURE_HTML));
  const interact = page.locator(
    '[data-design-top-bar] [data-design-mode="interact"]',
  );
  const design = page.locator(
    '[data-design-top-bar] [data-design-mode="edit"]',
  );

  await interact.click();
  await expect(page.locator(CONTROL_SELECTORS.screen)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(design).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(CONTROL_SELECTORS.screen)).toHaveCount(0);

  await interact.click();
  await expect(page.locator(CONTROL_SELECTORS.screen)).toBeVisible();
  await design.click();
  await expect(design).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(CONTROL_SELECTORS.screen)).toHaveCount(0);
});
