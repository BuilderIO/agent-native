import { expect, test, type APIRequestContext } from "@playwright/test";

import { enterDirectMode, expandAllLayers, gotoEditor } from "./helpers";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Fill hit area</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-gradient" data-agent-native-layer-name="Gradient" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:rgba(0,0,0,0);background-image:linear-gradient(90deg, #ff0000 0%, #0000ff 100%)"></div>
    </main>
  </body>
</html>`;

const SOLID_FILL_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Solid fill conversion</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-solid" data-agent-native-layer-name="Solid" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#ff0000;background-image:none"></div>
    </main>
  </body>
</html>`;

const SOLID_WITH_EXISTING_GRADIENT_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Solid beside existing gradient</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-solid-gradient" data-agent-native-layer-name="Solid with gradient" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#ff0000;background-image:linear-gradient(90deg, #0f766e 0%, #14b8a6 100%)"></div>
    </main>
  </body>
</html>`;

const SIBLING_GRADIENT_FILL_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sibling gradient conversion</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-siblings" data-agent-native-layer-name="Two fills" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#123456;background-image:linear-gradient(90deg, rgba(204, 51, 102, 0.2) 0%, rgba(51, 102, 204, 0.2) 100%), radial-gradient(circle at center, #00ff00 0%, #ff00ff 100%);background-size:24px 24px, cover;background-repeat:no-repeat, repeat-x;background-position:10% 20%, 30% 40%"></div>
    </main>
  </body>
</html>`;

const BASE_SOLID_WITH_SIBLINGS_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Base solid conversion below siblings</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-base-siblings" data-agent-native-layer-name="Base with siblings" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#ff0000;background-image:url(&quot;https://example.test/image.png&quot;), radial-gradient(circle at center, #00ff00 0%, #ff00ff 100%);background-size:cover, 24px 24px;background-repeat:no-repeat, repeat-x;background-position:center, 30% 40%"></div>
    </main>
  </body>
</html>`;

const THREE_IMAGE_FILLS_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Three image fills</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="fill-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:700px">
      <div data-agent-native-node-id="fill-stack" data-agent-native-layer-name="Three image fills" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:transparent;background-image:url(&quot;https://fills.invalid/first.png&quot;),url(&quot;https://fills.invalid/second.png&quot;),url(&quot;https://fills.invalid/third.png&quot;);background-size:24px 24px,contain,cover;background-repeat:no-repeat,repeat-x,no-repeat;background-position:left top,center,right bottom"></div>
    </main>
  </body>
</html>`;

