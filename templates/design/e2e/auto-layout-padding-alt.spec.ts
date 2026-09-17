import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

type DesignRecord = {
  files?: Array<{ id: string; content?: string }>;
};

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

async function readDesign(page: Page, designId: string): Promise<DesignRecord> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return response.json() as Promise<DesignRecord>;
}

async function readPadding(page: Page, designId: string, screenId: string) {
  const record = await readDesign(page, designId);
  const html = record.files?.find((file) => file.id === screenId)?.content;
  if (!html) throw new Error(`missing source for ${screenId}`);
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "text/html");
    const frame = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="padding-frame"]',
    );
    if (!frame) throw new Error("missing padding frame");
    return {
      top: frame.style.paddingTop,
      right: frame.style.paddingRight,
      bottom: frame.style.paddingBottom,
      left: frame.style.paddingLeft,
    };
  }, html);
}

test("Alt-scrubbing an unlinked padding side mirrors its opposite side", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await createFixtureDesign(
    page,
    `Auto layout Alt padding ${Date.now()}`,
  );
  try {
    const initial = await readDesign(page, designId);
    const screenId = initial.files?.[0]?.id;
    if (!screenId) throw new Error("fixture Screen is missing");

    await action(page, "update-file", {
      id: screenId,
      content: `<!doctype html><html><body style="margin:0;width:320px;height:220px">
        <section data-agent-native-node-id="padding-frame" data-agent-native-layer-name="Padding Frame" data-an-primitive="frame" style="display:flex;flex-direction:row;padding:10px 20px 30px 40px;gap:8px;background:#e2e8f0">
          <div data-agent-native-node-id="padding-child">Child</div>
        </section>
      </body></html>`,
    });

    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const row = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Padding Frame", exact: true });
    await expect(row).toBeVisible();
    await row.click();

    const layout = page
      .getByRole("heading", { name: "Auto layout", exact: true })
      .locator("xpath=ancestor::section");
    await expect(layout).toBeVisible();
    const top = layout
      .locator('input[aria-label="Top" i], input[aria-label="Top / Bottom" i]')
      .first();
    await expect(top).toHaveValue("10px");
    const box = await top.boundingBox();
    if (!box) throw new Error("missing Top padding input bounds");

    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, {
      steps: 4,
    });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect
      .poll(async () => {
        const padding = await readPadding(page, designId, screenId);
        return padding.top === padding.bottom ? padding : null;
      })
      .not.toBeNull();
    const padding = await readPadding(page, designId, screenId);
    expect(padding).toMatchObject({ right: "20px", left: "40px" });
    expect(padding.top).toBe(padding.bottom);
    expect(Number.parseFloat(padding.top)).toBeGreaterThan(10);
  } finally {
    await action(page, "delete-design", { id: designId });
  }
});
