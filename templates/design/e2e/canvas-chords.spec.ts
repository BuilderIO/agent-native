import { type BrowserContext, type Locator, type Page } from "@playwright/test";

import { appPath, designFrame, panTargetIntoUnobscuredCanvas } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

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

const FLOW_INLINE_TEXT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Flow Text</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="flow-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:640px">
      <div data-agent-native-node-id="flow-before" data-agent-native-layer-name="Before" style="height:86px">Before content</div>
      <div data-agent-native-node-id="flow-caption" data-agent-native-layer-name="Caption" style="position:static;left:91px;top:73px;margin:23px 0 0 34px;padding:7px 11px;font-size:28px;line-height:36px">Prefix text <span data-agent-native-node-id="flow-underline" data-agent-native-layer-name="Underlined phrase" style="text-decoration:underline">klsajfk</span> suffix text</div>
      <div data-agent-native-node-id="flow-after" data-agent-native-layer-name="After" style="margin-top:19px">After content</div>
      <div data-agent-native-node-id="flow-source" data-agent-native-layer-name="Replacement source" style="position:absolute;left:520px;top:260px;width:92px;height:54px;background:#22c55e"></div>
    </main>
  </body>
</html>`;

const RELATIVE_FLOW_INLINE_TEXT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Relative Flow Text</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="flow-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:640px">
      <div data-agent-native-node-id="flow-before" data-agent-native-layer-name="Before" style="height:86px">Before content</div>
      <div data-agent-native-node-id="flow-caption" data-agent-native-layer-name="Caption" style="position:relative;left:41px;top:29px;margin:23px 0 0 34px;padding:7px 11px;font-size:28px;line-height:36px">Prefix text <span data-agent-native-node-id="flow-underline" data-agent-native-layer-name="Underlined phrase" style="text-decoration:underline">klsajfk</span> suffix text</div>
      <div data-agent-native-node-id="flow-after" data-agent-native-layer-name="After" style="margin-top:19px">After content</div>
      <div data-agent-native-node-id="flow-source" data-agent-native-layer-name="Replacement source" style="position:absolute;left:520px;top:260px;width:92px;height:54px;background:#22c55e"></div>
    </main>
  </body>
</html>`;

const TRANSFORMED_FLOW_INLINE_TEXT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Transformed Flow Text</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="flow-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:640px;transform:rotate(12deg) skewX(8deg);transform-origin:0 0">
      <div data-agent-native-node-id="flow-before" data-agent-native-layer-name="Before" style="height:86px">Before content</div>
      <div data-agent-native-node-id="flow-caption" data-agent-native-layer-name="Caption" style="margin:23px 0 0 34px;padding:7px 11px;font-size:28px;line-height:36px">Prefix text <span data-agent-native-node-id="flow-underline" data-agent-native-layer-name="Underlined phrase" style="text-decoration:underline">klsajfk</span> suffix text</div>
      <div data-agent-native-node-id="flow-after" data-agent-native-layer-name="After" style="margin-top:19px">After content</div>
      <div data-agent-native-node-id="flow-source" data-agent-native-layer-name="Replacement source" style="position:absolute;left:520px;top:260px;width:92px;height:54px;background:#22c55e"></div>
    </main>
  </body>
</html>`;

const ZERO_SIZE_FLOW_INLINE_TEXT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Zero Size Flow Text</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="flow-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:640px">
      <div data-agent-native-node-id="flow-before" data-agent-native-layer-name="Before" style="height:86px">Before content</div>
      <div data-agent-native-node-id="flow-caption" data-agent-native-layer-name="Caption" style="width:0;height:0;overflow:visible;white-space:nowrap;margin:23px 0 0 34px;font-size:28px;line-height:36px">Prefix text <span data-agent-native-node-id="flow-underline" data-agent-native-layer-name="Underlined phrase" style="text-decoration:underline">klsajfk</span> suffix text</div>
      <div data-agent-native-node-id="flow-after" data-agent-native-layer-name="After" style="margin-top:19px">After content</div>
      <div data-agent-native-node-id="flow-source" data-agent-native-layer-name="Replacement source" style="position:absolute;left:520px;top:260px;width:92px;height:54px;background:#22c55e"></div>
    </main>
  </body>
</html>`;

const REPLACEMENT_GEOMETRY_STYLES = `
  .copy-auto-transform {
    position: absolute;
    left: 520px;
    top: 260px;
    width: auto;
    height: auto;
    padding: 11px 14px;
    border: 2px solid #14532d;
    background: #22c55e;
    font: 20px/1.3 system-ui, sans-serif;
    transform: matrix(0, 1, -1, 0, 0.25, 0.25);
    transform-origin: 0 0;
  }
  .copy-plain {
    position: absolute;
    left: 520px;
    top: 260px;
    width: 92px;
    height: 54px;
    background: #22c55e;
  }
  .copy-top-origin {
    position: absolute;
    left: 520px;
    top: 260px;
    width: 132px;
    height: 72px;
    padding: 8px 12px;
    background: #22c55e;
    transform: matrix(0, 1, -1, 0, 0.25, 0.25);
    transform-origin: top;
  }
  .copy-margin-offset {
    position: absolute;
    left: 520px;
    top: 260px;
    width: 92px;
    height: 54px;
    margin: 13px 0 0 17px;
    background: #22c55e;
  }
`;

