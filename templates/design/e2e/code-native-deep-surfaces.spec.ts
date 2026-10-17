import { type Page } from "@playwright/test";

import { FIXTURE_HTML } from "./global-setup";
import {
  appPath,
  designFrame,
  gotoEditor,
  resetPersistedCanvasState,
  selectByText,
} from "./helpers";
import { childrenOf, expect, expectOnlyChanged, test, type App } from "./rails";

const DEEP_FIXTURE_HTML = FIXTURE_HTML.replace(
  '      <div style="display:flex;align-items:center;gap:12px">',
  [
    "      <button",
    '        data-agent-native-node-id="e2e-widget-button"',
    '        data-agent-native-layer-name="E2E Widget Button"',
    '        data-agent-native-component="E2EWidget"',
    '        data-agent-native-prop-disabled="false"',
    '        data-agent-native-prop-label="Initial label"',
    '        style="align-self:flex-start;padding:12px 24px;border-radius:10px;border:1px solid #94a3b8;background:#f8fafc;color:#0f172a;font-size:15px"',
    "      >Widget Surface</button>",
    '      <div style="display:flex;align-items:center;gap:12px">',
  ].join("\n"),
);

const LINKED_FIXTURE_HTML = DEEP_FIXTURE_HTML.replace(
  "    <style>",
  '    <link rel="stylesheet" href="theme.css" />\n    <style>',
);
const THEME_CSS =
  ".deep-export-sentinel{outline:2px solid #0ea5e9}.deep-export-extra{color:#047857}";

const SECONDARY_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>E2E Secondary Clean</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a">
    <main style="padding:48px">
      <h1>Clean secondary file</h1>
      <img alt="Decorative mark" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
      <label>Email <input type="email" /></label>
      <button class="focus-visible:ring-2 focus-visible:ring-offset-2">Focusable clean control</button>
    </main>
  </body>
</html>`;

async function postAction(
  page: Page,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${actionName}`),
    { data: input },
  );
  expect(
    response.ok(),
    `${actionName} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response.json();
}

async function getAction(
  page: Page,
  actionName: string,
  input: Record<string, string>,
): Promise<any> {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/${actionName}?${new URLSearchParams(input)}`,
    ),
  );
  expect(
    response.ok(),
    `${actionName} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return response.json();
}

async function waitForAction(
  page: Page,
  actionName: string,
  trigger: () => Promise<void>,
): Promise<any> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/_agent-native/actions/${actionName}`) &&
      response.request().method() !== "OPTIONS",
  );
  await trigger();
  const response = await responsePromise;
  expect(response.ok(), `${actionName} failed: ${response.status()}`).toBe(
    true,
  );
  return response.json();
}

/** index.html (deep fixture), secondary.html and theme.css, with components indexed. */
async function seedDeep(app: App, indexHtml = DEEP_FIXTURE_HTML) {
  const designId = await app.seed(indexHtml, {
    title: "E2E Code-Native Deep Surfaces",
    files: { "secondary.html": SECONDARY_HTML },
  });
  await postAction(app.page, "create-file", {
    designId,
    filename: "theme.css",
    content: THEME_CSS,
    fileType: "css",
  });
  await postAction(app.page, "index-components", { designId });
  const fileId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  return { designId, fileId };
}

async function openDeep(app: App) {
  const ids = await seedDeep(app);
  await app.open(ids.designId);
  return ids;
}

async function fileRecord(app: App, designId: string, fileId: string) {
  const file = (await app.savedRecord(designId)).files.find(
    (candidate) => candidate.id === fileId,
  )!;
  return file as {
    id: string;
    filename: string;
    content: string;
    updatedAt?: string | null;
  };
}

function alphaBackgroundImage(page: Page, fileId: string) {
  return page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
    )
    .contentFrame()
    .locator('[data-agent-native-node-id="e2e-alpha-button"]')
    .evaluate((el) => window.getComputedStyle(el).backgroundImage);
}

// fixme: product bug: The canvas requests /design/theme.css from the app origin, gets HTML back, and Chrome refuses it (MIME text/html), so design CSS files
test.fixme("a screen's linked design stylesheet applies on the canvas", async ({
  app,
}) => {
  const { designId, fileId } = await seedDeep(
    app,
    LINKED_FIXTURE_HTML.replace(
      'data-agent-native-node-id="e2e-alpha-button"',
      'data-agent-native-node-id="e2e-alpha-button" class="deep-export-sentinel"',
    ),
  );
  await app.open(designId);

  await expect(
    designFrame(app.page, fileId).locator(
      '[data-agent-native-node-id="e2e-alpha-button"]',
    ),
  ).toHaveCSS("outline", "rgb(14, 165, 233) solid 2px");
});

