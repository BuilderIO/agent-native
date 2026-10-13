import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  appPath,
  designFrame,
  gotoEditor,
  installBridge,
  waitForBridge,
} from "./helpers";

const ORIGINAL = "rgb(255, 255, 255)";
const CHANGED = "rgb(225, 29, 72)";
const CHANGED_SOURCE =
  /background(?:-color)?:\s*(?:#e11d48|rgb\(225,\s*29,\s*72\))/i;
const SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Repeated cards</title>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
  </head>
  <body style="margin:0;min-height:520px;padding:32px;background:#e2e8f0;font-family:Arial,sans-serif">
    <main data-agent-native-node-id="main" x-data="{ cards: [
      { id: 1, title: 'North Star', creator: 'Aster Vale' },
      { id: 2, title: 'Signal Bloom', creator: 'Mira Chen' },
      { id: 3, title: 'Quiet Atlas', creator: 'Noah Reed' }
    ] }" style="display:flex;gap:16px;align-items:stretch">
      <template data-agent-native-node-id="card-template" x-for="card in cards" :key="card.id">
        <article data-agent-native-node-id="card" data-repeat-card style="display:flex;flex-direction:column;gap:12px;width:210px;padding:16px;border-radius:12px;background:#ffffff;box-sizing:border-box">
          <div data-agent-native-node-id="art" style="height:110px;border-radius:8px;background:#93c5fd"></div>
          <div data-agent-native-node-id="metadata" style="display:flex;flex-direction:column;gap:4px">
            <strong data-agent-native-node-id="title" x-text="card.title"></strong>
            <span data-agent-native-node-id="creator" x-text="card.creator"></span>
          </div>
        </article>
      </template>
      <aside data-agent-native-node-id="static" style="width:80px;background:#cbd5e1">Static</aside>
    </main>
  </body>
</html>`;

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

async function createDesign(
  request: APIRequestContext,
  content = SCREEN_HTML,
): Promise<string> {
  const created = await action(request, "create-design", {
    title: `Repeated cards ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 820, height: 520 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 820, height: 520, z: 0 },
      },
    ],
  });
  return designId;
}

async function source(request: APIRequestContext, designId: string) {
  const response = await request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const design = await response.json();
  const content = design.files?.find(
    (file: { filename?: string }) => file.filename === "index.html",
  )?.content;
  if (typeof content !== "string") {
    throw new Error(`get-design: index.html content missing for ${designId}`);
  }
  return content;
}

async function cardPaint(page: Page): Promise<string[]> {
  return designFrame(page)
    .locator("[data-repeat-card]")
    .evaluateAll((cards) =>
      cards.map((card) => getComputedStyle(card).backgroundColor),
    );
}

async function liveTitles(page: Page): Promise<string[]> {
  return designFrame(page)
    .locator('[data-agent-native-node-id="title"]')
    .allTextContents();
}

function sourceTitles(html: string): string[] {
  return [...html.matchAll(/\btitle:\s*'([^']*)'/g)].map((match) => match[1]!);
}

function sourceIds(html: string): number[] {
  return [...html.matchAll(/\bid:\s*(\d+)/g)].map((match) => Number(match[1]));
}

async function selectRepeatNode(
  page: Page,
  selector: string,
  itemIndex: number,
  point: "center" | "padding" = "center",
) {
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const frame = designFrame(page);
  const node = frame.locator(selector).nth(itemIndex);
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  if (!box) throw new Error(`Repeat item ${itemIndex} is not measurable`);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  try {
    await page.mouse.click(
      point === "padding" ? box.x + box.width - 8 : box.x + box.width / 2,
      point === "padding" ? box.y + box.height - 8 : box.y + box.height / 2,
    );
  } finally {
    await page.keyboard.up(modifier);
  }
  const message = await waitForBridge(page, "element-select");
  return message.payload ?? message;
}

async function selectSecondCard(page: Page) {
  return selectRepeatNode(page, "[data-repeat-card]", 1, "padding");
}

async function setSelectedFill(page: Page, hex: string) {
  const fill = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Fill$/i }) })
    .first();
  await expect(fill).toBeVisible();
  await fill.getByRole("button", { name: "Open color picker" }).click();
  const input = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(input).toBeVisible();
  await input.fill(hex);
  await input.press("Enter");
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
}

