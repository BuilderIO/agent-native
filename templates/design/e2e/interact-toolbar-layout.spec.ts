import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { cdpScreenshot, gotoEditor, readSeedDesignId } from "./helpers";

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
  route: "[data-design-top-bar] [data-design-interact-route]",
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
  bottomToolbarGroups: Array<string | null>;
  rightPanelCount: number;
}

async function enterInteractAndSampleImmediately(
  page: Page,
  width: number,
  height: number,
  { phone = false }: { phone?: boolean } = {},
): Promise<InteractEntrySnapshot> {
  await page.setViewportSize({ width, height });
  await gotoEditor(page, await readSeedDesignId());

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
  const previewIframeHandle = await previewIframe.elementHandle();
  if (!previewIframeHandle) throw new Error("screen preview iframe is missing");
  // Below `md` the open left panel is a drawer over the canvas, and so over
  // the top bar; close it to reach the mode switch.
  if (phone) {
    await page.getByRole("button", { name: "File", exact: true }).click();
  }
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  await expect(screenShell).toHaveAttribute(
    "data-screen-interact-mode",
    "true",
  );
  await expect(page.locator(CONTROL_SELECTORS.route)).toBeVisible();
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
      bottomToolbarGroups: Array.from(
        document.querySelectorAll(
          "[data-design-bottom-toolbar] [data-design-toolbar-group]",
        ),
      ).map((group) => group.getAttribute("data-design-toolbar-group")),
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
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(page, 1751, 897);

  expect(snapshot.screenShellCount).toBe(1);
  // Interact keeps only Move and the Agent in the floating toolbar.
  expect(snapshot.bottomToolbarGroups).toEqual(["move", "agent"]);
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
  // route · reload, then zoom, all on one 24px control row.
  const x = (name: ControlName) => snapshot.controls[name].rect!.x;
  expect(x("modeSwitch")).toBeLessThan(x("device"));
  expect(x("device")).toBeLessThan(x("theme"));
  expect(x("theme")).toBeLessThan(x("back"));
  expect(x("back")).toBeLessThan(x("forward"));
  expect(x("forward")).toBeLessThan(x("route"));
  expect(x("route")).toBeLessThan(x("reload"));
  expect(x("reload")).toBeLessThan(x("zoom"));
  for (const name of ["device", "theme", "route", "back", "reload"] as const) {
    expect(snapshot.controls[name].rect!.height, `${name} height`).toBe(24);
  }
  expect(snapshot.controls.route.rect!.width).toBeCloseTo(264, 0);

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
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(page, 1456, 410);

  expect(snapshot.screenShellCount).toBe(1);
  expect(snapshot.bottomToolbarGroups).toEqual(["move", "agent"]);
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

  await cdpScreenshot(page, testInfo.outputPath("damian-interact.png"));
});

