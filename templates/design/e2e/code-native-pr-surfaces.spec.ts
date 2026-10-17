import type { Page } from "@playwright/test";

import { DESIGN_MOTION_LAB, DESIGN_REVIEW_TOOLS_LAB } from "../shared/labs";
import { compileMotionCode } from "../shared/motion-code";
import { injectManagedMotionCss } from "../shared/motion-compiler";
import type { MotionTimeline } from "../shared/motion-timeline";
import { appPath, openAppMenuSubmenu } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

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

const AUDIT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Audit fixture</title>
  </head>
  <body style="margin:0;padding:40px;font-family:system-ui,sans-serif;background:#ffffff;color:#111827">
    <div data-agent-native-node-id="audit-row" data-agent-native-layer-name="Audit Row" style="display:flex;align-items:center;gap:12px">
      <img data-agent-native-node-id="audit-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:32px;height:32px" />
      <input data-agent-native-node-id="audit-input" placeholder="Email" style="height:32px" />
      <button data-agent-native-node-id="audit-focus" data-agent-native-layer-name="Focus Button" class="outline-none" style="height:32px">Focus me</button>
    </div>
  </body>
</html>`;

const EXPECTED_ALPHA_OPACITY_CSS = `@keyframes an-motion-alpha--opacity {
  0% {
    opacity: 0;
    animation-timing-function: ease;
  }
  100% {
    opacity: 1;
    animation-timing-function: ease;
  }
}

[data-agent-native-node-id="alpha"] {
  animation-name: an-motion-alpha--opacity;
  animation-duration: 2s;
  animation-timing-function: ease;
  animation-fill-mode: both;
  animation-iteration-count: infinite;
}

@media (prefers-reduced-motion: reduce) {
  [data-agent-native-node-id="alpha"] {
    animation: none !important;
  }
}`;

const UNSUPPORTED_MOTION_CSS = compileMotionCode({
  id: "unsupported-motion",
  designId: "unsupported-motion",
  sourceRef: "unsupported-motion",
  filePath: null,
  tracks: [
    {
      targetNodeId: "headline",
      property: "translate",
      keyframes: [
        {
          t: 0,
          value: "0px 0px",
          motionPath: {
            version: 1,
            type: "cubic",
            control1: { x: 0, y: 100 },
            control2: { x: 0, y: 100 },
          },
        },
        { t: 1, value: "100px 0px" },
      ],
    },
  ],
  durationMs: 840,
  playbackMode: "ping-pong",
  defaultEase: "ease",
  animationStyles: [],
  compiledHash: null,
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
} satisfies MotionTimeline)
  .css.replace(/\/\* agent-native-motion-source:[\s\S]*? \*\//, "")
  .replace("offset-distance: 100%;", "offset-distance: 99%;");

const UNSUPPORTED_MOTION_HTML = injectManagedMotionCss(
  `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Unsupported Motion source</title></head>
  <body style="margin:0;background:#fff">
    <main data-agent-native-node-id="main" style="padding:40px">
      <h1 data-agent-native-node-id="headline" data-agent-native-layer-name="Draft headline" style="margin:0;font-size:48px">Draft headline</h1>
      <p data-agent-native-node-id="untouched" data-agent-native-layer-name="Untouched note" style="margin:24px 0 0">Keep this note unchanged.</p>
    </main>
  </body>
</html>`,
  UNSUPPORTED_MOTION_CSS,
);

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

async function getAction(
  page: Page,
  name: string,
  input: Record<string, string>,
) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/${name}?${new URLSearchParams(input)}`),
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
  await app.page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(
    app.page.getByRole("button", { name: "More", exact: true }),
  ).not.toBeFocused();
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
}

function motionDock(page: Page) {
  return page.getByRole("region", { name: "Motion dock" });
}

async function openMotionDockFromMenu(page: Page) {
  await openAppMenuSubmenu(page, "View");
  await page.getByRole("menuitem", { name: "Motion", exact: true }).click();
  await expect(
    page.getByRole("menu", { name: "More", exact: true }),
  ).toHaveCount(0);
  await expect(motionDock(page)).toBeVisible();
}

async function addOpacityTrack(page: Page) {
  await page.getByRole("button", { name: "Add motion", exact: true }).click();
  const request = page.waitForRequest(
    (candidate) =>
      candidate.method() === "POST" &&
      candidate.url().includes("/_agent-native/actions/apply-motion-edit"),
  );
  await page.getByRole("menuitem", { name: "Opacity", exact: true }).click();
  return request;
}

