import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type Locator, type Page } from "playwright";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = path.join(root, ".tmp/design-fidelity/current");
const base = process.argv[2] ?? "http://127.0.0.1:6006";
const viewport = { width: 1440, height: 900 };
const stories = {
  workspace: "patterns-editor-workspace--design",
  file: "patterns-design-file-panel--design",
  inspector: "patterns-design-property-inspector--nav",
};
type Panel = "file" | "inspector";
type Surface = "prototype" | "standalone" | "workspace";
const sections = [
  "Position",
  "Layout",
  "Appearance",
  "Fill",
  "Stroke",
  "Effects",
  "Responsive",
  "Export",
];

async function story(
  page: Page,
  id: string,
  globals = "theme:design;appearance:light",
) {
  const url = new URL("iframe.html", base);
  url.search = new URLSearchParams({
    id,
    viewMode: "story",
    globals,
  }).toString();
  await page.goto(url.href);
  await page
    .locator(".design-file-panel, .design-property-inspector")
    .first()
    .waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function bounds(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Missing element geometry: " + locator);
  return rect;
}

async function checkPanelGrid(page: Page, prototype: Page) {
  const inspector = page.locator(".design-property-inspector");
  const handle = page.getByRole("separator", {
    name: "Properties panel width",
  });
  for (const [travel, expected] of [
    [13, 296],
    [-55, 280],
    [65, 344],
    [96, 400],
  ]) {
    const grip = await bounds(handle);
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - travel, y);
    await page.mouse.up();
    const panel = await bounds(inspector);
    assert.equal(panel.width, expected);
    await prototype.evaluate(`setInspW(${expected})`);
    const [source, rendered] = await Promise.all([
      sample(prototype, "inspector", "prototype", "nav", "-" + expected),
      sample(page, "inspector", "workspace", "nav", "-" + expected),
    ]);
    assert.equal(source.width, expected);
    checkInspectorTracks(source, rendered);

    for (const [index, label] of [
      "X",
      "Y",
      "Width",
      "Height",
      "Opacity",
      "Corner radius",
    ].entries()) {
      const box = await bounds(
        inspector.locator(".input").filter({
          has: page.getByRole("textbox", { name: label, exact: true }),
        }),
      );
      const fieldWidth = (expected - 72) / 2;
      assert.equal(box.width, fieldWidth, label + " track width");
      assert.equal(
        box.x - panel.x,
        16 + (index % 2) * (fieldWidth + 8),
        label + " column",
      );
    }
    for (const name of [
      "Auto layout",
      "Lock aspect ratio",
      "Corner radius settings",
      "Add fill",
      "Remove fill Solid 1",
      "Constraints",
      "Export settings",
    ]) {
      const box = await bounds(
        inspector.getByRole("button", { name, exact: true }),
      );
      assert.equal(
        box.x + box.width / 2,
        panel.x + expected - 24,
        name + " center",
      );
    }
    await expanded(page);
    await inspector
      .getByRole("button", { name: "Auto layout", exact: true })
      .click();
  }
  await handle.press("ArrowRight");
  assert.equal((await bounds(inspector)).width, 392);
  const file = page.locator(".design-file-panel");
  const fileHandle = page.getByRole("separator", {
    name: "Layers panel width",
  });
  const search = file.getByRole("button", { name: "Search layers" });
  await search.click();
  for (const width of [320, 328]) {
    const panel = await bounds(file);
    assert.equal(panel.width, width);
    for (const selector of [
      ".design-file-panel-tabs",
      ".design-file-panel-tools .input",
    ]) {
      const box = await bounds(file.locator(selector));
      assert.equal(box.x - panel.x, 16);
      assert.equal(box.width, width - 32);
    }
    for (const [index, part] of ["disclosure", "icon", "label"].entries()) {
      const box = await bounds(
        file
          .locator('.layer-tree-row[aria-level="1"] .layer-tree-' + part)
          .first(),
      );
      assert.equal(box.x - panel.x, 16 + index * 24);
    }
    const child = await bounds(
      file
        .locator('.layer-tree-row[aria-level="2"] .layer-tree-disclosure')
        .first(),
    );
    assert.equal(child.x - panel.x, 40);
    if (width === 320) await fileHandle.press("ArrowRight");
  }
}