function normalizeGradientColorSerialization(value: string): string {
  return value.replace(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi, (token) => {
    const hex = token.match(/^#([\da-f]{3,8})$/i)?.[1];
    if (hex && [3, 4, 6, 8].includes(hex.length)) {
      const expanded =
        hex.length < 5
          ? [...hex].map((digit) => `${digit}${digit}`).join("")
          : hex;
      const red = Number.parseInt(expanded.slice(0, 2), 16);
      const green = Number.parseInt(expanded.slice(2, 4), 16);
      const blue = Number.parseInt(expanded.slice(4, 6), 16);
      const alpha =
        expanded.length === 8
          ? Number((Number.parseInt(expanded.slice(6, 8), 16) / 255).toFixed(3))
          : 1;
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
    const channels = token
      .slice(token.indexOf("(") + 1, -1)
      .split(",")
      .map((part) => part.trim());
    if (channels.length < 3) return token;
    const normalized = channels.slice(0, 3).map((channel) => {
      const numeric = Number.parseFloat(channel);
      return channel.endsWith("%")
        ? String(Math.round((numeric / 100) * 255))
        : String(numeric);
    });
    const rawAlpha = channels[3];
    const alpha = rawAlpha
      ? Number(
          (rawAlpha.endsWith("%")
            ? Number.parseFloat(rawAlpha) / 100
            : Number.parseFloat(rawAlpha)
          ).toFixed(3),
        )
      : 1;
    return `rgba(${normalized.join(", ")}, ${alpha})`;
  });
}

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test("gradient fill trigger stays inside its cell and opens from one click", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Fill hit area ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    const layer = tree
      .getByRole("button", { name: "Gradient", exact: true })
      .first();
    await expect(layer).toBeVisible();
    await layer.click();
    await expect(
      tree.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Gradient");
    await expect
      .poll(() =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .last()
          .contentFrame()
          .locator('[data-agent-native-node-id="fill-gradient"]')
          .evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("linear-gradient");

    const trigger = page
      .getByRole("button", { name: /Linear gradient 1/ })
      .first();
    await expect(trigger).toBeVisible();
    const row = trigger.locator(
      'xpath=ancestor::*[@data-inspector-layout="drag-paint-row"][1]',
    );
    const cell = trigger.locator(
      "xpath=ancestor::*[@data-inspector-grid-cell][1]",
    );
    const actionCells = row.locator(
      ':scope > [data-inspector-grid-cell][data-inspector-span="4"]',
    );
    const eye = actionCells.nth(0).getByRole("button");
    const remove = actionCells.nth(1).getByRole("button");
    const [triggerBox, cellBox, eyeBox, removeBox] = await Promise.all([
      trigger.boundingBox(),
      cell.boundingBox(),
      eye.boundingBox(),
      remove.boundingBox(),
    ]);

    expect(triggerBox).not.toBeNull();
    expect(cellBox).not.toBeNull();
    expect(eyeBox).not.toBeNull();
    expect(removeBox).not.toBeNull();
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(
      cellBox!.x + cellBox!.width + 0.5,
    );
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(
      eyeBox!.x + 0.5,
    );
    expect(eyeBox!.x + eyeBox!.width).toBeLessThanOrEqual(removeBox!.x + 0.5);

    await trigger.click();
    await expect(
      page.locator('[role="group"][aria-label="Gradient stops"]'),
    ).toBeVisible();
  } finally {
    await postAction(request, baseURL, "delete-design", {
      id: designId,
    });
  }
});

test("gradient fill opacity preserves stop alpha through zero and reload", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Gradient fill opacity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id;
  if (!designId) throw new Error("create-design returned no id");
  try {
    await page.route("https://example.test/export-image.svg", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        headers: { "access-control-allow-origin": "*" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#00ff00"/></svg>',
      }),
    );
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE.replace("#0000ff 100%", "rgba(0,0,255,0) 100%").replace(
        "</main>",
        '<img src="https://example.test/export-image.svg" style="position:absolute;left:400px;top:64px;width:32px;height:32px"/></main>',
      ),
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    const tree = page.getByRole("tree", { name: "Layers" });
    const layer = tree
      .getByRole("button", { name: "Gradient", exact: true })
      .first();
    await layer.click();
    const trigger = page
      .getByRole("button", { name: /Linear gradient 1/ })
      .first();
    const row = trigger.locator(
      'xpath=ancestor::*[@data-inspector-layout="drag-paint-row"][1]',
    );
    const opacity = row.getByRole("textbox", { name: "Opacity", exact: true });
    const shape = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-gradient"]');
    await expect(opacity).toHaveValue("100%");
    for (const value of [20, 0]) {
      await opacity.fill(String(value));
      await opacity.press("Enter");
      await expect
        .poll(() =>
          shape.evaluate((node) => (node as HTMLElement).style.backgroundImage),
        )
        .toContain(`${value}%, transparent`);
      if (value === 20) {
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page
            .getByRole("button", { name: "Export", exact: true })
            .and(page.locator("button:not([aria-expanded])"))
            .click(),
        ]);
        const stream = await download.createReadStream();
        if (!stream) throw new Error("Export returned no PNG data");
        await download.saveAs(test.info().outputPath("gradient-opacity.png"));
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const pixel = await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            rgba: [...context.getImageData(32, 90, 1, 1).data],
          };
        }, Buffer.concat(chunks).toString("base64"));
        expect(pixel.width).toBe(320);
        expect(pixel.height).toBe(180);
        expect(pixel.rgba[3], JSON.stringify(pixel)).toBeGreaterThanOrEqual(45);
        expect(pixel.rgba[3], JSON.stringify(pixel)).toBeLessThanOrEqual(47);
        expect(pixel.rgba[0] - pixel.rgba[1]).toBeGreaterThan(10);

        const screen = tree
          .locator('[role="treeitem"][aria-level="1"]')
          .filter({ has: page.locator('span[title="Home"]') })
          .first();
        await screen.locator("[data-layer-row-button]").click();
        await expect(screen).toHaveAttribute("aria-selected", "true");
        const [screenDownload] = await Promise.all([
          page.waitForEvent("download"),
          page
            .getByRole("button", { name: "Export", exact: true })
            .and(page.locator("button:not([aria-expanded])"))
            .click(),
        ]);
        const screenStream = await screenDownload.createReadStream();
        if (!screenStream)
          throw new Error("Screen export returned no PNG data");
        await screenDownload.saveAs(
          test.info().outputPath("gradient-opacity-screen.png"),
        );
        const screenChunks: Buffer[] = [];
        for await (const chunk of screenStream) {
          screenChunks.push(Buffer.from(chunk));
        }
        const screenPixel = await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            image: [...context.getImageData(416, 80, 1, 1).data],
          };
        }, Buffer.concat(screenChunks).toString("base64"));
        expect(screenPixel.width).toBeGreaterThan(416);
        expect(screenPixel.height).toBeGreaterThan(80);
        expect(screenPixel.image).toEqual([0, 255, 0, 255]);
        await layer.click();
        await expect(
          tree.locator('[role="treeitem"][aria-selected="true"]'),
        ).toContainText("Gradient");
      }
    }
    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await layer.click();
    await expect(opacity).toHaveValue("0%");
    await opacity.fill("100");
    await opacity.press("Enter");
    await expect
      .poll(() =>
        shape.evaluate((node) => (node as HTMLElement).style.backgroundImage),
      )
      .not.toContain("color-mix");
    await expect
      .poll(() =>
        shape.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toMatch(/rgb\(255, 0, 0\).*rgba\(0, 0, 255, 0\)/);
    await trigger.click();
    await expect(
      page.getByRole("slider", { name: "Opacity", exact: true }),
    ).toHaveAttribute("aria-valuenow", "100");
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});

