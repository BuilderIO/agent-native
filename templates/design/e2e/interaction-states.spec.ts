import { type Locator, type Page } from "@playwright/test";

import { expect, expectOnlyChanged, test, type App } from "./rails";

const BUTTONS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px">
    <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha" style="width:160px;height:48px;opacity:0.97">Alpha</button>
    <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta" style="width:160px;height:48px">Beta</button>
  </div>
</body></html>`;

const AUTHORED_STATES = `<!doctype html><html><head><meta charset="utf-8">
<style data-agent-native-states>
[data-agent-native-node-id="alpha"]:hover {
  opacity: 0.91 !important;
}

[data-agent-native-node-id="alpha"]:focus {
  opacity: 0.82 !important;
}

[data-agent-native-node-id="alpha"]:focus-visible {
  opacity: 0.73 !important;
}

[data-agent-native-node-id="alpha"]:active {
  opacity: 0.64 !important;
}

[data-agent-native-node-id="gamma"]:disabled {
  opacity: 0.55 !important;
}
</style></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px">
    <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha" style="width:160px;height:48px;opacity:0.97">Alpha</button>
    <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta" style="width:160px;height:48px">Beta</button>
    <button disabled data-agent-native-node-id="gamma" data-agent-native-layer-name="Gamma" style="width:160px;height:48px">Gamma</button>
  </div>
