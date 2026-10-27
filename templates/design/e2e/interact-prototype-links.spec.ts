import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { waitForEditorBoot } from "./editor-boot";
import { gotoEditor } from "./helpers";
import { INTERACT_FRAME } from "./interact-helpers";

const SCREEN_CONTROL = "[data-design-top-bar] [data-design-interact-route]";

// A long page with a link to each kind of target, so one run shows which
// clicks the preview takes over and which it leaves to the page.
const HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home</title>
<style>
  body{margin:0;font:20px system-ui;background:#ffffff;color:#111111}
  a{display:inline-block;margin:12px 24px}
  .filler{height:2400px}
</style></head><body>
  <h1 id="title">Home screen</h1>
  <a id="to-pricing" href="/pricing">Pricing</a>
  <a id="to-pricing-dissolve" href="/pricing" data-an-prototype-transition='{"version":1,"trigger":"click","action":"navigate","transition":"dissolve","durationMs":420,"ease":{"kind":"preset","preset":"ease-out"}}'>Pricing with dissolve</a>
  <a id="to-pricing-delayed" href="/pricing" data-an-prototype-transition='{"version":1,"trigger":"click","action":"navigate","transition":"move-out","direction":"left","durationMs":800,"ease":{"kind":"preset","preset":"linear"}}'>Pricing with delayed navigation</a>
  <a id="to-docs" href="docs.html">Docs</a>
  <a id="to-docs-invalid-transition" href="docs.html" data-an-prototype-transition="{">Docs with invalid transition</a>
  <a id="to-section" href="#bottom">Jump to the bottom</a>
  <div class="filler">a page taller than its frame</div>
  <h2 id="bottom">Bottom of the page</h2>
</body></html>`;

const page2 = (title: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;font:20px system-ui"><h1 id="title">${title} screen</h1></body></html>`;

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await page.request.post(
    `${e2eBaseURL()}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `action ${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createLinkedDesign(
  page: Page,
): Promise<{ designId: string; homeFileId: string }> {
  const created = await postAction(page, "create-design", {
    title: "Interact prototype links",
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  let homeFileId: string | undefined;
  for (const [filename, content] of [
    ["index.html", HOME],
    ["pricing.html", page2("Pricing")],
    ["docs.html", page2("Docs")],
  ] as const) {
    const file = await postAction(page, "create-file", {
      designId,
      filename,
      content,
      fileType: "html",
    });
    if (filename === "index.html") homeFileId = file?.id ?? file?.data?.id;
  }
  if (!homeFileId) throw new Error("create-file returned no Home screen id");
  return { designId, homeFileId };
}

async function enterInteractOnHome(page: Page) {
  await page.setViewportSize({ width: 1751, height: 897 });
  const { designId } = await createLinkedDesign(page);
  await gotoEditor(page, designId);
  await page.waitForURL(/editorView=overview/);
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const screen = page.locator(SCREEN_CONTROL);
  await expect(screen).toBeVisible();
  // Pick Home explicitly: Interact opens on the selected or first screen.
  await screen.click();
  await page.getByRole("option", { name: "Home", exact: true }).click();
  await expect(screen).toHaveText("Home");
  const frame = page.locator(INTERACT_FRAME);
  const inner = frame.contentFrame();
  await expect(inner.locator("#title")).toHaveText("Home screen");
  return { screen, frame, inner };
}

async function recordPreviewAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    type PreviewAnimationRecord = {
      keyframes: Keyframe[];
      duration: number | string | undefined;
      easing: string | undefined;
      finished: boolean;
    };
    const host = window as typeof window & {
      __prototypeAnimations: PreviewAnimationRecord[];
    };
    const animate = Element.prototype.animate;
    host.__prototypeAnimations = [];
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function (
        this: Element,
        keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
        options?: number | KeyframeAnimationOptions,
      ) {
        const preview =
          this instanceof HTMLElement &&
          this.hasAttribute("data-an-prototype-preview");
        const optionsObject =
          typeof options === "number" ? { duration: options } : options;
        const duration = optionsObject?.duration;
        const record: PreviewAnimationRecord = {
          keyframes: Array.isArray(keyframes) ? keyframes : [],
          duration:
            typeof duration === "number" ? duration : String(duration ?? ""),
          easing: optionsObject?.easing,
          finished: false,
        };
        if (preview) host.__prototypeAnimations.push(record);
        const animation = animate.call(this, keyframes, options);
        if (preview) {
          void animation.finished.then(
            () => {
              record.finished = true;
            },
            () => {},
          );
        }
        return animation;
      },
    });
  });
}

