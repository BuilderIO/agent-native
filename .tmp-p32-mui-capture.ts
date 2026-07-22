import { chromium } from "./node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";

async function main() {
  const browser = await chromium.launch({ headless: true });
  for (const mode of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      colorScheme: mode,
    });
    await context.addInitScript((themeMode) => {
      localStorage.setItem("theme", themeMode);
    }, mode);
    const page = await context.newPage();
    await page.goto("http://localhost:9331/", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page
      .locator(".an-chat-history-row")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
    const counts = {
      rows: await page.locator(".an-chat-history-row").count(),
      newChat: await page.locator(".an-chat-history-rail__new-chat").count(),
      disclosure: await page
        .locator(".an-chat-history-rail__disclosure")
        .count(),
    };
    const collapse = page.getByRole("button", {
      name: "Collapse sidebar",
    });
    await collapse.hover();
    const tooltip = page.locator(".MuiTooltip-tooltip", {
      hasText: "Collapse sidebar",
    });
    await tooltip.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(250);
    const evidence = await page.evaluate(() => ({
      themeClass: document.documentElement.className,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily,
      muiTooltip: document.querySelectorAll(".MuiTooltip-tooltip").length,
      muiNewChat:
        document.querySelector(".an-chat-history-rail__new-chat")?.className ??
        "",
      muiDisclosure:
        document.querySelector(".an-chat-history-rail__disclosure")
          ?.className ?? "",
    }));
    const path = `/tmp/agent-native-ds-shots/chat-mui-sidebar-tooltip-${mode}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(JSON.stringify({ mode, path, counts, evidence }));
    await context.close();
  }
  await browser.close();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
