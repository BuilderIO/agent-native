// @vitest-environment happy-dom
import { getComposerDraftKey } from "@agent-native/toolkit/composer/draft-key";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const LEGACY_KEY = getComposerDraftKey("desktop:quick-prompt");
const EARLIER_KEY = getComposerDraftKey("desktop:quick-prompt:earlier-load");
const CREATE_APP_KEY = getComposerDraftKey("desktop:chat-first:create-app");

let container: HTMLDivElement;
let root: Root;

// The composer stack is slow to transform on a cold cache.
beforeAll(async () => {
  stubElectronApi();
  await import("./QuickPromptOverlay.js");
}, 120_000);

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stubElectronApi();
  // The composer probes origin-relative endpoints the file:// shell never has.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "electronAPI");
});

function stubElectronApi() {
  const model = {
    engine: "codex-cli",
    engineLabel: "Codex",
    model: "test-model",
    label: "Test model",
    configured: true,
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      platform: "darwin",
      quickPrompt: {
        setSetupRequired: vi.fn(),
        setPickerOpen: vi.fn(),
        onHidden: vi.fn(() => () => {}),
        dismiss: vi.fn(),
        openProviderSettings: vi.fn(),
      },
      codeAgents: {
        listProjects: vi.fn(async () => ({ projects: [] })),
        listModels: vi.fn(async () => ({
          status: "ok",
          models: [model],
          selected: { engine: model.engine, model: model.model },
        })),
      },
    },
  });
}

async function mountOverlay() {
  const { default: QuickPromptOverlay } =
    await import("./QuickPromptOverlay.js");
  const queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <QuickPromptOverlay onDismiss={vi.fn()} onSubmit={vi.fn()} />
      </QueryClientProvider>,
    );
  });
}

function quickPromptKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(getComposerDraftKey("desktop:quick-prompt")))
      keys.push(key);
  }
  return keys;
}

async function type(text: string) {
  const editor = container.querySelector<HTMLElement>(
    '[contenteditable="true"]',
  );
  if (!editor) throw new Error("Missing composer");
  await act(async () => {
    editor.focus();
    editor.textContent = text;
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
}

describe("Quick Prompt draft ownership", () => {
  it("does not restore an earlier load's draft and removes the old keys", async () => {
    localStorage.setItem(LEGACY_KEY, "<p>A private acquisition notes</p>");
    localStorage.setItem(EARLIER_KEY, "<p>A earlier draft</p>");
    localStorage.setItem(CREATE_APP_KEY, "<p>unrelated draft</p>");

    await mountOverlay();

    expect(container.textContent).not.toContain("A private acquisition notes");
    expect(container.textContent).not.toContain("A earlier draft");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(localStorage.getItem(EARLIER_KEY)).toBeNull();
    expect(localStorage.getItem(CREATE_APP_KEY)).toBe("<p>unrelated draft</p>");
  });

  it("keeps the draft when the overlay is shown again in the same load", async () => {
    await mountOverlay();
    await type("A unsent text");
    expect(quickPromptKeys()).toHaveLength(1);
    const [key] = quickPromptKeys();
    expect(key).not.toBe(LEGACY_KEY);

    act(() => root.unmount());
    root = createRoot(container);
    await mountOverlay();

    expect(container.textContent).toContain("A unsent text");
    expect(quickPromptKeys()).toEqual([key]);
  });

  it("does not restore a draft saved by an earlier load", async () => {
    await mountOverlay();
    await type("A unsent text");
    const savedKey = quickPromptKeys()[0] ?? "";
    expect(savedKey).not.toBe("");
    const savedDraft = localStorage.getItem(savedKey);
    act(() => root.unmount());

    // A new renderer load is a fresh module instance.
    vi.resetModules();
    root = createRoot(container);
    await mountOverlay();

    expect(container.textContent).not.toContain("A unsent text");
    expect(savedDraft).toContain("A unsent text");
    expect(localStorage.getItem(savedKey)).toBeNull();
  });
});