test("a link to another screen switches the preview, and nothing else is taken over", async ({
  page,
}) => {
  const { screen, inner } = await enterInteractOnHome(page);

  // A link to another screen of the design shows that screen.
  await inner.locator("#to-pricing").click();
  await expect(screen).toHaveText("Pricing");
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Pricing screen");

  // Back to Home, then a relative file link to a different screen.
  await page.locator("[data-design-top-bar] button[aria-label='Back']").click();
  await expect(screen).toHaveText("Home");
  const home = page.locator(INTERACT_FRAME).contentFrame();
  await expect(home.locator("#title")).toHaveText("Home screen");
  await home.locator("#to-docs").click();
  await expect(screen).toHaveText("Docs");
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Docs screen");

  // An in-page link stays on the screen and scrolls it, as in any page.
  await page.locator("[data-design-top-bar] button[aria-label='Back']").click();
  await expect(screen).toHaveText("Home");
  const again = page.locator(INTERACT_FRAME).contentFrame();
  await again.locator("#to-section").click();
  await expect(screen).toHaveText("Home");
  await expect
    .poll(() => again.locator("html").evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});

test("a code-authored dissolve animates the outgoing and incoming preview frames", async ({
  page,
}) => {
  const { screen, inner } = await enterInteractOnHome(page);
  await recordPreviewAnimations(page);
  await inner.locator("#to-pricing-dissolve").click();
  await expect(screen).toHaveText("Pricing");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __prototypeAnimations: unknown[] })
            .__prototypeAnimations,
      ),
    )
    .toEqual([
      expect.objectContaining({
        keyframes: [{ opacity: 1 }, { opacity: 0 }],
        duration: 210,
        easing: "ease-out",
        finished: true,
      }),
      expect.objectContaining({
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        duration: 210,
        easing: "ease-out",
        finished: true,
      }),
    ]);
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Pricing screen");
});

test("a manual screen selection cancels a pending prototype transition", async ({
  page,
}) => {
  const { screen, inner } = await enterInteractOnHome(page);

  await inner.locator("#to-pricing-delayed").click();
  await screen.click();
  await page.getByRole("option", { name: "Docs", exact: true }).click();
  await expect(screen).toHaveText("Docs");
  await page.waitForTimeout(900);
  await expect(screen).toHaveText("Docs");
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Docs screen");
});

test("a single-screen invalid transition falls back to immediate navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  const { designId, homeFileId } = await createLinkedDesign(page);
  await gotoEditor(page, designId);
  const editorUrl = new URL(page.url());
  editorUrl.searchParams.set("editorView", "single");
  editorUrl.searchParams.set("screen", homeFileId);
  await page.goto(editorUrl.toString(), { waitUntil: "domcontentloaded" });
  await waitForEditorBoot(page);
  await expect(page.locator("iframe[data-design-preview-iframe]")).toHaveCount(
    1,
  );
  await expect(page.locator("[data-multi-screen-canvas-surface]")).toHaveCount(
    0,
  );
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();

  const inner = page
    .locator("iframe[data-design-preview-iframe]")
    .contentFrame();
  await expect(inner.locator("#title")).toHaveText("Home screen");
  await recordPreviewAnimations(page);
  await inner.locator("#to-docs-invalid-transition").click();
  await expect(inner.locator("#title")).toHaveText("Docs screen");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __prototypeAnimations: unknown[] })
          .__prototypeAnimations,
    ),
  ).toEqual([]);
});

test("an invalid code-authored transition falls back to immediate navigation", async ({
  page,
}) => {
  const { screen, inner } = await enterInteractOnHome(page);
  await recordPreviewAnimations(page);
  await inner.locator("#to-docs-invalid-transition").click();
  await expect(screen).toHaveText("Docs");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __prototypeAnimations: unknown[] })
          .__prototypeAnimations,
    ),
  ).toEqual([]);
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Docs screen");
});