async function sample(
  page: Page,
  panel: Panel,
  surface: Surface,
  state: "nav" | "auto",
  suffix = "",
) {
  const reference = surface === "prototype";
  const host = reference
    ? page.locator(panel === "file" ? ".file-head" : "#insp-head")
    : page.locator(
        panel === "file" ? ".design-file-panel" : ".design-property-inspector",
      );
  const rect = await bounds(host);
  const rows: { name: string; x: number; y: number; height: number }[] = [];
  const controls: {
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }[] = [];
  async function control(name: string, el: Locator) {
    const box = await bounds(el);
    controls.push({
      name,
      x: box.x - rect.x,
      y: box.y - rect.y,
      width: box.width,
      height: box.height,
    });
  }
  if (panel === "inspector") {
    for (const name of sections) {
      const heading = page
        .locator(reference ? "#insp" : ".design-property-inspector")
        .getByRole("heading", { name, exact: true });
      const { y, height } = await bounds(
        heading.locator("xpath=ancestor::section[1]"),
      );
      rows.push({
        name,
        x: (await bounds(heading)).x - rect.x,
        y: y - rect.y,
        height,
      });
    }
    const referenceFields = page.locator("#insp");
    for (const [label, field] of [
      ["X", "Position"],
      ["Y", "Y"],
      ["Width", "Width"],
      ["Height", "Height"],
      ["Rotation", "Rotation"],
      ["Opacity", "Opacity"],
      ["Corner radius", "Corner radius"],
    ]) {
      const el = reference
        ? referenceFields.locator(".field").filter({
            has: page.locator(".flabel", {
              hasText: new RegExp("^" + field + "$"),
            }),
          })
        : host
            .getByRole("textbox", { name: label, exact: true })
            .locator(
              "xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' number-field ')][1]",
            );
      await control(
        label,
        reference && label === "Y"
          ? referenceFields
              .locator(".field")
              .filter({ has: page.locator('input[aria-label="Y"]') })
          : el,
      );
    }
    if (state === "nav") {
      for (const [name, source, actual] of [
        ["Share", "#share-btn", ".workspace-share"],
        [
          "Instance",
          "#insp .kit-seg.ic-seg",
          ".design-property-inspector-instance .segmented-control",
        ],
        [
          "Preview state",
          "#insp .state button",
          ".design-property-inspector-instance .select-trigger",
        ],
        [
          "Alignment X",
          "#insp .segc.disabled",
          '[aria-label="Horizontal alignment"]',
        ],
        [
          "Alignment Y",
          "#insp .c3 .segc.disabled",
          '[aria-label="Vertical alignment"]',
        ],
        ["Transform", "#insp .segc.xf", ".design-property-inspector-transform"],
        ["Fill value", "#insp .fillfield", ".paint-editor-trigger"],
        [
          "Breakpoint",
          "#insp .resp-rule .dd-btn:first-child",
          '[aria-label="Breakpoint"]',
        ],
        [
          "Responsive padding",
          "#insp .resp-rule .dd-btn.change",
          '[aria-label="Responsive padding"]',
        ],
      ]) {
        const node = reference
          ? page.locator(source).first()
          : host.locator(actual);
        await control(name, node);
      }
      for (const [from, to] of [
        ["Constraints", "Constraints"],
        ["Auto layout", "Auto layout"],
        ["Rotate 90° right", "Rotate 90 degrees"],
        ["Flip horizontal", "Flip horizontal"],
        ["Flip vertical", "Flip vertical"],
        ["Lock aspect ratio", "Lock aspect ratio"],
        ["Visible", "Layer visible"],
        ["Blend mode", "Blend mode"],
        ["Independent corners", "Corner radius settings"],
        ["Fill tokens", "Fill styles"],
        ["Add fill", "Add fill"],
        ["Hide fill", "Hide Solid 1"],
        ["Remove fill", "Remove fill Solid 1"],
        ["Stroke tokens", "Stroke styles"],
        ["Add stroke", "Add stroke"],
        ["Shadow tokens", "Effects styles"],
        ["Add effect", "Add effects"],
        ["Add a responsive rule", "Add responsive rule"],
        ["Remove rule", "Remove responsive rule"],
        ["Copy as", "Download layer JSON"],
        ["Add export setting", "Export settings"],
      ]) {
        const node = reference
          ? referenceFields
              .locator(
                `button:is([aria-label="${from}"],[title="${from}"],[data-tip="${from}"])`,
              )
              .first()
          : host.getByRole("button", { name: to, exact: true });
        await control(to, node);
      }
    }
  } else {
    await control(
      "Footer",
      reference ? page.locator(".pan-foot") : host.locator("footer"),
    );
    for (const name of ["Pages", "Layers"]) {
      const region = reference
        ? page
            .locator("#tree .sec-head")
            .filter({ hasText: new RegExp("^" + name + "$") })
        : host
            .locator(".design-file-panel-section-header")
            .filter({ has: page.getByRole("button", { name, exact: true }) });
      await control(name, region);
    }
    for (const name of ["Home", "Docs", "Pricing"]) {
      const region = reference
        ? page
            .locator("#tree [data-screen]")
            .filter({ hasText: new RegExp("^" + name + "$") })
        : host
            .locator(".design-file-panel-pages")
            .getByRole("button", { name, exact: true });
      await control("Page " + name, region);
    }
    const treeitems = reference
      ? page.locator('#tree [data-id][role="treeitem"]')
      : host.getByRole("tree", { name: "Layers" }).getByRole("treeitem");
    for (const item of (await treeitems.all()).slice(0, 18)) {
      const { y, height } = await bounds(item);
      const name = reference
        ? await item.locator(".label").innerText()
        : await item.getAttribute("aria-label");
      if (!name) throw new Error("Layer has no label: " + item);
      const label = item.locator(reference ? ".label" : ".layer-tree-label");
      rows.push({
        name,
        x: (await bounds(label)).x - rect.x,
        y: y - rect.y,
        height,
      });
    }
  }
  const file = surface + "-" + panel + "-" + state + suffix + ".png";
  const height = Math.min(864, Math.floor(viewport.height - rect.y));
  const image = await page.screenshot({
    path: path.join(output, file),
    clip: { x: rect.x, y: rect.y, width: rect.width, height },
    animations: "disabled",
  });
  return { file, rows, controls, width: rect.width, image };
}

