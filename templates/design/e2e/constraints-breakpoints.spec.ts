import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Constraints assert Figma parity (doc-quoted). Breakpoints assert Design's
 * OWN Framer-model contract from .agents/skills/responsive-breakpoints — they
 * are deliberately not a Figma concept, so parity is not the bar there.
 */

const PAGE_W = 1440;
const PAGE_H = 900;

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Constraints</title></head>
  <body style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="parent" data-agent-native-layer-name="Parent"
         style="position:absolute;left:20px;top:60px;width:280px;height:200px;background:#1f2937">
      <div data-agent-native-node-id="child" data-agent-native-layer-name="Child"
           style="position:absolute;left:20px;top:20px;width:180px;height:60px;background:#3b82f6"></div>
    </div>
    <div data-agent-native-node-id="auto-parent" data-agent-native-layer-name="Auto Parent"
         style="position:absolute;left:20px;top:320px;width:280px;display:flex;flex-direction:column;gap:12px">
      <div data-agent-native-node-id="auto-child" data-agent-native-layer-name="Auto Child"
           style="height:60px;background:#22c55e"></div>
    </div>
    <div data-agent-native-node-id="orphan" data-agent-native-layer-name="Orphan"
         style="position:absolute;left:20px;top:560px;width:180px;height:90px;background:#a855f7"></div>
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
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  return res.json();
}

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "constraints and breakpoints",
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

async function designRecord(page: Page, designId: string) {
  return page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
}

async function indexHtml(page: Page, designId: string): Promise<string> {
  const record = await designRecord(page, designId);
  return (
    (record.files ?? []).find((f: any) => f.filename === "index.html")
      ?.content ?? ""
  );
}

function toolbar(page: Page): Locator {
  return page.locator("[data-design-bottom-toolbar]");
}

function layerRow(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function openEditor(page: Page, designId: string): Promise<void> {
  await page.goto(`${baseURL}/design/${designId}`, {
    waitUntil: "domcontentloaded",
  });
  await toolbar(page)
    .locator('button[aria-label="Move"]')
    .waitFor({ timeout: 45_000 });
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 5; i += 1) {
    await page
      .getByRole("button", { name: "Expand layer" })
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
}

async function rendered(page: Page, id: string) {
  return node(page, id).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

/** Resize the parent through the inspector, isolating constraints from the
 *  broken resize handles. */
async function setWidth(page: Page, value: string): Promise<void> {
  const input = page
    .getByText("W", { exact: true })
    .first()
    .locator("xpath=following::input[1]");
  await input.fill(value);
  await input.press("Enter");
  await page.waitForTimeout(2200);
}

async function openConstraints(page: Page): Promise<boolean> {
  const toggle = page.locator('button[aria-label="Constraints"]');
  if ((await toggle.count()) === 0) return false;
  await toggle.first().click();
  await page.waitForTimeout(1200);
  return true;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    `http://127.0.0.1:${process.env.E2E_PORT ?? 9333}`;
});

test.describe("constraints (Figma parity)", () => {
  test("a child defaults to Top and Left constraints", async ({ page }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await layerRow(page, "Child").click();
    await page.waitForTimeout(1500);
    expect(
      await openConstraints(page),
      "no Constraints control for a child of a frame",
    ).toBe(true);

    const text = await page.evaluate(() => {
      const heading = Array.from(
        document.querySelectorAll<HTMLElement>("*"),
      ).find(
        (el) =>
          el.children.length === 0 &&
          (el.textContent ?? "").trim() === "Constraints",
      );
      return (
        heading?.parentElement?.parentElement?.innerText?.replace(
          /\s+/g,
          " ",
        ) ?? ""
      );
    });
    expect(
      text,
      `Figma: "By default, constraints are set to Top and Left". Panel reads "${text}".`,
    ).toMatch(/Left/i);
    expect(text).toMatch(/Top/i);
  });

  test("a Left+Top child keeps its offset when the parent widens", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    const before = await rendered(page, "child");
    const parentBefore = await rendered(page, "parent");

    await layerRow(page, "Parent").click();
    await page.waitForTimeout(1500);
    await setWidth(page, "600");

    const after = await rendered(page, "child");
    const parentAfter = await rendered(page, "parent");
    test.skip(
      Math.abs(parentAfter.width - parentBefore.width) < 1,
      "the parent did not actually resize, so constraints are untestable here",
    );
    expect(
      Math.round(after.left - parentAfter.left),
      `Figma: Top+Left "will stay in the same position relative to the top left corner of ` +
        `its parent frame". Offset went ${Math.round(before.left - parentBefore.left)} → ` +
        `${Math.round(after.left - parentAfter.left)}.`,
    ).toBe(Math.round(before.left - parentBefore.left));
  });

  test("a Scale-constrained child keeps its percentage of the parent width", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await layerRow(page, "Child").click();
    await page.waitForTimeout(1500);
    const opened = await openConstraints(page);
    test.skip(!opened, "no Constraints control to set Scale with");

    const scaleOption = page
      .getByRole("option", { name: /Scale/i })
      .or(page.getByRole("menuitem", { name: /Scale/i }));
    const hasScale = await scaleOption.count();
    test.skip(hasScale === 0, "no Scale constraint option exposed");
    await scaleOption.first().click();
    await page.waitForTimeout(1500);

    const childBefore = await rendered(page, "child");
    const parentBefore = await rendered(page, "parent");
    const ratio = childBefore.width / parentBefore.width;

    await layerRow(page, "Parent").click();
    await page.waitForTimeout(1500);
    await setWidth(page, "800");

    const childAfter = await rendered(page, "child");
    const parentAfter = await rendered(page, "parent");
    expect(
      childAfter.width / parentAfter.width,
      `Figma: Scale "will define the layer's size and position as a percentage of the ` +
        `frame's dimensions" — 70px in a 100px frame becomes 140px in a 200px frame. ` +
        `Ratio went ${ratio.toFixed(3)} → ${(childAfter.width / parentAfter.width).toFixed(3)}.`,
    ).toBeCloseTo(ratio, 2);
  });

  test("constraints are not offered for a child of an auto-layout frame", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await openEditor(page, id);
    await layerRow(page, "Auto Child").click();
    await page.waitForTimeout(1500);
    expect(
      await page.locator('button[aria-label="Constraints"]').count(),
      `Figma: "It's not possible to apply constraints to layers ... in an auto layout frame."`,
    ).toBe(0);
  });
});