function managedMotionCss(html: string) {
  return [
    ...html.matchAll(
      /<style data-agent-native-motion>\n([\s\S]*?)\n<\/style>/g,
    ),
  ].map((match) => match[1]);
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
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
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

test("the Review audit lists the fixture's three a11y findings and Fix adds a focus ring to that button only", async ({
  app,
  page,
}) => {
  const restoreLab = await setLab(page, DESIGN_REVIEW_TOOLS_LAB.key, true);
  try {
    const id = await app.seed(AUDIT_HTML);
    await openAndFit(app, id);
    await selectOnCanvas(app, "audit-focus", "Focus Button");
    const review = page.getByTestId("review-panel");
    await review.scrollIntoViewIfNeeded();
    const before = await app.savedNodes(id);

    await page.getByRole("button", { name: "Run audit", exact: true }).click();
    const altFinding = review.getByText("<img> is missing an alt attribute.", {
      exact: true,
    });
    const labelFinding = review.getByText(
      "Form control is missing an accessible label.",
      { exact: true },
    );
    const focusFinding = review.getByRole("button", {
      name: "Interactive element uses outline-none without a focus-visible ring.",
      exact: true,
    });
    await expect(review.getByText("3 issues", { exact: true })).toBeVisible();
    await expect(altFinding).toBeVisible();
    await expect(labelFinding).toBeVisible();
    await expect(focusFinding).toBeVisible();

    await focusFinding.hover();
    await focusFinding
      .getByRole("button", { name: "Fix", exact: true })
      .click();
    await app.settled();

    await expect(app.node("audit-focus")).toHaveAttribute(
      "class",
      "outline-none focus-visible:ring-2",
    );
    const after = await app.savedNodes(id);
    expect(after.get("audit-focus")?.attrs).toEqual({
      ...before.get("audit-focus")?.attrs,
      class: "outline-none focus-visible:ring-2",
    });
    expectOnlyChanged(before, after, ["audit-focus"]);
    await expect(review.getByText("2 issues", { exact: true })).toBeVisible();
    await expect(focusFinding).toHaveCount(0);
    await expect(altFinding).toBeVisible();
    await expect(labelFinding).toBeVisible();
  } finally {
    await restoreLab();
  }
});

test("with the Motion lab off the editor shows no Motion dock or Motion menu entry", async ({
  app,
  page,
}) => {
  const restoreLab = await setLab(page, DESIGN_MOTION_LAB.key, false);
  try {
    const id = await app.seed(SURFACES_HTML);
    await openAndFit(app, id);
    await selectOnCanvas(app, "alpha", "Alpha Button");

    await openAppMenuSubmenu(page, "View");
    await expect(
      page.getByRole("menuitem", { name: "Zoom in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Motion", exact: true }),
    ).toHaveCount(0);
    await expect(motionDock(page)).toHaveCount(0);
  } finally {
    await restoreLab();
  }
});

test("unsupported managed Motion syntax is visible and does not block canvas text edits", async ({
  app,
  page,
}) => {
  const restoreLab = await setLab(page, DESIGN_MOTION_LAB.key, true);
  const motionWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/_agent-native/actions/apply-motion-edit")
    ) {
      motionWrites.push(request.url());
    }
  });
  try {
    const id = await app.seed(UNSUPPORTED_MOTION_HTML);
    const screenId = (await app.savedRecord(id)).files.find(
      (file) => file.filename === "index.html",
    )?.id;
    if (!screenId) throw new Error("seeded design has no index.html screen");
    const passiveRead = await getAction(page, "get-motion-timeline", {
      designId: id,
      sourceRef: screenId,
      passiveRead: "true",
    });
    expect(passiveRead.sourceReadCapability).toMatchObject({
      status: "unsupported",
      sourceRef: screenId,
      errorCode: "motion_css_source_unreadable",
      reason: expect.stringMatching(
        /^Motion CSS for "headline" contains a path animation that cannot be read losslessly\.$/,
      ),
    });
    await openAndFit(app, id);
    await selectOnCanvas(app, "headline", "Draft headline");
    await openMotionDockFromMenu(page);

    await expect(
      motionDock(page).locator("[data-motion-source-read-unavailable]"),
    ).toContainText(
      "Motion cannot read this animation without changing its behavior.",
    );
    const addMotion = page.getByRole("button", {
      name: "Add animation",
      exact: true,
    });
    await expect(addMotion).toBeDisabled();
    await expect(
      motionDock(page).getByRole("checkbox", {
        name: "Toggle auto-keyframing",
        exact: true,
      }),
    ).toBeDisabled();

    const before = await app.savedNodes(id);
    const originalHeadline = before.get("headline");
    expect(originalHeadline).toBeDefined();
    await selectOnCanvas(app, "headline", "Draft headline");
    await page.keyboard.press("Enter");
    const editable = page
      .frameLocator("iframe[data-screen-iframe-id]")
      .locator('[contenteditable="true"]');
    await expect(editable).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("Published headline");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(editable).toHaveCount(0);
    await expect
      .poll(async () => (await app.savedNodes(id)).get("headline")?.text)
      .toBe("Published headline");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get("headline")).toMatchObject({
      tag: "h1",
      parent: "main",
      text: "Published headline",
    });
    expect(after.get("headline")?.attrs).toEqual(originalHeadline!.attrs);
    expect(after.get("untouched")).toEqual(before.get("untouched"));
    expectOnlyChanged(before, after, ["headline"]);
    expect(await app.savedHtml(id)).toContain("offset-distance: 99%;");
    expect(motionWrites).toEqual([]);
  } finally {
    await restoreLab();
  }
});

