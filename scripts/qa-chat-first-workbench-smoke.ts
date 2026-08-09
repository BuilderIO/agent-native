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
const electronDispatchUrl =
  process.env.CHAT_FIRST_ELECTRON_DISPATCH_URL?.trim();
const colorScheme =
  process.env.CHAT_FIRST_COLOR_SCHEME === "light" ? "light" : "dark";

type SurfaceSnapshot = {
  panel: number;
  launcher: number;
  emptyCards: number;
  toggle: number;
  browser: number;
  tabs: number;
  mainWidth: number;
  chatWidth: number;
  panelWidth: number;
  chatRight: number;
  panelLeft: number;
};

type SmokeContext = {
  context: BrowserContext;
  page: Page;
  embedRequests: Array<Record<string, unknown>>;
};

function saveScreenshot(page: Page, name: string): Promise<void> {
  if (!screenshotDir) return Promise.resolve();
  fs.mkdirSync(screenshotDir, { recursive: true });
  return page.screenshot({
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: true,
    timeout: 10_000,
  });
}

async function saveElectronScreenshot(
  electronApp: ElectronApplication,
  name: string,
): Promise<void> {
  if (!screenshotDir) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  const png = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.isVisible(),
    );
    if (!target) return null;
    const image = await target.webContents.capturePage();
    return image.toPNG().toString("base64");
  });
  if (png) {
    fs.writeFileSync(
      path.join(screenshotDir, `${name}.png`),
      Buffer.from(png, "base64"),
    );
  }
}

async function snapshot(page: Page, name: string): Promise<SurfaceSnapshot> {
  const snapshot = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(
      "[data-chat-first-surface-panel]",
    );
    const main = document.querySelector<HTMLElement>(
      ".agent-layout-main-surface",
    );
    const chat = document.querySelector<HTMLElement>(
      ".agent-layout-main-surface > .relative",
    );
    return {
      panel: document.querySelectorAll("[data-chat-first-surface-panel]")
        .length,
      launcher: document.querySelectorAll(
        ".dispatch-chat-first-surface-launcher",
      ).length,
      emptyCards: document.querySelectorAll("[data-surface-empty-state] > *")
        .length,
      toggle: document.querySelectorAll("[data-chat-first-surface-toggle]")
        .length,
      browser: document.querySelectorAll("[data-chat-first-browser-pane]")
        .length,
      tabs: document.querySelectorAll(
        "[data-chat-first-surface-tabs] [role=tab]",
      ).length,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      chatWidth: chat?.getBoundingClientRect().width ?? 0,
      panelWidth: panel?.getBoundingClientRect().width ?? 0,
      chatRight: chat?.getBoundingClientRect().right ?? 0,
      panelLeft: panel?.getBoundingClientRect().left ?? 0,
    };
  });
  await saveScreenshot(page, name);
  return snapshot;
}