test("solid-to-gradient conversion keeps its picker open", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Solid fill conversion ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: SOLID_FILL_FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    const layer = tree
      .getByRole("button", { name: "Solid", exact: true })
      .first();
    await expect(layer).toBeVisible();
    await layer.click();
    await expect(
      tree.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Solid");

    await page.getByRole("button", { name: "Open color picker" }).click();
    await page.getByRole("button", { name: "Linear" }).click();
    await expect(
      page.locator('[role="group"][aria-label="Gradient stops"]'),
    ).toBeVisible();

    const solid = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-solid"]');
    await expect
      .poll(() =>
        solid.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("linear-gradient");
    await expect
      .poll(() =>
        solid.evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe("rgba(0, 0, 0, 0)");
  } finally {
    await postAction(request, baseURL, "delete-design", {
      id: designId,
    });
  }
});

test("removing a converted Solid gradient closes its picker and preserves the sibling", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Solid with existing gradient ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: SOLID_WITH_EXISTING_GRADIENT_FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    const layer = tree
      .getByRole("button", { name: "Solid with gradient", exact: true })
      .first();
    await expect(layer).toBeVisible();
    await layer.click();

    const fillHeading = page.getByRole("heading", {
      name: "Fill",
      exact: true,
    });
    const fillSection = page
      .locator("section")
      .filter({ has: fillHeading })
      .first();
    const paintRows = fillSection.locator(
      '[data-inspector-layout="paint-row"], [data-inspector-layout="drag-paint-row"]',
    );
    await expect(paintRows).toHaveCount(2);
    const baseFillRow = fillSection.locator(
      '[data-inspector-layout="paint-row"]',
    );
    await expect(baseFillRow).toHaveCount(1);
    const gradientRows = fillSection.locator(
      '[data-inspector-layout="drag-paint-row"]',
    );
    const originalGradientRow = gradientRows.filter({
      has: page.getByRole("button", { name: "Linear gradient 1" }),
    });
    await expect(originalGradientRow).toHaveCount(1);

    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-solid-gradient"]');
    const originalGradient = await preview.evaluate(
      (node) => getComputedStyle(node).backgroundImage,
    );
    expect(originalGradient).toContain("linear-gradient");

    await baseFillRow
      .getByRole("button", { name: "Open color picker" })
      .click();
    await page.getByRole("button", { name: "Linear", exact: true }).click();

    const gradientStops = page.getByRole("group", { name: "Gradient stops" });
    await expect(gradientStops).toBeVisible();
    await expect(paintRows).toHaveCount(2);
    await expect(gradientRows).toHaveCount(2);
    await expect(baseFillRow).toHaveCount(0);

    const convertedGradientRow = gradientRows.filter({
      has: page.getByRole("button", { name: "Linear gradient 2" }),
    });
    await expect(convertedGradientRow).toHaveCount(1);
    const convertedGradientTrigger = convertedGradientRow.getByRole("button", {
      name: /Linear gradient 2/,
    });
    await expect(convertedGradientTrigger).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe("rgba(0, 0, 0, 0)");

    await convertedGradientRow
      .getByRole("button", { name: "Remove layer", exact: true })
      .click();
    await expect(gradientStops).toBeHidden();
    await expect(convertedGradientRow).toHaveCount(0);
    await expect(gradientRows).toHaveCount(1);
    await expect(paintRows).toHaveCount(1);
    await expect(baseFillRow).toHaveCount(0);
    await expect(originalGradientRow).toHaveCount(1);
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toBe(originalGradient);

    const savedUrl = `${baseURL.replace(/\/$/, "")}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`;
    const readSource = async () => {
      const response = await request.get(savedUrl);
      if (!response.ok())
        throw new Error(`get-design: ${await response.text()}`);
      const design = (await response.json()) as {
        files?: Array<{ filename?: string; content?: string }>;
      };
      const content = design.files?.find(
        (file) => file.filename === "index.html",
      )?.content;
      if (typeof content !== "string") {
        throw new Error("get-design returned no saved index.html");
      }
      return content;
    };
    const readSourceGradient = async () => {
      const html = await readSource();
      return page.evaluate((content) => {
        const parsed = new DOMParser().parseFromString(content, "text/html");
        return (
          parsed.querySelector<HTMLElement>(
            '[data-agent-native-node-id="fill-solid-gradient"]',
          )?.style.backgroundImage ?? ""
        );
      }, html);
    };
    const normalizedOriginalGradient =
      normalizeGradientColorSerialization(originalGradient);
    await expect
      .poll(async () =>
        normalizeGradientColorSerialization(await readSourceGradient()),
      )
      .toBe(normalizedOriginalGradient);

    await page.reload();
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await tree
      .getByRole("button", { name: "Solid with gradient", exact: true })
      .first()
      .click();
    await expect(gradientRows).toHaveCount(1);
    await expect(paintRows).toHaveCount(1);
    await expect(originalGradientRow).toHaveCount(1);
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toBe(originalGradient);
    expect(
      normalizeGradientColorSerialization(await readSourceGradient()),
    ).toBe(normalizedOriginalGradient);
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});

