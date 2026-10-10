import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
  pickFrameMode,
} from "./helpers";

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; content?: string }>;
};

const INSET_FLOW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Absolute to flow</title>
    <style>
      .authored-inset { inset: 9px 10px 11px 12px; }
    </style>
  </head>
  <body style="margin:0">
    <main data-agent-native-node-id="flow-parent" data-agent-native-layer-name="Flow parent"
      style="position:relative;width:240px;height:180px;display:flex;flex-direction:column;gap:10px">
      <div data-agent-native-node-id="flow-target" data-agent-native-layer-name="Inset target"
        class="authored-inset" style="position:absolute;width:60px;height:30px;background:#e6a26b"></div>
      <div data-agent-native-node-id="flow-sibling" data-agent-native-layer-name="Flow sibling"
        style="width:40px;height:20px;background:#6366f1"></div>
    </main>
  </body>
</html>`;

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function readInsetTargetStyles(
  page: Page,
  designId: string,
  fileId: string,
) {
  const record = await readDesign(page, designId);
  const html = record.files?.find(
    (candidate) => candidate.id === fileId,
  )?.content;
  if (!html) return null;
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "text/html");
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="flow-target"]',
    );
    if (!target) return null;
    return {
      position: target.style.position,
      width: target.style.width,
      alignSelf: target.style.alignSelf,
      inset: target.style.inset,
      left: target.style.left,
      right: target.style.right,
      top: target.style.top,
      bottom: target.style.bottom,
    };
  }, html);
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-card]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = rect.top + 60; y < rect.bottom - 60; y += 40) {
      for (let x = rect.left + 60; x < rect.right - 60; x += 40) {
        if (
          cards.some(
            (card) =>
              x >= card.left - 24 &&
              x <= card.right + 24 &&
              y >= card.top - 24 &&
              y <= card.bottom + 24,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

test.beforeEach(async ({ page }) => {
  const updates: string[] = [];
  const targetHost = new URL(e2eBaseURL()).host;
  page.on("websocket", (socket) => {
    if (!socket.url().includes(targetHost)) return;
    socket.on("framereceived", (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (["update", "full-reload"].includes(message.type)) {
          updates.push(message.type);
        }
      } catch {
        // Vite also sends non-JSON frames for heartbeat and connection control.
      }
    });
  });
  (page as typeof page & { hmrUpdates: string[] }).hmrUpdates = updates;
});

test.afterEach(async ({ page }) => {
  expect(
    (page as typeof page & { hmrUpdates: string[] }).hmrUpdates,
    "No Vite HMR during the position-toggle proof",
  ).toEqual([]);
});

test("turning off absolute positioning clears authored inset and restores flow", async ({
  page,
}) => {
  const created = await page.request.post(
    appPath("/_agent-native/actions/create-design"),
    {
      data: {
        title: `Absolute to flow ${Date.now()}`,
        projectType: "prototype",
      },
    },
  );
  if (!created.ok()) throw new Error(await created.text());
  const createdDesign = await created.json();
  const designId = createdDesign?.id ?? createdDesign?.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");

  let completed = false;
  try {
    const fileResponse = await page.request.post(
      appPath("/_agent-native/actions/create-file"),
      {
        data: {
          designId,
          filename: "flow.html",
          content: INSET_FLOW_HTML,
          fileType: "html",
        },
      },
    );
    if (!fileResponse.ok()) throw new Error(await fileResponse.text());
    const file = await fileResponse.json();
    const fileId = file?.id ?? file?.data?.id;
    if (typeof fileId !== "string") throw new Error("missing Screen id");
    const frameResponse = await page.request.post(
      appPath("/_agent-native/actions/update-design"),
      {
        data: {
          id: designId,
          dataOperations: [
            {
              op: "set",
              path: ["canvasFrames", fileId],
              value: { x: 100, y: 100, width: 320, height: 240 },
            },
          ],
        },
      },
    );
    if (!frameResponse.ok()) throw new Error(await frameResponse.text());

    await page.addInitScript(() => {
      (window as typeof window & { __DESIGN_TRACE?: boolean }).__DESIGN_TRACE =
        true;
    });
    await gotoEditor(page, designId);
    const target = designFrame(page, fileId).locator(
      '[data-agent-native-node-id="flow-target"]',
    );
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error("nested target has no canvas bounds");
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(modifier);
    try {
      await page.mouse.click(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
      );
    } finally {
      await page.keyboard.up(modifier);
    }
    await expect
      .poll(() =>
        page.evaluate(() => {
          const entries = (window as any).__designTrace?.entries?.() ?? [];
          const selects = entries.filter(
            (entry: any) => entry.area === "select",
          );
          return selects.at(-1)?.data?.element ?? null;
        }),
      )
      .toBe('[data-agent-native-node-id="flow-target"]');
    const toggle = page.getByRole("button", {
      name: "Absolute position",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const widthSizing = page.getByRole("button", {
      name: "W sizing mode — Fixed",
      exact: true,
    });
    await widthSizing.click();
    await expect(
      page.getByRole("menuitem", { name: "Fill container", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    const before = await target.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        rect: {
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
        },
        position: style.position,
        inset: [style.top, style.right, style.bottom, style.left],
        styleAttribute: element.getAttribute("style"),
      };
    });
    expect(before.position).toBe("absolute");
    expect(before.inset).toEqual(["9px", "10px", "11px", "12px"]);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const expectedStyles = {
      position: "relative",
      width: "60px",
      alignSelf: "",
      inset: "auto",
      left: "auto",
      right: "auto",
      top: "auto",
      bottom: "auto",
    };
    await expect
      .poll(() => readInsetTargetStyles(page, designId, fileId), {
        timeout: 15_000,
      })
      .toEqual(expectedStyles);
    const updatedRecord = await readDesign(page, designId);
    const afterSource =
      updatedRecord.files?.find((candidate) => candidate.id === fileId)
        ?.content ?? "";
    const persistedStyles = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const target = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="flow-target"]',
      );
      if (!target) throw new Error("saved target is missing");
      return {
        position: target.style.position,
        width: target.style.width,
        alignSelf: target.style.alignSelf,
        inset: target.style.inset,
        left: target.style.left,
        right: target.style.right,
        top: target.style.top,
        bottom: target.style.bottom,
      };
    }, afterSource);
    const after = await target.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const sibling = element.nextElementSibling;
      const siblingRectangle = sibling?.getBoundingClientRect();
      return {
        rect: {
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
        },
        siblingRect: siblingRectangle
          ? {
              x: siblingRectangle.x,
              y: siblingRectangle.y,
              width: siblingRectangle.width,
              height: siblingRectangle.height,
            }
          : null,
        position: style.position,
        inset: [style.top, style.right, style.bottom, style.left],
        styleAttribute: element.getAttribute("style"),
      };
    });
    console.log({ designId, fileId, before, after, afterSource });

    expect(after.position).toBe("relative");
    expect(after.inset).toEqual(["0px", "0px", "0px", "0px"]);
    expect(persistedStyles).toEqual(expectedStyles);
    expect(after.siblingRect).not.toBeNull();
    expect(after.rect.y + after.rect.height + 10).toBeCloseTo(
      after.siblingRect!.y,
      0,
    );
    await widthSizing.click();
    await page
      .getByRole("menuitem", { name: "Fill container", exact: true })
      .click();
    await expect
      .poll(() => readInsetTargetStyles(page, designId, fileId))
      .toMatchObject({
        position: "relative",
        width: "auto",
        alignSelf: "stretch",
      });
    completed = true;
  } finally {
    if (completed) {
      const response = await page.request.post(
        appPath("/_agent-native/actions/delete-design"),
        { data: { id: designId } },
      );
      if (!response.ok()) throw new Error(await response.text());
    } else {
      console.log({ preservedFailureDesignId: designId });
    }
  }
});

test("position toggle persists for a child of a Screen body", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    `Screen flow position ${Date.now()}`,
  );
  try {
    await gotoEditor(page, designId);
    const initial = await readDesign(page, designId);
    const beforeIds = new Set(initial.files?.map((file) => file.id));

    await pickFrameMode(page, "Screen");
    const point = await emptyBoardPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 190, point.y + 150, { steps: 12 });
    await page.mouse.up();

    let screenId = "";
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const screen = record.files?.find((file) => !beforeIds.has(file.id));
        if (!screen) return null;
        screenId = screen.id;
        return screen.id;
      })
      .not.toBeNull();

    const shell = page.locator(
      `[data-screen-shell][data-frame-id="${screenId}"]`,
    );
    await shell.locator("[data-frame-title]").click();
    await page.keyboard.press("Shift+a");
    await expect(page.locator('[data-flow-value="vertical"]')).toBeVisible();
    const body = designFrame(page, screenId).locator("body");
    const bodyBox = await body.boundingBox();
    const screenCard = shell.locator("[data-screen-card]");
    const cardBox = await screenCard.boundingBox();
    if (!bodyBox || !cardBox) throw new Error("screen bounds are missing");
    const bodyWidth = await body.evaluate(
      (element) => element.ownerDocument.documentElement.clientWidth,
    );
    const scale = cardBox.width / bodyWidth;

    await page.keyboard.press("r");
    await page.mouse.move(bodyBox.x + 28 * scale, bodyBox.y + 28 * scale);
    await page.mouse.down();
    await page.mouse.move(bodyBox.x + 92 * scale, bodyBox.y + 70 * scale, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const html = readDesign(page, designId).then(
          (record) =>
            record.files?.find((file) => file.id === screenId)?.content ?? "",
        );
        return (await html).includes(
          'data-agent-native-layer-name="Rectangle"',
        );
      })
      .toBe(true);

    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { name: /^Rectangle / })
      .getByRole("button", { name: "Rectangle", exact: true })
      .click();
    const positionToggle = page.getByRole("button", {
      name: "Absolute position",
      exact: true,
    });
    await expect(positionToggle).toHaveAttribute("aria-pressed", "false");
    const initialRectangle = designFrame(page, screenId).locator(
      '[data-agent-native-layer-name="Rectangle"]',
    );
    const initiallyRendered = await initialRectangle.evaluate((element) => ({
      position: getComputedStyle(element).position,
      parentDisplay: getComputedStyle(element.parentElement!).display,
      parentFlexDirection: getComputedStyle(element.parentElement!)
        .flexDirection,
    }));
    expect(initiallyRendered).toEqual({
      position: "relative",
      parentDisplay: "flex",
      parentFlexDirection: "column",
    });
    const initiallyPersisted = await readDesign(page, designId).then((record) =>
      page.evaluate(
        ({ files, screenId }) => {
          const html =
            files?.find((file: any) => file.id === screenId)?.content ?? "";
          const document = new DOMParser().parseFromString(html, "text/html");
          const rectangle = document.querySelector<HTMLElement>(
            '[data-agent-native-layer-name="Rectangle"]',
          );
          return rectangle?.style.position ?? null;
        },
        { files: record.files, screenId },
      ),
    );
    expect(initiallyPersisted).toBe("relative");

    await positionToggle.click();
    await expect(positionToggle).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const record = await readDesign(page, designId);
        const html =
          record.files?.find((file) => file.id === screenId)?.content ?? "";
        return page.evaluate((source) => {
          const document = new DOMParser().parseFromString(source, "text/html");
          return (
            document.querySelector<HTMLElement>(
              '[data-agent-native-layer-name="Rectangle"]',
            )?.style.position ?? null
          );
        }, html);
      })
      .toBe("absolute");
    await expect
      .poll(() =>
        initialRectangle.evaluate(
          (element) => getComputedStyle(element).position,
        ),
      )
      .toBe("absolute");

    const beforeRecord = await readDesign(page, designId);
    const beforeSource =
      beforeRecord.files?.find((file) => file.id === screenId)?.content ?? "";
    await page.evaluate(() => {
      (
        window as typeof window & {
          __designTrace?: { clear: () => void };
        }
      ).__designTrace?.clear();
    });
    await positionToggle.click();
    await expect(positionToggle).toHaveAttribute("aria-pressed", "false");
    const sourceChanged = await expect
      .poll(
        async () => {
          const after = await readDesign(page, designId);
          return (
            after.files?.find((file) => file.id === screenId)?.content ?? ""
          );
        },
        { timeout: 3_000 },
      )
      .not.toBe(beforeSource)
      .then(
        () => true,
        () => false,
      );

    const afterRecord = await readDesign(page, designId);
    const afterSource =
      afterRecord.files?.find((file) => file.id === screenId)?.content ?? "";
    const rectangle = designFrame(page, screenId).locator(
      '[data-agent-native-layer-name="Rectangle"]',
    );
    const rendered = await rectangle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        authoredStyle: element.getAttribute("style"),
        position: style.position,
        left: style.left,
        top: style.top,
      };
    });
    const trace = await page.evaluate(() => {
      const entries = (
        window as typeof window & {
          __designTrace?: { entries: () => unknown[] };
        }
      ).__designTrace?.entries();
      return entries ?? [];
    });
    console.log({
      designId,
      screenId,
      beforeSource,
      afterSource,
      rendered,
      trace,
    });
    expect(sourceChanged).toBe(true);
    expect(rendered.position).toBe("relative");
    const persistedPosition = await page.evaluate((html) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const rectangle = document.querySelector<HTMLElement>(
        '[data-agent-native-layer-name="Rectangle"]',
      );
      return rectangle
        ? {
            position: rectangle.style.position,
            inset: rectangle.style.inset,
            left: rectangle.style.left,
            right: rectangle.style.right,
            top: rectangle.style.top,
            bottom: rectangle.style.bottom,
          }
        : null;
    }, afterSource);
    expect(persistedPosition).toMatchObject({
      position: "relative",
      inset: "auto",
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    const reloadedRectangle = designFrame(page, screenId).locator(
      '[data-agent-native-layer-name="Rectangle"]',
    );
    await expect
      .poll(() =>
        reloadedRectangle.evaluate(
          (element) => getComputedStyle(element).position,
        ),
      )
      .toBe("relative");
    const reloadedRecord = await readDesign(page, designId);
    const reloadedSource =
      reloadedRecord.files?.find((candidate) => candidate.id === screenId)
        ?.content ?? "";
    expect(reloadedSource).toContain("position: relative");
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: designId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
});
