import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { gotoEditor } from "./helpers";

/**
 * Keyboard nudge in NORMAL BLOCK FLOW.
 *
 * The auto-layout spec covers a parent with an inline `display:flex`, which the
 * authored-style parser can read directly. This covers the case it cannot: a
 * plain block stack whose layout comes from a STYLESHEET, which is what a real
 * running app (fusion/localhost screen) looks like.
 *
 * Before the fix, `describeFlowContainer` recognised only flex and grid, so this
 * parent resolved to `kind: "none"` and arrow keys wrote `left`/`top` onto the
 * child. Under `position: static` that does nothing at all — the user-visible
 * symptom was "arrows just do px movements" with nothing moving.
 */
const BLOCK_FLOW_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Block Flow Keyboard</title>
    <style>
      /* Deliberately in a stylesheet: the authored-style parser cannot see
         this, so only the browser's rendered display knows the real layout. */
      .stack { padding: 16px; background: #1e293b; border-radius: 16px; }
      .stack > div { padding: 12px 16px; border-radius: 10px; }
    </style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">
    <main data-agent-native-node-id="bf-root" data-agent-native-layer-name="Root" style="position:relative;min-height:560px;padding:48px">
      <section data-agent-native-node-id="bf-stack" data-agent-native-layer-name="Stack" class="stack">
        <div data-agent-native-node-id="bf-alpha" data-agent-native-layer-name="BlockAlpha" style="background:#38bdf8;color:#082f49">Alpha</div>
        <div data-agent-native-node-id="bf-beta" data-agent-native-layer-name="BlockBeta" style="background:#a78bfa;color:#1f1147">Beta</div>
        <div data-agent-native-node-id="bf-gamma" data-agent-native-layer-name="BlockGamma" style="background:#fbbf24;color:#451a03">Gamma</div>
      </section>
    </main>
  </body>
</html>`;

test.describe("block flow keyboard nudge", () => {
  let designId = "";

  test.afterEach(async ({ request, baseURL }) => {
    if (!designId) return;
    await postAction(request, baseURL, "delete-design", { id: designId }).catch(
      () => {},
    );
    designId = "";
  });

  test("arrow keys reorder a block child instead of writing a dead offset", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createBlockFlowDesign(
      request,
      baseURL,
      "E2E Block Flow Reorder",
    );
    await gotoEditor(page, designId);

    // Down the block axis: DOM order is visual order, so the child moves past
    // its sibling rather than receiving a `top` that static positioning ignores.
    await selectLayerRow(page, "BlockAlpha");
    await pressEditorKey(page, "ArrowDown");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["bf-beta", "bf-alpha", "bf-gamma"]);
      expect(html).not.toMatch(/bf-alpha[^>]*position:\s*relative/);
      expect(html).not.toMatch(/bf-alpha[^>]*top:\s*1px/);
    });

    // And back up.
    await pressEditorKey(page, "ArrowUp");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);
    });

    // Cross axis of a non-wrapping stack has nowhere to go, and must not fall
    // back to a positional offset.
    await pressEditorKey(page, "ArrowRight");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);
      expect(html).not.toMatch(/bf-alpha[^>]*left:\s*1px/);
    });
  });

  test("does not reorder past the end of the stack", async ({
    page,
    request,
    baseURL,
  }) => {
    designId = await createBlockFlowDesign(
      request,
      baseURL,
      "E2E Block Flow Clamp",
    );
    await gotoEditor(page, designId);

    await selectLayerRow(page, "BlockGamma");
    await pressEditorKey(page, "ArrowDown");
    await expectFileContent(request, baseURL, designId, (html) => {
      expect(flowOrder(html)).toEqual(["bf-alpha", "bf-beta", "bf-gamma"]);
      expect(html).not.toMatch(/bf-gamma[^>]*top:\s*1px/);
    });
  });
});

/** DOM order of the stack's children, by node id. */
function flowOrder(html: string): string[] {
  const inner = elementInner(html, "bf-stack");
  return Array.from(
    inner.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    (match) => match[1]!,
  );
}

/** Inner markup of one node, matched by walking tag depth from its open tag. */
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

async function createBlockFlowDesign(
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
    content: BLOCK_FLOW_HTML,
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