function flowReplacementGeometryHtml(copyClass: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Replacement Geometry</title>
    <style>${REPLACEMENT_GEOMETRY_STYLES}</style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="geo-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:640px">
      <div data-agent-native-node-id="geo-before" data-agent-native-layer-name="Before" style="height:86px">Before content</div>
      <div data-agent-native-node-id="geo-caption" data-agent-native-layer-name="Caption" style="position:static;margin:23px 0 0 34px;padding:7px 11px;font-size:28px;line-height:36px">Prefix text <span data-agent-native-node-id="geo-underline" data-agent-native-layer-name="Underlined phrase" style="text-decoration:underline">klsajfk</span> suffix text</div>
      <div data-agent-native-node-id="geo-after" data-agent-native-layer-name="After" style="margin-top:19px">After content</div>
      <div data-agent-native-node-id="geo-source" data-agent-native-layer-name="Replacement source" class="${copyClass}">Replacement source</div>
    </main>
  </body>
</html>`;
}

const WRAPPED_INLINE_REPLACEMENT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Canvas Chords Wrapped Inline Replacement</title>
    <style>${REPLACEMENT_GEOMETRY_STYLES}</style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <main data-agent-native-node-id="wrap-root" data-agent-native-layer-name="Root" style="position:relative;width:900px;height:640px">
      <div data-agent-native-node-id="wrap-parent" data-agent-native-layer-name="Copy Target" style="position:relative;width:302px;padding:10px 12px;font-size:20px;line-height:32px">
        <div data-agent-native-node-id="wrap-before" data-agent-native-layer-name="Before" style="height:24px">Before content</div>
        <span data-agent-native-node-id="wrap-caption" data-agent-native-layer-name="Caption">Several words wrap onto another line before <span data-agent-native-node-id="wrap-underline" data-agent-native-layer-name="Underlined phrase" style="text-decoration:underline">the selected phrase</span> and continue across the narrow text box.</span>
        <div data-agent-native-node-id="wrap-after" data-agent-native-layer-name="After" style="margin-top:12px">After content</div>
        <div data-agent-native-node-id="wrap-source" data-agent-native-layer-name="Replacement source" class="copy-plain">Replacement source</div>
      </div>
    </main>
  </body>
</html>`;

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

async function openChords(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.settled();
  return { id, before: await app.savedNodes(id) };
}

function newNodes(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
) {
  return [...after.values()].filter((node) => !before.has(node.id));
}

function expectFlowReplacement(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
  expectedPosition: { x: number; y: number },
) {
  const copies = newNodes(before, after);
  expect(copies, "one replacement sibling").toHaveLength(1);
  expect(after.has("flow-caption")).toBe(false);
  expect(after.has("flow-underline")).toBe(false);
  expect(copies[0]!.parent).toBe("flow-root");
  expect(childrenOf(after, "flow-root")).toEqual([
    "flow-before",
    copies[0]!.id,
    "flow-after",
    "flow-source",
  ]);
  const copy = styleOf(copies[0]!);
  expect([copy.left, copy.top, copy.width, copy.height]).toEqual([
    `${expectedPosition.x}px`,
    `${expectedPosition.y}px`,
    "92px",
    "54px",
  ]);
  expectOnlyChanged(before, after, [
    "flow-caption",
    "flow-underline",
    copies[0]!.id,
  ]);
  expect(after.get("flow-source")).toMatchObject({
    parent: before.get("flow-source")!.parent,
    attrs: before.get("flow-source")!.attrs,
    text: before.get("flow-source")!.text,
  });
  expect(after.get("flow-before")?.text).toBe("Before content");
  expect(after.get("flow-after")?.text).toBe("After content");
}

async function clickFirstVisibleTextFragment(
  app: App,
  target: Locator,
): Promise<void> {
  const position = await target.evaluate((element) => {
    const fragment = Array.from(element.getClientRects()).find(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (!fragment) throw new Error("Underlined phrase has no visible fragment");
    return {
      x: fragment.left + fragment.width / 2,
      y: fragment.top + fragment.height / 2,
    };
  });
  const point = await app.pagePoint(position.x, position.y);
  await app.page.mouse.click(point.x, point.y);
}

async function replaceFlowTextTarget(
  app: App,
  context: BrowserContext,
  designId: string,
) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(appPath("/")).origin,
  });
  await selectLayerRow(app.page, "Replacement source");
  await pressEditorKey(app.page, `ControlOrMeta+C`);
  const underline = app.node("flow-underline");
  await clickFirstVisibleTextFragment(app, underline);
  await expect.poll(() => app.selectedLayers()).toEqual(["Underlined phrase"]);
  await pressEditorKey(app.page, `ControlOrMeta+Shift+R`);
  await expect
    .poll(async () => (await app.savedNodes(designId)).has("flow-caption"))
    .toBe(false);
  await app.settled();
  return app.savedNodes(designId);
}

async function replacementCssSnapshot(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((element) => {
    const computed = getComputedStyle(element);
    const authored = (element as HTMLElement).style;
    return {
      className: element.getAttribute("class"),
      display: computed.display,
      position: computed.position,
      boxSizing: computed.boxSizing,
      width: computed.width,
      height: computed.height,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      paddingTop: computed.paddingTop,
      paddingRight: computed.paddingRight,
      paddingBottom: computed.paddingBottom,
      paddingLeft: computed.paddingLeft,
      borderTopWidth: computed.borderTopWidth,
      borderRightWidth: computed.borderRightWidth,
      borderBottomWidth: computed.borderBottomWidth,
      borderLeftWidth: computed.borderLeftWidth,
      borderTopColor: computed.borderTopColor,
      borderRadius: computed.borderRadius,
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      transform: computed.transform,
      transformOrigin: computed.transformOrigin,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      authoredWidth: authored.width,
      authoredHeight: authored.height,
      authoredTransform: authored.transform,
      authoredTransformOrigin: authored.transformOrigin,
    };
  });
}

async function renderedBounds(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function replaceGeometryTextTarget(
  app: App,
  context: BrowserContext,
  designId: string,
  targetId: string,
  underlineId: string,
) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(appPath("/")).origin,
  });
  await selectLayerRow(app.page, "Replacement source");
  await pressEditorKey(app.page, "ControlOrMeta+C");
  const underline = app.node(underlineId);
  await clickFirstVisibleTextFragment(app, underline);
  await expect.poll(() => app.selectedLayers()).toEqual(["Underlined phrase"]);
  await pressEditorKey(app.page, "ControlOrMeta+Shift+R");
  await expect
    .poll(async () => (await app.savedNodes(designId)).has(targetId))
    .toBe(false);
  await app.settled();
  return app.savedNodes(designId);
}

async function expectGeometryReplacement(
  app: App,
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
  targetId: string,
  underlineId: string,
  sourceId: string,
  targetBounds: { x: number; y: number },
  sourceCss: Awaited<ReturnType<typeof replacementCssSnapshot>>,
) {
  expect(targetBounds.x).toBeGreaterThan(0);
  expect(targetBounds.y).toBeGreaterThan(0);
  const copies = newNodes(before, after);
  expect(copies, "one replacement sibling").toHaveLength(1);
  const copy = copies[0]!;
  const target = before.get(targetId)!;
  expect(after.has(targetId)).toBe(false);
  expect(after.has(underlineId)).toBe(false);
  expect(copy.parent).toBe(target.parent);
  const originalChildren = childrenOf(before, target.parent!);
  expect(childrenOf(after, target.parent!)).toEqual(
    originalChildren.map((id) => (id === targetId ? copy.id : id)),
  );
  expect(copy.attrs.class).toBe(before.get(sourceId)?.attrs.class);
  expectOnlyChanged(before, after, [targetId, underlineId, copy.id]);
  expect(after.get(sourceId)).toMatchObject({
    parent: before.get(sourceId)?.parent,
    attrs: before.get(sourceId)?.attrs,
    text: before.get(sourceId)?.text,
  });
  await expect(app.node(copy.id)).toBeVisible();
  const copyBounds = await renderedBounds(app, copy.id);
  expect({ x: copyBounds.x, y: copyBounds.y }).toEqual({
    x: targetBounds.x,
    y: targetBounds.y,
  });
  expect(await replacementCssSnapshot(app, copy.id)).toEqual(sourceCss);
}

