import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, designFrame, gotoEditor } from "./helpers";

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

const SOURCE_HTML = `<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:780px;background:#0f172a">
  <div data-agent-native-node-id="cross-source" data-agent-native-layer-name="Cross-screen source"
    style="position:absolute;left:100px;top:180px;width:140px;height:60px;box-sizing:border-box;background:#38bdf8;color:#082f49">Source</div>
</body></html>`;

const DESTINATION_HTML = `<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:780px;background:#111827">
  <section data-agent-native-node-id="destination-shell" data-agent-native-layer-name="Destination shell"
    style="position:absolute;left:80px;top:120px;width:420px;padding:20px;box-sizing:border-box;background:#334155">
    <section data-agent-native-node-id="nested-auto" data-agent-native-layer-name="Nested auto"
      style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#475569">
      <div data-agent-native-node-id="destination-first" data-agent-native-layer-name="Destination first"
        style="width:180px;height:40px;background:#94a3b8;color:#0f172a">First</div>
      <div data-agent-native-node-id="destination-last" data-agent-native-layer-name="Destination last"
        style="width:180px;height:40px;background:#64748b;color:#f8fafc">Last</div>
    </section>
  </section>
</body></html>`;

type DesignFile = { filename: string; id: string; content: string };

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function files(
  request: APIRequestContext,
  designId: string,
): Promise<DesignFile[]> {
  const response = await request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return ((await response.json()).files ?? []) as DesignFile[];
}

async function createDesign(
  request: APIRequestContext,
  onCreated?: (designId: string) => void,
) {
  const created = await action(request, "create-design", {
    title: `Cross-screen Option drag ${Date.now()}`,
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (typeof id !== "string") throw new Error("create-design returned no id");
  onCreated?.(id);
  await action(request, "create-file", {
    designId: id,
    filename: "index.html",
    content: SOURCE_HTML,
    fileType: "html",
  });
  await action(request, "create-file", {
    designId: id,
    filename: "destination.html",
    content: DESTINATION_HTML,
    fileType: "html",
  });
  const createdFiles = await files(request, id);
  const sourceId = createdFiles.find(
    (file) => file.filename === "index.html",
  )?.id;
  const destinationId = createdFiles.find(
    (file) => file.filename === "destination.html",
  )?.id;
  if (!sourceId || !destinationId) throw new Error("created screens missing");
  await action(request, "update-design", {
    id,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", sourceId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", sourceId],
        value: { x: 0, y: 0, width: 1000, height: 780, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", destinationId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", destinationId],
        value: { x: 1120, y: 0, width: 1000, height: 780, z: 1 },
      },
    ],
  });
  return { id, sourceId, destinationId };
}

async function content(
  request: APIRequestContext,
  designId: string,
  filename: string,
) {
  return (
    (await files(request, designId)).find((file) => file.filename === filename)
      ?.content ?? ""
  );
}

async function boxFor(page: Page, screenId: string, nodeId: string) {
  const box = await designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`missing ${nodeId}`);
  return box;
}

function layerIds(html: string, layerName: string) {
  const ids: string[] = [];
  const pattern = new RegExp(
    `data-agent-native-node-id="([^"]+)"[^>]*data-agent-native-layer-name="${layerName}"`,
    "g",
  );
  for (const match of html.matchAll(pattern)) ids.push(match[1]!);
  return ids;
}

