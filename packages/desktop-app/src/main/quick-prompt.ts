import path from "node:path";

import { CODE_AGENTS_SURFACE_ID } from "@shared/code-agents";
import {
  IPC,
  type CodeAgentCreateRunResult,
  type DesktopOpenRequest,
  type QuickPromptPreferences,
  type QuickPromptSettings,
  type QuickPromptSubmitRequest,
} from "@shared/ipc-channels";
import { QUICK_PROMPT_ACCELERATOR } from "@shared/quick-prompt";
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";

import * as AppStore from "./app-store";

const QUICK_PROMPT_SURFACE = "quick-prompt";
const QUICK_PROMPT_WIDTH = 460;
const QUICK_PROMPT_HEIGHT = 108;

interface QuickPromptDependencies {
  createCodeAgentRun: (input: unknown) => Promise<CodeAgentCreateRunResult>;
  sendOpenRequestToRenderer: (
    request: DesktopOpenRequest,
    options?: { stealFocus?: boolean },
  ) => void;
}

let quickPromptWindow: BrowserWindow | null = null;
let quickPromptShortcutRegistered = false;
let quickPromptShortcutError: string | undefined;
let quickPromptDependencies: QuickPromptDependencies | null = null;

function debugQuickPrompt(message: string, details?: unknown): void {
  if (process.env.AGENT_NATIVE_DESKTOP_SHORTCUT_DEBUG !== "1") return;
  if (details === undefined) {
    console.info(`[desktop-shortcut] ${message}`);
  } else {
    console.info(`[desktop-shortcut] ${message}`, details);
  }
}

function getQuickPromptSettings(): QuickPromptSettings {
  const preferences = AppStore.loadQuickPromptPreferences();
  return {
    ...preferences,
    accelerator: QUICK_PROMPT_ACCELERATOR,
    registered: quickPromptShortcutRegistered,
    ...(quickPromptShortcutError ? { error: quickPromptShortcutError } : {}),
  };
}

function positionQuickPromptWindow(window: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const bounds = display.workArea;
  const [width, height] = window.getSize();
  const x = bounds.x + Math.round((bounds.width - width) / 2);
  const y = bounds.y + Math.round((bounds.height - height) / 2);
  window.setPosition(x, y, false);
}

function hideQuickPrompt(): void {
  if (quickPromptWindow && !quickPromptWindow.isDestroyed()) {
    quickPromptWindow.hide();
  }
}

function createQuickPromptWindow(): BrowserWindow {
  if (quickPromptWindow && !quickPromptWindow.isDestroyed()) {
    return quickPromptWindow;
  }

  const window = new BrowserWindow({
    width: QUICK_PROMPT_WIDTH,
    height: QUICK_PROMPT_HEIGHT,
    minWidth: QUICK_PROMPT_WIDTH,
    minHeight: QUICK_PROMPT_HEIGHT,
    maxWidth: 1200,
    maxHeight: 360,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin"
      ? {
          vibrancy: "under-window" as const,
          visualEffectState: "active" as const,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  window.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    positionQuickPromptWindow(window);
    window.show();
    window.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
  });

  window.on("closed", () => {
    if (quickPromptWindow === window) quickPromptWindow = null;
  });

  void window.loadFile(path.join(__dirname, "../renderer/index.html"), {
    search: `?surface=${QUICK_PROMPT_SURFACE}`,
  });
  quickPromptWindow = window;
  return window;
}

function showQuickPrompt(): void {
  if (!app.isReady()) return;

  const window = createQuickPromptWindow();
  if (window.isVisible()) {
    hideQuickPrompt();
    return;
  }

  positionQuickPromptWindow(window);
  window.show();
  window.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
  debugQuickPrompt("quick prompt triggered", {
    accelerator: QUICK_PROMPT_ACCELERATOR,
  });
}

function unregisterQuickPromptShortcut(): void {
  if (quickPromptShortcutRegistered) {
    globalShortcut.unregister(QUICK_PROMPT_ACCELERATOR);
  }
  quickPromptShortcutRegistered = false;
}

export function registerQuickPromptShortcut(): void {
  unregisterQuickPromptShortcut();
  quickPromptShortcutError = undefined;

  const preferences = AppStore.loadQuickPromptPreferences();
  if (!preferences.enabled) {
    debugQuickPrompt("quick prompt disabled", {
      accelerator: QUICK_PROMPT_ACCELERATOR,
    });
    return;
  }

  const registered = globalShortcut.register(
    QUICK_PROMPT_ACCELERATOR,
    showQuickPrompt,
  );
  quickPromptShortcutRegistered = registered;
  if (!registered) {
    quickPromptShortcutError = "Another app already owns this shortcut.";
    debugQuickPrompt("quick prompt registration failed", {
      accelerator: QUICK_PROMPT_ACCELERATOR,
    });
    return;
  }

  debugQuickPrompt("quick prompt registered", {
    accelerator: QUICK_PROMPT_ACCELERATOR,
  });
}

function normalizeQuickPromptUpdate(
  value: unknown,
): Partial<QuickPromptPreferences> {
  if (typeof value !== "object" || value === null) return {};
  const enabled = (value as { enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? { enabled } : {};
}

async function submitQuickPrompt(
  request: QuickPromptSubmitRequest,
): Promise<CodeAgentCreateRunResult> {
  if (!quickPromptDependencies) {
    return {
      ok: false,
      message: "The desktop prompt is not ready yet.",
      error: "Quick Prompt dependencies are unavailable.",
    };
  }

  const result = await quickPromptDependencies.createCodeAgentRun({
    prompt: request?.prompt,
    ...(request?.cwd ? { cwd: request.cwd } : {}),
    ...(request?.attachments ? { attachments: request.attachments } : {}),
    metadata: { source: "quick-prompt" },
  });
  if (!result.ok || !result.run) return result;

  hideQuickPrompt();
  quickPromptDependencies.sendOpenRequestToRenderer(
    {
      app: CODE_AGENTS_SURFACE_ID,
      goalId: result.run.goalId,
      runId: result.run.id,
    },
    { stealFocus: true },
  );
  return result;
}

export function registerQuickPromptIpc(
  dependencies: QuickPromptDependencies,
): void {
  quickPromptDependencies = dependencies;

  ipcMain.handle(IPC.QUICK_PROMPT_LOAD, getQuickPromptSettings);
  ipcMain.handle(IPC.QUICK_PROMPT_UPDATE, (_event, value: unknown) => {
    AppStore.saveQuickPromptPreferences(normalizeQuickPromptUpdate(value));
    registerQuickPromptShortcut();
    return getQuickPromptSettings();
  });
  ipcMain.on(IPC.QUICK_PROMPT_DISMISS, hideQuickPrompt);
  ipcMain.handle(
    IPC.QUICK_PROMPT_SUBMIT,
    (_event, request: QuickPromptSubmitRequest) => submitQuickPrompt(request),
  );

  app.on("will-quit", () => {
    unregisterQuickPromptShortcut();
    quickPromptWindow?.destroy();
    quickPromptWindow = null;
  });
}