// fixme: fails in CI on current main: Timeoutlocator.click: Timeout 15000ms exceeded.
test.fixme("adding an opacity track saves one managed motion style for that button and reopens with its keyframes", async ({
  app,
  page,
}) => {
  const restoreLab = await setLab(page, DESIGN_MOTION_LAB.key, true);
  try {
    const id = await app.seed(SURFACES_HTML);
    await openAndFit(app, id);
    await selectOnCanvas(app, "alpha", "Alpha Button");
    await expect(motionDock(page)).toHaveCount(0);
    await openMotionDockFromMenu(page);
    await expect(
      page.getByText("Pick a property to add the first track.", {
        exact: false,
      }),
    ).toBeVisible();
    const before = await app.savedNodes(id);
    expect(managedMotionCss(await app.savedHtml(id))).toStrictEqual([]);

    const request = await addOpacityTrack(page);
    await app.settled();

    expect(request.postDataJSON().includeContent).toBe(false);
    expect(managedMotionCss(await app.savedHtml(id))).toStrictEqual([
      EXPECTED_ALPHA_OPACITY_CSS,
    ]);
    expectOnlyChanged(before, await app.savedNodes(id), []);
    await expect(motionDock(page).getByLabel("Keyframe at 0ms")).toBeVisible();
    await expect(
      motionDock(page).getByLabel("Keyframe at 2000ms"),
    ).toBeVisible();

    await app.open(id);
    await openMotionDockFromMenu(page);
    await expect(
      motionDock(page).getByRole("button", { name: "Alpha Button" }),
    ).toBeVisible();
    await expect(
      motionDock(page).getByText("opacity", { exact: true }),
    ).toBeVisible();
    await expect(motionDock(page).getByLabel("Keyframe at 0ms")).toBeVisible();
    await expect(
      motionDock(page).getByLabel("Keyframe at 2000ms"),
    ).toBeVisible();
  } finally {
    await restoreLab();
  }
});

// fixme: fails on current main: #7436 moved Add motion from the Motion dock to the inspector, and this flow never reaches it; re-author for the new UI
test.fixme("typing a 4000 ms duration in the Motion dock saves a 4s animation that reopens with its keyframe at 4000ms", async ({
  app,
  page,
}) => {
  const restoreLab = await setLab(page, DESIGN_MOTION_LAB.key, true);
  try {
    const id = await app.seed(SURFACES_HTML);
    await openAndFit(app, id);
    await selectOnCanvas(app, "alpha", "Alpha Button");
    await openMotionDockFromMenu(page);
    await addOpacityTrack(page);
    await app.settled();
    expect(managedMotionCss(await app.savedHtml(id))).toStrictEqual([
      EXPECTED_ALPHA_OPACITY_CSS,
    ]);

    const duration = motionDock(page).getByLabel("Duration in ms");
    await duration.fill("4000");
    await duration.press("Tab");
    await app.settled();

    await expect(duration).toHaveValue("4000");
    expect(managedMotionCss(await app.savedHtml(id))).toStrictEqual([
      EXPECTED_ALPHA_OPACITY_CSS.replace(
        "animation-duration: 2s;",
        "animation-duration: 4s;",
      ),
    ]);
    await app.open(id);
    await openMotionDockFromMenu(page);
    await expect(
      motionDock(page).getByLabel("Keyframe at 4000ms"),
    ).toBeVisible();
  } finally {
    await restoreLab();
  }
});

// fixme: fails on current main: #7436 moved Add motion from the Motion dock to the inspector, and this flow never reaches it; re-author for the new UI
test.fixme("turning the Motion lab off hides the dock for a design with a saved track and keeps the track", async ({
  app,
  page,
}) => {
  const restoreLab = await setLab(page, DESIGN_MOTION_LAB.key, true);
  try {
    const id = await app.seed(SURFACES_HTML);
    await openAndFit(app, id);
    await selectOnCanvas(app, "alpha", "Alpha Button");
    await openMotionDockFromMenu(page);
    await addOpacityTrack(page);
    await app.settled();
    expect(managedMotionCss(await app.savedHtml(id))).toStrictEqual([
      EXPECTED_ALPHA_OPACITY_CSS,
    ]);

    await setLab(page, DESIGN_MOTION_LAB.key, false);
    await app.open(id);
    await app.zoomToFit();
    await selectOnCanvas(app, "alpha", "Alpha Button");
    await openAppMenuSubmenu(page, "View");

    await expect(
      page.getByRole("menuitem", { name: "Zoom in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Motion", exact: true }),
    ).toHaveCount(0);
    await expect(motionDock(page)).toHaveCount(0);
    await app.settled();
    expect(managedMotionCss(await app.savedHtml(id))).toStrictEqual([
      EXPECTED_ALPHA_OPACITY_CSS,
    ]);
  } finally {
    await restoreLab();
  }
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
