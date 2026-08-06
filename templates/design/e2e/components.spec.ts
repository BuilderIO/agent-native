import { expect, test, type Page } from "@playwright/test";

/**
 * Design has no component template: an instance is any node carrying
 * `data-agent-native-component="Name"`, and same-named instances are
 * independent copies (see the DESIGN NOTE in swap-component-instance.ts), so
 * Figma parity is not the bar for the last describe block.
 */

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Components</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
    <button data-agent-native-node-id="btn-a" data-agent-native-layer-name="Button A"
            data-variant="primary"
            style="position:absolute;left:20px;top:60px;width:160px;height:44px;background:#3b82f6">Buy now</button>
    <button data-agent-native-node-id="btn-b" data-agent-native-layer-name="Button B"
            style="position:absolute;left:20px;top:140px;width:160px;height:44px;background:#22c55e">Sign up</button>
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:20px;top:220px;width:280px;height:120px;background:#1f2937">
      <p data-agent-native-node-id="card-text" data-agent-native-layer-name="Card Text"
         style="margin:0;padding:12px">Card body</p>
    </div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok())
    throw new Error(`${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "components",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return id;
}

async function indexHtml(page: Page, designId: string): Promise<string> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  return (
    (record.files ?? []).find((f: any) => f.filename === "index.html")
      ?.content ?? ""
  );
}

/** The open tag of one node, where every stamped annotation lives. */
function openTag(html: string, nodeId: string): string {
  const at = html.indexOf(`data-agent-native-node-id="${nodeId}"`);
  if (at === -1) return "";
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

test.beforeAll(async ({ }, testInfo) => {
  baseURL =
    (testInfo.project.use as { baseURL?: string }).baseURL ??
    process.env.E2E_BASE_URL ??
    "http://127.0.0.1:9333";
});

test.describe("promoting to a component", () => {
  test("create-component marks the node as a component instance", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    expect(
      openTag(await indexHtml(page, id), "btn-a"),
      "create-component must stamp data-agent-native-component on the node",
    ).toContain('data-agent-native-component="PrimaryButton"');
  });

  test("an existing variant-like attribute becomes a component prop", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    expect(
      openTag(await indexHtml(page, id), "btn-a"),
      `create-component documents that it stamps data-agent-native-prop-* for ` +
        `variant-like attributes already on the node (btn-a has data-variant).`,
    ).toContain("data-agent-native-prop-variant");
  });

  test("promoting one node leaves its siblings untouched", async ({ page }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    expect(
      openTag(await indexHtml(page, id), "btn-b"),
      "promoting one element must not annotate any other element",
    ).not.toContain("data-agent-native-component");
  });

  test("a promoted component is listed by list-design-components", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    const listed = await postAction(page, "list-design-components", {
      designId: id,
    });
    const names = JSON.stringify(listed);
    expect(
      names,
      `a promoted component must be discoverable — swap-component-instance ` +
        `takes its targetComponentName "from list-design-components".`,
    ).toContain("PrimaryButton");
  });
});

test.describe("detaching an instance", () => {
  test("detach strips the component linkage", async ({ page }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    await postAction(page, "detach-component-instance", {
      designId: id,
      nodeId: "btn-a",
    });
    expect(
      openTag(await indexHtml(page, id), "btn-a"),
      `Figma's Detach instance severs the linkage — the annotation must go.`,
    ).not.toContain('data-agent-native-component="PrimaryButton"');
  });

  test("detach preserves the rendered content", async ({ page }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    await postAction(page, "detach-component-instance", {
      designId: id,
      nodeId: "btn-a",
    });
    const html = await indexHtml(page, id);
    expect(
      html,
      `Figma: detaching keeps the visual result identical, it only breaks the ` +
        `link. The node's markup already IS the expanded content here.`,
    ).toContain("Buy now");
    expect(openTag(html, "btn-a")).toContain("background:#3b82f6");
  });
});

test.describe("swapping an instance", () => {
  test("swap replaces the instance with the target component's markup", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "PrimaryButton",
    });
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-b",
      name: "SecondaryButton",
    });
    await postAction(page, "swap-component-instance", {
      designId: id,
      nodeId: "btn-a",
      targetComponentName: "SecondaryButton",
    });
    const tag = openTag(await indexHtml(page, id), "btn-a");
    expect(
      tag,
      `Figma's Swap instance repoints the instance at the other component.`,
    ).toContain('data-agent-native-component="SecondaryButton"');
  });
});

test.describe("Design's own component model (not Figma parity)", () => {
  test("same-named instances are independent copies, not linked to a main", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-a",
      name: "Btn",
    });
    await postAction(page, "create-component", {
      designId: id,
      nodeId: "btn-b",
      name: "Btn",
    });
    await postAction(page, "apply-visual-edit", {
      source: { kind: "design-file", designId: id, filename: "index.html" },
      intent: {
        kind: "style",
        target: { nodeId: "btn-a" },
        property: "background",
        value: "rgb(255, 0, 0)",
      },
    });
    const html = await indexHtml(page, id);
    expect(
      openTag(html, "btn-b"),
      `Design has no component template: "every instance of the same name is ` +
        `an independently-duplicated copy of HTML" (swap-component-instance.ts). ` +
        `Editing one must NOT propagate — this is a deliberate divergence from ` +
        `Figma, where a main-component edit updates every instance.`,
    ).not.toContain("rgb(255, 0, 0)");
    expect(openTag(html, "btn-a")).toContain("rgb(255, 0, 0)");
  });
});
