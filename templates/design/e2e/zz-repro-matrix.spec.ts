import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { FIXTURE_HTML } from "./global-setup";
import { enterDirectMode, gotoEditor } from "./helpers";

let designId: string;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await request.post(
    `${e2eBaseURL()}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) throw new Error(`${name}: ${res.status()}`);
  return res.json();
}

test.use({ viewport: { width: 1440, height: 1000 } });

test.beforeEach(async ({ page }) => {
  const created = await postAction(page.request, "create-design", {
    title: "Repro matrix",
    projectType: "prototype",
  });
  designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  await postAction(page.request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE_HTML,
    fileType: "html",
  });
  await gotoEditor(page, designId);
});

async function liveTexts(page: Page): Promise<string[]> {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .evaluateAll((frames) =>
      frames.flatMap((frame) =>
        Array.from(
          (frame as HTMLIFrameElement).contentDocument?.querySelectorAll(
            '[data-an-primitive="text"]',
          ) ?? [],
        ).map((el) => el.textContent ?? ""),
      ),
    );
}

async function logPushes(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__pushes = [];
    const wrap = () => {
      document.querySelectorAll("iframe").forEach((f) => {
        const win = (f as HTMLIFrameElement).contentWindow as any;
        if (!win || win.__w) return;
        win.__w = true;
        const orig = win.postMessage.bind(win);
        win.postMessage = (data: any, ...rest: any[]) => {
          if (data?.type === "replace-document-content") {
            (window as any).__pushes.push({
              force: data.forceFullDocument === true,
              preserve: data.preserveTextEditingSession === true,
              bytes: typeof data.content === "string" ? data.content.length : 0,
            });
          }
          return orig(data, ...rest);
        };
      });
    };
    wrap();
    setInterval(wrap, 80);
  });
}

async function placeAndType(
  page: Page,
  label: string,
  opts: {
    waitForCaret?: boolean;
    commit: "click-out" | "escape";
    directMode?: boolean;
  },
) {
  if (opts.directMode) await enterDirectMode(page);
  await logPushes(page);
  const card = page.locator("[data-screen-card]").first();
  const box = await card.boundingBox();
  if (!box) throw new Error("no card");
  await page.locator('button[aria-label="Text"]').first().click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + 110);
  if (opts.waitForCaret) {
    await page.waitForTimeout(1500);
  }
  await page.keyboard.type("my page", { delay: 40 });
  await page.waitForTimeout(400);
  if (opts.commit === "escape") {
    await page.keyboard.press("Escape");
  } else {
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height - 60);
  }
  await page.waitForTimeout(2500);
  const texts = await liveTexts(page);
  const pushes = await page.evaluate(() => (window as any).__pushes);
  console.log(`RESULT ${label}: live=${JSON.stringify(texts)} pushes=${JSON.stringify(pushes)}`);
}

test("A overview + type immediately + click out", async ({ page }) => {
  await placeAndType(page, "A overview/immediate/click-out", { commit: "click-out" });
});

test("B overview + wait for caret + click out", async ({ page }) => {
  await placeAndType(page, "B overview/waited/click-out", {
    waitForCaret: true,
    commit: "click-out",
  });
});

test("C overview + type immediately + Escape", async ({ page }) => {
  await placeAndType(page, "C overview/immediate/escape", { commit: "escape" });
});

test("D full view + type immediately + click out", async ({ page }) => {
  await placeAndType(page, "D fullview/immediate/click-out", {
    commit: "click-out",
    directMode: true,
  });
});