function checkInspectorTracks(reference: Capture, actual: Capture) {
  assert.equal(actual.controls.length, reference.controls.length);
  for (const [index, box] of actual.controls.entries()) {
    const expected = reference.controls[index];
    assert.equal(box.name, expected.name);
    for (const key of ["x", "y", "width", "height"] as const)
      assert.ok(
        Math.abs(box[key] - expected[key]) <= 1 / 32,
        `${actual.width}px ${box.name} ${key}: ${box[key]} vs ${expected[key]}`,
      );
  }
}

async function expanded(page: Page) {
  const panel = page.locator(".design-property-inspector");
  const toggle = panel.getByRole("button", {
    name: "Auto layout",
    exact: true,
  });
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  const matrix = panel.getByRole("radiogroup", { name: "Frame alignment" });
  const number = (name: string) =>
    bounds(
      panel.locator(".input").filter({
        has: page.getByRole("textbox", { name, exact: true }),
      }),
    );
  const first = await number("Width"),
    second = await number("Height");
  const matrixBox = await bounds(matrix);
  const flow = await bounds(panel.locator('[aria-label="Layout direction"]'));
  const gapBox = await number("Gap");
  for (const [box, track] of [
    [matrixBox, first],
    [await number("Horizontal padding"), first],
    [flow, second],
    [gapBox, second],
    [await number("Vertical padding"), second],
  ]) {
    assert.equal(box.x, track.x);
    assert.equal(box.width, track.width);
  }
  assert.equal(matrixBox.y, flow.y);
  assert.ok(gapBox.y >= flow.y + flow.height);
  const mark = matrix.getByRole("radio", { name: "Center", exact: true });
  await mark.click();
  assert.equal(await mark.getAttribute("aria-checked"), "true");
  await mark.press("ArrowRight");
  assert.notEqual(await mark.getAttribute("aria-checked"), "true");
  await mark.click();
  await page.mouse.move(740, 1);
}

