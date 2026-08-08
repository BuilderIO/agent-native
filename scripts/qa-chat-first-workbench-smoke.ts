#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type {
  Browser,
  BrowserContext,
  ElectronApplication,
  Page,
} from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const requireFromDesktop = createRequire(
  path.join(repoRoot, "packages/desktop-app/package.json"),
);
const { chromium, _electron } = requireFromCore(
  "playwright",
) as typeof import("playwright");

const baseUrl = process.env.CHAT_FIRST_BASE_URL ?? "http://localhost:8080";
const screenshotDir = process.env.CHAT_FIRST_SCREENSHOT_DIR;
const electronLane = process.env.CHAT_FIRST_ELECTRON === "1";

type SurfaceSnapshot = {
  panel: number;
  launcher: number;
  emptyCards: number;
  toggle: number;
  browser: number;
  tabs: number;
  mainWidth: number;
  chatWidth: number;
};

function saveScreenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDir) return Promise.resolve();
  fs.mkdirSync(screenshotDir, { recursive: true });
  return page.screenshot({
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: true,
  });
}

async function snapshot(page: Page, name: string): Promise<SurfaceSnapshot> {
  const snapshot = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(
      "[data-dispatch-chat-first-surface]",
    );
    const main = document.querySelector<HTMLElement>(
      ".agent-layout-main-surface",
    );
    const chat = document.querySelector<HTMLElement>(
      ".agent-layout-main-surface > .relative",
    );
    return {
      panel: document.querySelectorAll("[data-dispatch-chat-first-surface]")
        .length,
      launcher: document.querySelectorAll(
        ".dispatch-chat-first-surface-launcher",
      ).length,
      emptyCards: document.querySelectorAll("[data-surface-empty-state] > *")
        .length,
      toggle: document.querySelectorAll("[data-chat-first-surface-toggle]")
        .length,
      browser: document.querySelectorAll(
        "[data-dispatch-chat-first-browser-pane]",
      ).length,
      tabs: document.querySelectorAll(
        "[data-dispatch-chat-first-tabs] [role=tab]",
      ).length,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      chatWidth: chat?.getBoundingClientRect().width ?? 0,
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
    };
  });
  await saveScreenshot(page, name);
  return snapshot;
}

async function createContext(
  browser: Browser,
  enabled: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript((chatFirstEnabled) => {
    localStorage.clear();
    if (chatFirstEnabled) {
      localStorage.setItem("agent-native:chat-first-mode:v1", "true");
    }
  }, enabled);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(5_000);
  return { context, page };
}

async function runSmoke(browser: Browser): Promise<void> {
  const off = await createContext(browser, false);
  try {
    const state = await snapshot(off.page, "01-chat-first-off");
    assert.equal(state.toggle, 0, "chat-first toggle must be absent when off");
    assert.equal(state.panel, 0, "chat-first panel must be absent when off");
  } finally {
    await off.context.close();
  }

  const on = await createContext(browser, true);
  try {
    const empty = await snapshot(on.page, "02-chat-first-no-tabs");
    assert.equal(empty.toggle, 1, "chat-first toggle should be discoverable");
    assert.equal(empty.panel, 0, "no-tab state must not mount a side panel");
    assert.equal(empty.launcher, 0, "launcher should be closed by default");
    assert.equal(empty.emptyCards, 0, "empty cards should be on demand");
    assert.ok(
      empty.chatWidth >= empty.mainWidth - 2,
      "chat should occupy the content width without a side panel",
    );

    await on.page.locator("[data-chat-first-surface-toggle]").click();
    const picker = await snapshot(on.page, "03-chat-first-surface-picker");
    assert.equal(picker.panel, 1);
    assert.equal(picker.launcher, 0);
    assert.equal(picker.emptyCards, 6);
    assert.equal(
      await on.page.locator('[data-surface-availability="deferred"]').count(),
      3,
      "deferred side surfaces should be labeled honestly",
    );

    await on.page.locator("[data-chat-first-surface-toggle]").click();
    await on.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openApp", {
          detail: { app: "mail", url: "https://evil.test/login" },
        }),
      );
    });
    const hostileNotice = on.page.getByRole("status");
    await hostileNotice.waitFor({ state: "visible" });
    assert.match(
      (await hostileNotice.textContent()) ?? "",
      /not registered|not available|could not be opened/i,
      "hostile open_app should explain why no app pane opened",
    );
    assert.equal(
      await on.page.locator("[data-dispatch-chat-first-surface]").count(),
      0,
      "hostile open_app must not mount a chrome-less pane",
    );
    await saveScreenshot(on.page, "04-chat-first-hostile-open-app");

    await on.page.locator("[data-chat-first-surface-toggle]").click();
    await on.page.getByRole("button", { name: "Open activity" }).click();
    const agents = await snapshot(on.page, "05-chat-first-agents");
    assert.equal(agents.panel, 1, "opening a surface should mount the panel");
    assert.ok(agents.tabs >= 1);
    assert.equal(agents.launcher, 0);

    await on.page.getByRole("button", { name: /Close Agents/ }).click();
    const closed = await snapshot(on.page, "06-chat-first-last-tab-closed");
    assert.equal(closed.panel, 0, "closing the last tab should hide the panel");
    assert.equal(closed.launcher, 0);
    assert.equal(closed.tabs, 0);

    await on.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openBrowser", {
          detail: { url: "https://example.com", title: "Example" },
        }),
      );
    });
    const browserSurface = await snapshot(on.page, "07-chat-first-browser");
    assert.equal(browserSurface.panel, 1);
    assert.equal(browserSurface.browser, 1);
    assert.ok(browserSurface.tabs >= 1);
    for (const label of ["Back", "Forward", /Reload/]) {
      assert.equal(
        await on.page.getByRole("button", { name: label }).count(),
        1,
        `${label} browser control should be visible`,
      );
    }

    await on.page.getByRole("button", { name: "Close browser" }).click();
    await on.page.keyboard.press("Control+Alt+b");
    const keyboardPicker = await snapshot(on.page, "08-chat-first-keyboard");
    assert.equal(keyboardPicker.panel, 1);
    assert.equal(keyboardPicker.launcher, 0);
    assert.equal(keyboardPicker.emptyCards, 6);
  } finally {
    await on.context.close();
  }
}