// fixme: product bug: Inspect code shows editor-internal markup: <button><span data-an-text="">Alpha Button</span></button> (line 124).
test.fixme("Inspect Code shows copyable selected HTML content", async ({
  app,
}) => {
  const page = app.page;
  const { fileId } = await openDeep(app);
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await page.getByRole("button", { name: "Inspect code", exact: true }).click();

  const inspectCode = page
    .locator("pre")
    .filter({ hasText: "<button>" })
    .first();
  await expect(inspectCode).toHaveText(
    /^\s*<button>\s*Alpha Button\s*<\/button>\s*$/,
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).trim(),
  ).toBe((await inspectCode.textContent())!.trim());
});

test("component boolean and text prop controls persist through reload", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileId } = await openDeep(app);
  await selectByText(page, "Widget Surface", { screenId: fileId });
  const componentSection = page.getByTestId("component-section");
  await expect(componentSection).toContainText("E2EWidget");
  const before = await app.savedNodes(designId);
  const widget = () =>
    designFrame(page, fileId).locator(
      '[data-agent-native-node-id="e2e-widget-button"]',
    );

  await waitForAction(page, "apply-component-prop-edit", async () => {
    await componentSection
      .getByRole("switch", { name: "disabled", exact: true })
      .click();
  });
  await expect(widget()).toHaveAttribute(
    "data-agent-native-prop-disabled",
    "true",
  );
  const labelInput = componentSection.locator("input").first();
  await expect(labelInput).toHaveValue("Initial label");
  await labelInput.fill("Updated label");
  await waitForAction(page, "apply-component-prop-edit", async () => {
    await labelInput.press("Enter");
  });
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(after.get("e2e-widget-button")?.attrs).toEqual({
    ...before.get("e2e-widget-button")?.attrs,
    "data-agent-native-prop-disabled": "true",
    "data-agent-native-prop-label": "Updated label",
  });
  expectOnlyChanged(before, after, ["e2e-widget-button"]);

  await gotoEditor(page, designId);
  await selectByText(page, "Widget Surface", { screenId: fileId });
  await expect(widget()).toHaveAttribute(
    "data-agent-native-prop-disabled",
    "true",
  );
  await expect(widget()).toHaveAttribute(
    "data-agent-native-prop-label",
    "Updated label",
  );
  await expect(
    page.getByTestId("component-section").locator("input").first(),
  ).toHaveValue("Updated label");
});

test("component duplicate preserves instance identity through undo and redo", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileId } = await openDeep(app);
  await selectByText(page, "Widget Surface", { screenId: fileId });
  const before = await app.savedNodes(designId);
  const parent = before.get("e2e-widget-button")!.parent!;
  const instancesOf = (nodes: typeof before) =>
    childrenOf(nodes, parent).filter(
      (id) =>
        nodes.get(id)?.attrs["data-agent-native-component"] === "E2EWidget",
    );
  expect(instancesOf(before)).toStrictEqual(["e2e-widget-button"]);

  await page.keyboard.press("ControlOrMeta+d");
  await app.settled();
  const duplicated = await app.savedNodes(designId);
  const [original, copy] = instancesOf(duplicated);
  expect(original).toBe("e2e-widget-button");
  expect(copy).not.toBe("e2e-widget-button");
  expect(childrenOf(duplicated, parent).indexOf(copy)).toBe(
    childrenOf(duplicated, parent).indexOf(original) + 1,
  );
  const { "data-agent-native-node-id": _copyId, ...copyAttrs } =
    duplicated.get(copy)!.attrs;
  const { "data-agent-native-node-id": _originalId, ...originalAttrs } =
    duplicated.get(original)!.attrs;
  expect(copyAttrs).toEqual(originalAttrs);

  await page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  const undone = await app.savedNodes(designId);
  expect(instancesOf(undone)).toStrictEqual(["e2e-widget-button"]);
  expectOnlyChanged(before, undone, []);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  const redone = await app.savedNodes(designId);
  expect(instancesOf(redone)).toStrictEqual(["e2e-widget-button", copy]);
  expectOnlyChanged(duplicated, redone, []);
});

test("run-design-audit scopes findings to the requested file", async ({
  app,
}) => {
  const { designId, fileId } = await seedDeep(app);
  const messages = (result: { findings: { message: string }[] }) =>
    result.findings.map((finding) => finding.message);

  const noisy = await postAction(app.page, "run-design-audit", {
    designId,
    fileId,
  });
  expect(messages(noisy)).toContain("<img> is missing an alt attribute.");

  const clean = await postAction(app.page, "run-design-audit", {
    designId,
    filename: "secondary.html",
  });
  expect(clean.filename).toBe("secondary.html");
  expect(
    messages(clean).filter((message) =>
      /missing an alt attribute|missing an accessible label/.test(message),
    ),
  ).toStrictEqual([]);
});

