// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceProvider, WorkspaceReadResult } from "./workspace/types";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * store.tsx transitively imports model-registry.ts, which requires the real
 * `monaco-editor` package (window/canvas-heavy, can't load under vitest — see
 * model-registry.spec.ts and editor/StatusBar.test.ts for the same
 * constraint). These tests fake the model-registry module surface instead, so
 * the store's reducer/dispatch wiring — dirty tracking, stale-echo handling,
 * preview-tab pinning, reload-buffer — can be exercised end to end through
 * `WorkbenchProvider` + `useWorkbench()` with real React state.
 */

interface FakeModelEntry {
  content: string;
  savedContent: string;
  language: string;
  disposed: boolean;
}

const models = new Map<string, FakeModelEntry>();
let applyingExternal = new Set<string>();

vi.mock("./model-registry", () => {
  const modelRegistry = {
    has: (uri: string) => models.has(uri),
    get: (uri: string) => {
      const entry = models.get(uri);
      if (!entry) return undefined;
      return {
        model: {
          isDisposed: () => entry.disposed,
          getValue: () => entry.content,
          getAlternativeVersionId: () => 0,
          // store.tsx's subscribeDirtyTracking attaches a listener here on
          // every model it sees; the store-level tests below drive dirty
          // state directly through api.markDirty/applyExternalRead instead
          // of simulating Monaco's synchronous edit-event firing (that
          // exact race is covered at the model-registry level in
          // model-registry.spec.ts), so this only needs to exist, not fire.
          onDidChangeContent: () => ({ dispose: () => {} }),
        },
        savedAltVersionId: 0,
        viewState: null,
      };
    },
    ensureModel: (uri: string, content: string, language: string) => {
      const existing = models.get(uri);
      if (existing && !existing.disposed) return existing;
      const entry: FakeModelEntry = {
        content,
        savedContent: content,
        language,
        disposed: false,
      };
      models.set(uri, entry);
      return entry;
    },
    getContent: (uri: string) => models.get(uri)?.content ?? null,
    isDirty: (uri: string) => {
      const entry = models.get(uri);
      if (!entry || entry.disposed) return false;
      return entry.content !== entry.savedContent;
    },
    isApplyingExternalContent: (uri: string) => applyingExternal.has(uri),
    applyExternalContent: (uri: string, content: string) => {
      const entry = models.get(uri);
      if (!entry || entry.disposed) return;
      if (entry.content === content) {
        entry.savedContent = entry.content;
        return;
      }
      applyingExternal.add(uri);
      entry.content = content;
      applyingExternal.delete(uri);
      entry.savedContent = content;
    },
    reloadContent: (uri: string, content: string, language: string) => {
      const entry = models.get(uri);
      if (!entry || entry.disposed) return;
      entry.language = language;
      modelRegistry.applyExternalContent(uri, content);
    },
    markSaved: (uri: string) => {
      const entry = models.get(uri);
      if (entry) entry.savedContent = entry.content;
    },
    saveViewState: () => {},
    getViewState: () => null,
    dispose: (uri: string) => {
      const entry = models.get(uri);
      if (entry) entry.disposed = true;
      models.delete(uri);
    },
    disposeAll: () => {
      models.clear();
    },
  };
  return { modelRegistry };
});

const { WorkbenchProvider, useWorkbench } = await import("./store");
type WorkbenchApi = ReturnType<typeof useWorkbench>["api"];
type WorkbenchState = ReturnType<typeof useWorkbench>["state"];

function makeProvider(overrides: { content: string; versionHash: string }): {
  provider: WorkspaceProvider;
  setRead: (read: WorkspaceReadResult) => void;
} {
  let current: WorkspaceReadResult = {
    content: overrides.content,
    versionHash: overrides.versionHash,
  };
  const provider: WorkspaceProvider = {
    key: "inline:test",
    kind: "inline",
    label: "Design files",
    capabilities: { write: true, create: true, rename: true, delete: true },
    listFiles: async () => [],
    readFile: async () => current,
    writeFile: async () => ({ versionHash: "saved-1" }),
  };
  return {
    provider,
    setRead: (read) => {
      current = read;
    },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
  }
  root = null;
  container = null;
  models.clear();
  applyingExternal = new Set();
});

