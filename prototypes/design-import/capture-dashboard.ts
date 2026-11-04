// Captures the Design dashboard (/home) from a running Design dev server into dashboard.json: the page's
// own DOM and CSS, its Inter faces inlined, and each template preview iframe as an image. The prototype
// renders that snapshot behind the import dialogs, so the dashboard is the shipped one, not a redraw.
//
// Run: start the Design dev server (`pnpm --dir templates/design dev --port 3101` with AUTH_MODE=local),
// then `node prototypes/design-import/capture-dashboard.ts [http://localhost:3101]`.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const origin = process.argv[2] ?? "http://localhost:3101";
const out = join(dirname(fileURLToPath(import.meta.url)), "dashboard.json");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await context.newPage();
await page.goto(`${origin}/home`, { waitUntil: "load" });
const importButton = page.locator('button[aria-label="Import"]');
const localDev = page.getByRole("button", { name: "Continue as local dev" });
// The sign-in page hydrates late, so a click before hydration does nothing; retry until the dashboard shows.
await importButton.or(localDev).first().waitFor({ timeout: 90_000 });
for (let i = 0; i < 10 && !(await importButton.isVisible()); i++) {
  if (await localDev.isVisible()) await localDev.click().catch(() => {});
  await importButton.waitFor({ timeout: 6000 }).catch(() => {});
}
await importButton.waitFor({ timeout: 30_000 });
await page.waitForTimeout(6000);

// Template previews are srcdoc iframes; each becomes a 2x JPEG of what it shows.
const frames = await page.locator("iframe").all();
const shots: string[] = [];
for (const frame of frames) {
  if (!(await frame.isVisible())) {
    shots.push("");
    continue;
  }
  await frame.scrollIntoViewIfNeeded();
  const jpeg = await frame.screenshot({ type: "jpeg", quality: 82 });
  shots.push(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
}
await page.evaluate(() => window.scrollTo(0, 0));

const snapshot = await page.evaluate(async (shots) => {
  const toDataUrl = async (url: string) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  };
  const loaded = new Set(
    [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => `${f.family}|${f.style}|${f.unicodeRange}`),
  );
  const css: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    for (const rule of [...sheet.cssRules]) {
      if (rule instanceof CSSFontFaceRule) {
        const s = rule.style;
        const key = `${s.getPropertyValue("font-family").replace(/["']/g, "")}|${s.getPropertyValue("font-style") || "normal"}|${s.getPropertyValue("unicode-range") || "U+0-10FFFF"}`;
        if (![...loaded].some((k) => k.replace(/["']/g, "") === key)) continue;
        const src = s.getPropertyValue("src");
        const match = src.match(/url\(["']?([^"')]+)["']?\)/);
        if (!match) continue;
        const data = await toDataUrl(new URL(match[1], sheet.href ?? location.href).href);
        css.push(rule.cssText.replace(src, `url("${data}") format("woff2")`));
        continue;
      }
      css.push(rule.cssText);
    }
  }
  const body = document.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll("script, noscript, template, [data-sonner-toaster], section[aria-label^='Notifications']").forEach((el) => el.remove());
  const liveFrames = [...document.querySelectorAll("iframe")];
  body.querySelectorAll("iframe").forEach((frame, i) => {
    const img = document.createElement("img");
    img.alt = "";
    // The frame renders at full page size under a scale transform; the screenshot is already at its
    // on-screen size, so the image takes none of the frame's class or style.
    const rect = liveFrames[i]?.getBoundingClientRect();
    img.style.cssText = `display:block;width:${rect?.width ?? 0}px;height:${rect?.height ?? 0}px`;
    if (shots[i]) img.src = shots[i];
    frame.replaceWith(img);
  });
  body.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes])
      if (attr.name.startsWith("data-agent-native-")) el.removeAttribute(attr.name);
    if (el.hasAttribute("contenteditable")) el.setAttribute("contenteditable", "false");
  });
  body.querySelector('button[aria-label="Import"]')?.setAttribute("data-proto", "import");
  return {
    lang: document.documentElement.lang,
    bodyClass: body.className,
    html: body.innerHTML,
    css: css.join("\n"),
  };
}, shots);

writeFileSync(out, JSON.stringify(snapshot));
console.log(`Wrote ${out}: ${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB, ${shots.filter(Boolean).length} previews.`);
await browser.close();
