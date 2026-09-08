import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { designFrame, gotoEditor } from "./helpers";

/**
 * Absolutely-positioned rectangles placed well away from the frame origin, so
 * a wrapper that loses its own left/top shows up as a jump to 0,0 rather than
 * as a few pixels of drift.
 */
const CHORDS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
    <main data-agent-native-node-id="ch-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="ch-alpha" data-agent-native-layer-name="Alpha" style="position:absolute;left:240px;top:180px;width:180px;height:90px;background:#38bdf8;color:#082f49">Alpha</div>
      <div data-agent-native-node-id="ch-bravo" data-agent-native-layer-name="Bravo" style="position:absolute;left:240px;top:340px;width:180px;height:90px;background:#a78bfa;color:#1f1147">Bravo</div>
      <div data-agent-native-node-id="ch-charlie" data-agent-native-layer-name="Charlie" style="position:absolute;left:600px;top:180px;width:180px;height:90px;background:#fbbf24;color:#451a03">Charlie</div>
    </main>
  </body>
</html>`;

const TEXT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Text</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="tx-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="tx-label" data-agent-native-layer-name="Label" style="position:absolute;left:200px;top:200px;font-size:24px">klsajfk</div>
    </main>
  </body>
</html>`;

/** The replace target sits inside an offset frame, so its document-space
 *  coordinate (frame origin + own offset) differs from its authored left/top.
 *  A flat body-level fixture makes the two identical and hides the bug. */
const NESTED_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Nested</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff">
    <main data-agent-native-node-id="nz-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="nz-source" data-agent-native-layer-name="Source" style="position:absolute;left:40px;top:40px;width:80px;height:60px;background:#22c55e"></div>
      <div data-agent-native-node-id="nz-frame" data-agent-native-layer-name="Holder" style="position:absolute;left:320px;top:260px;width:400px;height:280px;background:#e2e8f0">
        <div data-agent-native-node-id="nz-target" data-agent-native-layer-name="Target" style="position:absolute;left:60px;top:50px;width:120px;height:90px;background:#f97316"></div>
      </div>
    </main>
  </body>
</html>`;

/** A text layer whose content is wrapped in an id-less inline span, inside a
 *  frame — the exact shape from the report's [dnd:shield:down] log, where the
 *  click hit `div[...] > span` while the frame was the selected layer. */
const INLINE_CHILD_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Inline Child</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="ic-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:600px">
      <div data-agent-native-node-id="ic-frame" data-agent-native-layer-name="Holder" style="position:absolute;left:120px;top:120px;width:500px;height:320px;background:#eef2f7">
        <div data-agent-native-node-id="ic-text" data-agent-native-layer-name="Caption" style="position:absolute;left:40px;top:60px;font-size:28px"><span style="text-decoration: underline">klsajfk</span></div>
      </div>
    </main>
  </body>
</html>`;

/** A real board file: absolute children of a transparent, position:relative
 *  body. The board surface renders its content offset by thousands of pixels
 *  inside an 8192 iframe, which is why a plain screen fixture cannot stand in
 *  for it. */
const BOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: transparent; }
  body { margin: 0; position: relative; overflow: visible; }
</style>
</head>
<body>
<div data-agent-native-node-id="bd-frame" data-agent-native-layer-name="Holder" data-an-primitive="frame" style="position:absolute;left:240px;top:200px;width:520px;height:340px;background:#eef2f7">
<div data-agent-native-node-id="bd-text" data-agent-native-layer-name="Caption" style="position:absolute;left:40px;top:60px;font-size:28px"><span style="text-decoration: underline">klsajfk</span></div>
</div>
</body>
</html>`;

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

function actionBaseUrl(baseURL: string | undefined): string {
  return (baseURL ?? process.env.E2E_BASE_URL ?? e2eBaseURL()).replace(
    /\/$/,
    "",
  );
}

async function postAction(
  request: APIRequestContext,
  baseURL: string | undefined,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await request.post(
    `${actionBaseUrl(baseURL)}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `action ${name} failed: ${res.status()} ${await res.text()}`,
    );
  }
  return res.json();
}