test("converting the base solid appends it below sibling fills and keeps their arrays", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Base solid with sibling fills ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: BASE_SOLID_WITH_SIBLINGS_FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    await tree
      .getByRole("button", { name: "Base with siblings", exact: true })
      .click();
    await page.getByRole("button", { name: "Open color picker" }).click();
    await page.getByRole("button", { name: "Linear" }).click();

    await expect(
      page.locator('[role="group"][aria-label="Gradient stops"]'),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Linear gradient 3/ }),
    ).toBeVisible();

    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-base-siblings"]');
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toMatch(
        /^url\("https:\/\/example\.test\/image\.png"\), radial-gradient.*linear-gradient/s,
      );
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundSize),
      )
      .toBe("cover, 24px 24px, auto");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundRepeat),
      )
      .toBe("no-repeat, repeat-x, no-repeat");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundPosition),
      )
      .toBe("50% 50%, 30% 40%, 0% 0%");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe("rgba(0, 0, 0, 0)");
  } finally {
    await postAction(request, baseURL, "delete-design", {
      id: designId,
    });
  }
});

test("gradient-to-solid preserves sibling fill arrays and keeps the picker open", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Sibling gradient conversion ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: SIBLING_GRADIENT_FILL_FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const tree = page.getByRole("tree", { name: "Layers" });
    const layer = tree
      .getByRole("button", { name: "Two fills", exact: true })
      .first();
    await expect(layer).toBeVisible();
    await layer.click();

    const gradientTrigger = page
      .getByRole("button", { name: /Linear gradient 1/ })
      .first();
    await expect(gradientTrigger).toBeVisible();
    await gradientTrigger.click();
    await expect(
      page.locator('[role="group"][aria-label="Gradient stops"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Solid", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Hex" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /#cc3366/i }).first(),
    ).toContainText("20%");

    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-siblings"]');
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("linear-gradient");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("radial-gradient");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundColor),
      )
      .toBe("rgb(18, 52, 86)");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundSize),
      )
      .toBe("24px 24px, cover");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundRepeat),
      )
      .toBe("no-repeat, repeat-x");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundPosition),
      )
      .toBe("10% 20%, 30% 40%");
    expect(
      await preview.evaluate(() =>
        CSS.supports("background-image", "linear-gradient(#ff0000 0 0)"),
      ),
    ).toBe(true);

    await page.getByRole("button", { name: "Linear", exact: true }).click();
    await expect(
      page.locator('[role="group"][aria-label="Gradient stops"]'),
    ).toBeVisible();
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("rgba(204, 51, 102, 0.2)");
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("rgba(51, 102, 204, 0.2)");

    await page.getByRole("button", { name: "Solid", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Hex" })).toBeVisible();
    await expect
      .poll(() =>
        preview.evaluate((node) => getComputedStyle(node).backgroundImage),
      )
      .toContain("linear-gradient(rgba(204, 51, 102, 0.2)");

    const savedUrl = `${baseURL.replace(/\/$/, "")}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`;
    await expect
      .poll(async () => {
        const response = await request.get(savedUrl);
        if (!response.ok()) return `get-design ${response.status()}`;
        return JSON.stringify(await response.json());
      })
      .toContain("linear-gradient(rgba(204, 51, 102, 0.2) 0 0)");

    await page.reload();
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    const reselectedLayer = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Two fills", exact: true })
      .first();
    await expect(reselectedLayer).toBeVisible();
    await reselectedLayer.click();
    await expect(
      page.getByRole("button", { name: /#cc3366/i }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /#cc3366/i })
      .first()
      .click();
    await expect(page.getByRole("textbox", { name: "Hex" })).toBeVisible();
  } finally {
    await postAction(request, baseURL, "delete-design", {
      id: designId,
    });
  }
});

test("hiding and reordering an image fill keeps its cover size attached to that fill", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is not configured");
  const created = await postAction(request, baseURL, "create-design", {
    title: `Hidden fill reorder ${Date.now()}`,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await page.route("https://fills.invalid/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#000"/></svg>',
      }),
    );
    await postAction(request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: THREE_IMAGE_FILLS_FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);

    const selectFillStack = async () => {
      const layer = page
        .getByRole("tree", { name: "Layers" })
        .getByRole("button", { name: "Three image fills", exact: true });
      await expect(layer).toBeVisible();
      await layer.click();
    };
    await selectFillStack();

    const preview = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame()
      .locator('[data-agent-native-node-id="fill-stack"]');
    const readStack = () =>
      preview.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          image: style.backgroundImage,
          size: style.backgroundSize,
        };
      });
    await expect.poll(readStack).toMatchObject({
      image: expect.stringMatching(/first\.png.*second\.png.*third\.png/),
      size: "24px 24px, contain, cover",
    });

    const fillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    await fillSection
      .getByRole("button", { name: "Hide layer", exact: true })
      .nth(2)
      .click();
    await expect.poll(readStack).toMatchObject({
      image: expect.stringMatching(/first\.png.*second\.png.*third\.png/),
      size: "24px 24px, contain, 0px 0px",
    });

    const reorderHandles = fillSection.getByRole("button", {
      name: "Reorder layer",
      exact: true,
    });
    await expect(reorderHandles).toHaveCount(3);
    await reorderHandles.nth(2).dragTo(reorderHandles.nth(0));
    await expect.poll(readStack).toMatchObject({
      image: expect.stringMatching(/third\.png.*first\.png.*second\.png/),
      size: "0px 0px, 24px 24px, contain",
    });

    await fillSection
      .getByRole("button", { name: "Show layer", exact: true })
      .click();
    await expect.poll(readStack).toMatchObject({
      image: expect.stringMatching(/third\.png.*first\.png.*second\.png/),
      size: "cover, 24px 24px, contain",
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectFillStack();
    await expect.poll(readStack).toMatchObject({
      image: expect.stringMatching(/third\.png.*first\.png.*second\.png/),
      size: "cover, 24px 24px, contain",
    });
  } finally {
    await postAction(request, baseURL, "delete-design", { id: designId });
  }
});
