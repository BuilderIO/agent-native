import enUS from "../app/i18n/en-US";
import { FIXTURE_HTML, SEED_TITLE } from "./global-setup";
import {
  appPath,
  EDIT_MODE_BUTTON,
  expandAllLayers,
  INTERACT_MODE_BUTTON,
  must,
  openPageOverview,
  resetPersistedCanvasState,
} from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

type Box = { x: number; y: number; width: number; height: number };

const HEADINGS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;background:#ffffff;font-family:system-ui">
  <h1 data-agent-native-node-id="title" data-agent-native-layer-name="Title" style="margin:0;font-size:40px">Hero title</h1>
  <h2 data-agent-native-node-id="subtitle" data-agent-native-layer-name="Subtitle" style="margin:24px 0 0;font-size:24px">Subtitle</h2>
</body></html>`;

const BOXES = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#ffffff">
  <div data-agent-native-node-id="panel" data-agent-native-layer-name="Panel" style="position:absolute;left:80px;top:80px;width:400px;height:240px;padding:24px;box-sizing:border-box;background:#e2e8f0">
    <p data-agent-native-node-id="copy" data-agent-native-layer-name="Copy" style="margin:0">Panel copy</p>
  </div>
  <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" style="position:absolute;left:600px;top:80px;width:160px;height:120px;background:#93c5fd"></div>
  <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" style="position:absolute;left:760px;top:200px;width:160px;height:120px;background:#fca5a5"></div>
</body></html>`;

async function openFixture(app: App, html = FIXTURE_HTML) {
  const id = await app.seed(html, { title: SEED_TITLE });
  await app.open(id);
  return id;
}
// oracle-change: Creative context removed from Design; its assertions no longer apply

async function clickCenter(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
}

function selectionOverlay(app: App) {
  return app.page
    .locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .contentFrame()
    .locator('[data-agent-native-edit-overlay="selection"]');
}

async function expectBoxNear(actual: Box | null, expected: Box | null) {
  expect(actual).not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual![key] - expected![key]),
      `${key}: ${actual![key]} vs ${expected![key]}`,
    ).toBeLessThanOrEqual(2);
  }
}