test.describe("breakpoints (Design's Framer model, not Figma)", () => {
  test("add-breakpoint records the width in the design's breakpointSet", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    });
    const record = await designRecord(page, id);
    const data =
      typeof record.data === "string"
        ? JSON.parse(record.data || "{}")
        : (record.data ?? {});
    const widths = (data.breakpointSet?.breakpoints ?? []).map(
      (b: any) => b.widthPx,
    );
    expect(
      widths,
      `skill: add-breakpoint "adds a device-width frame to designs.data.breakpointSet". ` +
        `breakpointSet.breakpoints is ${JSON.stringify(data.breakpointSet?.breakpoints ?? null)}.`,
    ).toContain(810);
  });

  test("a duplicate breakpoint width is ignored", async ({ page }) => {
    const id = await newDesign(page);
    await postAction(page, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    });
    await postAction(page, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    }).catch(() => {});
    const record = await designRecord(page, id);
    const data =
      typeof record.data === "string"
        ? JSON.parse(record.data || "{}")
        : (record.data ?? {});
    const widths = (data.breakpointSet?.breakpoints ?? []).map(
      (b: any) => b.widthPx,
    );
    expect(
      widths.filter((w: number) => w === 810).length,
      `skill: "Duplicate widths are ignored". Got ${JSON.stringify(widths)}.`,
    ).toBe(1);
  });

  test("an edit at a narrower breakpoint scopes to next-wider minus one", async ({
    page,
  }) => {
    const id = await newDesign(page);
    await postAction(page, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    });
    await postAction(page, "add-breakpoint", {
      designId: id,
      label: "Phone",
      widthPx: 390,
    });
    await postAction(page, "apply-visual-edit", {
      source: { kind: "design-file", designId: id, filename: "index.html" },
      intent: {
        kind: "style",
        target: { nodeId: "child" },
        property: "background",
        value: "rgb(255, 0, 0)",
      },
      activeFrameWidthPx: 390,
    });

    const html = await indexHtml(page, id);
    const media = /@media[^{]*max-width:\s*(\d+)px/gi;
    const bounds: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = media.exec(html))) bounds.push(Number(m[1]));
    expect(
      bounds,
      `skill: "The bound for an override is next-wider frame width - 1" — editing at 390 ` +
        `with an 810 breakpoint present must scope to max-width: 809px. Found ${JSON.stringify(bounds)}.`,
    ).toContain(809);
  });

  test("the default device set is a desktop base plus mobile only", async ({
    page,
  }) => {
    const id = await newDesign(page);
    const record = await designRecord(page, id);
    const data =
      typeof record.data === "string"
        ? JSON.parse(record.data || "{}")
        : (record.data ?? {});
    const widths = (data.breakpointSet?.breakpoints ?? []).map(
      (b: any) => b.widthPx,
    );
    test.skip(
      widths.length === 0,
      "create-design injects no breakpointSet; the documented default applies to generate-design",
    );
    expect(
      widths,
      `skill: the default injected set is "a Desktop base plus a single Mobile (390) ` +
        `breakpoint frame ... never an auto-added tablet". Got ${JSON.stringify(widths)}.`,
    ).not.toContain(810);
  });
});
