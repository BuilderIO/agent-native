import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const ORIGINAL_FILL = "#f97316";
const REPLACEMENT_FILL = "#8b5cf6";
const SIBLING_FILL = "#16a34a";
const EXPLICIT_ROOT_FILL = "#cc3399";

const SVG_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Selection color SVG</title></head>
<body style="margin:0"><main style="position:relative;width:640px;height:480px">
  <svg data-agent-native-node-id="color-logo" data-agent-native-layer-name="Pasted SVG" data-an-primitive="pasted-svg" viewBox="0 0 120 80" style="position:absolute;left:40px;top:40px;width:240px;height:160px">
    <g id="color-group">
      <path data-agent-native-node-id="warm-left" d="M0 0h30v30z" fill="${ORIGINAL_FILL}" />
      <path data-agent-native-node-id="warm-right" d="M35 0h30v30z" fill="${ORIGINAL_FILL}" />
      <circle data-agent-native-node-id="cool-sibling" cx="90" cy="15" r="14" fill="${SIBLING_FILL}" />
    </g>
  </svg>
  <svg data-agent-native-node-id="root-filled-svg" data-agent-native-layer-name="Root filled SVG" data-an-primitive="pasted-svg" fill="${EXPLICIT_ROOT_FILL}" viewBox="0 0 40 20" style="position:absolute;left:340px;top:40px;width:80px;height:40px">
    <g><rect data-agent-native-node-id="root-filled-rect" x="0" y="0" width="18" height="20" /><circle data-agent-native-node-id="root-filled-circle" cx="30" cy="10" r="9" /></g>
  </svg>