async function createChordsDesign(
  request: APIRequestContext,
  baseURL: string | undefined,
  title: string,
  content: string = CHORDS_HTML,
): Promise<string> {
  const created = await postAction(request, baseURL, "create-design", {
    title,
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!id) throw new Error("create-design did not return an id");
  await postAction(request, baseURL, "create-file", {
    designId: id,
    filename: "layout.html",
    fileType: "html",
    content,
  });
  return id;
}

function bodyOf(html: string): string {
  const start = html.indexOf("<body");
  return start < 0 ? html : html.slice(start, html.indexOf("</body>") + 7);
}

async function expectFileContent(
  request: APIRequestContext,
  baseURL: string | undefined,
  id: string,
  assertContent: (html: string) => void,
) {
  await expect
    .poll(
      async () => {
        const params = new URLSearchParams({ id });
        const res = await request.get(
          `${actionBaseUrl(baseURL)}/_agent-native/actions/get-design?${params}`,
          { headers: { "Content-Type": "application/json" } },
        );
        if (!res.ok()) return `get-design ${res.status()}`;
        const payload = await res.json();
        const design = [
          payload,
          payload?.result,
          payload?.design,
          payload?.data,
        ].find((candidate) => Array.isArray(candidate?.files));
        const file = design?.files?.find(
          (candidate: { filename?: string }) =>
            candidate.filename === "layout.html",
        );
        if (typeof file?.content !== "string") {
          return "layout.html has no content";
        }
        try {
          assertContent(file.content);
          return "ok";
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return `${reason}\n--- layout.html ---\n${bodyOf(file.content)}`;
        }
      },
      { timeout: 20_000 },
    )
    .toBe("ok");
}

function layerTree(page: Page) {
  return page.getByRole("tree", { name: "Layers" });
}

async function selectLayerRow(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(name);
  const button = layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
  await expect(button).toBeVisible();
  await button.click({ force: true });
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

async function pressEditorKey(page: Page, key: string): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
  await page.keyboard.press(key);
}

function openTagContaining(html: string, needle: string): string | undefined {
  const tags = html.match(/<div [^>]*>/g) ?? [];
  return tags.find((tag) => tag.includes(needle));
}

function inlineOffset(html: string, nodeId: string) {
  const open = new RegExp(
    `<[a-z]+[^>]*data-agent-native-node-id="${nodeId}"[^>]*>`,
    "i",
  ).exec(html)?.[0];
  const style = open ? (/style="([^"]*)"/.exec(open)?.[1] ?? "") : "";
  const px = (prop: string) =>
    Number(
      new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`).exec(style)?.[1],
    );
  return { left: px("left"), top: px("top"), style };
}

test.describe("canvas chords", () => {
  let designId = "";

  test.afterEach(async ({ request, baseURL }) => {
    if (!designId) return;
    await postAction(request, baseURL, "delete-design", { id: designId }).catch(
      () => {},
    );
    designId = "";
  });

  test("Shift+A wraps one rectangle where it stands, not at the frame origin", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords AutoLayout",
    );
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Alpha");
    await pressEditorKey(page, "Shift+A");

    await expectFileContent(request, baseURL, designId, (html) => {
      const wrapper = openTagContaining(html, "display: flex");
      expect(wrapper, "no auto-layout wrapper was created").toBeTruthy();
      expect(wrapper).toContain("position: absolute");
      expect(wrapper).toContain("left: 240px");
      expect(wrapper).toContain("top: 180px");
    });
  });

  test("Cmd+G groups one rectangle at its own bounds", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(request, baseURL, "E2E Chords Group");
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Bravo");
    await pressEditorKey(page, `${PRIMARY}+G`);

    await expectFileContent(request, baseURL, designId, (html) => {
      const wrapper = openTagContaining(html, 'layer-name="Group');
      expect(wrapper, "no group wrapper was created").toBeTruthy();
      expect(wrapper).toContain("left: 240px");
      expect(wrapper).toContain("top: 340px");
      expect(wrapper).toContain("width: 180px");
      expect(wrapper).toContain("height: 90px");
      const child = inlineOffset(html, "ch-bravo");
      expect(child.left).toBe(0);
      expect(child.top).toBe(0);
    });
  });

  test("Alt+A aligns the selection from the canvas", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(request, baseURL, "E2E Chords Align");
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Charlie");
    await pressEditorKey(page, "Alt+A");

    await expectFileContent(request, baseURL, designId, (html) => {
      expect(inlineOffset(html, "ch-charlie").left).toBeLessThan(600);
    });
  });
  test("Alt+A still aligns when focus sits inside the preview iframe", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords Align Iframe",
    );
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Charlie");
    // Clicking a layer leaves focus on the panel; the reported failure is the
    // one where focus is in the canvas iframe, which is where it lands the
    // moment you click a frame.
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .evaluate((el) => (el as HTMLIFrameElement).contentWindow?.focus());
    await page.keyboard.press("Alt+A");

    await expectFileContent(request, baseURL, designId, (html) => {
      expect(inlineOffset(html, "ch-charlie").left).toBeLessThan(600);
    });
  });
  test("Cmd+U underlines the text without duplicating it or adding a <u> layer", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords Underline",
      TEXT_HTML,
    );
    await gotoEditor(page, designId);

    const label = designFrame(page)
      .locator('[data-agent-native-node-id="tx-label"]')
      .first();
    await label.waitFor({ state: "visible", timeout: 10_000 });
    const box = await label.boundingBox();
    if (!box) throw new Error("no bounding box for the text layer");

    // Double-click is the gesture that opens a real contenteditable session —
    // the state the reported bug needs, and the one Enter-to-drill-in misses.
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(1, { timeout: 10_000 });

    await page.keyboard.press(`${PRIMARY}+A`);
    await page.keyboard.press(`${PRIMARY}+U`);
    await page.keyboard.press("Escape");

    // Nudging afterwards is what surfaced the duplication in the report: the
    // layer now has a child, and the next commit round-trips through it.
    await selectLayerRow(page, "Label");
    await pressEditorKey(page, "ArrowRight");
    await page.waitForTimeout(600);

    await expectFileContent(request, baseURL, designId, (html) => {
      const tag =
        /<div[^>]*data-agent-native-node-id="tx-label"[\s\S]*?<\/div>/.exec(
          html,
        )?.[0];
      expect(tag, "tx-label not found").toBeDefined();
      // The visible text must survive exactly once.
      expect((tag!.match(/klsajfk/g) ?? []).length).toBe(1);
      // Underline must be a style, not a stray <u> element that shows up as
      // its own layer in the tree.
      expect(tag).not.toMatch(/<u[\s>]/i);
      expect(tag).toMatch(/underline/i);
    });
  });

  test("Cmd+Shift+R drops the replacement where the old layer stood", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords PasteReplace",
      NESTED_HTML,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(actionBaseUrl(baseURL)).origin,
    });
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Source");
    await pressEditorKey(page, `${PRIMARY}+C`);
    await selectLayerRow(page, "Target");
    await pressEditorKey(page, `${PRIMARY}+Shift+R`);

    await expectFileContent(request, baseURL, designId, (html) => {
      // The target is gone and exactly one copy replaced it.
      expect(html).not.toContain('data-agent-native-node-id="nz-target"');
      const copyTag =
        /<div[^>]*data-agent-native-node-id="copy-[^"]*"[^>]*>/.exec(html)?.[0];
      expect(copyTag, `no copy node in:\n${html}`).toBeDefined();
      // Authored, parent-relative offsets — not the 320+60 / 260+50 document
      // coordinate, and certainly not a board-space ~4000.
      expect(copyTag).toMatch(/left:\s*60px/);
      expect(copyTag).toMatch(/top:\s*50px/);
    });
  });
  test("clicking an inline child inside a text layer does not duplicate its text", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords Inline Child",
      INLINE_CHILD_HTML,
    );
    await gotoEditor(page, designId);

    // Select the enclosing frame first: selected-layer drag priority is what
    // retargets the pointerdown, and it is present in the reported log.
    await selectLayerRow(page, "Holder");

    const span = designFrame(page)
      .locator('[data-agent-native-node-id="ic-text"] span')
      .first();
    await span.waitFor({ state: "visible", timeout: 10_000 });
    const box = await span.boundingBox();
    if (!box) throw new Error("no bounding box for the inline span");

    for (let i = 0; i < 3; i += 1) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
    }

    await expectFileContent(request, baseURL, designId, (html) => {
      const tag =
        /<div[^>]*data-agent-native-node-id="ic-text"[\s\S]*?<\/div>/.exec(
          html,
        )?.[0];
      expect(tag, "ic-text not found").toBeDefined();
      expect((tag!.match(/klsajfk/g) ?? []).length).toBe(1);
      expect((tag!.match(/<span/g) ?? []).length).toBe(1);
    });
  });
  test("clicking an inline child on the board surface leaves its text alone", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords Board Click",
      CHORDS_HTML,
    );
    const board = await postAction(request, baseURL, "create-file", {
      designId,
      filename: "__board__.html",
      fileType: "html",
      content: BOARD_HTML,
    });
    const boardFileId = board?.id ?? board?.data?.id ?? board?.file?.id;
    expect(boardFileId, "board file id").toBeTruthy();
    await postAction(request, baseURL, "update-design", {
      id: designId,
      dataOperations: [
        { op: "set", path: ["boardFileId"], value: boardFileId },
      ],
    });

    await gotoEditor(page, designId);

    await selectLayerRow(page, "Holder");

    // The board surface is the preview iframe that deliberately carries no
    // data-screen-iframe-id (see DesignCanvas boardSurface).
    const span = page
      .locator(
        "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
      )
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="bd-text"] span')
      .first();
    await span.waitFor({ state: "visible", timeout: 10_000 });
    const box = await span.boundingBox();
    if (!box) throw new Error("no bounding box for the board inline span");

    for (let i = 0; i < 3; i += 1) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(600);
    }

    await expect
      .poll(
        async () => {
          const params = new URLSearchParams({ id: designId });
          const res = await request.get(
            `${actionBaseUrl(baseURL)}/_agent-native/actions/get-design?${params}`,
          );
          const payload = await res.json();
          const design = [
            payload,
            payload?.result,
            payload?.design,
            payload?.data,
          ].find((candidate) => Array.isArray(candidate?.files));
          const file = design?.files?.find(
            (candidate: { filename?: string }) =>
              candidate.filename === "__board__.html",
          );
          const html = String(file?.content ?? "");
          const tag =
            /<div[^>]*data-agent-native-node-id="bd-text"[\s\S]*?<\/div>/.exec(
              html,
            )?.[0] ?? "";
          return `${(tag.match(/klsajfk/g) ?? []).length}|${(tag.match(/<span/g) ?? []).length}`;
        },
        { timeout: 15_000 },
      )
      .toBe("1|1");
  });
  test("Cmd+Shift+R on an underlined text layer does not nest a copy inside it", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords Replace Inline",
      INLINE_CHILD_HTML,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(actionBaseUrl(baseURL)).origin,
    });
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Holder");
    await pressEditorKey(page, `${PRIMARY}+C`);

    // Clicking underlined text selects the inline span, not the text layer —
    // that is the selection paste-to-replace then acts on.
    const span = designFrame(page)
      .locator('[data-agent-native-node-id="ic-text"] span')
      .first();
    await span.waitFor({ state: "visible", timeout: 10_000 });
    const box = (await span.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    await pressEditorKey(page, `${PRIMARY}+Shift+R`);

    await expectFileContent(request, baseURL, designId, (html) => {
      const tag =
        /<div[^>]*data-agent-native-node-id="ic-text"[\s\S]*?<\/div>/.exec(
          html,
        )?.[0];
      expect(tag, "ic-text not found").toBeDefined();
      // A layer clone must never end up nested inside a text layer.
      expect(tag).not.toContain("data-agent-native-preserve-styles");
      expect((tag!.match(/klsajfk/g) ?? []).length).toBe(1);
    });
  });
  test("Cmd+U twice in one session leaves the text un-underlined", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createChordsDesign(
      request,
      baseURL,
      "E2E Chords Underline Toggle",
      TEXT_HTML,
    );
    await gotoEditor(page, designId);

    const label = designFrame(page)
      .locator('[data-agent-native-node-id="tx-label"]')
      .first();
    await label.waitFor({ state: "visible", timeout: 10_000 });
    const box = (await label.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(1, { timeout: 10_000 });

    await page.keyboard.press(`${PRIMARY}+A`);
    await page.keyboard.press(`${PRIMARY}+U`);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${PRIMARY}+A`);
    await page.keyboard.press(`${PRIMARY}+U`);
    await page.keyboard.press("Escape");

    await expectFileContent(request, baseURL, designId, (html) => {
      const tag =
        /<div[^>]*data-agent-native-node-id="tx-label"[\s\S]*?<\/div>/.exec(
          html,
        )?.[0];
      expect(tag, "tx-label not found").toBeDefined();
      expect((tag!.match(/klsajfk/g) ?? []).length).toBe(1);
      expect(tag).not.toMatch(/text-decoration:\s*underline/i);
    });
  });
});
