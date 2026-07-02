#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFromCore = createRequire(
  path.join(repoRoot, "packages/core/package.json"),
);
const { chromium } = requireFromCore(
  "playwright",
) as typeof import("playwright");

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type StyleSnapshot = {
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
};

type SmokeSnapshot = {
  root: Rect;
  toolbar: Rect;
  plus: Rect;
  mode: Rect;
  spacer: Rect;
  model: Rect;
  send: Rect;
  folder?: Rect;
  modeStyle: StyleSnapshot;
  modelStyle: StyleSnapshot;
};

function read(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function assertSourceContract(): void {
  const codeAgentsApp = read("packages/code-agents-ui/src/CodeAgentsApp.tsx");
  const tiptapComposer = read(
    "packages/core/src/client/composer/TiptapComposer.tsx",
  );
  const agentFrame = read(
    "packages/core/src/client/composer/AgentComposerFrame.tsx",
  );
  const codeStyles = read("packages/code-agents-ui/src/styles.css");

  assert.match(
    agentFrame,
    /agent-composer-root flex flex-col rounded-lg border border-input bg-muted\/45/,
    "AgentComposerFrame should continue owning the shared composer root shell",
  );
  assert.match(
    codeAgentsApp,
    /<PromptComposer[\s\S]*className="code-agents-standard-composer code-agents-composer-shell"[\s\S]*layoutVariant=\{variant\}/,
    "Agent-Native Code should render the shared PromptComposer shell",
  );
  assert.match(
    codeAgentsApp,
    /<NewSessionComposer[\s\S]*\/>[\s\S]*<ProjectFolderPicker[\s\S]*variant="bar"/,
    "Agent-Native Code should keep the folder picker below the new-session composer",
  );

  const toolbarStart = tiptapComposer.indexOf("agent-composer-toolbar");
  const plusIndex = tiptapComposer.indexOf("<ComposerPlusMenu", toolbarStart);
  const hostSlotIndex = tiptapComposer.indexOf(
    "{toolbarSlot ?? modeControl}",
    toolbarStart,
  );
  const spacerIndex = tiptapComposer.indexOf(
    'data-agent-composer-slot="toolbar-spacer"',
    toolbarStart,
  );
  const modelIndex = tiptapComposer.indexOf("<ModelSelector", toolbarStart);
  const sendIndex = tiptapComposer.indexOf(
    "agent-composer-send-button",
    toolbarStart,
  );
  assert.ok(
    toolbarStart >= 0,
    "TiptapComposer should render a composer toolbar",
  );
  assert.ok(
    plusIndex < hostSlotIndex &&
      hostSlotIndex < spacerIndex &&
      spacerIndex < modelIndex &&
      modelIndex < sendIndex,
    "TiptapComposer toolbar order should stay plus, host slot, spacer, model, send",
  );

  assert.match(
    codeStyles,
    /\.code-agents-standard-composer \[data-agent-composer-slot="toolbar"\][\s\S]*justify-content:\s*flex-start/,
    "Code composer toolbar should remain a normal left-to-right flex row",
  );
  assert.match(
    codeStyles,
    /\.code-agents-standard-composer[\s\S]*\[data-agent-composer-slot="toolbar"\][\s\S]*>\s*\[data-agent-composer-slot="toolbar-spacer"\][\s\S]*flex:\s*1 1 auto/,
    "Code composer toolbar should keep a flex spacer before the right controls",
  );
  assert.match(
    codeStyles,
    /\.code-agents-standard-composer \.desktop-select-trigger[\s\S]*font-size:\s*11px !important/,
    "Code mode picker should use the compact composer font size",
  );
  assert.match(
    codeStyles,
    /\.code-agents-standard-composer \[data-agent-composer-slot="model-button"\][\s\S]*font-size:\s*11px !important/,
    "Code model picker should match the compact composer font size",
  );
  assert.match(
    codeAgentsApp,
    /showingSelectedRunDetail[\s\S]*code-agents-overview--chat/,
    "Agent-Native Code should mark selected transcript views with a chat layout class",
  );
  assert.match(
    codeStyles,
    /\.code-agents-overview--chat\s*\{[\s\S]*overflow:\s*hidden/,
    "Selected Agent-Native Code transcripts should keep scrolling inside the chat, not the outer overview",
  );
}

function fixtureHtml(): string {
  const codeStyles = read("packages/code-agents-ui/src/styles.css");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: #111;
        color: #e5e5e5;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button { font: inherit; }
      .agent-composer-area { flex-shrink: 0; padding: 8px 12px; }
      .agent-composer-root {
        display: flex;
        flex-direction: column;
        border: 1px solid hsl(var(--input, 220 4% 14%));
        border-radius: 8px;
        background: hsl(var(--background, 220 6% 6%));
      }
      .agent-composer-editor-wrap { padding: 8px 8px 4px; }
      .agent-composer-editor { min-width: 0; }
      .ProseMirror { min-height: 52px; outline: none; }
      .agent-composer-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
      }
      .flex-1 { flex: 1 1 auto; min-width: 12px; }
      .shrink-0 { flex-shrink: 0; }
      .agent-composer-mode-button,
      .agent-composer-model-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: hsl(var(--muted-foreground, 220 4% 60%));
        padding: 4px 8px;
        font-size: 12px;
        font-weight: 500;
        line-height: 16px;
      }
      .agent-composer-model-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .agent-composer-send-button {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 6px;
        background: hsl(var(--primary, 0 0% 75%));
        color: hsl(var(--primary-foreground, 220 6% 6%));
      }
      .standard-sidebar-fixture {
        --background: 0 0% 100%;
        --foreground: 222 47% 11%;
        --input: 214 32% 91%;
        --primary: 222 47% 11%;
        --primary-foreground: 210 40% 98%;
        --muted-foreground: 215 16% 47%;
        width: 390px;
        margin: 32px auto;
        color: hsl(var(--foreground));
        background: hsl(var(--background));
      }
      .standard-sidebar-fixture .agent-composer-root { background: hsl(var(--background)); }
      .standard-sidebar-fixture .ProseMirror { min-height: 52px; font-size: 14px; }
      ${codeStyles}
    </style>
  </head>
  <body>
    <section class="code-agents-surface" aria-label="Agent-Native Code">
      <aside class="code-agents-rail" aria-label="Agent-Native Code goals and sessions"></aside>
      <main class="code-agents-main">
        <div class="code-agents-overview">
          <div class="code-agents-start">
            <h2>What should we build in framework?</h2>
            <div
              data-smoke="code-composer"
              data-agent-composer-variant="hero"
              data-agent-composer-slot="area"
              class="agent-composer-area shrink-0 px-3 py-2 text-left code-agents-standard-composer code-agents-composer-shell agent-composer-area--hero"
            >
              <div data-agent-composer-variant="hero" data-agent-composer-slot="root" class="agent-composer-root flex flex-col rounded-lg border border-input bg-background agent-composer-root--hero">
                <div data-agent-composer-variant="hero" data-agent-composer-slot="editor-wrap" class="agent-composer-editor-wrap px-2 pt-2 pb-1">
                  <div data-agent-composer-variant="hero" data-agent-composer-slot="editor" class="agent-composer-editor aui-composer flex-1 min-w-0 px-0.5">
                    <div data-agent-composer-variant="hero" data-agent-composer-slot="editor-input" class="ProseMirror agent-composer-prosemirror" contenteditable="true">Describe a task or ask a question</div>
                  </div>
                </div>
                <div data-agent-composer-variant="hero" data-agent-composer-slot="toolbar" class="agent-composer-toolbar flex items-center gap-1 px-2 py-1.5">
                  <button class="code-composer-plus" aria-label="Add attachment" type="button">+</button>
                  <div class="code-agents-composer-mode-slot">
                    <button class="desktop-select-trigger code-agents-mode-select" aria-label="Mode" type="button">Auto</button>
                  </div>
                  <div data-agent-composer-slot="toolbar-spacer" class="flex-1"></div>
                  <button data-agent-composer-slot="model-button" class="agent-composer-model-button" aria-label="Model" type="button"><span>Claude Sonnet 4.6</span></button>
                  <button data-agent-composer-slot="send-button" class="agent-composer-send-button shrink-0" aria-label="Send message" type="button">↑</button>
                </div>
              </div>
            </div>
            <div
              data-smoke="code-folder-picker"
              class="code-agents-project-picker code-agents-project-picker--bar"
            >
              <p class="code-agents-rail-label">Folder</p>
              <div class="code-agents-project-picker__row">
                <button class="desktop-select-trigger code-agents-project-select" aria-label="Select coding folder" type="button">framework</button>
                <button class="code-agents-icon-button" aria-label="Add folder" type="button">+</button>
              </div>
              <p class="code-agents-project-path">/Users/steve/Projects/builder/agent-native/framework</p>
            </div>
          </div>
        </div>
      </main>
    </section>
    <section data-smoke="sidebar-composer" class="standard-sidebar-fixture">
      <div class="agent-composer-area shrink-0 px-3 py-2">
        <div data-agent-composer-slot="root" class="agent-composer-root flex flex-col rounded-lg border border-input bg-background">
          <div data-agent-composer-slot="editor-wrap" class="agent-composer-editor-wrap px-2 pt-2 pb-1">
            <div data-agent-composer-slot="editor" class="agent-composer-editor aui-composer flex-1 min-w-0 px-0.5">
              <div data-agent-composer-slot="editor-input" class="ProseMirror" contenteditable="true">Ask the agent</div>
            </div>
          </div>
          <div data-agent-composer-slot="toolbar" class="agent-composer-toolbar flex items-center gap-1 px-2 py-1.5">
            <button class="sidebar-composer-plus agent-composer-mode-button" aria-label="Add attachment" type="button">+</button>
            <button data-agent-composer-slot="mode-button" class="agent-composer-mode-button" aria-label="Mode" type="button">Chat</button>
            <div data-agent-composer-slot="toolbar-spacer" class="flex-1"></div>
            <button data-agent-composer-slot="model-button" class="agent-composer-model-button" aria-label="Model" type="button"><span>Claude Sonnet</span></button>
            <button data-agent-composer-slot="send-button" class="agent-composer-send-button shrink-0" aria-label="Send message" type="button">↑</button>
          </div>
        </div>
      </div>
    </section>
    <section
      data-smoke="code-chat-layout"
      class="code-agents-surface"
      style="height: 420px; width: 900px; margin: 32px auto;"
      aria-label="Agent-Native Code chat layout"
    >
      <aside class="code-agents-rail" aria-label="Agent-Native Code goals and sessions"></aside>
      <main class="code-agents-main">
        <div data-smoke="code-chat-overview" class="code-agents-overview code-agents-overview--chat">
          <div class="code-agents-detail code-agents-detail--chat">
            <div class="code-agents-chat-header">
              <div>
                <h3>Review transcript scroll behavior</h3>
                <p>Updated just now</p>
              </div>
            </div>
            <div class="code-agents-transcript">
              <div
                class="code-agents-transcript__assistant"
                style="display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1 1 auto;"
              >
                <div
                  data-smoke="code-chat-scroll"
                  style="flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;"
                >
                  <div
                    class="agent-thread-content"
                    style="display: flex; flex-direction: column; gap: 16px; padding: 16px;"
                  >
                    <p>First transcript block with enough text to establish the scroll container.</p>
                    <p>Second transcript block with enough text to establish the scroll container.</p>
                    <p>Third transcript block with enough text to establish the scroll container.</p>
                    <p>Fourth transcript block with enough text to establish the scroll container.</p>
                    <p>Fifth transcript block with enough text to establish the scroll container.</p>
                    <p>Sixth transcript block with enough text to establish the scroll container.</p>
                    <p>Seventh transcript block with enough text to establish the scroll container.</p>
                    <p>Eighth transcript block with enough text to establish the scroll container.</p>
                    <p>Ninth transcript block with enough text to establish the scroll container.</p>
                    <p data-smoke="code-chat-last">Final transcript line must remain above the composer after scrolling to the bottom.</p>
                  </div>
                </div>
                <div
                  data-smoke="code-chat-composer"
                  data-agent-composer-variant="default"
                  data-agent-composer-slot="area"
                  class="agent-composer-area shrink-0 px-3 py-2 text-left code-agents-standard-composer code-agents-composer-shell"
                >
                  <div data-agent-composer-slot="root" class="agent-composer-root flex flex-col rounded-lg border border-input bg-background">
                    <div data-agent-composer-slot="editor-wrap" class="agent-composer-editor-wrap px-2 pt-2 pb-1">
                      <div data-agent-composer-slot="editor" class="agent-composer-editor aui-composer flex-1 min-w-0 px-0.5">
                        <div data-agent-composer-slot="editor-input" class="ProseMirror agent-composer-prosemirror" contenteditable="true">Send a follow-up...</div>
                      </div>
                    </div>
                    <div data-agent-composer-slot="toolbar" class="agent-composer-toolbar flex items-center gap-1 px-2 py-1.5">
                      <button class="code-composer-plus" aria-label="Add attachment" type="button">+</button>
                      <div data-agent-composer-slot="toolbar-spacer" class="flex-1"></div>
                      <button data-agent-composer-slot="model-button" class="agent-composer-model-button" aria-label="Model" type="button"><span>Auto</span></button>
                      <button data-agent-composer-slot="send-button" class="agent-composer-send-button shrink-0" aria-label="Send message" type="button">↑</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </section>
  </body>
</html>`;
}

async function launchBrowser() {
  const channel = process.env.PLAYWRIGHT_CHANNEL || "chrome";
  try {
    return await chromium.launch({ channel, headless: true });
  } catch (channelError) {
    if (process.env.PLAYWRIGHT_CHANNEL) throw channelError;
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      throw new Error(
        [
          "Could not launch Playwright Chromium for composer geometry smoke.",
          `Chrome channel error: ${
            channelError instanceof Error
              ? channelError.message.split("\n")[0]
              : String(channelError)
          }`,
          `Bundled Chromium error: ${
            bundledError instanceof Error
              ? bundledError.message.split("\n")[0]
              : String(bundledError)
          }`,
          "Install a browser with `pnpm exec playwright install chromium` or set PLAYWRIGHT_CHANNEL to an installed channel.",
        ].join("\n"),
      );
    }
  }
}

function approxEqual(actual: string, expected: string, label: string): void {
  assert.equal(actual, expected, label);
}

function assertComposerGeometry(
  snapshot: SmokeSnapshot,
  label: string,
  options: { hasFolder: boolean },
): void {
  assert.ok(
    snapshot.plus.left - snapshot.root.left <= 22,
    `${label}: plus button should stay near the composer bottom-left edge`,
  );
  assert.ok(
    snapshot.plus.top >= snapshot.toolbar.top - 1 &&
      snapshot.plus.bottom <= snapshot.toolbar.bottom + 1,
    `${label}: plus button should be vertically contained in the toolbar`,
  );
  assert.ok(
    snapshot.plus.top > snapshot.root.top + snapshot.root.height * 0.45,
    `${label}: plus button should stay in the lower toolbar, not the editor row`,
  );
  assert.ok(
    snapshot.mode.right < snapshot.spacer.left + 1,
    `${label}: mode picker should sit before the toolbar spacer`,
  );
  assert.ok(
    snapshot.spacer.width >= 24,
    `${label}: toolbar spacer should reserve flexible space before model picker`,
  );
  assert.ok(
    snapshot.model.left > snapshot.mode.right + 24,
    `${label}: model picker should be right-aligned away from the mode picker`,
  );
  assert.ok(
    snapshot.model.right <= snapshot.send.left - 2,
    `${label}: model picker should remain immediately left of send`,
  );
  assert.ok(
    snapshot.root.right - snapshot.send.right <= 14,
    `${label}: send button should anchor the right edge of the toolbar group`,
  );
  approxEqual(
    snapshot.modelStyle.fontSize,
    snapshot.modeStyle.fontSize,
    `${label}: model picker should match mode picker font size`,
  );
  approxEqual(
    snapshot.modelStyle.fontFamily,
    snapshot.modeStyle.fontFamily,
    `${label}: model picker should match mode picker font family`,
  );
  approxEqual(
    snapshot.modelStyle.fontWeight,
    snapshot.modeStyle.fontWeight,
    `${label}: model picker should match mode picker font weight`,
  );

  if (options.hasFolder) {
    assert.ok(snapshot.folder, `${label}: expected folder picker geometry`);
    assert.ok(
      snapshot.folder!.top >= snapshot.root.bottom - 10,
      `${label}: folder picker should be below the composer, not beside or inside it`,
    );
    assert.ok(
      Math.abs(snapshot.folder!.left - snapshot.root.left) <= 24,
      `${label}: folder picker should align with the composer group`,
    );
  }
}

async function captureSnapshot(
  page: import("playwright").Page,
  rootSelector: string,
  selectors: {
    plus: string;
    mode: string;
    model: string;
    send: string;
    folder?: string;
  },
): Promise<SmokeSnapshot> {
  const payloadJson = JSON.stringify({ rootSelector, selectors }).replace(
    /</g,
    "\\u003c",
  );
  return page.evaluate(`(() => {
      const { rootSelector, selectors } = ${payloadJson};
      function readElement(selector) {
        const element = document.querySelector(selector);
        if (!element) throw new Error("Missing selector: " + selector);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          rect: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          style: {
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
          },
        };
      }

      const root = readElement(rootSelector + " .agent-composer-root").rect;
      const toolbar = readElement(
        rootSelector + " .agent-composer-toolbar",
      ).rect;
      const plus = readElement(selectors.plus).rect;
      const mode = readElement(selectors.mode);
      const spacer = readElement(
        rootSelector + " [data-agent-composer-slot=\\"toolbar-spacer\\"]",
      ).rect;
      const model = readElement(selectors.model);
      const send = readElement(selectors.send).rect;
      const folder = selectors.folder
        ? readElement(selectors.folder).rect
        : undefined;

      return {
        root,
        toolbar,
        plus,
        mode: mode.rect,
        spacer,
        model: model.rect,
        send,
        folder,
        modeStyle: mode.style,
        modelStyle: model.style,
      };
    })()`);
}

async function main(): Promise<void> {
  assertSourceContract();

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.setContent(fixtureHtml(), { waitUntil: "load" });

    const codeSnapshot = await captureSnapshot(
      page,
      '[data-smoke="code-composer"]',
      {
        plus: '[data-smoke="code-composer"] .code-composer-plus',
        mode: '[data-smoke="code-composer"] .code-agents-mode-select',
        model: '[data-smoke="code-composer"] .agent-composer-model-button',
        send: '[data-smoke="code-composer"] .agent-composer-send-button',
        folder: '[data-smoke="code-folder-picker"]',
      },
    );
    assertComposerGeometry(codeSnapshot, "Agent-Native Code composer", {
      hasFolder: true,
    });

    const sidebarSnapshot = await captureSnapshot(
      page,
      '[data-smoke="sidebar-composer"]',
      {
        plus: '[data-smoke="sidebar-composer"] .sidebar-composer-plus',
        mode: '[data-smoke="sidebar-composer"] .agent-composer-mode-button[aria-label="Mode"]',
        model: '[data-smoke="sidebar-composer"] .agent-composer-model-button',
        send: '[data-smoke="sidebar-composer"] .agent-composer-send-button',
      },
    );
    assertComposerGeometry(sidebarSnapshot, "Shared sidebar composer", {
      hasFolder: false,
    });

    const chatLayout = await page.evaluate(() => {
      const overview = document.querySelector<HTMLElement>(
        '[data-smoke="code-chat-overview"]',
      );
      const scroll = document.querySelector<HTMLElement>(
        '[data-smoke="code-chat-scroll"]',
      );
      const composer = document.querySelector<HTMLElement>(
        '[data-smoke="code-chat-composer"]',
      );
      const last = document.querySelector<HTMLElement>(
        '[data-smoke="code-chat-last"]',
      );
      if (!overview || !scroll || !composer || !last) {
        throw new Error("Missing code chat layout smoke element");
      }
      scroll.scrollTop = scroll.scrollHeight;
      const scrollRect = scroll.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();

      return {
        overviewOverflowY: getComputedStyle(overview).overflowY,
        innerCanScroll: scroll.scrollHeight > scroll.clientHeight + 1,
        scrollBottom: scrollRect.bottom,
        composerTop: composerRect.top,
        lastBottom: lastRect.bottom,
      };
    });

    assert.equal(
      chatLayout.overviewOverflowY,
      "hidden",
      "Agent-Native Code selected chat view should not create an outer scroll layer",
    );
    assert.ok(
      chatLayout.innerCanScroll,
      "Agent-Native Code selected chat view should keep transcript scrolling inside the chat",
    );
    assert.ok(
      chatLayout.scrollBottom <= chatLayout.composerTop + 1,
      "Agent-Native Code selected chat scroll area should end before the composer",
    );
    assert.ok(
      chatLayout.lastBottom <= chatLayout.composerTop + 1,
      "Agent-Native Code selected chat content should not sit under the composer",
    );
  } finally {
    await browser.close();
  }

  console.log("Composer geometry smoke passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