async function primitives(page: Page, panel: Panel) {
  const selectors =
    panel === "file"
      ? { addPage: '.design-file-panel button[aria-label="Add page"]' }
      : {
          width:
            '.design-property-inspector .number-field:has(input[aria-label="Width"])',
          autoLayout:
            '.design-property-inspector button[aria-label="Auto layout"]',
        };
  const result: Record<
    string,
    { actual: Record<string, string>; shared: Record<string, string> }
  > = {};
  for (const [name, selector] of Object.entries(selectors)) {
    result[name] = await page.locator(selector).evaluate((node) => {
      const stage = node.closest("[data-storybook-stage]");
      if (!stage) throw new Error("No Storybook theme scope.");
      const wrapper = document.createElement("div");
      wrapper.style.cssText =
        "position:fixed;top:0;left:-1000px;display:flex;align-items:center";
      const copy = node.cloneNode(true) as HTMLElement;
      copy.removeAttribute("id");
      copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      wrapper.append(copy);
      stage.append(wrapper);
      try {
        const style = (el: Element) => {
          const s = getComputedStyle(el);
          return {
            height: s.height,
            radius: s.borderTopLeftRadius,
            font: s.fontFamily,
            fontSize: s.fontSize,
            color: s.color,
            padding: getComputedStyle(el.querySelector(".input-slot") ?? el)
              .paddingInlineStart,
            icon:
              el
                .querySelector("svg")
                ?.getBoundingClientRect()
                .width.toString() ?? "",
          };
        };
        return { actual: style(node), shared: style(copy) };
      } finally {
        wrapper.remove();
      }
    });
  }
  return result;
}

type Capture = Awaited<ReturnType<typeof sample>>;
type Shots = Record<Surface, Capture>;
async function comparison(
  page: Page,
  filename: string,
  shots: Shots,
  labels = ["Design prototype", "Standalone pattern", "Editor workspace"],
) {
  await galleryImage(
    page,
    filename,
    Object.values(shots).map((shot, i) => ({ ...shot, label: labels[i] })),
  );
}
async function galleryImage(
  page: Page,
  filename: string,
  panels: { label: string; width: number; image: Buffer }[],
) {
  const figures = panels
    .map(
      (s) =>
        `<figure><figcaption>${s.label}</figcaption><img width="${s.width}" src="data:image/png;base64,${s.image.toString("base64")}"></figure>`,
    )
    .join("");
  await page.setContent(
    `<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:white}main{width:max-content;display:flex;gap:12px;padding:8px}figure{margin:0}img{display:block;border:0;outline:1px solid #ddd}figcaption{font:600 13px/28px system-ui}</style><main>${figures}</main>`,
  );
  await page.locator("main").screenshot({ path: path.join(output, filename) });
}