test("editor renders the toolbar and the design iframe content", async ({
  app,
}) => {
  await openFixture(app);
  const page = app.page;
  const toolbar = page.locator("[data-design-bottom-toolbar]");
  for (const tool of [
    "Move",
    "Frame",
    "Rectangle",
    "Text",
    "Pen",
    "Pin comment",
  ]) {
    await expect(
      toolbar.getByRole("button", { name: tool, exact: true }),
    ).toBeVisible();
  }
  await expect(toolbar.getByRole("button", { name: /agent/i })).toHaveCount(0);
  await expect(
    toolbar.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.getByRole("button", { name: "Interact", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(app.node("e2e-alpha-button")).toHaveText("Alpha Button");
  await expect(
    app.page
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame()
      .getByText("E2E Hero Heading"),
  ).toBeVisible();
});

test("agent rail keeps the shared chat header and chat switcher", async ({
  app,
}) => {
  await openFixture(app);
  const page = app.page;
  await page
    .getByRole("tab", { name: enUS.designEditor.leftTabs.agent, exact: true })
    .click();

  const agentPanel = page.locator("[data-design-agent-panel]");
  // The Agent column is narrower than the tab strip needs, so its chats sit
  // behind one switcher whose menu carries the only New chat entry.
  const switcher = agentPanel.locator("[data-agent-thread-switcher]");
  await expect(switcher).toHaveText("New chat");
  await expect(agentPanel.locator('button[aria-label="New chat"]')).toHaveCount(
    0,
  );
  await expect(
    agentPanel.getByRole("button", {
      name: "Agent panel options",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    agentPanel.getByRole("button", { name: "Collapse sidebar", exact: true }),
  ).toBeVisible();
  for (const removed of ["Chat", "Workspace", "Workspace mode", "Share"]) {
    await expect(
      agentPanel.getByRole("button", { name: removed, exact: true }),
    ).toHaveCount(0);
  }

  const threadMenu = page.locator("[data-agent-thread-menu]");
  await switcher.click();
  await threadMenu
    .getByRole("menuitem")
    .and(page.locator(":not([data-agent-thread-menu-item])"))
    .click();
  await expect(threadMenu).toHaveCount(0);
  await switcher.click();
  await expect(threadMenu.locator("[data-agent-thread-menu-item]")).toHaveCount(
    2,
  );
  await expect(
    threadMenu.locator('[data-agent-thread-menu-item][aria-current="true"]'),
  ).toHaveCount(1);
});

test("agent rail stays inside a narrow viewport without the canvas toolbar covering its composer", async ({
  app,
}) => {
  await openFixture(app);
  const page = app.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-design-minimal-toggle="ui"]').click();
  await page
    .getByRole("tab", { name: enUS.designEditor.leftTabs.agent, exact: true })
    .click();

  const agentPanel = page.locator("[data-design-agent-panel]");
  await expect(agentPanel).toBeVisible();
  expect((await agentPanel.boundingBox())!.width).toBeLessThanOrEqual(334);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const composer = agentPanel
    .locator('[data-agent-composer-slot="root"]')
    .last();
  await expect(composer).toBeVisible();
  await expect(
    page.locator("[data-design-bottom-toolbar]"),
    "a phone-width Agent panel leaves no canvas for the toolbar, so it must not sit on the composer",
  ).toHaveCount(0);
});

test("designs list shared sidebar stays contained at normal and narrow widths", async ({
  app,
}) => {
  const page = app.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(appPath("/home"), { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Toggle agent", exact: true }).click();
  const sidebar = page
    .locator('[data-agent-sidebar-state="open"]')
    .filter({ has: page.locator("[data-agent-sidebar-chat-header]") });
  await expect(sidebar.locator('button[aria-label="New chat"]')).toBeVisible();
  await expect(
    sidebar.getByRole("button", { name: "Agent panel options", exact: true }),
  ).toBeVisible();
  const normal = (await sidebar.boundingBox())!;
  expect(normal.x + normal.width).toBeLessThanOrEqual(1280);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await expect(sidebar.locator("[data-agent-thread-switcher]")).toBeVisible();
  const narrow = (await sidebar.boundingBox())!;
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(390);
});

test("share dialog uses editor panel chrome", async ({ app }) => {
  {
    await openFixture(app);
    const page = app.page;
    await page
      .getByRole("button", { name: /^share(?: \(.+\))?$/i })
      .first()
      .click();

    const shareOptions = page.locator(
      '[role="tablist"][aria-label="Share options"]',
    );
    await expect(shareOptions).toBeVisible();
    const tabListBox = (await shareOptions.boundingBox())!;
    expect(tabListBox.width).toBeLessThanOrEqual(420);
    expect(tabListBox.height).toBeLessThanOrEqual(42);

    // oracle-change(templates/design/app/pages/design-editor/view/share-send-to-tab.test.tsx): Design's own Send to agent tab and its terminal preview are gone; the coding handoff is the shared panel's Send to prompt.
    await page.getByRole("tab", { name: "Share link" }).click();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(page.url()).origin,
      });
    await page.getByRole("button", { name: "Send to", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Open in Claude Code" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Copy agent prompt" }).click();
    await expect(
      page.getByText("Agent prompt copied", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      `Build this design as production code: ${SEED_TITLE}`,
    );

    const popover = page
      .locator("[data-radix-popper-content-wrapper]")
      .filter({ has: shareOptions })
      .first();
    expect((await popover.boundingBox())!.width).toBeLessThanOrEqual(650);

    await page.getByRole("tab", { name: "Share link" }).click();
    await page.getByRole("combobox", { name: "General access" }).click();
    const accessMenu = page
      .locator("[data-radix-popper-content-wrapper]")
      .filter({
        has: page.getByRole("option", {
          name: /^Anyone (?:in your organization|at .+)$/,
        }),
      })
      .last();
    await expect(accessMenu).toBeVisible();
    await expect(shareOptions).toBeVisible();
    const zIndex = (locator: typeof popover) =>
      locator.evaluate((node) =>
        Number.parseInt(getComputedStyle(node).zIndex || "0", 10),
      );
    expect(await zIndex(accessMenu)).toBeGreaterThan(await zIndex(popover));
    await page.keyboard.press("Escape");
  }
});

test("visual-edit route has no top bar and keeps Share, zoom and the mode tabs", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE_HTML);
  const page = app.page;
  await page.goto(appPath(`/visual-edit/${id}`), {
    waitUntil: "domcontentloaded",
  });
  const rightPanel = page.locator('[data-design-chrome-region="right-panel"]');
  await expect(rightPanel).toBeVisible();
  await expect(page.locator("[data-design-top-bar]")).toHaveCount(0);
  await expect(
    rightPanel.getByRole("button", { name: /^share/i }).first(),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-design-toolbar-zoom]")
      .getByRole("button", { name: /^\d+%$/ }),
  ).toBeVisible();
  const toolbar = page.locator("[data-design-bottom-toolbar]");
  for (const tab of ["Edit", "Interact"]) {
    await expect(
      toolbar.getByRole("button", { name: tab, exact: true }),
    ).toBeVisible();
  }
  await expect(
    toolbar.getByRole("button", { name: "Annotate", exact: true }),
  ).toHaveCount(0);
});

// oracle-change: the editor top bar is gone; its Share, presence and zoom moved into the 48px column heads and the bottom toolbar, so this now pins those heads.
test("column heads are 48px and keep Share in the right head and zoom in the bottom toolbar", async ({
  app,
}) => {
  await openFixture(app);
  const page = app.page;
  const leftHead = page.locator(
    '[data-design-left-column] > [data-design-chrome-region="left-header"]',
  );
  const rightHead = page.locator(
    '[data-design-chrome-region="right-toolbar-actions"]',
  );
  const leftHeadBox = must(await leftHead.boundingBox(), "left head");
  const rightHeadBox = must(await rightHead.boundingBox(), "right head");
  expect([leftHeadBox.y, leftHeadBox.height]).toStrictEqual([0, 48]);
  expect([rightHeadBox.y, rightHeadBox.height]).toStrictEqual([0, 48]);
  expect(rightHeadBox.x + rightHeadBox.width).toBeLessThanOrEqual(
    (await page.evaluate(() => innerWidth)) + 1,
  );
  await expect(
    page.getByRole("button", { name: "Add to Context" }),
  ).toHaveCount(0);

  const shareBox = must(
    await rightHead
      .getByRole("button", { name: /^share(?: \(.+\))?$/i })
      .first()
      .boundingBox(),
    "Share",
  );
  expect(shareBox.x).toBeGreaterThanOrEqual(rightHeadBox.x - 1);
  expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(
    rightHeadBox.x + rightHeadBox.width + 1,
  );
  expect(
    await rightHead.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
  await expect(
    page
      .locator("[data-design-toolbar-zoom]")
      .getByRole("button", { name: /^\d+%$/ }),
  ).toBeVisible();

  await page.evaluate(() =>
    localStorage.setItem("design.editor.inspectorWidth", "240"),
  );
  await page.reload();
  await expect(rightHead).toBeVisible();
  expect(must(await rightHead.boundingBox(), "right head").width).toBeCloseTo(
    280,
    0,
  );
  await expect(page.locator("[data-design-comments-toggle]")).toBeVisible();
  expect(
    await rightHead.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);
});

test("screen overview adds, targets and removes breakpoints from the unified control and saves each set", async ({
  app,
}) => {
  const page = app.page;
  const savedWidths = async (designId: string) => {
    const data = (await app.savedRecord(designId)).data as {
      breakpointSet?: { breakpoints: { widthPx: number }[] };
    };
    return (data.breakpointSet?.breakpoints ?? []).map(
      (breakpoint) => breakpoint.widthPx,
    );
  };
  let notifyFirstAdd: () => void = () => {};
  let releaseFirstAdd: () => void = () => {};
  const firstAddStarted = new Promise<void>(
    (resolve) => (notifyFirstAdd = resolve),
  );
  const firstAddGate = new Promise<void>(
    (resolve) => (releaseFirstAdd = resolve),
  );
  let holdFirstAdd = true;
  await page.route("**/_agent-native/actions/add-breakpoint", async (route) => {
    const response = await route.fetch();
    if (holdFirstAdd) {
      holdFirstAdd = false;
      notifyFirstAdd();
      await firstAddGate;
    }
    await route.fulfill({ response });
  });

  const id = await app.seed(FIXTURE_HTML);
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto(appPath(`/design/${id}?view=overview&zoom=24`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-card]")).toBeVisible();
  await openPageOverview(page);
  // oracle-change: the All screens row is gone; selecting a page row in the Pages list shows the same breakpoint control.
  await page.locator("[data-screen-row]").first().click();
  const control = page.locator("[data-breakpoint-device-control]");
  const base = control.getByRole("button", { name: "Base" });
  await expect(base).toHaveAttribute("aria-pressed", "true");

  await control.getByRole("button", { name: "Add breakpoint" }).click();
  await page.getByRole("button", { name: /Tablet\s+810/ }).click();
  const tablet = control.getByRole("button", { name: "810" });
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(1);
  await tablet.click();
  await expect(tablet).toHaveAttribute("aria-pressed", "true");
  await base.click();
  await expect(base).toHaveAttribute("aria-pressed", "true");

  await firstAddStarted;
  await control.getByRole("button", { name: "Add breakpoint" }).click();
  await page.getByPlaceholder("Custom width").fill("700");
  const addCustom = page.getByRole("button", { name: "Add", exact: true });
  await expect(addCustom).toBeDisabled();
  releaseFirstAdd();
  await expect(addCustom).toBeEnabled();
  await addCustom.click();
  const custom = control.getByRole("button", { name: "700" });
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(2);
  await expect.poll(() => savedWidths(id)).toStrictEqual([700, 810]);

  await custom.click();
  await control.getByRole("button", { name: "Breakpoint options" }).click();
  await page.getByRole("menuitem", { name: "Remove breakpoint" }).click();
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(1);
  await expect.poll(() => savedWidths(id)).toStrictEqual([810]);

  await tablet.click();
  await control.getByRole("button", { name: "Breakpoint options" }).click();
  await page.getByRole("menuitem", { name: "Remove breakpoint" }).click();
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(0);
  await expect.poll(() => savedWidths(id)).toStrictEqual([]);
});

test("the frame + offers the next built-in breakpoint and skips one equal to the screen's own width", async ({
  app,
}) => {
  const page = app.page;
  const id = await app.seed(FIXTURE_HTML, {
    files: { "laptop.html": FIXTURE_HTML },
  });
  const record = await app.savedRecord(id);
  const fileId = (name: string) =>
    record.files.find((file) => file.filename === name)!.id;
  const post = async (name: string, data: Record<string, unknown>) =>
    expect(
      (
        await page.request.post(appPath(`/_agent-native/actions/${name}`), {
          data,
        })
      ).ok(),
    ).toBe(true);
  await post("update-design", {
    id,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId("index.html")],
        value: { sourceType: "inline", width: 1440, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId("index.html")],
        value: { x: 0, y: 0, width: 1440, height: 900, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", fileId("laptop.html")],
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId("laptop.html")],
        value: { x: 0, y: 2000, width: 1280, height: 900, z: 1 },
      },
    ],
  });
  for (const breakpoint of [
    { label: "Mobile", widthPx: 390 },
    { label: "Tablet", widthPx: 768 },
  ]) {
    await post("add-breakpoint", { designId: id, ...breakpoint });
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto(appPath(`/design/${id}?view=overview&zoom=24`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-breakpoint-frame]")).toHaveCount(4);

  await expect(
    page.locator('button[title$="breakpoint (1280px) to all pages"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('button[title^="Add "][title$=" to all pages"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('button[title$="breakpoint (1280px) to all pages"]'),
  ).toHaveAttribute("title", "Add Desktop breakpoint (1280px) to all pages");
});

test("screen overview keeps frame labels contained when header space is tight", async ({
  app,
}) => {
  await openFixture(app);
  const page = app.page;
  const screenShell = page
    .locator("[data-screen-shell]")
    .filter({ has: page.locator("[data-screen-card]") })
    .first();
  const screenCard = screenShell.locator("[data-screen-card]");
  const initialCardBox = (await screenCard.boundingBox())!;

  await page.mouse.move(
    initialCardBox.x + initialCardBox.width / 2,
    initialCardBox.y + initialCardBox.height / 2,
  );
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Control");
  await expect(screenShell.locator("[data-frame-full-view]")).toHaveCount(0);
  let previous = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await screenCard.boundingBox());
      const stable = now === previous;
      previous = now;
      return stable;
    })
    .toBe(true);

  await expect(screenShell.locator("[data-frame-dimensions]")).toHaveCount(0);
  const cardBox = (await screenCard.boundingBox())!;
  const titleBox = (await screenShell
    .locator("[data-frame-title]")
    .boundingBox())!;
  expect(titleBox.width).toBeGreaterThan(0);
  expect(titleBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(
    cardBox.x + cardBox.width + 1,
  );
});

test("a plain click selects the element under the cursor, the inspector shows its values, and another click replaces it", async ({
  app,
}) => {
  await openFixture(app, HEADINGS);
  await app.zoomToFit();
  const size = app.page.locator('input[aria-label="Size" i]').first();

  await clickCenter(app, "title");
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Title"]);
  await expect(size).toHaveValue("40");
  await expect(app.page.locator("[data-frame-selection-box]")).toHaveCount(0);
  await expectBoxNear(
    await selectionOverlay(app).boundingBox(),
    await app.node("title").boundingBox(),
  );

  await clickCenter(app, "subtitle");
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Subtitle"]);
  await expect(size).toHaveValue("24");
  await expectBoxNear(
    await selectionOverlay(app).boundingBox(),
    await app.node("subtitle").boundingBox(),
  );
});

test("middle-mouse pan follows each pointer step 1:1 over screen content", async ({
  app,
}) => {
  await openFixture(app, HEADINGS);
  await app.zoomToFit();
  const card = app.page.locator("[data-screen-card]");
  const title = await app.designRect("title");
  const start = await app.pagePoint(
    title.x + title.width / 2,
    title.y + title.height / 2,
  );
  const cardTop = (await card.boundingBox())!.y;

  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down({ button: "middle" });
  for (let step = 1; step <= 6; step += 1) {
    await app.page.mouse.move(start.x, start.y + step * 12);
    await expect
      .poll(async () => Math.round((await card.boundingBox())!.y - cardTop))
      .toBe(step * 12);
  }
  await app.page.mouse.up({ button: "middle" });

  await expect.poll(() => app.selectedLayers()).toStrictEqual([]);
});

test("left sidebar switches between all screens and focused screens", async ({
  app,
}) => {
  await openFixture(app);
  const page = app.page;
  const sidebar = page.locator("aside").first();
  const pageRows = sidebar.locator("[data-screen-row]");
  const currentPageRow = pageRows.locator('[aria-current="page"]');
  const homeScreen = sidebar
    .getByRole("button", { name: "Home", exact: true })
    .first();
  await expect(currentPageRow).toHaveCount(0);
  await expect(homeScreen).not.toHaveAttribute("aria-current", "page");

  await homeScreen.click();
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Home"]);
  await expect(currentPageRow).toHaveCount(0);

  // oracle-change: Interact has no Pages list, so the current-row check moves to the preview's screen shell.
  await page.locator(INTERACT_MODE_BUTTON).click();
  await expect(
    page.locator('[data-screen-shell][data-screen-interact-mode="true"]'),
  ).toHaveCount(1);
  await expect(
    page
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame()
      .getByText("E2E Hero Heading"),
  ).toBeVisible();

  await page.locator(EDIT_MODE_BUTTON).click();
  await openPageOverview(page);
  await expect(currentPageRow).toHaveCount(0);
});

if (process.env.E2E_SHOW_DESIGN_SECONDARY_LEFT_PANELS === "0") {
  test("with secondary panels disabled, Tools, Assets and Code deep links open Layers instead", async ({
    app,
  }) => {
    const id = await app.seed(FIXTURE_HTML, { title: SEED_TITLE });
    const fileTab = app.page.getByRole("tab", {
      name: enUS.designEditor.leftTabs.file,
      exact: true,
    });
    for (const panel of ["tools", "assets", "code"]) {
      await resetPersistedCanvasState(app.page);
      await app.page.goto(appPath(`/design/${id}?panel=${panel}`), {
        waitUntil: "domcontentloaded",
      });
      await expect(
        fileTab,
        `?panel=${panel} must fall back to the File tab`,
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        app.page.getByRole("tree", { name: "Layers" }),
      ).toBeVisible();
      await expect(
        app.page.getByRole("button", { name: /Shader Fills/ }),
      ).toHaveCount(0);
    }
  });
}

test("a selected element's resize handle stays on top of a hovered neighbour and still resizes", async ({
  app,
}) => {
  const id = await openFixture(app, BOXES);
  await app.zoomToFit();
  await clickCenter(app, "box-a");
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Box A"]);
  const before = await app.savedNodes(id);
  const handle = app.page
    .locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .contentFrame()
    .locator('[data-agent-native-edit-handle="se"]');
  await expect(handle).toBeVisible();
  const from = await app.pagePoint(760, 200);
  const to = await app.pagePoint(760 + 40, 200 + 30);

  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 10 });
  await app.page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("box-a"))).toEqual({
    ...styleOf(before.get("box-a")),
    width: "200px",
    height: "150px",
  });
  expectOnlyChanged(before, after, ["box-a"]);
});