async function deleteDesign(request: APIRequestContext, designId: string) {
  await action(request, "delete-design", { id: designId });
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("Option-dragging a root from Screen A duplicates into nested auto layout on Screen B", async ({
  page,
  request,
}) => {
  let designId: string | null = null;
  try {
    const design = await createDesign(request, (id) => {
      designId = id;
    });
    await gotoEditor(page, design.id);
    await page.keyboard.press("Shift+1");
    let previousScreenPositions = "";
    await expect
      .poll(async () => {
        const source = await boxFor(page, design.sourceId, "cross-source");
        const target = await boxFor(page, design.destinationId, "nested-auto");
        const current = JSON.stringify({
          source: { x: source.x, y: source.y },
          target: { x: target.x, y: target.y },
        });
        const settled = current === previousScreenPositions;
        previousScreenPositions = current;
        return settled;
      })
      .toBe(true);

    const source = await boxFor(page, design.sourceId, "cross-source");
    const target = await boxFor(page, design.destinationId, "nested-auto");
    const sourceBefore = await content(request, design.id, "index.html");
    const destinationBefore = await content(
      request,
      design.id,
      "destination.html",
    );
    const sourceNode = designFrame(page, design.sourceId).locator(
      '[data-agent-native-node-id="cross-source"]',
    );
    const sourceBeforeGeometry = await sourceNode.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        parentNodeId: node.parentElement?.getAttribute(
          "data-agent-native-node-id",
        ),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        background: style.backgroundColor,
        cssWidth: style.width,
        cssHeight: style.height,
      };
    });

    await page.keyboard.down(PRIMARY);
    await page.mouse.click(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.keyboard.up(PRIMARY);
    await page.keyboard.down("Alt");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    try {
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + 8, {
        steps: 4,
      });
      await page.mouse.move(
        target.x + target.width / 2,
        target.y + target.height / 2,
        { steps: 30 },
      );
      await expect
        .poll(() => page.locator("[data-cross-screen-drag-ghost]").count())
        .toBeGreaterThan(0);
      await expect
        .poll(() => page.locator("[data-cross-screen-drop-guide]").count())
        .toBeGreaterThan(0);
      const sourceHeldGeometry = await sourceNode.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          parentNodeId: node.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
      expect(sourceHeldGeometry.parentNodeId).toBe(
        sourceBeforeGeometry.parentNodeId,
      );
      expect(sourceHeldGeometry.x).toBeCloseTo(sourceBeforeGeometry.x, 1);
      expect(sourceHeldGeometry.y).toBeCloseTo(sourceBeforeGeometry.y, 1);
      expect(sourceHeldGeometry.width).toBeCloseTo(
        sourceBeforeGeometry.width,
        1,
      );
      expect(sourceHeldGeometry.height).toBeCloseTo(
        sourceBeforeGeometry.height,
        1,
      );
      const heldGuide = await page
        .locator("[data-cross-screen-drop-guide]")
        .evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            display: style.display,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
        });
      const heldTarget = await designFrame(page, design.destinationId)
        .locator('[data-agent-native-node-id="nested-auto"]')
        .boundingBox();
      expect(heldTarget).not.toBeNull();
      const guideInsideTarget =
        Math.abs(heldGuide.left - heldTarget!.x) < 4 &&
        Math.abs(heldGuide.top - heldTarget!.y) < 4 &&
        Math.abs(heldGuide.width - heldTarget!.width) < 4 &&
        Math.abs(heldGuide.height - heldTarget!.height) < 4;
      const guideIsColumnInsertionLine =
        heldGuide.left >= heldTarget!.x - 4 &&
        heldGuide.left + heldGuide.width <=
          heldTarget!.x + heldTarget!.width + 4 &&
        heldGuide.top >= heldTarget!.y - 4 &&
        heldGuide.top + heldGuide.height <=
          heldTarget!.y + heldTarget!.height + 4 &&
        heldGuide.height <= 4;
      expect(heldGuide.display).not.toBe("none");
      expect(
        guideInsideTarget || guideIsColumnInsertionLine,
        `guide=${JSON.stringify(heldGuide)} target=${JSON.stringify(heldTarget)}`,
      ).toBe(true);
      await expect
        .poll(() =>
          designFrame(page, design.sourceId)
            .locator('[data-agent-native-node-id="cross-source"]')
            .count(),
        )
        .toBe(1);
      expect(await content(request, design.id, "index.html")).toBe(
        sourceBefore,
      );
      expect(await content(request, design.id, "destination.html")).toBe(
        destinationBefore,
      );
    } finally {
      await page.mouse.up();
      await page.keyboard.up("Alt");
    }

    let destinationAfter = "";
    await expect
      .poll(async () => {
        destinationAfter = await content(
          request,
          design.id,
          "destination.html",
        );
        return layerIds(destinationAfter, "Cross-screen source").length;
      })
      .toBe(1);
    const copyId = layerIds(destinationAfter, "Cross-screen source")[0]!;
    expect(copyId).not.toBe("cross-source");
    expect(await content(request, design.id, "index.html")).toContain(
      'data-agent-native-node-id="cross-source"',
    );
    expect(
      await designFrame(page, design.destinationId)
        .locator(`[data-agent-native-node-id="${copyId}"]`)
        .evaluate((node) =>
          node.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
    ).toBe("nested-auto");
    const destinationOrder = await designFrame(page, design.destinationId)
      .locator(
        '[data-agent-native-node-id="nested-auto"] > [data-agent-native-node-id]',
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
      );
    expect(destinationOrder).toEqual([
      "destination-first",
      copyId,
      "destination-last",
    ]);

    const copyGeometry = await designFrame(page, design.destinationId)
      .locator(`[data-agent-native-node-id="${copyId}"]`)
      .evaluate((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          background: style.backgroundColor,
          cssWidth: style.width,
          cssHeight: style.height,
        };
      });
    expect(copyGeometry).toMatchObject({
      background: sourceBeforeGeometry.background,
      cssWidth: sourceBeforeGeometry.cssWidth,
      cssHeight: sourceBeforeGeometry.cssHeight,
    });

    await page.keyboard.press(`${PRIMARY}+z`);
    await expect
      .poll(() => content(request, design.id, "destination.html"))
      .toBe(destinationBefore);
    await expect
      .poll(() => content(request, design.id, "index.html"))
      .toBe(sourceBefore);

    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await expect
      .poll(() => content(request, design.id, "destination.html"))
      .toContain(`data-agent-native-node-id="${copyId}"`);
    await expect
      .poll(() => content(request, design.id, "index.html"))
      .toContain('data-agent-native-node-id="cross-source"');

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator(`[data-agent-native-node-id="${copyId}"]`)
          .count(),
      )
      .toBe(1);
    const reloadedGeometry = await designFrame(page, design.destinationId)
      .locator(`[data-agent-native-node-id="${copyId}"]`)
      .evaluate((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          background: style.backgroundColor,
          cssWidth: style.width,
          cssHeight: style.height,
          parent: node.parentElement?.getAttribute("data-agent-native-node-id"),
        };
      });
    expect(reloadedGeometry).toMatchObject({
      x: copyGeometry.x,
      y: copyGeometry.y,
      width: copyGeometry.width,
      height: copyGeometry.height,
      background: copyGeometry.background,
      cssWidth: copyGeometry.cssWidth,
      cssHeight: copyGeometry.cssHeight,
      parent: "nested-auto",
    });
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator(
            '[data-agent-native-node-id="nested-auto"] > [data-agent-native-node-id]',
          )
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
          ),
      )
      .toEqual(["destination-first", copyId, "destination-last"]);
    expect(await content(request, design.id, "index.html")).toContain(
      'data-agent-native-node-id="cross-source"',
    );
  } finally {
    if (designId) await deleteDesign(request, designId);
  }
});