async function createContext(
  browser: Browser,
  enabled: boolean,
): Promise<SmokeContext> {
  const context = await browser.newContext({
    colorScheme,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript((chatFirstEnabled) => {
    localStorage.clear();
    if (chatFirstEnabled) {
      localStorage.setItem("agent-native:chat-first-mode:v1", "true");
    }
  }, enabled);
  const page = await context.newPage();
  const embedRequests: Array<Record<string, unknown>> = [];
  if (enabled) {
    await page.route("**/_agent-native/actions/list-workspace-apps*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mail",
            name: "Mail",
            path: "/mail/inbox",
            url: "https://mail.example.test",
            status: "ready",
            archived: false,
          },
        ]),
      }),
    );
    await page.route(
      "**/_agent-native/actions/create_embed_session*",
      async (route) => {
        const raw = route.request().postData();
        const payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        embedRequests.push(payload);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            startUrl: "https://mail.example.test/mail/inbox",
          }),
        });
      },
    );
  }
  await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded" });
  // The client-side auth guard can redirect after the initial document has
  // loaded, when its first session query returns 401. Give that redirect a
  // chance to settle before deciding whether the local-dev CTA is needed.
  await page.waitForTimeout(2_000);
  if (new URL(page.url()).pathname.endsWith("/sign-in")) {
    const localDevButton = page.getByRole("button", {
      name: /continue as local dev/i,
    });
    await localDevButton.waitFor({ state: "visible", timeout: 15_000 });
    await localDevButton.click();
    await page.waitForURL((url) => url.pathname.endsWith("/chat"), {
      timeout: 15_000,
    });
  }
  await page.locator("body").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(5_000);
  return { context, page, embedRequests };
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
    assert.ok(
      picker.chatWidth < empty.chatWidth - 1,
      "opening a side surface should shrink the conversation column",
    );
    assert.ok(
      picker.panelWidth >= 320 && picker.panelLeft >= picker.chatRight - 1,
      "side surface should be an inline column beside the conversation, not an overlay",
    );
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
      await on.page.locator("[data-chat-first-surface-panel]").count(),
      0,
      "hostile open_app must not mount a chrome-less pane",
    );
    await saveScreenshot(on.page, "04-chat-first-hostile-open-app");

    await on.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openApp", {
          detail: { app: "mail", path: "/mail/inbox" },
        }),
      );
    });
    await on.page.locator("[data-chat-first-app-pane]").waitFor({
      state: "visible",
    });
    assert.deepEqual(
      on.embedRequests.at(-1),
      { app: "mail", path: "/mail/inbox", chrome: "minimal" },
      "app-relative embeds must mint a session for the registered app",
    );
    await saveScreenshot(on.page, "05-chat-first-app");
    await on.page.getByRole("button", { name: "Close Mail" }).click();

    await on.page.locator("[data-chat-first-surface-toggle]").click();
    await on.page.getByRole("button", { name: "Open activity" }).click();
    const agents = await snapshot(on.page, "06-chat-first-agents");
    assert.equal(agents.panel, 1, "opening a surface should mount the panel");
    assert.ok(agents.tabs >= 1);
    assert.equal(agents.launcher, 0);
    assert.equal(
      await on.page.locator("[data-chat-first-agents-surface] article").count(),
      0,
      "Dispatch Agents should use compact rows instead of card articles",
    );
    assert.equal(
      await on.page
        .locator("[data-chat-first-agents-surface] [class*='border-dashed']")
        .count(),
      0,
      "Dispatch Agents empty/loading states should not use dashed cards",
    );
    assert.equal(
      await on.page.getByText("Subagents", { exact: true }).count(),
      1,
      "Dispatch Agents should use the compact Subagents section label",
    );

    await on.page.getByRole("button", { name: /Close Agents/ }).click();
    const closed = await snapshot(on.page, "07-chat-first-last-tab-closed");
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
    const browserSurface = await snapshot(on.page, "08-chat-first-browser");
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

    await on.page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openBrowser", {
          detail: { url: "https://example.org/second", title: "Second" },
        }),
      );
    });
    await on.page.waitForFunction(
      () =>
        document.querySelectorAll("[data-chat-first-browser-pane]").length ===
        2,
    );
    const browserTabs = await snapshot(on.page, "09-chat-first-browser-tabs");
    assert.equal(
      browserTabs.browser,
      2,
      "switching browser tabs must keep both browser panes mounted",
    );
    assert.equal(
      browserTabs.tabs,
      2,
      "each browser surface should have its own tab",
    );

    await on.page.getByRole("button", { name: "Close browser" }).click();
    await on.page.getByRole("button", { name: "Close browser" }).click();
    await on.page.keyboard.press("Control+Alt+b");
    const keyboardPicker = await snapshot(on.page, "10-chat-first-keyboard");
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
  electronApp?: ElectronApplication,
): Promise<ElectronSnapshot> {
  const snapshot = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".code-agents-main");
    return {
      hub: document.querySelectorAll(".desktop-chat-first-hub--enabled").length,
      rail: document.querySelectorAll("[data-chat-first-apps-rail]").length,
      panel: document.querySelectorAll("[data-chat-first-surface-panel]")
        .length,
      launcher: document.querySelectorAll(
        ".desktop-chat-first-surface-launcher",
      ).length,
      toggle: document.querySelectorAll("[data-chat-first-surface-toggle]")
        .length,
      cards: document.querySelectorAll("[data-surface-empty-state] > *").length,
      tabs: document.querySelectorAll(
        "[data-chat-first-surface-tabs] [role=tab]",
      ).length,
      browser: document.querySelectorAll("[data-chat-first-browser-pane]")
        .length,
      appPane: document.querySelectorAll("[data-chat-first-app-pane]").length,
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      chatWidth:
        document
          .querySelector<HTMLElement>(
            ".desktop-chat-first-hub > .code-agents-surface",
          )
          ?.getBoundingClientRect().width ?? 0,
      panelWidth:
        document
          .querySelector<HTMLElement>("[data-chat-first-surface-panel]")
          ?.getBoundingClientRect().width ?? 0,
      chatRight:
        document
          .querySelector<HTMLElement>(
            ".desktop-chat-first-hub > .code-agents-surface",
          )
          ?.getBoundingClientRect().right ?? 0,
      panelLeft:
        document
          .querySelector<HTMLElement>("[data-chat-first-surface-panel]")
          ?.getBoundingClientRect().left ?? 0,
    };
  });
  if (electronApp) await saveElectronScreenshot(electronApp, name);
  else await saveScreenshot(page, name);
  return snapshot;
}

