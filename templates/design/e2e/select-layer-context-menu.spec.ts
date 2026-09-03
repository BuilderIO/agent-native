import {
  expect,
  test,
  type APIRequestContext,
  type FrameLocator,
  type Page,
} from "@playwright/test";

import {
  designFrame,
  enterDirectMode,
  gotoEditor,
  installBridge,
  waitForBridge,
} from "./helpers";

const STACK_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Select layer fixture</title></head>
  <body style="margin:0;min-height:100vh;padding:20px">
    <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage frame" style="position:relative;width:440px;height:360px;background:#eee">
      <div data-agent-native-node-id="back" data-agent-native-layer-name="Back sibling" style="position:absolute;left:40px;top:40px;width:280px;height:260px;background:#bfdbfe">Back sibling</div>
      <div data-agent-native-node-id="nested-parent" data-agent-native-layer-name="Nested parent" style="position:absolute;z-index:1;left:80px;top:80px;width:220px;height:210px;background:#bbf7d0">
        <div data-agent-native-node-id="nested-child" data-agent-native-layer-name="Nested child" style="position:absolute;left:20px;top:20px;width:150px;height:150px;background:#fef08a">Nested child</div>
      </div>
      <div data-agent-native-node-id="front" data-agent-native-layer-name="Front sibling" style="position:absolute;z-index:2;left:120px;top:120px;width:120px;height:120px;background:#fecaca">Front sibling</div>
      <div data-agent-native-node-id="hidden-cover" data-agent-native-layer-name="Hidden cover" data-agent-native-hidden="true" style="position:absolute;z-index:3;left:130px;top:130px;width:90px;height:90px;background:#000">Hidden cover</div>
      <div data-agent-native-node-id="locked-cover" data-agent-native-layer-name="Locked cover" data-agent-native-locked="true" style="position:absolute;z-index:4;left:140px;top:140px;width:70px;height:70px;background:#fff">Locked cover</div>
    </div>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function getAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
  const params = new URLSearchParams(
    Object.entries(input).map(([key, value]) => [key, String(value)]),
  );
  const response = await request.get(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}?${params}`,
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function openLayerStack(
  page: Page,
  frame: FrameLocator = designFrame(page),
) {
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const stage = frame.locator('[data-agent-native-node-id="stage"]');
  const box = await stage.boundingBox();
  if (!box) throw new Error("stage has no browser geometry");
  const frameOffset = await stage.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 165, y: rect.top + 165 };
  });
  // Dispatch on the real bridge shield inside Chromium. A top-level
  // page.mouse right-click is consumed by Chromium's iframe context-menu
  // boundary in headless mode before the srcdoc listener sees it; this still
  // exercises the actual contextmenu event, elementsFromPoint stack, iframe
  // postMessage bridge, host menu, and selection path end-to-end.
  await stage.evaluate((_element, point) => {
    document.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  }, frameOffset);
  await waitForBridge(page, "element-contextmenu");
  const trigger = page.getByText("Select layer", { exact: true });
  await expect(trigger).toBeVisible();
  await trigger.hover();
  const submenu = page.getByRole("menu").last();
  await expect(
    submenu.getByText("Front sibling", { exact: true }),
  ).toBeVisible();
  return submenu;
}

async function selectedTreeLabel(page: Page) {
  return (
    (await page
      .getByRole("treeitem", { selected: true })
      .first()
      .textContent()) ?? ""
  );
}

test("Select layer lists the exact visible unlocked hit stack and dismisses without mutation", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Select layer ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: STACK_HTML,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    const baselineDesign = await getAction(request, "get-design", {
      id: designId,
    });
    const baselineContent = baselineDesign.files?.find(
      (file: { filename?: string }) => file.filename === "index.html",
    )?.content;

    const submenu = await openLayerStack(page);
    const visibleLabels = [
      "Front sibling",
      "Nested child",
      "Nested parent",
      "Back sibling",
      "Stage frame",
    ];
    for (const label of visibleLabels) {
      await expect(submenu.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(
      submenu.getByText("Locked cover", { exact: true }),
    ).toHaveCount(0);
    await expect(
      submenu.getByText("Hidden cover", { exact: true }),
    ).toHaveCount(0);

    const submenuItems = submenu
      .getByRole("menuitem")
      .filter({ has: page.locator("svg") });
    const labelsInOrder = await submenuItems.allTextContents();
    const orderedHits = labelsInOrder.filter((label) =>
      visibleLabels.includes(label.trim()),
    );
    expect(orderedHits).toEqual(visibleLabels);

    // Escape dismisses the submenu/menu and leaves the right-click top hit
    // selected; it must not accidentally pick a different candidate.
    await page.keyboard.press("Escape");
    await expect(page.getByText("Select layer", { exact: true })).toBeHidden();
    await expect.poll(() => selectedTreeLabel(page)).toContain("Front sibling");

    const childMenu = await openLayerStack(page);
    await childMenu.getByText("Nested child", { exact: true }).click();
    await expect.poll(() => selectedTreeLabel(page)).toContain("Nested child");

    const parentMenu = await openLayerStack(page);
    await parentMenu.getByText("Nested parent", { exact: true }).click();
    await expect.poll(() => selectedTreeLabel(page)).toContain("Nested parent");

    const backMenu = await openLayerStack(page);
    await backMenu.getByText("Back sibling", { exact: true }).click();
    await expect.poll(() => selectedTreeLabel(page)).toContain("Back sibling");

    const design = await getAction(request, "get-design", { id: designId });
    const content = design.files?.find(
      (file: { filename?: string }) => file.filename === "index.html",
    )?.content;
    expect(content).toBe(baselineContent);
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});

test("Select layer on a non-active overview screen routes selection to that exact screen", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Overview select layer ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    const home = await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: STACK_HTML,
      fileType: "html",
    });
    const about = await postAction(request, "create-file", {
      designId,
      filename: "about.html",
      content: STACK_HTML,
      fileType: "html",
    });
    const homeId = home.id ?? home.data?.id ?? home.file?.id;
    const aboutId = about.id ?? about.data?.id ?? about.file?.id;
    if (!homeId || !aboutId) throw new Error("create-file returned no id");

    await gotoEditor(page, designId);
    await expect(
      page.getByRole("button", { name: "Interact" }).first(),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("screen"))
      .toBe(homeId);

    const baseline = await getAction(request, "get-design", { id: designId });
    const aboutBaseline = baseline.files?.find(
      (file: { id?: string }) => file.id === aboutId,
    )?.content;
    const aboutShell = page
      .locator("[data-screen-shell]")
      .filter({ hasText: "About" });
    await expect(aboutShell).toBeVisible();
    const aboutFrame = aboutShell
      .locator("iframe[data-design-preview-iframe]")
      .contentFrame();

    const menu = await openLayerStack(page, aboutFrame);
    await menu.getByText("Nested child", { exact: true }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("screen"))
      .toBe(aboutId);
    await expect.poll(() => selectedTreeLabel(page)).toContain("Nested child");
    const after = await getAction(request, "get-design", { id: designId });
    expect(
      after.files?.find((file: { id?: string }) => file.id === aboutId)
        ?.content,
    ).toBe(aboutBaseline);
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});