type ElectronSnapshot = {
  hub: number;
  rail: number;
  panel: number;
  launcher: number;
  toggle: number;
  cards: number;
  tabs: number;
  browser: number;
  appPane: number;
  mainWidth: number;
};

async function electronSnapshot(
  page: Page,
  name: string,
): Promise<ElectronSnapshot> {
  const snapshot = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".code-agents-main");
    return {
      hub: document.querySelectorAll(".desktop-chat-first-hub--enabled").length,
      rail: document.querySelectorAll(".desktop-chat-first-apps").length,
      panel: document.querySelectorAll(".desktop-chat-first-surface-panel")
        .length,
      launcher: document.querySelectorAll(
        ".desktop-chat-first-surface-launcher",
      ).length,
      toggle: document.querySelectorAll("[data-chat-first-surface-toggle]")
        .length,
      cards: document.querySelectorAll(
        ".desktop-chat-first-surface-empty__card",
      ).length,
      tabs: document.querySelectorAll(
        ".desktop-chat-first-surface-tabs [role=tab]",
      ).length,
      browser: document.querySelectorAll(".desktop-chat-first-browser-pane")
        .length,
      appPane: document.querySelectorAll(".desktop-chat-first-app-pane").length,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
    };
  });
  await saveScreenshot(page, name);
  return snapshot;
}

async function openElectronAgentSurface(page: Page): Promise<void> {
  const shell = page.locator(".code-agents-surface");
  if ((await shell.count()) === 0) {
    await page.getByRole("button", { name: "Agent", exact: true }).click();
  }
  await shell.waitFor({ state: "visible", timeout: 15_000 });
}

function electronExecutablePath(): string {
  const configured = process.env.CHAT_FIRST_ELECTRON_EXECUTABLE?.trim();
  if (configured) return configured;

  const electronRoot = path.dirname(requireFromDesktop.resolve("electron"));
  if (process.platform === "darwin") {
    return path.join(electronRoot, "dist/Electron.app/Contents/MacOS/Electron");
  }
  return path.join(electronRoot, "dist/electron");
}