// Overview renders multiple DesignCanvas instances, but the preview belongs to the active screen.
test("a shader preview from the deep-linked Tools panel reaches the active overview screen without saving", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileId } = await seedDeep(app);
  // The Tools panel has no rail button; ?panel=tools is its only UI entry point.
  await resetPersistedCanvasState(page);
  await page.goto(appPath(`/design/${designId}?panel=tools`), {
    waitUntil: "domcontentloaded",
  });
  await selectByText(page, "Alpha Button", { screenId: fileId });
  await expect.poll(() => alphaBackgroundImage(page, fileId)).toBe("none");
  const before = await app.savedNodes(designId);

  await page.getByRole("button", { name: /Shader Fills/ }).click();
  await page.getByRole("button", { name: "Browse Shaders" }).click();
  await page.getByRole("button", { name: "Mesh Gradient" }).click();
  await expect
    .poll(() => alphaBackgroundImage(page, fileId))
    .toMatch(/(?:linear|radial|conic)-gradient/);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(designId), []);

  await gotoEditor(page, designId);
  await expect.poll(() => alphaBackgroundImage(page, fileId)).toBe("none");
});

test("apply-shader-fill persists over pending content, re-applies, and refuses a stale revision", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileId } = await seedDeep(app);
  const source = await fileRecord(app, designId, fileId);
  expect(source.updatedAt).toEqual(expect.any(String));
  const pendingSentinel = "<!-- shader-current-content-sentinel -->";
  const applied = await postAction(page, "apply-shader-fill", {
    descriptor: { preset: "MeshGradient" },
    target: { nodeId: "e2e-alpha-button" },
    source: {
      kind: "design-file",
      designId,
      fileId,
      revision: source.updatedAt,
      currentContent: source.content.replace(
        "</body>",
        `${pendingSentinel}\n  </body>`,
      ),
    },
  });
  expect(applied).toMatchObject({
    ok: true,
    persisted: true,
    updatedAt: expect.any(String),
  });
  expect(applied.updatedAt).not.toBe(source.updatedAt);

  await app.open(designId);
  await expect
    .poll(() => alphaBackgroundImage(page, fileId))
    .toMatch(/(?:linear|radial|conic)-gradient/);
  const saved = (await fileRecord(app, designId, fileId)).content;
  expect(saved.trimStart().startsWith("<!doctype html>")).toBe(true);
  expect(saved).toContain(pendingSentinel);
  expect(saved).toMatch(
    /data-agent-native-node-id="e2e-alpha-button"[\s\S]*background:\s*(?:linear|radial|conic)-gradient/,
  );

  const sameTabSentinel = "<!-- shader-same-tab-second-apply -->";
  const secondApplied = await postAction(page, "apply-shader-fill", {
    descriptor: { preset: "MeshGradient", rotation: 0.2 },
    target: { nodeId: "e2e-alpha-button" },
    source: {
      kind: "design-file",
      designId,
      fileId,
      revision: applied.updatedAt,
      currentContent: saved.replace("</body>", `${sameTabSentinel}\n  </body>`),
    },
  });
  expect(secondApplied).toMatchObject({
    ok: true,
    persisted: true,
    updatedAt: expect.any(String),
  });
  expect(secondApplied.updatedAt).not.toBe(applied.updatedAt);
  expect((await fileRecord(app, designId, fileId)).content).toContain(
    sameTabSentinel,
  );

  const stale = await fileRecord(app, designId, fileId);
  const staleTabSentinel = "<!-- shader-stale-tab-sentinel -->";
  const concurrentSaveSentinel = "<!-- shader-concurrent-save-sentinel -->";
  await postAction(page, "update-file", {
    id: fileId,
    content: stale.content.replace(
      "</body>",
      `${concurrentSaveSentinel}\n  </body>`,
    ),
  });
  const conflict = await postAction(page, "apply-shader-fill", {
    descriptor: { preset: "MeshGradient" },
    target: { nodeId: "e2e-alpha-button" },
    source: {
      kind: "design-file",
      designId,
      fileId,
      revision: stale.updatedAt,
      currentContent: stale.content.replace(
        "</body>",
        `${staleTabSentinel}\n  </body>`,
      ),
    },
  });
  expect(conflict).toMatchObject({
    ok: false,
    persisted: false,
    conflict: true,
  });
  expect(conflict.error).toContain(
    "changed since this shader fill was previewed",
  );
  const afterConflict = (await fileRecord(app, designId, fileId)).content;
  expect(afterConflict).toContain(concurrentSaveSentinel);
  expect(afterConflict).not.toContain(staleTabSentinel);
});