/** The node's own markup, parsed: its direct text and element children. */
/** Whether the text layer or anything inside it renders an underline. */
async function rendersUnderline(app: App, nodeId: string) {
  return app
    .node(nodeId)
    .evaluate((element) =>
      [element, ...element.querySelectorAll("*")].some((node) =>
        getComputedStyle(node).textDecorationLine.includes("underline"),
      ),
    );
}

async function savedMarkup(app: App, designId: string, nodeId: string) {
  return app.page.evaluate(
    ({ html, id }) => {
      const element = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector<HTMLElement>(`[data-agent-native-node-id="${id}"]`);
      if (!element) return null;
      return {
        innerHTML: element.innerHTML,
        text: element.textContent,
        decoration: element.style.textDecoration,
      };
    },
    { html: await app.savedHtml(designId), id: nodeId },
  );
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
  await input.fill("");
}

async function pressEditorKey(page: Page, key: string): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
  await page.keyboard.press(key);
}

async function writeLegacyMarginClipboard(
  app: App,
  context: BrowserContext,
  fileId: string,
  margins: string[],
): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(appPath("/")).origin,
  });
  await app.page.evaluate(
    async ({ fileId, margins }) => {
      const clipboardPath = "/app/lib/design-clipboard.ts";
      const importPath = "/app/lib/design-import.ts";
      const { getDesignClipboardTrustToken } = await import(clipboardPath);
      const { serializeDesignClipboardPayload } = await import(importPath);
      const entries = margins.map((margin, index) => ({
        html: `<div data-agent-native-node-id="legacy-margin-${index}" data-agent-native-layer-name="Legacy margin ${index}" style="width:60px;height:30px;font-size:20px;margin:${margin};background:rgb(10, 20, 30)">Margin ${index}</div>`,
        rootNodeId: `legacy-margin-${index}`,
        sourceFileId: fileId,
      }));
      const marker = serializeDesignClipboardPayload(
        entries.map((entry) => entry.html).join("\n"),
        { version: 1, entries },
        getDesignClipboardTrustToken() ?? undefined,
      );
      await navigator.clipboard.writeText(marker);
    },
    { fileId, margins },
  );
}

