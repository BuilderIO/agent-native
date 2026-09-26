import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, expandAllLayers } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const FRAME_LEFT = 40;
const FRAME_TOP = 120;
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <div data-agent-native-node-id="frame" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:${FRAME_LEFT}px;top:${FRAME_TOP}px;width:600px;height:400px;border:1px solid #ccc"></div>
</main></body></html>`;
const AUTHORED_OPEN_SVG_HTML = SCREEN_HTML.replace(
  "</main>",
  `<svg data-agent-native-node-id="authored-open-svg" data-agent-native-layer-name="Pasted SVG" data-an-primitive="pasted-svg" data-an-pen-nodes='[0,[10,30,null,null,null,null,null],[70,30,null,null,null,null,null]]' viewBox="0 0 120 80" style="position:absolute;left:200px;top:200px;width:120px;height:80px;overflow:visible"><path d="M10 30L70 30" fill="none" stroke="#111827" stroke-width="2" /></svg>
</main>`,
);

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

async function createDesign(
  request: APIRequestContext,
  screenHtml = SCREEN_HTML,
) {
  const created = await action(request, "create-design", {
    title: `Pen in frame QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: screenHtml,
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
  const preview = await page.evaluate(() => {
    const overlays = Array.from(
      document.querySelectorAll<HTMLElement>("[data-pen-path-overlay]"),
    ).filter((overlay) => {
      const style = getComputedStyle(overlay);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    const overlay = overlays.sort(
      (left, right) =>
        right.querySelectorAll("[data-pen-anchor]").length -
        left.querySelectorAll("[data-pen-anchor]").length,
    )[0];
    if (!overlay) return null;
    const rects = Array.from(
      overlay.querySelectorAll<HTMLElement>("[data-pen-anchor]"),
    ).map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const handles = Array.from(
      overlay.querySelectorAll<HTMLElement>("[data-pen-handle]"),
    ).map((handle) => {
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    return {
      anchors: rects,
      handles,
      pathData: overlay.querySelector("svg path")?.getAttribute("d") ?? "",
    };
  });
  if (!preview) throw new Error("Pen path preview is not visible");
  return preview;
}

async function screenLocalPoint(page: Page, point: { x: number; y: number }) {
  return page
    .locator("iframe[data-screen-iframe-id]")
    .evaluate((iframe, outerPoint) => {
      const rect = iframe.getBoundingClientRect();
      return {
        x: ((outerPoint.x - rect.left) / rect.width) * iframe.clientWidth,
        y: ((outerPoint.y - rect.top) / rect.height) * iframe.clientHeight,
      };
    }, point);
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

async function authoredOpenPathEndpoints(page: Page) {
  const endpoints = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    );
    const path = iframe?.contentDocument?.querySelector<SVGPathElement>(
      'svg[data-agent-native-node-id="authored-open-svg"] path',
    );
    const matrix = path?.getScreenCTM();
    const frameBox = iframe?.getBoundingClientRect();
    if (!iframe || !path || !matrix || !frameBox) return null;
    const toPagePoint = (distance: number) => {
      const endpoint = path.getPointAtLength(distance);
      const local = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(
        matrix,
      );
      return {
        x: frameBox.left + (local.x / iframe.clientWidth) * frameBox.width,
        y: frameBox.top + (local.y / iframe.clientHeight) * frameBox.height,
      };
    };
    return {
      start: toPagePoint(0),
      terminal: toPagePoint(path.getTotalLength()),
    };
  });
  if (!endpoints)
    throw new Error("authored open SVG has no rendered endpoints");
  return endpoints;
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
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Vector");

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

test("a new Pen path previews every pointer step in the selected frame and closes with fill", async ({
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
    const bounds = (await iframe.boundingBox())!;
    const framePoint = (x: number, y: number) => ({
      x: bounds.x + ((FRAME_LEFT + x) / 800) * bounds.width,
      y: bounds.y + ((FRAME_TOP + y) / 600) * bounds.height,
    });
    const points = [
      framePoint(72, 64),
      framePoint(198, 82),
      framePoint(138, 206),
    ];

    await page.keyboard.press("p");
    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // Each click adds the anchor while the pointer is still down. The second
    // point is a real drag, so its Bézier handles and changing endpoint must
    // be visible before mouseup, not only in the final persisted SVG.
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(1);
    expect((await penPreview(page)).pathData).toMatch(/^M\s/);
    await page.mouse.up();

    await page.mouse.move(points[1]!.x, points[1]!.y);
    await page.mouse.down();
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(2);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const pointer = {
        x: points[1]!.x + 28 * t,
        y: points[1]!.y + 34 * t,
      };
      await page.mouse.move(pointer.x, pointer.y);
      const preview = await penPreview(page);
      expect(preview.anchors).toHaveLength(2);
      expect(preview.handles.length).toBeGreaterThan(0);
      expect(preview.pathData).toMatch(/[CQ]/);
      expect(Math.abs(preview.anchors[1]!.x - points[1]!.x)).toBeLessThan(3);
      expect(Math.abs(preview.anchors[1]!.y - points[1]!.y)).toBeLessThan(3);
      const draggedHandle = preview.handles[preview.handles.length - 1]!;
      expect(Math.abs(draggedHandle.x - pointer.x)).toBeLessThan(3);
      expect(Math.abs(draggedHandle.y - pointer.y)).toBeLessThan(3);
    }
    const curvedAnchorExpected = await screenLocalPoint(page, points[1]!);
    await page.mouse.up();

    await page.mouse.move(points[2]!.x, points[2]!.y);
    await page.mouse.down();
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(3);
    expect((await penPreview(page)).pathData).not.toMatch(/Z\s*$/i);
    await page.mouse.up();

    // Closing is itself a pointer gesture. While the pointer is down over the
    // first anchor the preview closes, but nothing is persisted before release.
    const firstAnchor = (await penPreview(page)).anchors[0]!;
    await page.mouse.move(firstAnchor.x, firstAnchor.y);
    await page.mouse.down();
    await expect
      .poll(async () => (await penPreview(page)).pathData)
      .toMatch(/Z\s*$/i);
    expect(await persistedVectors(request, designId)).toEqual([]);
    await page.mouse.up();

    await expect
      .poll(async () => (await persistedVectors(request, designId)).length)
      .toBe(1);
    const [vector] = await page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator("svg[data-an-primitive='path']")
      .evaluateAll((svgs) =>
        svgs.map((svg) => {
          const path = svg.querySelector("path");
          return {
            parent: svg.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            nodes: JSON.parse(svg.getAttribute("data-an-pen-nodes") ?? "[]"),
            screenAnchors: (() => {
              const matrix = (svg as SVGSVGElement).getScreenCTM();
              if (!matrix) return [];
              return JSON.parse(svg.getAttribute("data-an-pen-nodes") ?? "[]")
                .slice(1)
                .map(([x, y]: [number, number]) => {
                  const point = new DOMPoint(x, y).matrixTransform(matrix);
                  return { x: point.x, y: point.y };
                });
            })(),
            closed: path?.getAttribute("d")?.trim().endsWith("Z"),
            fill: path ? getComputedStyle(path).fill : null,
            stroke: path ? getComputedStyle(path).stroke : null,
          };
        }),
      );
    expect(vector).toBeDefined();
    expect(vector!.parent).toBe("frame");
    expect(vector!.nodes[0]).toBe(1);
    expect(vector!.nodes).toHaveLength(4);
    const expectedAnchors = [
      await screenLocalPoint(page, points[0]!),
      curvedAnchorExpected,
      await screenLocalPoint(page, points[2]!),
    ];
    expectedAnchors.forEach((expected, index) => {
      const actual = vector!.screenAnchors[index]!;
      expect(Math.abs(actual.x - expected.x)).toBeLessThan(3);
      expect(Math.abs(actual.y - expected.y)).toBeLessThan(3);
    });
    expect(vector!.closed).toBe(true);
    expect(vector!.fill).toBe("rgb(218, 218, 218)");
    expect(vector!.stroke).toBe("none");
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
      page.getByRole("button", { name: "Move", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Vector");
    await page.keyboard.press("p");
    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
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
    const firstExtension = (await persistedVectors(request, designId))[0]!;
    expect(firstExtension.id).toBe(before.id);
    expect(firstExtension.pathData).toContain("L");

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
      .toBe(firstExtension.pathData);
    expect((await persistedVectors(request, designId))[0]?.id).toBe(before.id);

    const committedTerminal = await terminalPenPoint(page);
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(
        async () => (await persistedVectors(request, designId))[0]?.pathData,
      )
      .toBe(before.pathData);
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => persistedVectors(request, designId))
      .toEqual([]);
    await expect.poll(async () => vectors(page)).toEqual([]);
    const selectedBeforeRestart = await page
      .locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-layer-node-id")),
      );
    expect(selectedBeforeRestart).not.toContain(firstExtension.id);

    // Undoing the creation must invalidate its continuation target. Clicking
    // the old terminal point starts a fresh path instead of appending to the
    // deleted vector and issuing an update against its missing node id.
    await page.keyboard.press("p");
    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await penClick(page, committedTerminal.x, committedTerminal.y);
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(1);
    await penClick(
      page,
      Math.min(committedTerminal.x + 40, committedTerminal.right - 12),
      Math.min(committedTerminal.y + 40, committedTerminal.bottom - 12),
    );
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(2);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await persistedVectors(request, designId)).length)
      .toBe(1);
    const restarted = (await persistedVectors(request, designId))[0]!;
    expect(restarted.id).not.toBe(firstExtension.id);
    expect(restarted.pathData).not.toBe(firstExtension.pathData);
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Vector");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await vectors(page)).length).toBe(1);
    expect((await persistedVectors(request, designId))[0]).toEqual(restarted);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("overview Pen continues a selected authored open SVG in place", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const designId = await createDesign(request, AUTHORED_OPEN_SVG_HTML);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await expect
      .poll(async () => page.locator("iframe[data-screen-iframe-id]").count(), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);
    await page.locator("[data-frame-title]").first().click();
    await expandAllLayers(page);
    const layerButton = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Pasted SVG", exact: true });
    await expect(layerButton).toBeVisible();
    await layerButton.click();
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Pasted SVG");

    const before = await persistedVectors(request, designId);
    expect(before).toHaveLength(1);
    const authoredNodeId = "authored-open-svg";
    expect(before[0]!.id).toBe(authoredNodeId);
    expect(before[0]!.pathData).toBe("M10 30L70 30");
    let authoredNodeSaveRequests = 0;
    page.on("request", (request) => {
      if (
        !request.url().includes("/_agent-native/actions/update-file") ||
        request.method() !== "POST"
      ) {
        return;
      }
      if ((request.postData() ?? "").includes(authoredNodeId)) {
        authoredNodeSaveRequests += 1;
      }
    });

    await page.keyboard.press("p");
    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    const endpoints = await authoredOpenPathEndpoints(page);
    const iframeBox = await page.evaluate(() => {
      const rect = document
        .querySelector("iframe[data-screen-iframe-id]")
        ?.getBoundingClientRect();
      return rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
    });
    expect(iframeBox).not.toBeNull();
    for (const point of [endpoints.start, endpoints.terminal]) {
      expect(point.x).toBeGreaterThan(iframeBox!.x + 2);
      expect(point.x).toBeLessThan(iframeBox!.x + iframeBox!.width - 2);
      expect(point.y).toBeGreaterThan(iframeBox!.y + 2);
      expect(point.y).toBeLessThan(iframeBox!.y + iframeBox!.height - 2);
    }
    await page.mouse.click(endpoints.terminal.x, endpoints.terminal.y);
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(2);
    const resumed = await penPreview(page);
    for (const [actual, expected] of [
      [resumed.anchors[0]!, endpoints.start],
      [resumed.anchors[1]!, endpoints.terminal],
    ] as const) {
      expect(Math.abs(actual.x - expected.x)).toBeLessThan(3);
      expect(Math.abs(actual.y - expected.y)).toBeLessThan(3);
    }
    expect(authoredNodeSaveRequests).toBe(0);

    const appended = {
      x: endpoints.terminal.x + 36,
      y: endpoints.terminal.y + 36,
    };
    expect(appended.x).toBeLessThan(iframeBox!.x + iframeBox!.width - 12);
    expect(appended.y).toBeLessThan(iframeBox!.y + iframeBox!.height - 12);
    await page.mouse.move(appended.x, appended.y);
    await page.mouse.down();
    await expect
      .poll(async () => (await penPreview(page)).anchors.length)
      .toBe(3);
    const extendedPreview = await penPreview(page);
    expect(extendedPreview.pathData).not.toBe(before[0]!.pathData);
    const expectedPathData = extendedPreview.pathData;
    expect(authoredNodeSaveRequests).toBe(0);
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(authoredNodeSaveRequests).toBe(0);
    const saveResponse = page.waitForResponse(
      (response) => {
        if (
          !response.url().includes("/_agent-native/actions/update-file") ||
          response.request().method() !== "POST"
        ) {
          return false;
        }
        const body = response.request().postData();
        return typeof body === "string" && body.includes(authoredNodeId);
      },
      { timeout: 30_000 },
    );
    await page.keyboard.press("Enter");
    expect((await saveResponse).ok()).toBe(true);
    expect(authoredNodeSaveRequests).toBeGreaterThan(0);
    const after = (await persistedVectors(request, designId))[0]!;
    expect(after.id).toBe(before[0]!.id);
    const expectedCoordinates =
      expectedPathData.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const persistedCoordinates =
      after.pathData.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(expectedCoordinates).toHaveLength(6);
    expect(persistedCoordinates).toHaveLength(expectedCoordinates.length);
    for (let index = 0; index < expectedCoordinates.length; index += 1) {
      expect(
        Math.abs(persistedCoordinates[index]! - expectedCoordinates[index]!),
      ).toBeLessThanOrEqual(0.5);
    }
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