test("repeated motion writes replace the managed CSS block instead of duplicating", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileId } = await seedDeep(app);
  const pendingSentinel = "<!-- motion-current-content-sentinel -->";
  const source = await fileRecord(app, designId, fileId);
  const first = await postAction(page, "apply-motion-edit", {
    designId,
    fileId,
    currentContent: source.content.replace(
      "</body>",
      `${pendingSentinel}\n  </body>`,
    ),
    revision: source.updatedAt,
    tracks: [
      {
        targetNodeId: "e2e-alpha-button",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0.2" },
          { t: 1, value: "1" },
        ],
      },
    ],
    durationMs: 300,
    defaultEase: "ease",
  });
  expect(first.persisted).toBe(true);

  const afterFirst = await fileRecord(app, designId, fileId);
  const second = await postAction(page, "apply-motion-edit", {
    designId,
    fileId,
    timelineId: first.timelineId,
    currentContent: afterFirst.content,
    revision: afterFirst.updatedAt,
    tracks: [
      {
        targetNodeId: "e2e-alpha-button",
        property: "transform",
        keyframes: [
          { t: 0, value: "translateY(12px)" },
          { t: 1, value: "translateY(0)" },
        ],
      },
    ],
    durationMs: 640,
    defaultEase: "ease-out",
    includeContent: true,
  });
  expect(second.persisted).toBe(true);
  const saved = (await fileRecord(app, designId, fileId)).content;
  expect(saved).toBe(second.patchedContent);
  expect(saved.match(/<style\s+data-agent-native-motion\b/g)).toHaveLength(1);
  expect(saved).toContain("animation-duration: 0.64s");
  expect(saved).toContain("an-motion-e2e-alpha-button--transform");
  expect(saved).not.toContain("an-motion-e2e-alpha-button--opacity");
  expect(saved).toContain(pendingSentinel);

  await app.open(designId);
  const motionStyles = designFrame(page, fileId).locator(
    "style[data-agent-native-motion]",
  );
  await expect(motionStyles).toHaveCount(1);
  await expect
    .poll(() => motionStyles.textContent())
    .toContain("animation-duration: 0.64s");
});

test("export actions include multi-file content across HTML, SVG, ZIP, and PDF payloads", async ({
  app,
}) => {
  const page = app.page;
  const { designId } = await seedDeep(app, LINKED_FIXTURE_HTML);
  const html = await postAction(page, "export-html", { id: designId });
  expect(html.fileCount).toBe(3);
  expect(html.html).toContain("Clean secondary file");
  expect(html.html).toContain("deep-export-sentinel");
  expect(html.filename).toMatch(/E2E-Code-Native-Deep-Surfaces-\d+\.html/);

  const svg = await postAction(page, "export-svg", {
    id: designId,
    width: 800,
    height: 600,
  });
  expect(svg.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(svg.svg).toContain('<foreignObject width="800" height="600">');
  expect(svg.svg).toContain("Clean secondary file");

  await postAction(page, "create-file", {
    designId,
    filename: "README.md",
    content: "User-authored README sentinel",
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId,
    filename: "design-data.json",
    content: "User-authored design data sentinel",
    fileType: "asset",
  });

  const zip = await postAction(page, "export-zip", { id: designId });
  expect(zip.fileCount).toBe(5);
  const JSZip = (await import("jszip")).default;
  const archive = await JSZip.loadAsync(Buffer.from(zip.zipBase64, "base64"));
  expect(
    Object.keys(archive.files)
      .filter((name) => !name.endsWith("/"))
      .sort(),
  ).toStrictEqual([
    "README.md",
    "agent-native-metadata/README.md",
    "agent-native-metadata/design-data.json",
    "design-data.json",
    "index.html",
    "secondary.html",
    "theme.css",
  ]);
  expect(await archive.file("index.html")?.async("string")).toContain(
    "theme.css",
  );
  expect(await archive.file("README.md")?.async("string")).toBe(
    '<style data-agent-native-export-hidden>[data-agent-native-hidden="true"]{display:none!important}</style>\nUser-authored README sentinel',
  );
  expect(await archive.file("design-data.json")?.async("string")).toBe(
    "User-authored design data sentinel",
  );
  expect(await archive.file("theme.css")?.async("string")).toBe(THEME_CSS);
  expect(
    await archive.file("agent-native-metadata/README.md")?.async("string"),
  ).toContain("E2E Code-Native Deep Surfaces");

  const pdf = await getAction(page, "export-pdf", { id: designId });
  expect(pdf.exportInfo.format).toBe("pdf");
  expect(pdf.exportInfo.note).toContain("single-page raster PDF");
  expect(pdf.exportInfo.note).toContain(
    "does not provide selectable/vector text",
  );
  expect(pdf.files.map((file: { filename: string }) => file.filename)).toEqual(
    expect.arrayContaining(["index.html", "secondary.html", "theme.css"]),
  );
});