test("one repeated card Fill edits the authored template for every row through history and reload", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await expect(designFrame(page).locator("[data-repeat-card]")).toHaveCount(
      3,
    );
    await expect
      .poll(() => cardPaint(page))
      .toEqual([ORIGINAL, ORIGINAL, ORIGINAL]);

    const selection = await selectSecondCard(page);
    expect(selection.sourceId).toBe("card");
    expect(selection.repeat).toMatchObject({
      instanceCount: 3,
      itemIndex: 1,
    });
    expect(selection.repeat?.sourceSelector).toBe(
      '[data-agent-native-node-id="card"]',
    );
    await expect(
      page.getByText("Affects all 3 copies", { exact: true }),
    ).toBeVisible();

    await setSelectedFill(page, "E11D48");
    await expect
      .poll(() => cardPaint(page))
      .toEqual([CHANGED, CHANGED, CHANGED]);
    await expect
      .poll(async () => CHANGED_SOURCE.test(await source(request, designId)))
      .toBe(true);
    let saved = await source(request, designId);
    expect(saved.match(/data-agent-native-node-id="card"/g)).toHaveLength(1);
    expect(saved.match(/<template\b[^>]*x-for=/g)).toHaveLength(1);
    expect(saved).toMatch(CHANGED_SOURCE);

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => CHANGED_SOURCE.test(await source(request, designId)))
      .toBe(false);
    await expect
      .poll(() => cardPaint(page))
      .toEqual([ORIGINAL, ORIGINAL, ORIGINAL]);
    const liveAfterUndo = await cardPaint(page);

    expect(liveAfterUndo).toEqual([ORIGINAL, ORIGINAL, ORIGINAL]);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() => cardPaint(page))
      .toEqual([CHANGED, CHANGED, CHANGED]);
    await expect
      .poll(async () => CHANGED_SOURCE.test(await source(request, designId)))
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(designFrame(page).locator("[data-repeat-card]")).toHaveCount(
      3,
    );
    await expect
      .poll(() => cardPaint(page))
      .toEqual([CHANGED, CHANGED, CHANGED]);
    saved = await source(request, designId);
    expect(saved.match(/data-agent-native-node-id="card"/g)).toHaveLength(1);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("one repeated bound title edits only its data item through history and reload", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  const original = ["North Star", "Signal Bloom", "Quiet Atlas"];
  const changed = ["North Star", "Signal Garden", "Quiet Atlas"];
  try {
    await gotoEditor(page, designId);
    await expect.poll(() => liveTitles(page)).toEqual(original);
    const selection = await selectRepeatNode(
      page,
      '[data-agent-native-node-id="title"]',
      1,
    );
    expect(selection.sourceId).toBe("title");
    expect(selection.repeat).toMatchObject({
      instanceCount: 3,
      itemIndex: 1,
      sourceSelector: '[data-agent-native-node-id="title"]',
      textBinding: "card.title",
    });

    await page.keyboard.press("Enter");
    const editable = designFrame(page).locator(
      '[data-agent-native-text-editing][contenteditable="true"]',
    );
    await expect(editable).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("Signal Garden");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(editable).toHaveCount(0);
    await expect
      .poll(
        async () =>
          JSON.stringify(sourceTitles(await source(request, designId))) !==
          JSON.stringify(original),
      )
      .toBe(true);
    const sourceAfterEdit = sourceTitles(await source(request, designId));
    await expect.poll(() => liveTitles(page)).toEqual(changed);
    const liveAfterEdit = await liveTitles(page);
    let saved = await source(request, designId);
    expect(saved.match(/x-text="card\.title"/g)).toHaveLength(1);
    expect(saved.match(/data-agent-native-node-id="title"/g)).toHaveLength(1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => sourceTitles(await source(request, designId)))
      .toEqual(original);
    await expect.poll(() => liveTitles(page)).toEqual(original);
    const liveAfterUndo = await liveTitles(page);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => sourceTitles(await source(request, designId)))
      .toEqual(sourceAfterEdit);
    await expect.poll(() => liveTitles(page)).toEqual(changed);
    const liveAfterRedo = await liveTitles(page);

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => sourceTitles(await source(request, designId)))
      .toEqual(original);
    await expect.poll(() => liveTitles(page)).toEqual(original);
    const liveAfterSecondUndo = await liveTitles(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(
      designFrame(page).locator('[data-agent-native-node-id="title"]'),
    ).toHaveCount(3);
    await expect.poll(() => liveTitles(page)).toEqual(original);
    const liveAfterReload = await liveTitles(page);

    expect({
      sourceAfterEdit,
      liveAfterEdit,
      liveAfterUndo,
      liveAfterRedo,
      liveAfterSecondUndo,
      liveAfterReload,
    }).toEqual({
      sourceAfterEdit: changed,
      liveAfterEdit: changed,
      liveAfterUndo: original,
      liveAfterRedo: changed,
      liveAfterSecondUndo: original,
      liveAfterReload: original,
    });
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("an id-keyed repeated row duplicates through history and reload", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  const original = ["North Star", "Signal Bloom", "Quiet Atlas"];
  const originalIds = [1, 2, 3];
  const duplicated = [
    "North Star",
    "Signal Bloom",
    "Signal Bloom",
    "Quiet Atlas",
  ];
  const duplicatedIds = [1, 2, 4, 3];
  try {
    await gotoEditor(page, designId);
    const selection = await selectSecondCard(page);
    expect(selection.sourceId).toBe("card");
    expect(selection.repeat).toMatchObject({
      instanceCount: 3,
      itemIndex: 1,
      sourceSelector: '[data-agent-native-node-id="card"]',
      keyExpression: "card.id",
    });

    await page.keyboard.press("ControlOrMeta+d");
    await expect
      .poll(async () => sourceTitles(await source(request, designId)))
      .toEqual(duplicated);
    await expect
      .poll(async () => sourceIds(await source(request, designId)))
      .toEqual(duplicatedIds);
    await expect.poll(() => liveTitles(page)).toEqual(duplicated);
    let saved = await source(request, designId);
    expect(saved.match(/<template\b[^>]*x-for=/g)).toHaveLength(1);
    expect(saved.match(/data-agent-native-node-id="card"/g)).toHaveLength(1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => sourceTitles(await source(request, designId)))
      .toEqual(original);
    await expect
      .poll(async () => sourceIds(await source(request, designId)))
      .toEqual(originalIds);
    await expect.poll(() => liveTitles(page)).toEqual(original);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => sourceTitles(await source(request, designId)))
      .toEqual(duplicated);
    await expect
      .poll(async () => sourceIds(await source(request, designId)))
      .toEqual(duplicatedIds);
    await expect.poll(() => liveTitles(page)).toEqual(duplicated);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect.poll(() => liveTitles(page)).toEqual(duplicated);
    saved = await source(request, designId);
    expect(sourceTitles(saved)).toEqual(duplicated);
    expect(sourceIds(saved)).toEqual(duplicatedIds);
    expect(saved.match(/<template\b[^>]*x-for=/g)).toHaveLength(1);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});