async function openElectronAgentSurface(page: Page): Promise<void> {
  const shell = page.locator(".code-agents-surface");
  if ((await shell.count()) === 0) {
    await page.getByRole("button", { name: "Agent", exact: true }).click();
  }
  await shell.waitFor({ state: "visible", timeout: 15_000 });
}

async function installElectronAppCreationSmokeMock(
  electronApp: ElectronApplication,
): Promise<void> {
  const apps = ["content", "design", "mail", "calendar", "clips"].map((id) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    icon: "Code",
    description: "Smoke-test app",
    url: "",
    isBuiltIn: true,
    enabled: true,
    mode: "prod",
  }));
  await electronApp.evaluate(
    ({ ipcMain }, input) => {
      let created = false;
      const now = new Date().toISOString();
      const run = {
        id: "task-chat-first-app-creation-smoke",
        goalId: "task",
        title: "Notes app",
        subtitle: "Queued from Desktop",
        status: "queued",
        phase: "queued",
        progress: { label: "Queued", completed: 0, total: 1, percent: 0 },
        details: [],
        createdAt: now,
        updatedAt: now,
      };
      const app = {
        id: "local-notes-smoke",
        name: "Notes app",
        icon: "Code",
        description: "A smoke-test app",
        url: "",
        devPort: 5999,
        devUrl: "http://localhost:5999",
        localPath: "/tmp/local-notes-smoke",
        isBuiltIn: false,
        enabled: true,
        mode: "dev",
      };

      ipcMain.removeHandler("apps:create-from-prompt");
      ipcMain.handle("apps:create-from-prompt", async () => {
        created = true;
        return {
          ok: true,
          apps: [...input.apps, app],
          app,
          run,
          message: "Building Notes app.",
        };
      });
      ipcMain.removeHandler("code-agents:list-runs");
      ipcMain.handle("code-agents:list-runs", async (_event, goalId) => ({
        status: "ok",
        goalId: goalId ?? "task",
        runs: created ? [run] : [],
      }));
      ipcMain.removeHandler("code-agents:read-transcript");
      ipcMain.handle(
        "code-agents:read-transcript",
        async (_event, request) => ({
          status: "ok",
          runId: request?.runId ?? run.id,
          events: [
            {
              id: "chat-first-app-creation-smoke-event",
              runId: request?.runId ?? run.id,
              type: "user",
              text: "Build a notes app",
              createdAt: now,
            },
          ],
        }),
      );
    },
    { apps },
  );
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
      args: [
        mainPath,
        `--user-data-dir=${userDataPath}`,
        "--disable-gpu",
        ...(colorScheme === "dark" ? ["--force-dark-mode"] : []),
      ],
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
    const off = await electronSnapshot(
      page,
      "electron-01-chat-first-off",
      electronApp,
    );
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

    await page.evaluate(async (dispatchUrl) => {
      if (dispatchUrl) {
        await window.electronAPI.appConfig.update("dispatch", {
          mode: "prod",
          url: dispatchUrl,
        });
      }
      await window.electronAPI.frame.update({ chatFirstMode: true });
      location.reload();
    }, electronDispatchUrl);
    await page.waitForTimeout(5_000);
    await openElectronAgentSurface(page);

    const empty = await electronSnapshot(
      page,
      "electron-02-chat-first-no-tabs",
      electronApp,
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
    assert.equal(
      await page
        .locator(".code-agents-main-toolbar [data-chat-first-surface-toggle]")
        .count(),
      1,
      "Electron panel toggle should stay in the central toolbar above native webviews",
    );
    const defaultAppIds = await page
      .locator("[data-chat-first-app][data-app-id]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-app-id")),
      );
    assert.deepEqual(
      defaultAppIds.slice(0, 5),
      ["content", "design", "mail", "calendar", "clips"],
      "Electron first-run apps should use the shared default order",
    );
    assert.equal(
      await page.getByRole("button", { name: "Show more" }).count(),
      1,
      "Electron app rail should progressively disclose the remaining apps",
    );
    assert.equal(
      await page.locator("[data-chat-first-main-chat]").count(),
      0,
      "The Electron chat-first center should use the native coding chat",
    );
    assert.equal(
      await page.locator(".code-agents-workbench").count(),
      0,
      "The empty chat-first center should not show a workbench before a chat is selected",
    );
    const topNavColors = await page
      .locator(".code-agents-nav-list > button")
      .evaluateAll((buttons) =>
        buttons.map((button) => getComputedStyle(button).color),
      );
    assert.equal(
      new Set(topNavColors).size,
      1,
      `Electron chat-first top navigation should use one neutral text color (${topNavColors.join(", ")})`,
    );

    await installElectronAppCreationSmokeMock(electronApp);
    const createAppButton = page.locator(
      '[data-chat-first-apps-rail] button[aria-label="Create app"]',
    );
    assert.equal(
      await createAppButton.count(),
      1,
      "Electron chat-first rail should expose the New app trigger",
    );
    await createAppButton.click();
    const createAppPopover = page.locator("[data-chat-first-create-app]");
    await createAppPopover.waitFor({ state: "visible" });
    assert.equal(
      await createAppPopover.getByText("New app", { exact: true }).count(),
      1,
      "Electron New app trigger should open the prompt popover",
    );
    const createAppEditor = createAppPopover.locator(
      '[contenteditable="true"]',
    );
    await createAppEditor.click();
    await createAppEditor.pressSequentially("Build a notes app");
    await saveElectronScreenshot(electronApp, "electron-new-app-popover");
    const createAppSendButton = createAppPopover.locator(
      '[data-agent-composer-slot="send-button"]',
    );
    assert.equal(
      await createAppSendButton.count(),
      1,
      "Electron New app popover should expose the shared composer send control",
    );
    assert.equal(
      await createAppSendButton.isEnabled(),
      true,
      "Electron New app composer should enable send after typing",
    );
    await createAppSendButton.click();
    await createAppPopover.waitFor({ state: "hidden" });
    await page.waitForTimeout(1_000);
    await saveElectronScreenshot(electronApp, "electron-after-new-app");
    const createdChatRow = page
      .locator(".code-agents-run-list .an-chat-history-row")
      .filter({ hasText: "Notes app" });
    await createdChatRow.waitFor({ state: "visible", timeout: 15_000 });
    const createdChat = createdChatRow.locator(".an-chat-history-row__button");
    await createdChat.waitFor({ state: "visible" });
    assert.equal(
      await createdChat.getByText("Notes app", { exact: true }).count(),
      1,
      "Electron app creation should add a selectable normal chat row",
    );
    await createdChat.click();
    assert.match(
      (await createdChatRow.getAttribute("class")) ?? "",
      /an-chat-history-row--active/,
      "Electron app creation chat row should be selectable",
    );
    await page.getByRole("button", { name: "Show more" }).click();
    await saveElectronScreenshot(
      electronApp,
      "electron-after-new-app-show-more",
    );
    assert.equal(
      await page
        .locator('[data-chat-first-app][data-app-id="local-notes-smoke"]')
        .count(),
      1,
      "Electron app creation should add the app to the Apps rail",
    );

    await page
      .locator(".code-agents-rail-footer")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await page.locator(".settings-page-tabs-nav").waitFor({ state: "visible" });
    const settingsLayout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(
        ".settings-panel--page",
      );
      const sidebar = document.querySelector<HTMLElement>(
        ".settings-page-tabs-nav",
      );
      return {
        panelWidth: panel?.getBoundingClientRect().width ?? 0,
        viewportWidth: window.innerWidth,
        sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
      };
    });
    assert.ok(
      settingsLayout.panelWidth >= settingsLayout.viewportWidth - 1,
      "Electron settings should occupy the full desktop page",
    );
    assert.ok(
      settingsLayout.sidebarWidth >= 180,
      "Electron settings should expose the section rail",
    );
    assert.equal(
      await page.getByPlaceholder("Search settings…").count(),
      1,
      "Electron settings should expose the shared settings search",
    );
    for (const label of [
      "General",
      "AI providers",
      "Workspace",
      "Keyboard shortcuts",
    ]) {
      assert.equal(
        await page.getByRole("tab", { name: label, exact: true }).count(),
        1,
        `Electron settings should expose ${label}`,
      );
    }
    await saveElectronScreenshot(electronApp, "electron-02-settings");
    await page.getByRole("button", { name: "Back to app" }).click();
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator(".settings-panel--page").count(),
      0,
      "closing Electron settings should return to the workbench",
    );

    await page.getByRole("button", { name: "Show less" }).click();
    const chatFirstNav = await page
      .locator(".code-agents-nav-list")
      .innerText();
    assert.doesNotMatch(chatFirstNav, /Agent chat|Code work/);
    assert.doesNotMatch(chatFirstNav, /Mobile|Computer access/);
    assert.equal(
      await page.locator(".code-agents-overview--chat").count(),
      1,
      "Selecting the new app should open the normal coding chat",
    );
    assert.equal(
      await page.locator(".code-agents-workbench").count(),
      0,
      "Chat-first app creation should stay in the chat instead of opening a separate workbench",
    );

    const closePreview = page.getByRole("button", { name: "Close browser" });
    if (await closePreview.count()) await closePreview.click();
    const electronToggle = page.locator("[data-chat-first-surface-toggle]");
    if ((await page.locator("[data-chat-first-surface-panel]").count()) === 0) {
      await electronToggle.click();
    }
    await page
      .locator("[data-chat-first-surface-panel]")
      .waitFor({ state: "visible" });
    const picker = await electronSnapshot(
      page,
      "electron-03-surface-picker",
      electronApp,
    );
    assert.equal(picker.panel, 1);
    assert.ok(
      picker.chatWidth < empty.chatWidth - 1,
      "Electron side surface should shrink the conversation column",
    );
    assert.ok(
      picker.panelWidth >= 340 && picker.panelLeft >= picker.chatRight - 1,
      "Electron side surface should be an inline column beside the conversation",
    );
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
    const agents = await electronSnapshot(
      page,
      "electron-04-agents",
      electronApp,
    );
    assert.equal(
      agents.panel,
      1,
      "opening Agents should mount Electron's panel",
    );
    assert.ok(agents.tabs >= 1);
    assert.equal(agents.launcher, 0);
    assert.equal(
      await page.locator("[data-chat-first-agents-surface] article").count(),
      0,
      "Agents should use compact rows instead of card articles",
    );
    assert.equal(
      await page
        .locator("[data-chat-first-agents-surface] [class*='border-dashed']")
        .count(),
      0,
      "Agents empty/loading states should not use dashed cards",
    );
    assert.equal(
      await page.getByText("Subagents", { exact: true }).count(),
      1,
      "Agents should use the compact Subagents section label",
    );

    await page.getByRole("button", { name: /Close Agents/ }).click();
    const closed = await electronSnapshot(
      page,
      "electron-05-last-tab-closed",
      electronApp,
    );
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
    await page.locator("[data-chat-first-browser-pane]").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const browserSurface = await electronSnapshot(
      page,
      "electron-06-browser",
      electronApp,
    );
    assert.equal(browserSurface.panel, 1);
    assert.equal(browserSurface.browser, 1);
    for (const label of ["Back", "Forward", /Reload/]) {
      assert.equal(
        await page.getByRole("button", { name: label }).count(),
        1,
        `Electron ${label} browser control should be visible`,
      );
    }

    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openBrowser", {
          detail: { url: "https://example.org/second", title: "Second" },
        }),
      );
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-chat-first-browser-pane]").length ===
        2,
    );
    const browserTabs = await electronSnapshot(
      page,
      "electron-07-browser-tabs",
      electronApp,
    );
    assert.equal(
      browserTabs.browser,
      2,
      "Electron must keep both browser panes mounted across tab switches",
    );
    assert.equal(browserTabs.tabs, 2);

    await page.getByRole("button", { name: "Close browser" }).click();
    await page.getByRole("button", { name: "Close browser" }).click();
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative:openApp", {
          detail: { app: "mail", url: "https://evil.test/login" },
        }),
      );
    });
    const hostileNotice = page.locator("[data-chat-first-notice]");
    await hostileNotice.waitFor({ state: "visible", timeout: 15_000 });
    assert.match(
      (await hostileNotice.textContent()) ?? "",
      /not registered|not enabled|could not be opened/i,
      "Electron hostile open_app should explain why no pane opened",
    );
    assert.equal(
      await page.locator("[data-chat-first-app-pane]").count(),
      0,
      "Electron hostile open_app must not mount an app pane",
    );
    assert.equal(
      await page.locator("[data-chat-first-surface-panel]").count(),
      0,
      "Electron hostile open_app must not mount the side panel",
    );
    await saveElectronScreenshot(electronApp, "electron-08-hostile-open-app");
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