test("dragging a container's top padding handle saves the new padding", async ({
  app,
}) => {
  const id = await openFixture(app, BOXES);
  await app.zoomToFit();
  const panel = await app.designRect("panel");
  const corner = await app.pagePoint(panel.x + 8, panel.y + panel.height - 8);
  await app.page.mouse.click(corner.x, corner.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Panel"]);
  const before = await app.savedNodes(id);
  const handle = app.page
    .locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .contentFrame()
    .locator('[data-spacing-key="padding:top"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const { scale } = await app.pagePoint(0, 0);

  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x, from.y + 16 * scale, { steps: 8 });
  await app.page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("panel"))).toEqual({
    ...styleOf(before.get("panel")),
    "padding-top": "40px",
  });
  expectOnlyChanged(before, after, ["panel"]);
});

test("clicking a Layers row selects that element on the canvas", async ({
  app,
}) => {
  await openFixture(app, HEADINGS);
  await app.zoomToFit();
  await expandAllLayers(app.page);

  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Subtitle", exact: true })
    .click();

  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Subtitle"]);
  await expect(selectionOverlay(app)).toBeVisible();
  await expectBoxNear(
    await selectionOverlay(app).boundingBox(),
    await app.node("subtitle").boundingBox(),
  );
});

test("deeply nested layer rows keep a clickable hit target without scrolling the tree sideways", async ({
  app,
}) => {
  const levels = [
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
  ];
  const nested = levels.reduceRight(
    (inner, name) =>
      `<div data-agent-native-node-id="level-${name.toLowerCase()}" data-agent-native-layer-name="Level ${name}" style="padding:4px">${inner}</div>`,
    '<button data-agent-native-node-id="deep" data-agent-native-layer-name="Deep Layer Button">Deep</button>',
  );
  await openFixture(
    app,
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${nested}</body></html>`,
  );
  await expandAllLayers(app.page);
  const tree = app.page.getByRole("tree", { name: "Layers" });
  const deepLayer = tree.getByRole("button", {
    name: "Deep Layer Button",
    exact: true,
  });

  await deepLayer.click();

  await expect
    .poll(() => app.selectedLayers())
    .toStrictEqual(["Deep Layer Button"]);
  expect((await deepLayer.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  const treeLeft = (await tree.boundingBox())!.x;
  expect(
    (await tree
      .getByRole("button", { name: "Home", exact: true })
      .boundingBox())!.x,
  ).toBeGreaterThanOrEqual(treeLeft);
  const sidewaysScroll = await tree.evaluate((node) => {
    let total = 0;
    for (
      let element: Element | null = node;
      element;
      element = element.parentElement
    )
      total += element.scrollLeft;
    return total;
  });
  expect(sidewaysScroll).toBe(0);
});

test("Escape cancels an in-progress element drag on the canvas", async ({
  app,
}) => {
  const id = await openFixture(app, BOXES);
  await app.zoomToFit();
  await clickCenter(app, "box-a");
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Box A"]);
  const before = await app.savedNodes(id);
  const start = await app.pagePoint(680, 140);
  const mid = await app.pagePoint(680 + 96, 140 + 64);
  const end = await app.pagePoint(680 + 144, 140 + 96);

  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(mid.x, mid.y, { steps: 8 });
  await expect
    .poll(async () => (await app.designRect("box-a")).x)
    .toBeGreaterThan(620);
  await app.page.keyboard.press("Escape");
  await app.page.mouse.move(end.x, end.y, { steps: 4 });
  await app.page.mouse.up();
  await app.settled();

  expect(await app.designRect("box-a")).toEqual({
    x: 600,
    y: 80,
    width: 160,
    height: 120,
  });
  expectOnlyChanged(before, await app.savedNodes(id), []);
});
