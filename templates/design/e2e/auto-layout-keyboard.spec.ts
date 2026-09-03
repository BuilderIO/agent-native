import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { gotoEditor } from "./helpers";

const AUTO_LAYOUT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Auto Layout Keyboard</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
    <main data-agent-native-node-id="al-root" data-agent-native-layer-name="Root" style="position:relative;min-height:560px;padding:48px">
      <section data-agent-native-node-id="al-row" data-agent-native-layer-name="Card Row" style="display:flex;flex-direction:row;gap:16px;padding:16px;background:#1e293b;border-radius:16px">
        <div data-agent-native-node-id="al-alpha" data-agent-native-layer-name="Alpha" style="padding:12px 16px;border-radius:10px;background:#38bdf8;color:#082f49">Alpha</div>
        <div data-agent-native-node-id="al-beta" data-agent-native-layer-name="Beta" style="padding:12px 16px;border-radius:10px;background:#a78bfa;color:#1f1147">Beta</div>
        <div data-agent-native-node-id="al-gamma" data-agent-native-layer-name="Gamma" style="padding:12px 16px;border-radius:10px;background:#fbbf24;color:#451a03">Gamma</div>
      </section>
      <div data-agent-native-node-id="al-free" data-agent-native-layer-name="Free Frame" style="position:relative;margin-top:32px;width:360px;height:200px;border:1px dashed #475569;border-radius:12px"></div>
    </main>
  </body>
</html>`;

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

test.describe("auto layout keyboard parity", () => {
  let designId = "";

  test.afterEach(async ({ request, baseURL }) => {
    if (!designId) return;
    await postAction(request, baseURL, "delete-design", {
      id: designId,
    }).catch(() => {});
    designId = "";
  });

  test("arrow keys reorder an auto layout child instead of offsetting it", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createAutoLayoutDesign(
      request,
      baseURL,
      "E2E Auto Layout Reorder",
    );
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Alpha");
    await pressEditorKey(page, "ArrowRight");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["al-beta", "al-alpha", "al-gamma"]);
      expect(html).not.toMatch(/al-alpha[^>]*position:\s*relative/);
    });

    await pressEditorKey(page, "ArrowLeft");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["al-alpha", "al-beta", "al-gamma"]);
    });

    // The cross axis of a non-wrapping row has nowhere to move to; Figma does
    // nothing rather than falling back to a positional offset.
    await pressEditorKey(page, "ArrowUp");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["al-alpha", "al-beta", "al-gamma"]);
      expect(html).not.toMatch(/al-alpha[^>]*top:\s*-1px/);
    });
  });

  test("paste lands inside a selected auto layout frame, in its flow", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    designId = await createAutoLayoutDesign(
      request,
      baseURL,
      "E2E Paste Into Container",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(actionBaseUrl(baseURL)).origin,
    });
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Alpha");
    await pressPrimaryShortcut(page, "c");
    await selectLayerRow(page, "Free Frame");
    await pressPrimaryShortcut(page, "v");

    await expectFileContent(request, baseURL, designId, (html) => {
      const frame = elementInner(html, "al-free");
      expect(frame).toContain("Alpha");
      expect(flowOrder(html)).toEqual(["al-alpha", "al-beta", "al-gamma"]);
    });
  });

  test("paste lands after a selected text object, not inside it", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    designId = await createAutoLayoutDesign(
      request,
      baseURL,
      "E2E Paste After Object",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(actionBaseUrl(baseURL)).origin,
    });
    await gotoEditor(page, designId);

    await selectLayerRow(page, "Alpha");
    await pressPrimaryShortcut(page, "c");
    await selectLayerRow(page, "Beta");
    await pressPrimaryShortcut(page, "v");

    await expectFileContent(request, baseURL, designId, (html) => {
      expect(elementInner(html, "al-beta")).not.toContain("Alpha");
      const order = flowOrder(html);
      expect(order.slice(0, 2)).toEqual(["al-alpha", "al-beta"]);
      expect(order).toHaveLength(4);
    });
  });
});

/** DOM order of the auto layout row's children, by node id. */
function flowOrder(html: string): string[] {
  const inner = elementInner(html, "al-row");
  return Array.from(
    inner.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    (match) => match[1]!,
  );
}

/** Inner markup of one node, matched by walking tag depth from its open tag —
 * a non-greedy regex would stop at the first `</div>` of a nested child. */
function elementInner(html: string, nodeId: string): string {
  const openIndex = html.indexOf(`data-agent-native-node-id="${nodeId}"`);
  if (openIndex < 0) throw new Error(`node ${nodeId} not found`);
  const tagStart = html.lastIndexOf("<", openIndex);
  const tag = /^<([a-zA-Z0-9-]+)/.exec(html.slice(tagStart))?.[1];
  if (!tag) throw new Error(`no tag for ${nodeId}`);
  const contentStart = html.indexOf(">", openIndex) + 1;
  const pattern = new RegExp(`</?${tag}\\b`, "g");
  pattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, match.index);
  }
  throw new Error(`unbalanced ${tag} for ${nodeId}`);
}

async function createAutoLayoutDesign(
  request: APIRequestContext,
  baseURL: string | undefined,
  title: string,
): Promise<string> {
  const created = await postAction(request, baseURL, "create-design", {
    title,
    projectType: "prototype",
  });
  const id: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!id) throw new Error(`create-design did not return id: ${created}`);
  await postAction(request, baseURL, "create-file", {
    designId: id,
    filename: "layout.html",
    fileType: "html",
    content: AUTO_LAYOUT_HTML,
  });
  return id;
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

function actionBaseUrl(baseURL: string | undefined): string {
  return (
    baseURL ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`
  ).replace(/\/$/, "");
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

function bodyOf(html: string): string {
  const start = html.indexOf("<body");
  return start < 0 ? html : html.slice(start, html.indexOf("</body>") + 7);
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

async function focusCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
}

async function pressEditorKey(page: Page, key: string): Promise<void> {
  await focusCanvas(page);
  await page.keyboard.press(key);
}

async function pressPrimaryShortcut(page: Page, key: string): Promise<void> {
  await focusCanvas(page);
  await page.keyboard.press(`${PRIMARY}+${key.toUpperCase()}`);
}