</main></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function readSource(page: Page, designId: string, screenId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=${encodeURIComponent("screen.html")}`,
    ),
  );
  if (!response.ok()) throw new Error(`read-source-file: ${response.status()}`);
  const body = await response.json();
  if (typeof body.content !== "string") {
    throw new Error(`screen ${screenId} source was not returned`);
  }
  return body.content as string;
}

test("Selection colors replaces a grouped SVG fill without stale inspector colors", async ({
  page,
  request,
}, testInfo) => {
  const created = await action(request, "create-design", {
    title: `SVG Selection colors ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  let screenId = "";

  try {
    const file = await action(request, "create-file", {
      designId,
      filename: "screen.html",
      content: SVG_HTML,
      fileType: "html",
    });
    screenId = file?.id ?? file?.data?.id ?? "";
    if (!screenId) throw new Error("create-file returned no screen id");
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const layers = page.getByRole("tree", { name: "Layers" });
    const svgRow = layers.getByRole("button", {
      name: "Pasted SVG",
      exact: true,
    });
    await svgRow.click();
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Pasted SVG");

    const selectionColors = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    const showColors = selectionColors.getByRole("button", {
      name: "Show selection colors",
    });
    if (await showColors.count()) await showColors.click();

    const colorLabels = () =>
      selectionColors
        .locator('button[aria-label^="#"]')
        .evaluateAll((buttons) =>
          buttons
            .map((button) => button.getAttribute("aria-label")?.toLowerCase())
            .filter((label): label is string => Boolean(label)),
        );
    const fillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    const expectNoBaseFill = async () => {
      await expect(
        fillSection.getByRole("button", { name: "Open color picker" }),
      ).toHaveCount(0);
      await expect(
        fillSection.locator('[data-inspector-layout="drag-paint-row"]'),
      ).toHaveCount(0);
    };
    await expectNoBaseFill();
    await expect.poll(colorLabels).toEqual([ORIGINAL_FILL, SIBLING_FILL]);

    await selectionColors
      .getByRole("button", { name: ORIGINAL_FILL, exact: true })
      .click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill(REPLACEMENT_FILL.slice(1));
    await hex.press("Enter");

    const frame = designFrame(page, screenId);
    const readPaints = () =>
      frame
        .locator("svg[data-agent-native-node-id='color-logo']")
        .evaluate((svg) => {
          const fillOf = (id: string) => {
            const shape = svg.querySelector(
              `[data-agent-native-node-id="${id}"]`,
            );
            if (!shape) throw new Error(`Missing SVG shape ${id}`);
            return getComputedStyle(shape).fill;
          };
          return [
            fillOf("warm-left"),
            fillOf("warm-right"),
            fillOf("cool-sibling"),
          ];
        });
    await expect
      .poll(readPaints)
      .toEqual(["rgb(139, 92, 246)", "rgb(139, 92, 246)", "rgb(22, 163, 74)"]);
    await expect.poll(colorLabels).toEqual([REPLACEMENT_FILL, SIBLING_FILL]);
    await expectNoBaseFill();
    const replacedSource = await readSource(page, designId, screenId);
    expect(replacedSource.toLowerCase()).toContain(REPLACEMENT_FILL);
    expect(replacedSource.toLowerCase()).not.toContain(ORIGINAL_FILL);
    await page.screenshot({
      path: testInfo.outputPath("selection-colors-svg-replaced.png"),
    });

    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(readPaints)
      .toEqual(["rgb(249, 115, 22)", "rgb(249, 115, 22)", "rgb(22, 163, 74)"]);
    await expect.poll(colorLabels).toEqual([ORIGINAL_FILL, SIBLING_FILL]);
    await expectNoBaseFill();
    const undoneSource = await readSource(page, designId, screenId);
    expect(undoneSource.toLowerCase()).toContain(ORIGINAL_FILL);
    expect(undoneSource.toLowerCase()).not.toContain(REPLACEMENT_FILL);
    await page.screenshot({
      path: testInfo.outputPath("selection-colors-svg-undone.png"),
    });

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(readPaints)
      .toEqual(["rgb(139, 92, 246)", "rgb(139, 92, 246)", "rgb(22, 163, 74)"]);
    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await layers
      .getByRole("button", { name: "Pasted SVG", exact: true })
      .click();
    const reloadedShowColors = selectionColors.getByRole("button", {
      name: "Show selection colors",
    });
    if (await reloadedShowColors.count()) await reloadedShowColors.click();
    await expect
      .poll(readPaints)
      .toEqual(["rgb(139, 92, 246)", "rgb(139, 92, 246)", "rgb(22, 163, 74)"]);
    await expect.poll(colorLabels).toEqual([REPLACEMENT_FILL, SIBLING_FILL]);
    await expectNoBaseFill();
    const reloadedSource = await readSource(page, designId, screenId);
    expect(reloadedSource.toLowerCase()).toContain(REPLACEMENT_FILL);
    expect(reloadedSource.toLowerCase()).not.toContain(ORIGINAL_FILL);
    await page.screenshot({
      path: testInfo.outputPath("selection-colors-svg-reloaded.png"),
    });

    await layers
      .getByRole("button", { name: "Root filled SVG", exact: true })
      .click();
    const rootFilledSvg = frame.locator(
      "svg[data-agent-native-node-id='root-filled-svg']",
    );
    await expect
      .poll(() =>
        rootFilledSvg
          .locator("[data-agent-native-node-id='root-filled-rect']")
          .evaluate((node) => getComputedStyle(node).fill),
      )
      .toBe("rgb(204, 51, 153)");
    await expect(
      fillSection.getByRole("button", { name: "Open color picker" }),
    ).toBeVisible();
    await expect(
      fillSection.getByRole("textbox", { name: "Color", exact: true }),
    ).toHaveValue("CC3399");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("adding a fill to mixed pasted SVG paths updates each vector paint", async ({
  page,
  request,
}) => {
  const created = await action(request, "create-design", {
    title: `Mixed pasted SVG fill ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  let screenId = "";

  try {
    const file = await action(request, "create-file", {
      designId,
      filename: "screen.html",
      content:
        '<!doctype html><html><head></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"></main></body></html>',
      fileType: "html",
    });
    screenId = file?.id ?? file?.data?.id ?? "";
    if (!screenId) throw new Error("create-file returned no screen id");
    await gotoEditor(page, designId);
    await enterDirectMode(page, { screenId });

    const svg =
      '<svg width="100" height="40" viewBox="0 0 100 40"><g><path d="M0 0h40v40H0z" fill="#f97316"/><path d="M60 0h40v40H60z" fill="#16a34a"/></g></svg>';
    const frame = designFrame(page, screenId);
    const pasteAccepted = await frame
      .locator("body")
      .evaluate((body, source) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([source], "clipboard.svg", {
            type: "image/svg+xml",
          }),
        );
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        body.dispatchEvent(event);
        return event.defaultPrevented;
      }, svg);
    expect(pasteAccepted).toBe(true);

    const pastedSvg = frame.locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    );
    const paths = pastedSvg.locator("path");
    await expect(paths).toHaveCount(2);
    await expandAllLayers(page);
    const layers = page.getByRole("tree", { name: "Layers" });
    const pathRows = layers.locator('[role="treeitem"][aria-level="4"]');
    await expect(pathRows).toHaveCount(2);
    await pathRows.nth(0).click();
    await pathRows.nth(1).click({ modifiers: ["Shift"] });
    const selectedRows = layers.locator(
      '[role="treeitem"][aria-selected="true"]',
    );
    await expect(selectedRows).toHaveCount(2);

    const readFills = () =>
      paths.evaluateAll((shapes) =>
        shapes.map((shape) => getComputedStyle(shape).fill),
      );
    const before = await readFills();
    expect(before).toHaveLength(2);
    expect(before[0]).not.toBe(before[1]);

    const fillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await expect(
      fillSection.getByText("Click + to replace mixed content", {
        exact: true,
      }),
    ).toBeVisible();
    await fillSection
      .getByRole("button", { name: "Add fill", exact: true })
      .click();

    await expect
      .poll(async () => {
        const fills = await readFills();
        return fills.length === 2 && fills[0] === fills[1];
      })
      .toBe(true);
    const after = await readFills();
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    const saved = await readSource(page, designId, screenId);
    expect(saved).toContain("fill: rgb(217 217 217)");
  } finally {
    await action(page.request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});

test("equivalent SVG paint spellings show one shared fill", async ({
  page,
  request,
}) => {
  const created = await action(request, "create-design", {
    title: `Equivalent SVG paints ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    const file = await action(request, "create-file", {
      designId,
      filename: "screen.html",
      content:
        '<!doctype html><html><head></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"></main></body></html>',
      fileType: "html",
    });
    const screenId: string | undefined = file?.id ?? file?.data?.id;
    if (!screenId) throw new Error("create-file returned no screen id");
    await gotoEditor(page, designId);
    await enterDirectMode(page, { screenId });

    const svg =
      '<svg width="100" height="40" viewBox="0 0 100 40"><g><path data-agent-native-layer-name="Warm left" d="M0 0h40v40H0z" fill="#d9d9d9"/><path data-agent-native-layer-name="Warm right" d="M60 0h40v40H60z" fill="rgb(217 217 217)"/></g></svg>';
    const frame = designFrame(page, screenId);
    const pasteAccepted = await frame
      .locator("body")
      .evaluate((body, source) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([source], "clipboard.svg", {
            type: "image/svg+xml",
          }),
        );
        const event = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        });
        body.dispatchEvent(event);
        return event.defaultPrevented;
      }, svg);
    expect(pasteAccepted).toBe(true);

    await expandAllLayers(page);
    const layers = page.getByRole("tree", { name: "Layers" });
    const pathRows = layers.locator('[role="treeitem"][aria-level="4"]');
    await expect(pathRows).toHaveCount(2);
    await pathRows.nth(0).click();
    await pathRows.nth(1).click({ modifiers: ["Shift"] });
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);

    const fillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await expect(
      fillSection.getByText("Click + to replace mixed content", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      fillSection.getByRole("button", { name: "Open color picker" }),
    ).toBeVisible();
    await expect(
      fillSection.getByRole("textbox", { name: "Color", exact: true }),
    ).toHaveValue("D9D9D9");

    const selectionColors = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Selection colors",
          exact: true,
        }),
      })
      .first();
    const showColors = selectionColors.getByRole("button", {
      name: "Show selection colors",
    });
    if (await showColors.count()) await showColors.click();
    const colorLabels = () =>
      selectionColors
        .locator('button[aria-label^="#"]')
        .evaluateAll((buttons) =>
          buttons
            .map((button) => button.getAttribute("aria-label")?.toLowerCase())
            .filter((label): label is string => Boolean(label)),
        );
    await expect.poll(colorLabels).toEqual(["#d9d9d9"]);

    await page.reload();
    await enterDirectMode(page, { screenId });
    await expandAllLayers(page);
    const reloadedLayers = page.getByRole("tree", { name: "Layers" });
    const reloadedRows = reloadedLayers.locator(
      '[role="treeitem"][aria-level="4"]',
    );
    await expect(reloadedRows).toHaveCount(2);
    await reloadedRows.nth(0).click();
    await reloadedRows.nth(1).click({ modifiers: ["Shift"] });
    await expect(
      reloadedLayers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);
    const reloadedFillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await expect(
      reloadedFillSection.getByText("Click + to replace mixed content", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      reloadedFillSection.getByRole("textbox", {
        name: "Color",
        exact: true,
      }),
    ).toHaveValue("D9D9D9");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