// oracle: none — verifies layout bounds on a phone-width viewport.
test("Interact keeps the mode switch, device, theme and route on a 390px viewport", async ({
  page,
}, testInfo) => {
  const snapshot = await enterInteractAndSampleImmediately(page, 390, 844, {
    phone: true,
  });

  // The mode switch (the way out), device and theme fit; the route dropdown
  // starts inside the bar and the bar scrolls sideways to the rest.
  for (const name of ["modeSwitch", "device", "theme"] as const) {
    const control = snapshot.controls[name];
    expect.soft(control.visible, `${name} is visible`).toBe(true);
    expect
      .soft(control.hit, `${name} center should hit itself`)
      .toMatchObject({ targetFound: true, hitsTarget: true });
    if (control.rect) expectInsideBar(snapshot, name);
  }
  expect(snapshot.controls.route.visible).toBe(true);
  expect(snapshot.controls.route.rect!.x).toBeLessThan(
    snapshot.topBar!.x + snapshot.topBar!.width,
  );
  await page.locator(CONTROL_SELECTORS.route).scrollIntoViewIfNeeded();
  const route = await page.locator(CONTROL_SELECTORS.route).boundingBox();
  expect(route!.x + route!.width).toBeLessThanOrEqual(390.5);
  // Back, forward and reload give way below `sm`; the route dropdown stays.
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
    `${e2eBaseURL()}/_agent-native/actions/${name}`,
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

// An option reads "<title> <route>"; the route is its own element, so match it
// exactly (a text match on "/" would hit every option).
function routeOption(page: Page, target: string) {
  const escaped = target.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return page.getByRole("option").filter({
    has: page
      .locator("[data-design-route-path]")
      .filter({ hasText: new RegExp(`^${escaped}$`) }),
  });
}

const DARK_CSS =
  "@media (prefers-color-scheme: dark){body{background:#111111;color:#ffffff}}";

async function createRoutedDesign(pageHandle: Page): Promise<string> {
  const created = await postAction(pageHandle, "create-design", {
    title: "Interact routes",
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  for (const [filename, content] of [
    ["index.html", html("Home screen", DARK_CSS)],
    ["pricing.html", html("Pricing screen", DARK_CSS)],
    ["docs.html", html("Docs screen")],
  ] as const) {
    await postAction(pageHandle, "create-file", {
      designId,
      filename,
      content,
      fileType: "html",
    });
  }
  return designId;
}

// oracle: none — drives the Interact route, device and theme controls end to end.
test("route picker, history, reload, device and theme drive the preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  const designId = await createRoutedDesign(page);
  await gotoEditor(page, designId);

  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const route = page.locator(CONTROL_SELECTORS.route);
  await expect(route).toBeVisible();
  const back = page.locator(CONTROL_SELECTORS.back);
  const forward = page.locator(CONTROL_SELECTORS.forward);
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  const startRoute = (
    await route.locator("[data-design-route-path]").innerText()
  ).trim();
  const jumpTo = async (target: string) => {
    await route.click();
    await routeOption(page, target).click();
    await expect(route).toContainText(target);
  };
  const other = startRoute === "/pricing" ? "/docs" : "/pricing";

  await jumpTo(other);
  await expect(back).toBeEnabled();
  await expect(forward).toBeDisabled();

  await back.click();
  await expect(route).toContainText(startRoute);
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect(route).toContainText(other);

  // Reload remounts the preview document.
  const frameHandle = await page.locator(INTERACTIVE_FRAME).elementHandle();
  await page.locator(CONTROL_SELECTORS.reload).click();
  await expect
    .poll(() => frameHandle!.evaluate((frame) => frame.isConnected))
    .toBe(false);
  await expect(route).toContainText(other);

  // Device: a preset resizes the preview and keeps its choice across routes.
  await page.locator(CONTROL_SELECTORS.device).click();
  await page.getByRole("option", { name: /iPhone 17\b(?! P)/ }).click();
  await expect(page.locator(CONTROL_SELECTORS.device)).toContainText(
    "iPhone 17",
  );
  await jumpTo(startRoute);
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
test("Light and Dark emulate prefers-color-scheme in the preview, and Dark without dark styles asks the agent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  await page.emulateMedia({ colorScheme: "light" });
  const designId = await createRoutedDesign(page);
  await gotoEditor(page, designId);

  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const route = page.locator(CONTROL_SELECTORS.route);
  await expect(route).toBeVisible();
  const theme = page.locator(CONTROL_SELECTORS.theme);

  const pick = async (label: string) => {
    await theme.click();
    await page.getByRole("menuitemradio", { name: label }).click();
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

  // Home has dark styles.
  await route.click();
  await routeOption(page, "/").click();
  await expect.poll(background).toBe("rgb(255, 255, 255)");

  await pick("Dark");
  await expect.poll(background).toBe("rgb(17, 17, 17)");
  expect(await prefersDark()).toBe(true);

  const published = await page.evaluate(
    () =>
      (window as unknown as { __designSelection?: { interact?: unknown } })
        .__designSelection?.interact,
  );
  expect(published).toMatchObject({ theme: "dark" });

  await pick("Light");
  await expect.poll(background).toBe("rgb(255, 255, 255)");
  expect(await prefersDark()).toBe(false);

  // The picker offers Light and Dark only.
  await theme.click();
  await expect(page.getByRole("menuitemradio")).toHaveText(["Light", "Dark"]);
  await page.keyboard.press("Escape");

  // Docs has no dark styles: Dark is listed as unavailable, and choosing it
  // leaves the preview Light and puts the request in the agent chat, unsent.
  await route.click();
  await routeOption(page, "/docs").click();
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

// oracle: none — a URL screen is served by another page, which never runs the theme bridge.
test("a URL screen cannot take the theme override and says why, while routes and reload still work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  const created = await postAction(page, "create-design", {
    title: "URL screen",
    projectType: "prototype",
  });
  const designId: string = created?.id ?? created?.data?.id;
  await postAction(page, "create-file", {
    designId,
    filename: "index.html",
    content: html("Home screen"),
    fileType: "html",
  });
  // A loopback URL is a localhost screen, which needs a bridge connection to
  // render at all; any other host is a plain URL screen, answered here.
  const url = "https://preview.example.test/robots.txt";
  await page.route(url, (route) =>
    route.fulfill({
      contentType: "text/plain",
      body: "User-agent: *\nAllow: /\n",
    }),
  );
  const app = await postAction(page, "create-file", {
    designId,
    filename: "app.html",
    content: url,
    fileType: "html",
  });
  const appId: string = app?.id ?? app?.data?.id ?? app?.file?.id;
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
  await gotoEditor(page, designId);

  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const route = page.locator(CONTROL_SELECTORS.route);
  await expect(route).toBeVisible();
  const theme = page.locator(CONTROL_SELECTORS.theme);
  await expect(theme).toBeEnabled();

  await route.click();
  await routeOption(page, "/robots.txt").click();
  await expect(route).toContainText("/robots.txt");
  await expect(page.locator(INTERACTIVE_FRAME)).toHaveAttribute("src", url);
  await expect(theme).toBeDisabled();
  await page.locator("[data-design-interact-theme-unavailable]").hover();
  await expect(
    page.getByText("Theme preview isn't available for this screen"),
  ).toBeVisible();

  // Back still walks the screens visited, and Reload remounts the URL frame.
  const frame = await page.locator(INTERACTIVE_FRAME).elementHandle();
  await page.locator(CONTROL_SELECTORS.reload).click();
  await expect
    .poll(() => frame!.evaluate((element) => element.isConnected))
    .toBe(false);
  await page.locator(CONTROL_SELECTORS.back).click();
  await expect(theme).toBeEnabled();
});

// oracle: none — Escape and the mode switch both leave Interact.
test("Escape and the mode switch leave Interact", async ({ page }) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  await gotoEditor(page, await readSeedDesignId());
  const interact = page.locator(
    '[data-design-top-bar] [data-design-mode="interact"]',
  );
  const design = page.locator(
    '[data-design-top-bar] [data-design-mode="edit"]',
  );

  await interact.click();
  await expect(page.locator(CONTROL_SELECTORS.route)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(design).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(CONTROL_SELECTORS.route)).toHaveCount(0);

  await interact.click();
  await expect(page.locator(CONTROL_SELECTORS.route)).toBeVisible();
  await design.click();
  await expect(design).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(CONTROL_SELECTORS.route)).toHaveCount(0);
});
