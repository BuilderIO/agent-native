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
    // The trigger button is a swatch only (its hex value lives in the
    // adjacent inline field, not the button's own text) — see
    // DesignColorPicker's solid-paint row in #5752.
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