function deltaRows(ref: Capture, actual: Capture) {
  assert.equal(
    actual.rows.length,
    ref.rows.length,
    "Unexpected layer row count",
  );
  return ref.rows.map((row, i) => {
    const compared = actual.rows[i];
    assert.equal(compared.name, row.name, "Unexpected row at " + i);
    return {
      name: row.name,
      x: compared.x - row.x,
      referenceY: row.y,
      actualY: compared.y,
      y: compared.y - row.y,
      height: compared.height - row.height,
    };
  });
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const pages = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  const [proto, workspace, file, inspector] = pages;
  const errors: string[] = [];
  pages.forEach((p) => p.on("pageerror", (e) => errors.push(e.message)));
  await proto.addInitScript(() => localStorage.setItem("dz-started", "1"));
  await proto.goto(
    pathToFileURL(
      path.resolve(
        process.argv[3] ?? path.join(root, "prototypes/design/dist/index.html"),
      ),
    ).href,
  );
  await proto.evaluate(
    'S.mode="design"; S.selected="nav"; S.multi=[]; S.screenSel=false; render()',
  );
  await proto.locator("#isl-tabs [data-panel=file]").click();
  await Promise.all([
    story(workspace, stories.workspace),
    story(file, stories.file),
    story(inspector, stories.inspector),
  ]);
  await proto.evaluate(() => document.fonts.ready.then(() => undefined));
  await Promise.all(
    [proto, workspace, file, inspector].map((p) => p.mouse.move(740, 1)),
  );
  await proto.locator("#spec-grid-btn").click();
  await proto.locator("#spec-legend").waitFor();
  const referenceGrid = await proto.screenshot({
    path: path.join(output, "prototype-spacing.png"),
    clip: await bounds(proto.locator("#isl-r")),
  });
  await proto.locator("#spec-grid-btn").click();
  await proto.screenshot({ path: path.join(output, "prototype.png") });
  await workspace.screenshot({ path: path.join(output, "workspace.png") });
  const editorHeight =
    viewport.height - (await bounds(proto.locator("#insp-head"))).y;
  await Promise.all(
    [workspace, file, inspector].map((p) =>
      p.setViewportSize({ ...viewport, height: editorHeight }),
    ),
  );
  const capture = async (
    panel: Panel,
    state: "nav" | "auto",
  ): Promise<Shots> => ({
    prototype: await sample(proto, panel, "prototype", state),
    standalone: await sample(
      panel === "file" ? file : inspector,
      panel,
      "standalone",
      state,
    ),
    workspace: await sample(workspace, panel, "workspace", state),
  });
  const fileShots = await capture("file", "nav"),
    inspectorShots = await capture("inspector", "nav");
  await proto
    .locator("#insp")
    .getByRole("button", { name: "Auto layout" })
    .click();
  await expanded(inspector);
  await expanded(workspace);
  const autoShots = await capture("inspector", "auto");
  const gallery = await context.newPage();
  await galleryImage(gallery, "design-panels.png", [
    { ...fileShots.standalone, label: "File" },
    { ...inspectorShots.standalone, label: "Property inspector" },
  ]);
  await story(
    inspector,
    stories.inspector,
    "theme:design;appearance:light;spacing:on",
  );
  await inspector.locator("[data-panel-spacing]").waitFor();
  const panel = await bounds(inspector.locator(".design-property-inspector"));
  const heading = await bounds(
    inspector.locator(".design-property-inspector-selection"),
  );
  const gridImage = await inspector.screenshot({
    clip: {
      x: panel.x,
      y: heading.y,
      width: panel.width,
      height: panel.y + panel.height - heading.y,
    },
  });
  await galleryImage(gallery, "spacing-comparison.png", [
    {
      label: "Design prototype · Spacing",
      width: panel.width,
      image: referenceGrid,
    },
    {
      label: "Storybook · Panel spacing",
      width: panel.width,
      image: gridImage,
    },
  ]);
  await comparison(gallery, "file-comparison.png", fileShots);
  await comparison(gallery, "inspector-comparison.png", inspectorShots);
  await comparison(gallery, "auto-comparison.png", autoShots, [
    "Prototype after Auto layout click",
    "Standalone · Auto layout",
    "Workspace · Auto layout",
  ]);
  const report = Object.fromEntries(
    Object.entries({
      file: fileShots,
      inspector: inspectorShots,
      auto: autoShots,
    }).map(([key, s]) => [
      key,
      {
        prototypeToStandalone: deltaRows(s.prototype, s.standalone),
        standaloneToWorkspace: deltaRows(s.standalone, s.workspace),
        controls: {
          prototype: s.prototype.controls,
          standalone: s.standalone.controls,
          workspace: s.workspace.controls,
        },
        widths: [s.prototype.width, s.standalone.width, s.workspace.width],
      },
    ]),
  );
  await writeFile(
    path.join(output, "geometry.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  for (const [name, shots] of Object.entries({
    file: fileShots,
    inspector: inspectorShots,
    auto: autoShots,
  })) {
    assert.equal(
      shots.prototype.width,
      shots.standalone.width,
      name + " source width",
    );
    assert.equal(
      shots.standalone.width,
      shots.workspace.width,
      name + " workspace width",
    );
    assert.deepEqual(
      shots.standalone.controls,
      shots.workspace.controls,
      name + " standalone controls differ from integrated",
    );
    assert.deepEqual(
      shots.standalone.rows,
      shots.workspace.rows,
      name + " standalone geometry diverged from workspace",
    );
  }
  for (const shots of [fileShots, inspectorShots]) {
    if (shots === inspectorShots)
      checkInspectorTracks(shots.prototype, shots.standalone);
    else assert.deepEqual(shots.standalone.controls, shots.prototype.controls);
    assert.deepEqual(
      shots.standalone.rows,
      shots.prototype.rows,
      "Default section or layer geometry diverged from the prototype",
    );
  }
  const themeSamples: Record<
    string,
    Awaited<ReturnType<typeof primitives>>
  > = {};
  for (const [theme, density, appearance] of [
    ["design", "compact", "light"],
    ["design", "comfortable", "light"],
    ["mail", "comfortable", "dark"],
  ]) {
    const globals = `theme:${theme};density:${density};appearance:${appearance}`;
    await Promise.all([
      story(file, stories.file, globals),
      story(inspector, stories.inspector, globals),
      story(workspace, stories.workspace, globals),
    ]);
    if (appearance === "dark") {
      await galleryImage(gallery, "design-panels-dark.png", [
        {
          label: "File",
          width: fileShots.standalone.width,
          image: await file.locator(".design-file-panel").screenshot(),
        },
        {
          label: "Property inspector",
          width: inspectorShots.standalone.width,
          image: await inspector
            .locator(".design-property-inspector")
            .screenshot(),
        },
      ]);
    }
    const valueFit = await inspector
      .getByRole("textbox", { name: "Width", exact: true })
      .evaluate((node) => {
        const input = node as HTMLInputElement;
        const style = getComputedStyle(input);
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) throw new Error("Canvas text measurement is unavailable.");
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.letterSpacing = style.letterSpacing;
        return {
          value: input.value,
          text: ctx.measureText(input.value).width,
          space:
            input.clientWidth -
            parseFloat(style.paddingInlineStart) -
            parseFloat(style.paddingInlineEnd),
        };
      });
    assert.ok(
      valueFit.text <= valueFit.space,
      `Width value clipped in ${globals}: ${JSON.stringify(valueFit)}`,
    );
    const standalone = {
      ...(await primitives(file, "file")),
      ...(await primitives(inspector, "inspector")),
    };
    const integration = {
      ...(await primitives(workspace, "file")),
      ...(await primitives(workspace, "inspector")),
    };
    assert.deepEqual(
      standalone,
      integration,
      "Standalone and assembled control styles diverged in " + globals,
    );
    themeSamples[globals] = standalone;
    for (const [name, probe] of Object.entries(standalone)) {
      assert.deepEqual(
        probe.actual,
        probe.shared,
        "Control differs from its shared " + name + " primitive in " + globals,
      );
    }
  }
  const c = themeSamples["theme:design;density:compact;appearance:light"];
  const d = themeSamples["theme:design;density:comfortable;appearance:light"];
  const dark = themeSamples["theme:mail;density:comfortable;appearance:dark"];
  assert.notEqual(
    c.width.actual.padding,
    d.width.actual.padding,
    "Field padding should respond to density.",
  );
  assert.notEqual(
    d.width.actual.color,
    dark.width.actual.color,
    "Field color should respond to theme and appearance.",
  );
  await writeFile(
    path.join(output, "theme-controls.json"),
    JSON.stringify(themeSamples, null, 2) + "\n",
  );
  assert.deepEqual(
    autoShots.prototype.rows,
    inspectorShots.prototype.rows,
    "The reference now has a distinct expanded layout. Update this comparison.",
  );
  await story(workspace, stories.workspace);
  await checkPanelGrid(workspace, proto);
  assert.deepEqual(errors, []);
  console.log(
    "Verified standalone and integrated panels. Reference, crops and geometric differences: " +
      output,
  );
} finally {
  await browser.close();
}