function mount(providers: WorkspaceProvider[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let latest: { state: WorkbenchState; api: WorkbenchApi } | null = null;
  function Capture() {
    const { state, api } = useWorkbench();
    latest = { state, api };
    return null;
  }
  act(() => {
    root!.render(
      <WorkbenchProvider providers={providers}>
        <Capture />
      </WorkbenchProvider>,
    );
  });
  return {
    get: () => latest!,
  };
}

describe("WorkbenchProvider", () => {
  it("does not pin a preview tab when an external (agent/poll) edit lands on it", async () => {
    // Regression test for the store↔model-registry dirty-tracking race: an
    // external content replacement used to synchronously report the buffer
    // as dirty (see model-registry.spec.ts), which store.tsx's markDirty
    // then treated as a real user edit and pinned the preview tab. Agent
    // edits arriving on a previewed file must never silently convert it into
    // a pinned tab.
    const { provider } = makeProvider({
      content: "<h1>hello</h1>",
      versionHash: "v1",
    });
    const harness = mount([provider]);

    await act(async () => {
      await harness.get().api.openFile(provider.key, "index.html", {
        preview: true,
      });
    });

    const uri = harness.get().state.tabs[0]?.uri;
    expect(uri).toBeDefined();
    expect(harness.get().state.tabs[0]?.preview).toBe(true);
    expect(harness.get().state.buffers[uri!]?.dirty).toBe(false);

    act(() => {
      harness.get().api.applyExternalRead(uri!, {
        content: "<h1>hello from the agent</h1>",
        versionHash: "v2",
      });
    });

    expect(harness.get().state.buffers[uri!]?.dirty).toBe(false);
    // The core regression: the tab must still be a preview tab (italic,
    // replaced by the next preview open) — not silently pinned.
    expect(harness.get().state.tabs[0]?.preview).toBe(true);
  });

  it("still marks the buffer dirty and pins the preview tab on a real user edit", async () => {
    const { provider } = makeProvider({
      content: "<h1>hi</h1>",
      versionHash: "v1",
    });
    const harness = mount([provider]);

    await act(async () => {
      await harness.get().api.openFile(provider.key, "index.html", {
        preview: true,
      });
    });
    const uri = harness.get().state.tabs[0]!.uri;

    act(() => {
      // Simulate a real keystroke: mutate the fake model directly, then
      // report it the same way the real onDidChangeContent subscriber would.
      const entry = models.get(uri)!;
      entry.content = "<h1>hi, edited by hand</h1>";
      harness.get().api.markDirty(uri, true);
    });

    expect(harness.get().state.buffers[uri]?.dirty).toBe(true);
    expect(harness.get().state.tabs[0]?.preview).toBe(false);
  });

  it("reloadBuffer force-replaces content on an already-open buffer (conflict 'reload latest')", async () => {
    // Regression test: reloadBuffer used to call the initial-load path,
    // which is deliberately a content no-op once a model already exists —
    // so clicking "reload latest" after a conflict silently did nothing.
    const { provider, setRead } = makeProvider({
      content: "original content",
      versionHash: "v1",
    });
    const harness = mount([provider]);

    await act(async () => {
      await harness.get().api.openFile(provider.key, "notes.md");
    });
    const uri = harness.get().state.tabs[0]!.uri;
    expect(harness.get().state.buffers[uri]?.savedVersionHash).toBe("v1");

    // Simulate a local dirty edit, then the server having moved on (a
    // conflict), then the user explicitly choosing to reload latest.
    models.get(uri)!.content = "local unsaved edit";
    setRead({ content: "content from someone else", versionHash: "v2" });

    await act(async () => {
      await harness.get().api.reloadBuffer(uri);
    });

    expect(models.get(uri)?.content).toBe("content from someone else");
    expect(harness.get().state.buffers[uri]?.dirty).toBe(false);
    expect(harness.get().state.buffers[uri]?.conflict).toBe(false);
    expect(harness.get().state.buffers[uri]?.savedVersionHash).toBe("v2");
  });
});
