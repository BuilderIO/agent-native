import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  childNodeIds,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
  installBridge,
} from "./helpers";

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";
const FIXTURE = `<!doctype html><html><body style="margin:0;padding:20px">
<div data-agent-native-node-id="stack" data-agent-native-layer-name="Stack" style="position:relative;width:260px;height:260px">
<div data-agent-native-node-id="S" data-agent-native-layer-name="S" style="position:absolute;left:20px;top:20px;width:160px;height:160px"></div>
<div data-agent-native-node-id="A" data-agent-native-layer-name="A" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:red"></div>
<div data-agent-native-node-id="B" data-agent-native-layer-name="B" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:green"></div>
<div data-agent-native-node-id="C" data-agent-native-layer-name="C" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:blue"></div>
<div data-agent-native-node-id="D" data-agent-native-layer-name="D" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:purple"></div>
</div>
<div data-agent-native-node-id="auto" data-agent-native-layer-name="Auto" style="display:flex;gap:12px;margin-top:20px">
<div data-agent-native-node-id="first" data-agent-native-layer-name="First" style="width:80px;height:40px;background:red"></div>
<div data-agent-native-node-id="second" data-agent-native-layer-name="Second" style="width:80px;height:40px;background:blue"></div>
</div></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${e2eBaseURL()}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext): Promise<string> {
  const created = await action(request, "create-design", {
    title: `Z-order parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return designId;
}

async function indexHtml(
  request: APIRequestContext,
  designId: string,
): Promise<string> {
  const response = await request.get(
    `${e2eBaseURL()}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const result = await response.json();
  const file = (result.files ?? result.data?.files)?.find(
    (candidate: { filename: string }) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("index.html was not returned");
  return file.content;
}

function layerButton(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

async function selectLayer(
  page: Page,
  name: string,
  additive = false,
): Promise<void> {
  const button = layerButton(page, name);
  await expect(button).toBeVisible();
  await button.click({
    force: true,
    ...(additive ? { modifiers: [PRIMARY] } : {}),
  });
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

async function topNodeAt(page: Page, parentId: string): Promise<string | null> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${parentId}"]`)
    .evaluate((parent) => {
      const rect = parent.getBoundingClientRect();
      return (
        document
          .elementsFromPoint(rect.left + 100, rect.top + 100)
          .map((node) => node.getAttribute("data-agent-native-node-id"))
          .find(Boolean) ?? null
      );
    });
}

async function pressZ(page: Page, undo = false): Promise<void> {
  await page.keyboard.press(undo ? `${PRIMARY}+z` : `${PRIMARY}+Shift+z`);
}

test("Figma G8 multi-selection preserves native order, painted order, and one-step undo", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await installBridge(page);
    await selectLayer(page, "A");
    await selectLayer(page, "C", true);

    await page.keyboard.press("]");
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["S", "B", "D", "A", "C"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("C");

    await page.keyboard.press("[");
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["A", "C", "S", "B", "D"]);

    await pressZ(page, true);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["S", "B", "D", "A", "C"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("C");

    await pressZ(page, true);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["S", "A", "B", "C", "D"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("D");
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Figma G9 Bring to Front reorders an auto-layout child and undo restores it", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await selectLayer(page, "First");

    await page.keyboard.press("]");
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) => childNodeIds(html, "auto")),
      )
      .toEqual(["second", "first"]);

    await pressZ(page, true);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) => childNodeIds(html, "auto")),
      )
      .toEqual(["first", "second"]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
