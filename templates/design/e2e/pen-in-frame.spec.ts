import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const FRAME_LEFT = 40;
const FRAME_TOP = 120;
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <div data-agent-native-node-id="frame" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:${FRAME_LEFT}px;top:${FRAME_TOP}px;width:600px;height:400px;border:1px solid #ccc"></div>
</main></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Pen in frame QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
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
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
    ],
  });
  return designId;
}

/** Each vector's authored geometry next to where it paints, in screen px. */
async function vectors(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    )?.contentDocument;
    if (!doc) return [];
    return [...doc.querySelectorAll<SVGElement>("svg[data-an-primitive]")].map(
      (svg) => {
        const rect = svg.getBoundingClientRect();
        const path = svg.querySelector("path");
        const pathData = path?.getAttribute("d") ?? "";
        const pathStyle = path ? getComputedStyle(path) : null;
        const numbers = pathData
          .split(/[^-\d.]+/)
          .filter(Boolean)
          .map(Number);
        const xs = numbers.filter((_, index) => index % 2 === 0);
        const ys = numbers.filter((_, index) => index % 2 === 1);
        return {
          id: svg.getAttribute("data-agent-native-node-id"),
          parent:
            svg.parentElement?.getAttribute("data-agent-native-node-id") ??
            null,
          styleLeft: (svg as unknown as HTMLElement).style.left,
          drawnLeft: Math.min(...xs),
          drawnTop: Math.min(...ys),
          paintedLeft: Math.round(rect.left),
          paintedTop: Math.round(rect.top),
          pathData,
          fill: pathStyle?.fill ?? null,
          stroke: pathStyle?.stroke ?? null,
          strokeWidth: pathStyle?.strokeWidth ?? null,
        };
      },
    );
  });
}

async function persistedVectors(request: APIRequestContext, designId: string) {
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const html = design.files?.find(
    (file: { filename?: string }) => file.filename === "index.html",
  )?.content;
  if (typeof html !== "string") throw new Error("index.html was not returned");
  return pageVectors(html);
}

function pageVectors(html: string) {
  return Array.from(
    html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi),
    ([, attributes, body]) => ({
      id:
        attributes?.match(/\bdata-agent-native-node-id="([^"]+)"/)?.[1] ?? null,
      pathData: body?.match(/<path\b[^>]*\bd="([^"]*)"/)?.[1] ?? "",
    }),
  ).filter((vector) => vector.id && vector.pathData);
}

async function penClick(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function penPreview(page: Page) {
  return page.locator("[data-pen-path-overlay]").evaluate((overlay) => {
    const rects = Array.from(
      overlay.querySelectorAll<HTMLElement>("[data-pen-anchor]"),
    ).map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    return {
      anchors: rects,
      pathData: overlay.querySelector("svg path")?.getAttribute("d") ?? "",
    };
  });
}

async function terminalPenPoint(page: Page) {
  const point = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    );
    const svg = iframe?.contentDocument?.querySelector<SVGSVGElement>(
      "svg[data-an-primitive='path']",
    );
    const path = svg?.querySelector("path");
    const matrix = svg?.getScreenCTM();
    const frameBox = iframe?.getBoundingClientRect();
    if (!iframe || !svg || !path || !matrix || !frameBox) return null;
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const local = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(matrix);
    return {
      x: frameBox.left + (local.x / iframe.clientWidth) * frameBox.width,
      y: frameBox.top + (local.y / iframe.clientHeight) * frameBox.height,
      right: frameBox.right,
      bottom: frameBox.bottom,
    };
  });
  if (!point) throw new Error("committed path has no rendered terminal point");
  return point;
}