async function runElectronSmoke(): Promise<void> {
  const mainPath = path.join(
    repoRoot,
    "packages/desktop-app/out/main/index.js",
  );
  if (!fs.existsSync(mainPath)) {
    throw new Error(
      `Electron smoke requires a built desktop app at ${mainPath}. Run pnpm --dir packages/desktop-app build first.`,
    );
  }

  const userDataPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-chat-first-electron-"),
  );
  let electronApp: ElectronApplication | undefined;
  try {
    electronApp = await _electron.launch({
      executablePath: electronExecutablePath(),
      args: [mainPath, `--user-data-dir=${userDataPath}`, "--disable-gpu"],
      env: {
        ...process.env,
        AGENT_NATIVE_FRAMEWORK_ROOT: repoRoot,
        AGENT_NATIVE_PROJECT_ROOT: repoRoot,
      },
      timeout: 45_000,
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(5_000);

    await openElectronAgentSurface(page);
    const off = await electronSnapshot(page, "electron-01-chat-first-off");
    assert.equal(off.hub, 0, "Electron legacy Agent shell must stay unchanged");
    assert.equal(
      off.rail,
      0,
      "Electron chat-first rail must be absent when off",
    );
    assert.equal(
      off.toggle,
      0,
      "Electron chat-first toggle must be absent when off",
    );

    await page.evaluate(async () => {
      await window.electronAPI.frame.update({ chatFirstMode: true });
      location.reload();
    });
    await page.waitForTimeout(5_000);
    await openElectronAgentSurface(page);

    const empty = await electronSnapshot(
      page,
      "electron-02-chat-first-no-tabs",
    );
    assert.equal(empty.hub, 1, "Electron chat-first hub should be enabled");
    assert.equal(empty.rail, 1, "Electron chat-first rail should be visible");
    assert.equal(empty.panel, 0, "Electron no-tab state must hide the panel");
    assert.equal(
      empty.launcher,
      0,
      "Electron launcher should be closed by default",
    );
    assert.ok(
      empty.mainWidth > 0,
      "Electron Agent content should be measurable",
    );
    const chatFirstNav = await page
      .locator(".code-agents-nav-list")
      .innerText();
    assert.match(chatFirstNav, /Agent chat/);
    assert.match(chatFirstNav, /Code work/);
    assert.doesNotMatch(chatFirstNav, /Mobile|Computer access/);

    await page.getByRole("button", { name: "Code work" }).click();
    assert.equal(
      await page.locator(".code-agents-overview").count(),
      1,
      "Code work should keep the local coding-agent surface",
    );
    await page.getByRole("button", { name: "Agent chat" }).click();
    assert.equal(
      await page.locator(".desktop-chat-first-agent-chat").count(),
      1,
      "Agent chat should use the Dispatch app webview",
    );
    const agentChatSlot = await page
      .locator(".desktop-chat-first-agent-chat .webview-slot--active")
      .evaluate((element) => {
        const slot = element.getBoundingClientRect();
        const rail = document
          .querySelector(".code-agents-rail")
          ?.getBoundingClientRect();
        const main = document
          .querySelector(".code-agents-main")
          ?.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          slotLeft: slot.left,
          slotRight: slot.right,
          railRight: rail?.right ?? 0,
          mainLeft: main?.left ?? 0,
          mainRight: main?.right ?? 0,
        };
      });
    assert.equal(agentChatSlot.opacity, "1");
    assert.equal(agentChatSlot.pointerEvents, "auto");
    assert.ok(
      agentChatSlot.slotLeft >= agentChatSlot.railRight - 1 &&
        agentChatSlot.slotRight <= agentChatSlot.mainRight + 1 &&
        agentChatSlot.slotLeft >= agentChatSlot.mainLeft - 1,
      "Dispatch webview should stay inside the desktop chat center",
    );

    await page.locator("[data-chat-first-surface-toggle]").click();
    const picker = await electronSnapshot(page, "electron-03-surface-picker");
    assert.equal(picker.panel, 1);
    assert.equal(picker.launcher, 0);
    assert.equal(
      picker.cards,
      6,
      "Electron should expose the six-card catalog",
    );
    assert.equal(
      await page.locator('[data-surface-availability="deferred"]').count(),
      3,
      "Electron deferred surfaces should be labeled honestly",
    );

    await page.getByRole("button", { name: "Open activity" }).click();
    const agents = await electronSnapshot(page, "electron-04-agents");
    assert.equal(
      agents.panel,
      1,
      "opening Agents should mount Electron's panel",
    );
    assert.ok(agents.tabs >= 1);
    assert.equal(agents.launcher, 0);

    await page.getByRole("button", { name: /Close Agents/ }).click();
    const closed = await electronSnapshot(page, "electron-05-last-tab-closed");
    assert.equal(
      closed.panel,
      0,
      "closing the last Electron tab hides the panel",
    );
    assert.equal(closed.tabs, 0);

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openBrowser", {
          detail: { url: "https://example.com", title: "Example" },
        }),
      );
    });
    await page.locator(".desktop-chat-first-browser-pane").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const browserSurface = await electronSnapshot(page, "electron-06-browser");
    assert.equal(browserSurface.panel, 1);
    assert.equal(browserSurface.browser, 1);
    for (const label of ["Back", "Forward", /Reload/]) {
      assert.equal(
        await page.getByRole("button", { name: label }).count(),
        1,
        `Electron ${label} browser control should be visible`,
      );
    }

    await page.getByRole("button", { name: "Close browser" }).click();
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openApp", {
          detail: { app: "mail", url: "https://evil.test/login" },
        }),
      );
    });
    const hostileNotice = page.locator(
      ".desktop-chat-first-apps [role=status]",
    );
    await hostileNotice.waitFor({ state: "visible", timeout: 15_000 });
    assert.match(
      (await hostileNotice.textContent()) ?? "",
      /not registered|not enabled|could not be opened/i,
      "Electron hostile open_app should explain why no pane opened",
    );
    assert.equal(
      await page.locator(".desktop-chat-first-app-pane").count(),
      0,
      "Electron hostile open_app must not mount an app pane",
    );
    assert.equal(
      await page.locator(".desktop-chat-first-surface-panel").count(),
      0,
      "Electron hostile open_app must not mount the side panel",
    );
    await saveScreenshot(page, "electron-07-hostile-open-app");
  } finally {
    if (electronApp) await electronApp.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    await runSmoke(browser);
    if (electronLane) await runElectronSmoke();
    console.log(
      `qa-chat-first-workbench-smoke: clean (${baseUrl}; electron=${electronLane ? "on" : "off"}; screenshots=${screenshotDir ?? "disabled"})`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
