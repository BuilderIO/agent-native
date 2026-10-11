import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const CONTENT = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"><section data-agent-native-node-id="paste-target" data-agent-native-layer-name="Paste target" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:260px;height:180px;background:#eeeeee"><div data-agent-native-node-id="existing-child" data-agent-native-layer-name="Existing child" style="position:absolute;left:8px;top:8px;width:24px;height:20px;background:#ff0000"></div></section></main></body></html>`;
const SVG =
  '<svg width="80" height="40" viewBox="0 0 80 40"><g><path d="M0 0h30v30z" fill="#f97316"/><path d="M50 0h30v30z" fill="#16a34a"/></g></svg>';

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(
  page: Page,
  onDesignCreated: (designId: string) => void,
) {
  const design = await action(page, "create-design", {
    title: `Paste SVG into frame ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");
  onDesignCreated(designId);
  const file = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content: CONTENT,
  });
  const screenId = file.id ?? file.data?.id;
  if (typeof screenId !== "string") throw new Error("missing screen id");
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 100, y: 100, width: 640, height: 480 },
      },
    ],
  });
  return { designId, screenId };
}

async function pasteSvgFile(target: Locator, svg: string): Promise<boolean> {
  return target.evaluate((body, source) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([source], "clipboard.svg", { type: "image/svg+xml" }),
    );
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    body.dispatchEvent(event);
    return event.defaultPrevented;
  }, svg);
}

async function readSource(page: Page, designId: string): Promise<string> {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=${encodeURIComponent("screen.html")}`,
    ),
  );
  if (!response.ok()) return "";
  const source = await response.json();
  return typeof source.content === "string" ? source.content : "";
}

async function clickLayerRowAndAssertSelected(row: Locator): Promise<void> {
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

test("pasting an SVG while a frame is selected nests it in that frame", async ({
  page,
}) => {
  let designId = "";
  try {
    const created = await createDesign(page, (id) => {
      designId = id;
    });
    const { screenId } = created;
    await gotoEditor(page, designId);
    await enterDirectMode(page, { screenId });
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await expandAllLayers(page);
    const targetRow = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .filter({
        has: page.getByRole("button", { name: "Paste target", exact: true }),
      })
      .first();
    await clickLayerRowAndAssertSelected(targetRow);

    expect(
      await pasteSvgFile(designFrame(page, screenId).locator("body"), SVG),
    ).toBe(true);

    const frame = designFrame(page, screenId);
    const target = frame.locator('[data-agent-native-node-id="paste-target"]');
    await expect(
      target.locator(':scope > svg[data-agent-native-layer-name="Pasted SVG"]'),
    ).toHaveCount(1);
    await expect(
      frame.locator("body > svg[data-agent-native-layer-name='Pasted SVG']"),
    ).toHaveCount(0);
    await expect
      .poll(() => readSource(page, designId))
      .toContain('data-agent-native-layer-name="Pasted SVG"');
  } finally {
    if (designId) {
      await action(page, "delete-design", { id: designId }).catch(() => {});
    }
  }
});