test.describe("canvas chords", () => {
  test("Shift+A wraps one rectangle where it stands, not at the frame origin", async ({
    app,
  }) => {
    const { id, before } = await openChords(
      app,
      CHORDS_HTML.replace(">Alpha</div>", "></div>"),
    );
    await selectLayerRow(app.page, "Alpha");
    await pressEditorKey(app.page, "Shift+A");

    await expect
      .poll(async () => (await app.savedNodes(id)).get("ch-alpha")?.parent)
      .not.toBe("ch-root");
    await app.settled();
    const after = await app.savedNodes(id);
    const wrapperId = after.get("ch-alpha")!.parent!;
    expect(newNodes(before, after).map((node) => node.id)).toEqual([wrapperId]);
    expect(after.get(wrapperId)?.parent).toBe("ch-root");
    const wrapper = styleOf(after.get(wrapperId));
    expect({
      position: wrapper.position,
      left: wrapper.left,
      top: wrapper.top,
      display: wrapper.display,
    }).toEqual({
      position: "absolute",
      left: "240px",
      top: "180px",
      display: "flex",
    });
    expect(
      await app.designRect("ch-alpha"),
      "Alpha renders exactly where it stood",
    ).toEqual({ x: 240, y: 180, width: 180, height: 90 });
    expectOnlyChanged(before, after, [wrapperId, "ch-alpha"]);
  });

  test("Cmd+G groups one rectangle at its own bounds", async ({ app }) => {
    const { id, before } = await openChords(app, CHORDS_HTML);
    await selectLayerRow(app.page, "Bravo");
    await pressEditorKey(app.page, `ControlOrMeta+G`);

    await expect
      .poll(async () => (await app.savedNodes(id)).get("ch-bravo")?.parent)
      .not.toBe("ch-root");
    await app.settled();
    const after = await app.savedNodes(id);
    const groupId = after.get("ch-bravo")!.parent!;
    expect(newNodes(before, after).map((node) => node.id)).toEqual([groupId]);
    expect(after.get(groupId)?.parent).toBe("ch-root");
    const group = styleOf(after.get(groupId));
    expect([group.left, group.top, group.width, group.height]).toEqual([
      "240px",
      "340px",
      "180px",
      "90px",
    ]);
    const bravo = styleOf(after.get("ch-bravo"));
    expect([bravo.left, bravo.top]).toEqual(["0px", "0px"]);
    expect(await app.designRect("ch-bravo")).toEqual({
      x: 240,
      y: 340,
      width: 180,
      height: 90,
    });
    expectOnlyChanged(before, after, [groupId, "ch-bravo"]);
  });

  for (const focus of ["canvas", "preview iframe"] as const) {
    test(`Alt+A left-aligns the selection to its frame with focus in the ${focus}`, async ({
      app,
    }) => {
      const { id, before } = await openChords(app, CHORDS_HTML);
      await selectLayerRow(app.page, "Charlie");
      if (focus === "canvas") {
        await pressEditorKey(app.page, "Alt+A");
      } else {
        await app.page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .evaluate((el) => (el as HTMLIFrameElement).contentWindow?.focus());
        await app.page.keyboard.press("Alt+A");
      }

      await expect
        .poll(
          async () =>
            styleOf((await app.savedNodes(id)).get("ch-charlie")).left,
        )
        .toBe("0px");
      await app.settled();
      const after = await app.savedNodes(id);
      expect(styleOf(after.get("ch-charlie"))).toEqual({
        ...styleOf(before.get("ch-charlie")),
        left: "0px",
      });
      expectOnlyChanged(before, after, ["ch-charlie"]);
    });
  }

  test("Cmd+U underlines the text without duplicating it or adding a <u> layer", async ({
    app,
  }) => {
    const { id, before } = await openChords(app, TEXT_HTML);
    const page = app.page;
    const box = (await app.node("tx-label").boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(1);
    await page.keyboard.press(`ControlOrMeta+A`);
    await page.keyboard.press(`ControlOrMeta+U`);
    await page.keyboard.press("Escape");

    await expect
      .poll(async () => (await savedMarkup(app, id, "tx-label"))?.text)
      .toBe("klsajfk");
    await expect.poll(async () => app.savedHtml(id)).toMatch(/underline/);
    await app.settled();
    const markup = await savedMarkup(app, id, "tx-label");
    expect(markup?.innerHTML, "no <u> element").not.toMatch(/<u[\s>]/i);
    expect(markup?.text, "the text once").toBe("klsajfk");
    expect(await rendersUnderline(app, "tx-label")).toBe(true);
    const after = await app.savedNodes(id);
    const added = newNodes(before, after);
    expect(
      added.filter((node) => node.parent !== "tx-label"),
      "anything new lives inside the text layer",
    ).toEqual([]);
    expectOnlyChanged(before, after, [
      "tx-label",
      ...added.map((node) => node.id),
    ]);
  });

  test("Cmd+Shift+R drops the replacement where the old layer stood", async ({
    app,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(appPath("/")).origin,
    });
    const { id, before } = await openChords(app, NESTED_HTML);
    await selectLayerRow(app.page, "Source");
    await pressEditorKey(app.page, `ControlOrMeta+C`);
    await selectLayerRow(app.page, "Target");
    await pressEditorKey(app.page, `ControlOrMeta+Shift+R`);

    await expect
      .poll(async () => (await app.savedNodes(id)).has("nz-target"))
      .toBe(false);
    await app.settled();
    const after = await app.savedNodes(id);
    const copies = newNodes(before, after);
    expect(copies, "one replacement").toHaveLength(1);
    expect(copies[0]!.parent, "in the replaced layer's frame").toBe("nz-frame");
    const copy = styleOf(copies[0]);
    expect([copy.left, copy.top, copy.width, copy.height]).toEqual([
      "60px",
      "50px",
      "80px",
      "60px",
    ]);
    expectOnlyChanged(before, after, ["nz-target", copies[0]!.id]);
  });

  test("Cmd+Shift+R replaces a flow text root at its measured origin", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(app, FLOW_INLINE_TEXT_HTML);
    const expectedPosition = await app
      .node("flow-caption")
      .evaluate((caption) => {
        const captionElement = caption as HTMLElement;
        const containingBlock = captionElement.offsetParent;
        if (!containingBlock)
          throw new Error("Caption has no position reference");
        const captionRect = captionElement.getBoundingClientRect();
        const underline = caption.querySelector(
          "[data-agent-native-node-id='flow-underline']",
        );
        if (!underline) throw new Error("Caption has no inline underline");
        const underlineRect = underline.getBoundingClientRect();
        const rootRect = containingBlock.getBoundingClientRect();
        return {
          containingBlockId: containingBlock.getAttribute(
            "data-agent-native-node-id",
          ),
          captionPosition: getComputedStyle(captionElement).position,
          authoredLeft: captionElement.style.left,
          authoredTop: captionElement.style.top,
          underlineOffsetX: underlineRect.x - captionRect.x,
          x: Math.round(
            captionRect.x -
              rootRect.x -
              containingBlock.clientLeft +
              containingBlock.scrollLeft,
          ),
          y: Math.round(
            captionRect.y -
              rootRect.y -
              containingBlock.clientTop +
              containingBlock.scrollTop,
          ),
        };
      });
    expect(expectedPosition.containingBlockId).toBe("flow-root");
    expect(expectedPosition.captionPosition).toBe("static");
    expect(expectedPosition.authoredLeft).toBe("91px");
    expect(expectedPosition.authoredTop).toBe("73px");
    expect(
      expectedPosition.underlineOffsetX,
      "the inline selection starts inside Caption, not at its origin",
    ).toBeGreaterThan(0);
    expect(
      expectedPosition.x,
      "Caption is offset from the reference origin",
    ).toBeGreaterThan(0);
    expect(
      expectedPosition.y,
      "Caption is below the first flow sibling",
    ).toBeGreaterThan(0);

    const after = await replaceFlowTextTarget(app, context, id);
    expectFlowReplacement(before, after, expectedPosition);
  });

  test("Cmd+Shift+R uses rendered flow offsets for relative text", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      RELATIVE_FLOW_INLINE_TEXT_HTML,
    );
    const expectedPosition = await app
      .node("flow-caption")
      .evaluate((caption) => {
        const captionElement = caption as HTMLElement;
        const containingBlock = captionElement.offsetParent;
        if (!containingBlock)
          throw new Error("Caption has no position reference");
        const captionRect = captionElement.getBoundingClientRect();
        const rootRect = containingBlock.getBoundingClientRect();
        return {
          containingBlockId: containingBlock.getAttribute(
            "data-agent-native-node-id",
          ),
          captionPosition: getComputedStyle(captionElement).position,
          authoredLeft: captionElement.style.left,
          authoredTop: captionElement.style.top,
          x: Math.round(
            captionRect.x -
              rootRect.x -
              containingBlock.clientLeft +
              containingBlock.scrollLeft,
          ),
          y: Math.round(
            captionRect.y -
              rootRect.y -
              containingBlock.clientTop +
              containingBlock.scrollTop,
          ),
        };
      });
    expect(expectedPosition.containingBlockId).toBe("flow-root");
    expect(expectedPosition.captionPosition).toBe("relative");
    expect(expectedPosition.authoredLeft).toBe("41px");
    expect(expectedPosition.authoredTop).toBe("29px");
    expect(expectedPosition.x).not.toBe(41);
    expect(expectedPosition.y).not.toBe(29);
    const after = await replaceFlowTextTarget(app, context, id);
    expectFlowReplacement(before, after, expectedPosition);
  });

  test("Cmd+Shift+R maps flow placement through rotated and skewed ancestors", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      TRANSFORMED_FLOW_INLINE_TEXT_HTML,
    );
    const expectedPosition = await app
      .node("flow-caption")
      .evaluate((caption) => {
        const captionElement = caption as HTMLElement;
        const containingBlock = captionElement.offsetParent;
        if (!containingBlock)
          throw new Error("Caption has no position reference");
        const matrix = new DOMMatrixReadOnly(
          getComputedStyle(containingBlock).transform,
        );
        const captionRect = captionElement.getBoundingClientRect();
        const rootRect = containingBlock.getBoundingClientRect();
        return {
          containingBlockId: containingBlock.getAttribute(
            "data-agent-native-node-id",
          ),
          x: captionElement.offsetLeft,
          y: captionElement.offsetTop,
          rectOffsetX: captionRect.x - rootRect.x,
          rectOffsetY: captionRect.y - rootRect.y,
          matrixB: matrix.b,
          matrixC: matrix.c,
        };
      });
    expect(expectedPosition.containingBlockId).toBe("flow-root");
    expect(expectedPosition.matrixB).not.toBe(0);
    expect(Math.abs(expectedPosition.matrixC)).toBeGreaterThan(0.01);
    expect(expectedPosition.rectOffsetX).not.toBe(expectedPosition.x);
    expect(expectedPosition.rectOffsetY).not.toBe(expectedPosition.y);
    const after = await replaceFlowTextTarget(app, context, id);
    expectFlowReplacement(before, after, expectedPosition);
  });

  test("Cmd+Shift+R places a zero-size flow text root at its measured origin", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      ZERO_SIZE_FLOW_INLINE_TEXT_HTML,
    );
    const expectedPosition = await app
      .node("flow-caption")
      .evaluate((caption) => {
        const captionElement = caption as HTMLElement;
        const containingBlock = captionElement.offsetParent;
        if (!containingBlock)
          throw new Error("Caption has no position reference");
        const captionRect = captionElement.getBoundingClientRect();
        const rootRect = containingBlock.getBoundingClientRect();
        const underline = caption.querySelector(
          "[data-agent-native-node-id='flow-underline']",
        );
        if (!underline) throw new Error("Caption has no inline underline");
        const underlineRect = underline.getBoundingClientRect();
        return {
          containingBlockId: containingBlock.getAttribute(
            "data-agent-native-node-id",
          ),
          width: captionRect.width,
          height: captionRect.height,
          underlineWidth: underlineRect.width,
          underlineHeight: underlineRect.height,
          x: Math.round(
            captionRect.x -
              rootRect.x -
              containingBlock.clientLeft +
              containingBlock.scrollLeft,
          ),
          y: Math.round(
            captionRect.y -
              rootRect.y -
              containingBlock.clientTop +
              containingBlock.scrollTop,
          ),
        };
      });
    expect(expectedPosition.containingBlockId).toBe("flow-root");
    expect([expectedPosition.width, expectedPosition.height]).toEqual([0, 0]);
    expect(expectedPosition.underlineWidth).toBeGreaterThan(0);
    expect(expectedPosition.underlineHeight).toBeGreaterThan(0);
    const after = await replaceFlowTextTarget(app, context, id);
    expectFlowReplacement(before, after, expectedPosition);
  });

  test("Cmd+Shift+R places a stylesheet-sized transformed copy at the target bounds", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      flowReplacementGeometryHtml("copy-auto-transform"),
    );
    const targetBounds = await renderedBounds(app, "geo-caption");
    const sourceCss = await replacementCssSnapshot(app, "geo-source");
    expect(sourceCss.authoredWidth).toBe("");
    expect(sourceCss.authoredHeight).toBe("");
    expect(parseFloat(sourceCss.width)).toBeGreaterThan(0);
    expect(parseFloat(sourceCss.height)).toBeGreaterThan(0);
    expect(sourceCss.transform).not.toBe("none");
    expect(sourceCss.transformOrigin).not.toBe("50% 50%");

    const after = await replaceGeometryTextTarget(
      app,
      context,
      id,
      "geo-caption",
      "geo-underline",
    );
    await expectGeometryReplacement(
      app,
      before,
      after,
      "geo-caption",
      "geo-underline",
      "geo-source",
      targetBounds,
      sourceCss,
    );
  });

  test("Cmd+Shift+R replaces wrapped inline text at its measured origin", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      WRAPPED_INLINE_REPLACEMENT_HTML,
    );
    const targetBounds = await renderedBounds(app, "wrap-caption");
    const targetFragments = await app
      .node("wrap-caption")
      .evaluate((element) => element.getClientRects().length);
    expect(
      targetFragments,
      "Caption wraps across multiple lines",
    ).toBeGreaterThan(1);
    const sourceCss = await replacementCssSnapshot(app, "wrap-source");

    const after = await replaceGeometryTextTarget(
      app,
      context,
      id,
      "wrap-caption",
      "wrap-underline",
    );
    await expectGeometryReplacement(
      app,
      before,
      after,
      "wrap-caption",
      "wrap-underline",
      "wrap-source",
      targetBounds,
      sourceCss,
    );
  });

  test("Cmd+Shift+R preserves a top-only transform origin on the copied layer", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      flowReplacementGeometryHtml("copy-top-origin"),
    );
    const targetBounds = await renderedBounds(app, "geo-caption");
    const sourceCss = await replacementCssSnapshot(app, "geo-source");
    expect(sourceCss.transform).not.toBe("none");
    expect(sourceCss.transformOrigin).toMatch(/\s0(?:px|%)$/);

    const after = await replaceGeometryTextTarget(
      app,
      context,
      id,
      "geo-caption",
      "geo-underline",
    );
    await expectGeometryReplacement(
      app,
      before,
      after,
      "geo-caption",
      "geo-underline",
      "geo-source",
      targetBounds,
      sourceCss,
    );
  });

  test("Cmd+Shift+R places a margin-offset copy at the target bounds", async ({
    app,
    context,
  }) => {
    const { id, before } = await openChords(
      app,
      flowReplacementGeometryHtml("copy-margin-offset"),
    );
    const targetBounds = await renderedBounds(app, "geo-caption");
    const sourceCss = await replacementCssSnapshot(app, "geo-source");
    expect([sourceCss.marginTop, sourceCss.marginLeft]).toEqual([
      "13px",
      "17px",
    ]);

    const after = await replaceGeometryTextTarget(
      app,
      context,
      id,
      "geo-caption",
      "geo-underline",
    );
    await expectGeometryReplacement(
      app,
      before,
      after,
      "geo-caption",
      "geo-underline",
      "geo-source",
      targetBounds,
      sourceCss,
    );
  });

  test("Keyboard paste preserves non-pixel margins at exact visual coordinates", async ({
    app,
    context,
  }) => {
    const { id } = await openChords(
      app,
      '<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:800px"></body></html>',
    );
    const margins = ["0px auto", "10%", "2em"];
    const fileId = await app.page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .getAttribute("data-screen-iframe-id");
    expect(fileId).not.toBeNull();
    await writeLegacyMarginClipboard(app, context, fileId!, margins);
    await pressEditorKey(app.page, "Escape");
    await expect.poll(() => app.selectedLayers()).toEqual([]);
    await pressEditorKey(app.page, "ControlOrMeta+V");
    await expect
      .poll(
        async () =>
          [...(await app.savedNodes(id)).values()].filter((node) =>
            node.attrs["data-agent-native-layer-name"]?.startsWith(
              "Legacy margin ",
            ),
          ).length,
      )
      .toBe(3);
    await app.settled();
    const nodes = [...(await app.savedNodes(id)).values()];
    for (const [index, margin] of margins.entries()) {
      const copy = nodes.find(
        (node) =>
          node.attrs["data-agent-native-layer-name"] ===
          `Legacy margin ${index}`,
      )!;
      expect(copy).toBeDefined();
      const geometry = await renderedBounds(app, copy.id);
      expect({ x: geometry.x, y: geometry.y }).toEqual({
        x: 24 + index * 16,
        y: 24 + index * 16,
      });
      expect(
        await app
          .node(copy.id)
          .evaluate((element) => (element as HTMLElement).style.margin),
      ).toBe(margin);
    }
  });

  test("Keyboard repeat paste preserves mixed positioned and flow roots", async ({
    app,
    context,
  }) => {
    const positioned =
      '<div data-agent-native-node-id="mixed-positioned" data-agent-native-layer-name="Mixed positioned" style="position:absolute;left:240px;top:180px;width:60px;height:30px">Positioned</div>';
    const flow =
      '<div data-agent-native-node-id="mixed-flow" data-agent-native-layer-name="Mixed flow" style="position:static;width:60px;height:30px;margin:0">Flow</div>';
    const relative =
      '<div data-agent-native-node-id="mixed-relative" data-agent-native-layer-name="Mixed relative" style="position:relative;left:40px;top:12px;width:60px;height:30px;margin:0">Relative flow</div>';
    const { id, before } = await openChords(
      app,
      `<!doctype html><html><body style="margin:0;position:relative;width:900px;height:600px">${positioned}${flow}${relative}</body></html>`,
    );
    const fileId = (await app.savedRecord(id)).files.find(
      (file) => file.filename === "index.html",
    )!.id;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(appPath("/")).origin,
    });
    await app.page.evaluate(
      async ({ fileId, positioned, flow, relative }) => {
        const clipboardPath = "/app/lib/design-clipboard.ts";
        const importPath = "/app/lib/design-import.ts";
        const { getDesignClipboardTrustToken } = await import(clipboardPath);
        const { serializeDesignClipboardPayload } = await import(importPath);
        const entries = [
          { html: flow, rootNodeId: "mixed-flow", sourceFileId: fileId },
          {
            html: relative,
            rootNodeId: "mixed-relative",
            sourceFileId: fileId,
          },
          {
            html: positioned,
            rootNodeId: "mixed-positioned",
            sourceFileId: fileId,
          },
        ];
        await navigator.clipboard.writeText(
          serializeDesignClipboardPayload(
            entries.map((entry) => entry.html).join("\n"),
            { version: 1, entries },
            getDesignClipboardTrustToken() ?? undefined,
          ),
        );
      },
      { fileId, positioned, flow, relative },
    );
    await selectLayerRow(app.page, "Mixed positioned");
    let previous = before;
    for (let generation = 0; generation < 3; generation += 1) {
      await pressEditorKey(app.page, "ControlOrMeta+V");
      await expect
        .poll(async () => (await app.savedNodes(id)).size)
        .toBe(before.size + (generation + 1) * 3);
      await app.settled();
      const after = await app.savedNodes(id);
      const copies = newNodes(previous, after);
      expect(copies).toHaveLength(3);
      const positionedCopy = copies.find(
        (node) =>
          node.attrs["data-agent-native-layer-name"] === "Mixed positioned",
      )!;
      const flowCopy = copies.find(
        (node) => node.attrs["data-agent-native-layer-name"] === "Mixed flow",
      )!;
      const relativeCopy = copies.find(
        (node) =>
          node.attrs["data-agent-native-layer-name"] === "Mixed relative",
      )!;
      expect(relativeCopy).toBeDefined();
      expect(styleOf(relativeCopy)).toEqual(
        styleOf(before.get("mixed-relative")),
      );
      expect(
        await app
          .node(relativeCopy.id)
          .evaluate((element) => getComputedStyle(element).position),
      ).toBe("relative");
      expect(positionedCopy).toBeDefined();
      expect(flowCopy).toBeDefined();
      expect(styleOf(positionedCopy)).toEqual({
        ...styleOf(before.get("mixed-positioned")),
        left: `${240 + generation * 16}px`,
        top: `${180 + generation * 16}px`,
      });
      expect(await app.designRect(positionedCopy.id)).toEqual({
        x: 240 + generation * 16,
        y: 180 + generation * 16,
        width: 60,
        height: 30,
      });
      expect(styleOf(flowCopy)).toEqual(styleOf(before.get("mixed-flow")));
      expect(after.get("mixed-positioned")).toEqual(
        before.get("mixed-positioned"),
      );
      const originalFlow = before.get("mixed-flow")!;
      expect(after.get("mixed-flow")).toEqual({
        ...originalFlow,
        index: originalFlow.index + 3 * (generation + 1),
      });
      const originalRelative = before.get("mixed-relative")!;
      expect(after.get("mixed-relative")).toEqual({
        ...originalRelative,
        index: originalRelative.index + 3 * (generation + 1),
      });
      previous = after;
    }
  });

  test("Keyboard paste and replacement measure the active breakpoint preview", async ({
    app,
    context,
  }) => {
    const id = await app.seed(
      '<!doctype html><html><head><style>[data-agent-native-node-id="breakpoint-target"]{position:absolute;left:160px;top:200px;width:20px;height:20px}@media(max-width:480px){[data-agent-native-node-id="breakpoint-target"]{left:40px;top:80px}}</style></head><body style="margin:0;position:relative;height:800px"><div data-agent-native-node-id="breakpoint-target" data-agent-native-layer-name="Breakpoint target"></div></body></html>',
    );
    const fileId = (await app.savedRecord(id)).files.find(
      (file) => file.filename === "index.html",
    )!.id;
    const configured = await app.page.request.post(
      appPath("/_agent-native/actions/update-design"),
      {
        data: {
          id,
          dataOperations: [
            {
              op: "set",
              path: ["breakpointSet"],
              value: {
                id: "clipboard-breakpoints",
                breakpoints: [
                  {
                    id: "narrow",
                    label: "Narrow",
                    widthPx: 480,
                    prefix: "base",
                  },
                ],
              },
            },
            {
              op: "set",
              path: ["screenMetadata", fileId],
              value: { sourceType: "inline", width: 1280, height: 800 },
            },
            {
              op: "set",
              path: ["canvasFrames", fileId],
              value: { x: 0, y: 0, width: 1280, height: 800, z: 0 },
            },
          ],
        },
      },
    );
    expect(configured.ok()).toBe(true);
    await app.page.setViewportSize({ width: 2200, height: 1000 });
    await app.open(id);
    const zoom = app.page.getByRole("button", { name: /^\d+%$/ }).first();
    await zoom.click();
    await app.page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
    await expect(zoom).toHaveText("50%");
    const preview = app.page.locator(
      `iframe[data-screen-iframe-id="${fileId}::bp-480"]`,
    );
    await expect(preview).toBeVisible();
    const breakpointTitle = app.page
      .locator("[data-breakpoint-frame]")
      .filter({ has: preview })
      .locator("[data-frame-title]");
    await panTargetIntoUnobscuredCanvas(
      app.page,
      breakpointTitle,
      "breakpoint title",
    );
    await breakpointTitle.click();
    await expect(
      app.page.getByRole("combobox", { name: "Responsive edit scope" }),
    ).toBeVisible();
    await panTargetIntoUnobscuredCanvas(
      app.page,
      breakpointTitle,
      "active breakpoint title",
    );
    await breakpointTitle.click({ modifiers: ["Shift"] });
    await expect.poll(() => app.selectedLayers()).toEqual([]);
    await expect
      .poll(async () => {
        const response = await app.page.request.get(
          appPath(
            `/_agent-native/application-state/design-active-breakpoint:${id}`,
          ),
        );
        expect(response.ok()).toBe(true);
        const state = (await response.json()) as {
          activeBreakpointId?: string;
        } | null;
        return state?.activeBreakpointId;
      })
      .toBe("narrow");
    await writeLegacyMarginClipboard(app, context, fileId, ["10%"]);
    await pressEditorKey(app.page, "ControlOrMeta+V");
    await expect
      .poll(
        async () =>
          [...(await app.savedNodes(id)).values()].filter(
            (node) =>
              node.attrs["data-agent-native-layer-name"] === "Legacy margin 0",
          ).length,
      )
      .toBe(1);
    await app.settled();
    const before = await app.savedNodes(id);
    const copy = [...before.values()].find(
      (node) =>
        node.attrs["data-agent-native-layer-name"] === "Legacy margin 0",
    )!;
    const geometry = async (nodeId: string) =>
      preview
        .contentFrame()
        .locator(`[data-agent-native-node-id="${nodeId}"]`)
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            margin: (element as HTMLElement).style.margin,
          };
        });
    expect(await geometry(copy.id)).toEqual({ x: 24, y: 24, margin: "10%" });
    await selectLayerRow(app.page, "Legacy margin 0");
    await pressEditorKey(app.page, "ControlOrMeta+C");
    await selectLayerRow(app.page, "Breakpoint target");
    expect(await geometry("breakpoint-target")).toEqual({
      x: 40,
      y: 80,
      margin: "",
    });
    await pressEditorKey(app.page, "ControlOrMeta+Shift+R");
    await expect
      .poll(async () => (await app.savedNodes(id)).has("breakpoint-target"))
      .toBe(false);
    await app.settled();
    const after = await app.savedNodes(id);
    const replacement = newNodes(before, after);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]!.parent).toBe(
      before.get("breakpoint-target")!.parent,
    );
    expect(await geometry(replacement[0]!.id)).toEqual({
      x: 40,
      y: 80,
      margin: "10%",
    });
    expect(after.get(copy.id)).toEqual(copy);
  });

  test("Keyboard paste and replacement preserve board-layer geometry", async ({
    app,
    context,
  }) => {
    const boardHtml =
      '<!doctype html><html><body style="margin:0;position:relative;width:1000px;height:800px"><div data-agent-native-node-id="board-anchor" data-agent-native-layer-name="Board anchor" style="position:absolute;left:0;top:0;width:1px;height:1px"></div></body></html>';
    const id = await app.seed("<!doctype html><html><body></body></html>", {
      files: { "__board__.html": boardHtml },
    });
    const record = await app.savedRecord(id);
    const fileId = record.files.find(
      (file) => file.filename === "__board__.html",
    )!.id;
    const removed = await app.page.request.post(
      appPath("/_agent-native/actions/delete-file"),
      {
        data: {
          id: record.files.find((file) => file.filename === "index.html")!.id,
        },
      },
    );
    expect(removed.ok()).toBe(true);
    const linked = await app.page.request.post(
      appPath("/_agent-native/actions/update-design"),
      {
        data: {
          id,
          dataOperations: [{ op: "set", path: ["boardFileId"], value: fileId }],
        },
      },
    );
    expect(linked.ok()).toBe(true);
    await app.open(id);
    await app.settled();
    const frame = app.page.locator(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );
    await expect(frame).toBeVisible();
    const margins = ["0px auto", "10%", "2em"];
    await writeLegacyMarginClipboard(app, context, fileId, margins);
    await selectLayerRow(app.page, "Board anchor");
    await pressEditorKey(app.page, "Escape");
    await expect.poll(() => app.selectedLayers()).toEqual([]);
    await pressEditorKey(app.page, "ControlOrMeta+V");
    await expect
      .poll(
        async () =>
          [...(await app.savedNodes(id, "__board__.html")).values()].filter(
            (node) =>
              node.attrs["data-agent-native-layer-name"]?.startsWith(
                "Legacy margin ",
              ),
          ).length,
      )
      .toBe(3);
    await app.settled();
    const nodes = [...(await app.savedNodes(id, "__board__.html")).values()];
    const readBoardGeometry = async (nodeId: string) => {
      return frame
        .contentFrame()
        .locator(`[data-agent-native-node-id="${nodeId}"]`)
        .evaluate((element) => {
          const offset = element.ownerDocument.querySelector(
            "style[data-agent-native-content-offset]",
          );
          const readOffset = (attribute: string) => {
            if (!offset) return 0;
            const value = offset.getAttribute(attribute);
            if (!value?.trim()) throw new Error("Missing board content offset");
            return Number(value);
          };
          const x = readOffset("data-agent-native-content-offset-x");
          const y = readOffset("data-agent-native-content-offset-y");
          if (!Number.isFinite(x) || !Number.isFinite(y))
            throw new Error("Unreadable board content offset");
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left - x,
            y: rect.top - y,
            margin: (element as HTMLElement).style.margin,
          };
        });
    };
    for (const [index, margin] of margins.entries()) {
      const copy = nodes.find(
        (node) =>
          node.attrs["data-agent-native-layer-name"] ===
          `Legacy margin ${index}`,
      )!;
      expect(copy).toBeDefined();
      const geometry = await readBoardGeometry(copy.id);
      expect(geometry).toEqual({
        x: 24 + index * 16,
        y: 24 + index * 16,
        margin,
      });
    }
    const beforeReplacement = await app.savedNodes(id, "__board__.html");
    await selectLayerRow(app.page, "Legacy margin 0");
    await pressEditorKey(app.page, "ControlOrMeta+C");
    await selectLayerRow(app.page, "Board anchor");
    await pressEditorKey(app.page, "ControlOrMeta+Shift+R");
    await expect
      .poll(async () =>
        (await app.savedNodes(id, "__board__.html")).has("board-anchor"),
      )
      .toBe(false);
    await app.settled();
    const afterReplacement = await app.savedNodes(id, "__board__.html");
    const replacement = newNodes(beforeReplacement, afterReplacement);
    expect(replacement).toHaveLength(1);
    expect(replacement[0]!.parent).toBe(
      beforeReplacement.get("board-anchor")!.parent,
    );
    expect(await readBoardGeometry(replacement[0]!.id)).toEqual({
      x: 0,
      y: 0,
      margin: margins[0],
    });
    for (const node of nodes.filter((candidate) =>
      candidate.attrs["data-agent-native-layer-name"]?.startsWith(
        "Legacy margin ",
      ),
    )) {
      expect(afterReplacement.get(node.id)).toEqual(node);
    }
  });

  test("clicking an inline child inside a text layer selects it and does not duplicate its text", async ({
    app,
  }) => {
    const { id, before } = await openChords(app, INLINE_CHILD_HTML);
    await selectLayerRow(app.page, "Holder");
    const box = (await app.node("ic-text").locator("span").boundingBox())!;
    for (let i = 0; i < 3; i += 1) {
      await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      // Spaced out so the browser sees three single clicks, not a double/triple click.
      await app.page.waitForTimeout(500);
    }
    await expect
      .poll(
        () => app.selectedLayers(),
        "the inline span is its own layer, named by its text",
      )
      .toEqual(["klsajfk"]);
    await app.settled();
    expect((await savedMarkup(app, id, "ic-text"))?.text, "the text once").toBe(
      "klsajfk",
    );
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("clicking an inline child on the board surface selects it and leaves its text alone", async ({
    app,
  }) => {
    const id = await app.seed(CHORDS_HTML);
    const page = app.page;
    const board = await (
      await page.request.post(appPath("/_agent-native/actions/create-file"), {
        data: {
          designId: id,
          filename: "__board__.html",
          fileType: "html",
          content: BOARD_HTML,
        },
      })
    ).json();
    const linked = await page.request.post(
      appPath("/_agent-native/actions/update-design"),
      {
        data: {
          id,
          dataOperations: [
            { op: "set", path: ["boardFileId"], value: board.id },
          ],
        },
      },
    );
    expect(linked.ok()).toBe(true);
    await app.open(id);
    await app.zoomToFit();
    await app.settled();
    const boardBefore = await app.savedNodes(id, "__board__.html");
    await selectLayerRow(page, "Holder");

    const span = page
      .locator(
        "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
      )
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="bd-text"] span');
    const box = (await span.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(
      await page.evaluate(
        ({ x, y }) =>
          Boolean(
            document
              .elementFromPoint(x, y)
              ?.closest("[data-design-canvas-container]"),
          ),
        point,
      ),
      "the click point is on the canvas, not the editor chrome",
    ).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(500);
    }

    await expect
      .poll(
        () => app.selectedLayers(),
        "the inline span is its own layer, named by its text",
      )
      .toEqual(["klsajfk"]);
    await app.settled();
    expectOnlyChanged(
      boardBefore,
      await app.savedNodes(id, "__board__.html"),
      [],
    );
  });

  test("Cmd+Shift+R on an underlined text layer does not nest a copy inside it", async ({
    app,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(appPath("/")).origin,
    });
    const { id } = await openChords(app, INLINE_CHILD_HTML);
    await selectLayerRow(app.page, "Holder");
    await pressEditorKey(app.page, `ControlOrMeta+C`);
    const box = (await app.node("ic-text").locator("span").boundingBox())!;
    await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(
        () => app.selectedLayers(),
        "the inline span is its own layer, named by its text",
      )
      .toEqual(["klsajfk"]);
    await pressEditorKey(app.page, `ControlOrMeta+Shift+R`);
    await app.settled();

    const after = await app.savedNodes(id);
    const nested = [...after.values()].filter((node) => {
      let parent = node.parent;
      while (parent) {
        if (parent === "ic-text") return true;
        parent = after.get(parent)?.parent ?? null;
      }
      return false;
    });
    expect(
      nested.map((node) => node.attrs["data-agent-native-layer-name"]),
      "nothing is nested inside the text layer",
    ).toEqual([]);
    if (after.has("ic-text")) {
      expect(after.get("ic-text")!.attrs).not.toHaveProperty(
        "data-agent-native-preserve-styles",
      );
      expect((await savedMarkup(app, id, "ic-text"))?.text).toBe("klsajfk");
    }
  });

  test("Cmd+U twice in one session leaves the text un-underlined", async ({
    app,
  }) => {
    const { id, before } = await openChords(app, TEXT_HTML);
    const page = app.page;
    const box = (await app.node("tx-label").boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(1);
    await page.keyboard.press(`ControlOrMeta+A`);
    await page.keyboard.press(`ControlOrMeta+U`);
    await expect.poll(() => rendersUnderline(app, "tx-label")).toBe(true);
    await page.keyboard.press(`ControlOrMeta+A`);
    await page.keyboard.press(`ControlOrMeta+U`);
    await page.keyboard.press("Escape");
    await expect(
      designFrame(page).locator("[data-agent-native-text-editing]"),
    ).toHaveCount(0);

    await app.settled();
    expect(await app.savedHtml(id)).not.toMatch(/underline/);
    expect((await savedMarkup(app, id, "tx-label"))?.text).toBe("klsajfk");
    expect(await rendersUnderline(app, "tx-label")).toBe(false);
    const after = await app.savedNodes(id);
    expect(
      newNodes(before, after).filter((node) => node.parent !== "tx-label"),
      "anything new lives inside the text layer",
    ).toEqual([]);
  });
});
