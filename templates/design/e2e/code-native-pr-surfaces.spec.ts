// oracle-change: Motion timeline removed from Design; its specs and assertions are deleted with the feature
import type { Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

// oracle-change: the Review audit panel was removed with the design review tools
const SURFACES_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Code-native surfaces</title>
    <style>
      :root {
        --e2e-accent-color: #6366f1;
        --e2e-radius: 14px;
      }
    </style>
  </head>
  <body style="margin:0;padding:40px;font-family:system-ui,sans-serif;background:#ffffff;color:#111827">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px">
      <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha Button" style="width:140px;height:44px;border:0;background:#1d4ed8;color:#ffffff">Alpha Button</button>
      <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button" style="width:140px;height:44px;border:0;background:#166534;color:#ffffff">Beta Button</button>
    </div>
    <button data-agent-native-node-id="cta" data-agent-native-layer-name="Variant CTA" data-agent-native-component="E2EButton" data-agent-native-prop-variant="primary" data-agent-native-prop-size="md" style="margin-top:24px;width:160px;height:44px;border:0;border-radius:var(--e2e-radius);background:var(--e2e-accent-color);color:#ffffff">Variant CTA</button>
    <div data-agent-native-node-id="swatch" data-agent-native-layer-name="Token Swatch" style="margin-top:24px;width:240px;height:60px;border-radius:var(--e2e-radius);background:var(--e2e-accent-color)"></div>
  </body>
</html>`;

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  expect(
    response.ok(),
    `${name} ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response.json();
}

/** Sets a lab for the signed-in user and returns the restore for the previous value. */
async function setLab(page: Page, key: string, enabled: boolean) {
  const states = await (
    await page.request.get(appPath("/_agent-native/actions/get-lab-states"))
  ).json();
  const previous = states[key]?.enabled;
  expect(typeof previous, `get-lab-states has no state for ${key}`).toBe(
    "boolean",
  );
  expect((await postAction(page, "set-lab", { key, enabled })).enabled).toBe(
    enabled,
  );
  return async () => {
    expect(
      (await postAction(page, "set-lab", { key, enabled: previous })).enabled,
    ).toBe(previous);
  };
}

async function openAndFit(app: App, designId: string) {
  await app.open(designId);
  await app.zoomToFit();
  await app.settled();
}

async function selectOnCanvas(app: App, nodeId: string, layerName: string) {
  const node = app.node(nodeId);
  await expect(node).toBeVisible();
  const rect = await node.boundingBox();
  if (!rect) throw new Error(`Canvas node ${nodeId} has no rendered bounds`);
  // Cmd+click reaches a nested layer; a plain click takes the top-level one.
  await app.page.keyboard.down("ControlOrMeta");
  await app.page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await app.page.keyboard.up("ControlOrMeta");
  await expect(
    app.page.getByRole("button", { name: "More", exact: true }),
  ).not.toBeFocused();
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
}

test("changing a component's variant in the inspector saves that prop on the instance and nothing else", async ({
  app,
  page,
}) => {
  const id = await app.seed(SURFACES_HTML);
  await postAction(page, "index-components", { designId: id });
  await postAction(page, "seed-e2e-component-variants", { designId: id });
  await openAndFit(app, id);
  await selectOnCanvas(app, "cta", "Variant CTA");
  const componentSection = page.getByTestId("component-section");
  await expect(componentSection).toContainText("E2EButton");
  const variantSelect = componentSection.getByRole("combobox").first();
  await expect(variantSelect).toHaveText("primary");
  const before = await app.savedNodes(id);

  await variantSelect.click();
  await page.getByRole("option", { name: "secondary", exact: true }).click();
  await app.settled();

  await expect(variantSelect).toHaveText("secondary");
  await expect(app.node("cta")).toHaveAttribute(
    "data-agent-native-prop-variant",
    "secondary",
  );
  const after = await app.savedNodes(id);
  expect(after.get("cta")?.attrs).toEqual({
    ...before.get("cta")?.attrs,
    "data-agent-native-prop-variant": "secondary",
  });
  expectOnlyChanged(before, after, ["cta"]);
});