test("a pen path drawn inside a frame paints where it was drawn and stays draggable", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(3000);
    await page.locator("[data-frame-title]").first().click();
    const card = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    const points = [
      { x: card.x + 60, y: card.y + 200 },
      { x: card.x + 120, y: card.y + 140 },
      { x: card.x + 180, y: card.y + 220 },
    ];
    await page.keyboard.press("p");
    await page.waitForTimeout(400);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      await penClick(page, point.x, point.y);
      await expect
        .poll(async () => (await penPreview(page)).anchors.length)
        .toBe(index + 1);

      const preview = await penPreview(page);
      expect(preview.pathData).toMatch(/^M\s/);
      if (index > 0) expect(preview.pathData).toMatch(/[LC]/);
      for (const anchor of preview.anchors) {
        expect(anchor.x).toBeGreaterThan(card.x);
        expect(anchor.x).toBeLessThan(card.x + card.width);
        expect(anchor.y).toBeGreaterThan(card.y);
        expect(anchor.y).toBeLessThan(card.y + card.height);
      }
      expect(Math.abs(preview.anchors[index]!.x - point.x)).toBeLessThan(3);
      expect(Math.abs(preview.anchors[index]!.y - point.y)).toBeLessThan(3);

      if (index < points.length - 1) {
        const nextPoint = points[index + 1]!;
        await page.mouse.move(nextPoint.x, nextPoint.y);
        await expect
          .poll(async () => (await penPreview(page)).anchors.length)
          .toBe(index + 2);
        const livePreview = await penPreview(page);
        expect(livePreview.pathData).toMatch(/[LC]/);
        expect(
          Math.abs(livePreview.anchors[index + 1]!.x - nextPoint.x),
        ).toBeLessThan(3);
        expect(
          Math.abs(livePreview.anchors[index + 1]!.y - nextPoint.y),
        ).toBeLessThan(3);
      }
    }
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);

    const drawn = await vectors(page);
    expect(drawn).toHaveLength(1);
    const vector = drawn[0]!;
    expect(vector.parent).toBe("frame");
    // Enter finishes the current open path; only an explicit click on its
    // first anchor closes it. Open paths must remain visible as strokes and
    // must not acquire the filled-shape default.
    expect(vector.pathData).not.toMatch(/Z\s*$/i);
    expect(vector.fill).toBe("none");
    expect(vector.stroke).not.toBe("none");
    expect(vector.strokeWidth).not.toBeNull();
    // Painted where the path was drawn, not offset by the frame's origin.
    expect(Math.abs(vector.paintedLeft - vector.drawnLeft)).toBeLessThan(6);
    expect(Math.abs(vector.paintedTop - vector.drawnTop)).toBeLessThan(6);

    const box = (await page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator("svg[data-an-primitive='path']")
      .first()
      .boundingBox())!;
    await page.keyboard.press("v");
    await page.waitForTimeout(400);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.click(centerX, centerY);
    await page.waitForTimeout(800);
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 10, centerY + 8, { steps: 3 });
    await page.mouse.move(centerX + 70, centerY + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2000);

    const moved = (await vectors(page))[0]!;
    expect(moved.styleLeft).not.toBe(vector.styleLeft);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Pen continues a selected open path in place and persists undo/redo", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await page.locator("[data-frame-title]").first().click();
    const iframe = page.locator("iframe[data-screen-iframe-id]").first();
    await expect
      .poll(async () => Boolean(await iframe.boundingBox()))
      .toBe(true);
    const frameBox = (await iframe.boundingBox())!;
    const start = {
      x: frameBox.x + frameBox.width * 0.2,
      y: frameBox.y + frameBox.height * 0.35,
    };
    const end = { x: frameBox.x + frameBox.width * 0.7, y: start.y };
    await page.keyboard.press("p");
    await penClick(page, start.x, start.y);
    await penClick(page, end.x, end.y);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await persistedVectors(request, designId)).length)
      .toBe(1);
    const before = (await persistedVectors(request, designId))[0]!;

    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Vector");
    const terminal = await terminalPenPoint(page);
    await page.mouse.click(terminal.x, terminal.y);
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(2);

    const appended = {
      x: Math.min(terminal.x + 36, terminal.right - 12),
      y: Math.min(terminal.y + 36, terminal.bottom - 12),
    };
    await page.mouse.move(appended.x, appended.y);
    await page.mouse.down();
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(3);
    expect((await penPreview(page)).pathData).not.toBe(before.pathData);
    await page.mouse.up();
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => {
        const paths = await persistedVectors(request, designId);
        return paths.length === 1 && paths[0]?.pathData !== before.pathData;
      })
      .toBe(true);
    const extended = (await persistedVectors(request, designId))[0]!;
    expect(extended.id).toBe(before.id);
    expect(extended.pathData).toContain("L");

    const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(
        async () => (await persistedVectors(request, designId))[0]?.pathData,
      )
      .toBe(before.pathData);
    expect((await persistedVectors(request, designId))[0]?.id).toBe(before.id);
    await page.keyboard.press(redoShortcut);
    await expect
      .poll(
        async () => (await persistedVectors(request, designId))[0]?.pathData,
      )
      .toBe(extended.pathData);
    expect((await persistedVectors(request, designId))[0]?.id).toBe(before.id);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await vectors(page)).length).toBe(1);
    expect((await persistedVectors(request, designId))[0]).toEqual(extended);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