</body></html>`;

type State =
  | "default"
  | "hover"
  | "focus"
  | "focus-visible"
  | "active"
  | "disabled";

async function openWithAlphaSelected(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  const rect = await app.designRect("alpha");
  const center = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(center.x, center.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Alpha"]);
  await expect(stateTrigger(app.page)).toHaveAttribute(
    "data-interaction-state",
    "default",
  );
  return id;
}

function stateTrigger(page: Page) {
  return page.getByRole("button", { name: "Interaction state" });
}

function opacityInput(page: Page) {
  return page.locator('input[aria-label="Opacity" i]').first();
}

async function chooseState(page: Page, state: State) {
  await stateTrigger(page).click();
  await page.locator(`[data-interaction-state-option="${state}"]`).click();
  await expect(stateTrigger(page)).toHaveAttribute(
    "data-interaction-state",
    state,
  );
}

async function typeInto(input: Locator, value: string) {
  await input.fill(value);
  await input.press("Enter");
}

async function computedOpacity(element: Locator) {
  return element.evaluate((node) => getComputedStyle(node).opacity);
}

/** Real pseudo-class rules from the saved `<style data-agent-native-states>`, keyed `nodeId:state`. */
function savedStateRules(html: string) {
  const block =
    /<style\b[^>]*\bdata-agent-native-states\b[^>]*>([\s\S]*?)<\/style>/i.exec(
      html,
    )?.[1] ?? "";
  const rules: Record<string, Record<string, string>> = {};
  for (const [, nodeId, state, body] of block.matchAll(
    /\[data-agent-native-node-id="([^"]+)"\]:(hover|focus-visible|focus|active|disabled)\s*\{([^}]*)\}/g,
  )) {
    const declarations: Record<string, string> = {};
    for (const declaration of body.split(";")) {
      const [property, ...value] = declaration.split(":");
      if (property.trim())
        declarations[property.trim()] = value
          .join(":")
          .replace(/!important/, "")
          .trim();
    }
    rules[`${nodeId}:${state}`] = declarations;
  }
  return rules;
}

test("editing opacity and width per interaction state saves each under its own pseudo-class rule, leaving the element's own style untouched", async ({
  app,
}) => {
  const id = await openWithAlphaSelected(app, BUTTONS);
  const before = await app.savedNodes(id);

  for (const [state, percent] of [
    ["hover", "91"],
    ["focus", "82"],
    ["focus-visible", "73"],
    ["active", "64"],
    ["disabled", "55"],
  ] as const) {
    await chooseState(app.page, state);
    await typeInto(opacityInput(app.page), percent);
    await expect(app.node("alpha")).toHaveAttribute(
      "data-an-state-preview",
      state,
    );
    await expect
      .poll(() => computedOpacity(app.node("alpha")))
      .toBe(`0.${percent}`);
  }
  await chooseState(app.page, "hover");
  await typeInto(
    app.page.locator('input[aria-label="W size in pixels"]'),
    "220",
  );
  await expect
    .poll(() => app.designRect("alpha"))
    .toMatchObject({ width: 220 });
  await app.settled();

  const html = await app.savedHtml(id);
  expect(savedStateRules(html)).toEqual({
    "alpha:hover": {
      opacity: "0.91",
      width: "220px",
      "flex-basis": "auto",
      "flex-grow": "0",
      "flex-shrink": "0",
    },
    "alpha:focus": { opacity: "0.82" },
    "alpha:focus-visible": { opacity: "0.73" },
    "alpha:active": { opacity: "0.64" },
    "alpha:disabled": { opacity: "0.55" },
  });
  expectOnlyChanged(before, await app.savedNodes(id), []);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Alpha"]);
  await expect(stateTrigger(app.page)).toHaveAttribute(
    "data-interaction-state",
    "hover",
  );
});

// fixme: product bug: Opacity field shows the previous state's 91% on Focus (line 146); VisualScrubInput pendingCommitRef holds the stale value across a state
test.fixme("choosing a state with nothing authored shows the element's default opacity, not the last edited state's", async ({
  app,
}) => {
  const id = await openWithAlphaSelected(app, BUTTONS);
  await chooseState(app.page, "hover");
  await expect(opacityInput(app.page)).toHaveValue("97%");
  await typeInto(opacityInput(app.page), "91");
  await app.settled();
  expect(savedStateRules(await app.savedHtml(id))).toEqual({
    "alpha:hover": { opacity: "0.91" },
  });

  await chooseState(app.page, "focus");

  await expect(opacityInput(app.page)).toHaveValue("97%");
  await expect.poll(() => computedOpacity(app.node("alpha"))).toBe("0.97");
});

// fixme: product bug: Redo restores the saved :active rule but drops the inspector back to Default state and clears the preview (line 173
test.fixme("undo and redo of a state edit restore that state's saved rule and keep the state selected", async ({
  app,
}) => {
  const id = await openWithAlphaSelected(app, BUTTONS);
  await chooseState(app.page, "active");
  await typeInto(opacityInput(app.page), "64");
  await app.settled();
  await typeInto(opacityInput(app.page), "61");
  await app.settled();
  expect(savedStateRules(await app.savedHtml(id))).toEqual({
    "alpha:active": { opacity: "0.61" },
  });
  const before = await app.savedNodes(id);

  await app.page.keyboard.press("ControlOrMeta+z");
  await app.settled();

  expect(savedStateRules(await app.savedHtml(id))).toEqual({
    "alpha:active": { opacity: "0.64" },
  });
  await expect(stateTrigger(app.page)).toHaveAttribute(
    "data-interaction-state",
    "active",
  );
  await expect(app.node("alpha")).toHaveAttribute(
    "data-an-state-preview",
    "active",
  );
  await expect.poll(() => computedOpacity(app.node("alpha"))).toBe("0.64");

  await app.page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();

  expect(savedStateRules(await app.savedHtml(id))).toEqual({
    "alpha:active": { opacity: "0.61" },
  });
  expectOnlyChanged(before, await app.savedNodes(id), []);
  await expect(stateTrigger(app.page)).toHaveAttribute(
    "data-interaction-state",
    "active",
  );
  await expect.poll(() => computedOpacity(app.node("alpha"))).toBe("0.61");
});

test("in Interact mode saved state rules follow real hover, click focus, keyboard focus, press and disabled", async ({
  app,
}) => {
  await app.page.addInitScript(() => {
    const counter = window as Window & { __alphaClicks?: number };
    counter.__alphaClicks = 0;
    window.addEventListener(
      "click",
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-agent-native-node-id="alpha"]')
        ) {
          counter.__alphaClicks = (counter.__alphaClicks ?? 0) + 1;
        }
      },
      true,
    );
  });
  const id = await app.seed(AUTHORED_STATES);
  await app.open(id);
  await app.zoomToFit();
  await app.page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  await expect(
    app.page.locator("[data-design-top-bar] [data-design-interact-route]"),
  ).toBeVisible();
  const alpha = app.node("alpha");
  const clicks = () =>
    alpha.evaluate(
      (node) =>
        (node.ownerDocument.defaultView as Window & { __alphaClicks?: number })
          .__alphaClicks,
    );
  await expect.poll(() => computedOpacity(alpha)).toBe("0.97");

  const box = await alpha.boundingBox();
  if (!box) throw new Error("Alpha has no box");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await app.page.mouse.move(center.x, center.y);
  await expect.poll(() => computedOpacity(alpha)).toBe("0.91");

  await app.page.mouse.click(center.x, center.y);
  await expect
    .poll(() =>
      alpha.evaluate((node) => node.matches(":focus:not(:focus-visible)")),
    )
    .toBe(true);
  await expect.poll(() => computedOpacity(alpha)).toBe("0.82");

  await app.node("beta").press("Shift+Tab");
  await expect
    .poll(() => alpha.evaluate((node) => node.matches(":focus-visible")))
    .toBe(true);
  await expect.poll(() => computedOpacity(alpha)).toBe("0.73");

  await app.page.mouse.move(center.x, center.y);
  await app.page.mouse.down();
  await expect.poll(() => computedOpacity(alpha)).toBe("0.64");
  await app.page.mouse.up();
  await expect.poll(clicks).toBe(2);

  await expect(app.node("gamma")).toBeDisabled();
  await expect.poll(() => computedOpacity(app.node("gamma"))).toBe("0.55");
});