test("editing a color token recolors its users live, saves the override on the design, and survives reload", async ({
  app,
  page,
}) => {
  const id = await app.seed(SURFACES_HTML);
  await openAndFit(app, id);
  const swatchStyle = (property: "backgroundColor" | "borderTopLeftRadius") =>
    app
      .node("swatch")
      .evaluate((element, name) => getComputedStyle(element)[name], property);
  await page.getByRole("tab", { name: "Library", exact: true }).click();
  await expect(
    page.getByText("E2e Accent Color", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => swatchStyle("backgroundColor"))
    .toBe("rgb(99, 102, 241)");
  const htmlBefore = await app.savedHtml(id);
  expect((await app.savedRecord(id)).data?.tweakSelections).toBeUndefined();

  await page
    .getByRole("button", { name: "Edit E2e Accent Color", exact: true })
    .click();
  const input = page.getByLabel("Token value for E2e Accent Color", {
    exact: true,
  });
  await input.fill("#ff3366");
  await input.press("Enter");
  await app.settled();

  await expect
    .poll(() => swatchStyle("backgroundColor"))
    .toBe("rgb(255, 51, 102)");
  expect(
    await app
      .node("cta")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(255, 51, 102)");
  expect(await swatchStyle("borderTopLeftRadius")).toBe("14px");
  expect((await app.savedRecord(id)).data?.tweakSelections).toStrictEqual({
    "--e2e-accent-color": "#ff3366",
  });
  expect(await app.savedHtml(id)).toBe(htmlBefore);

  await app.open(id);
  await expect
    .poll(() => swatchStyle("backgroundColor"))
    .toBe("rgb(255, 51, 102)");
});

test("DesignCanvas renders and saves source-token literals in user markup verbatim and installs its bridge", async ({
  app,
}) => {
  const headToken = "__INITIAL_SOURCE_HEAD__";
  const ownershipToken = "__INITIAL_SOURCE_OWNERSHIP__";
  const tokenClass = `${headToken} ${ownershipToken}`;
  const tokenStyle = `--source-head-token: ${headToken}; --source-ownership-token: ${ownershipToken};`;
  const id = await app.seed(`<!doctype html>
<html>
  <head>
    <meta name="source-token-head-probe" content="${ownershipToken}">
    <meta name="source-token-head-literal" content="${headToken}">
  </head>
  <body class="${tokenClass}" style="${tokenStyle}">
    <button id="source-token-probe" data-agent-native-node-id="source-token-probe" class="${ownershipToken}" style="${tokenStyle}">Bridge ready</button>
  </body>
</html>`);
  await app.open(id);

  const probe = app.node("source-token-probe");
  const body = probe.locator("xpath=ancestor::body");
  const meta = (name: string) =>
    probe.locator(`xpath=ancestor::html/head/meta[@name="${name}"]`);
  await expect(probe).toHaveText("Bridge ready");
  await expect
    .poll(() =>
      probe.evaluate(
        (element) =>
          (
            element.ownerDocument.defaultView as {
              __anEditorChromeBridge?: boolean;
            }
          ).__anEditorChromeBridge,
      ),
    )
    .toBe(true);
  await expect(meta("source-token-head-probe")).toHaveAttribute(
    "content",
    ownershipToken,
  );
  await expect(meta("source-token-head-literal")).toHaveAttribute(
    "content",
    headToken,
  );
  await expect(body).toHaveAttribute("class", tokenClass);
  await expect(body).toHaveAttribute("style", tokenStyle);
  await expect(probe).toHaveAttribute("class", ownershipToken);
  await expect(probe).toHaveAttribute("style", tokenStyle);

  await app.settled();
  const saved = await app.savedHtml(id);
  expect(saved).toContain(
    `<meta name="source-token-head-probe" content="${ownershipToken}">`,
  );
  expect(saved).toContain(
    `<meta name="source-token-head-literal" content="${headToken}">`,
  );
  const savedNodes = await app.savedNodes(id);
  const savedBody = [...savedNodes.values()].find(
    (node) => node.tag === "body",
  );
  expect(savedBody?.attrs).toEqual({
    class: tokenClass,
    style: tokenStyle,
    "data-agent-native-node-id": savedBody?.id,
  });
  expect(savedNodes.get("source-token-probe")?.attrs).toEqual({
    id: "source-token-probe",
    "data-agent-native-node-id": "source-token-probe",
    class: ownershipToken,
    style: tokenStyle,
  });
});
