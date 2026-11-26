// @vitest-environment happy-dom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

it("mounts the real quick prompt composer from the desktop renderer entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input instanceof Request ? input.url : input).includes(
        "/_agent-native/auth/session",
      )
        ? new Response(JSON.stringify({ error: "Not authenticated" }), {
            status: 401,
          })
        : new Response("{}", { status: 200 }),
    ),
  );
  Object.assign(window, {
    electronAPI: {
      platform: "linux",
      sentry: { enabled: false },
      quickPrompt: {
        dismiss: vi.fn(),
        submit: vi.fn(async () => ({ ok: true })),
        setSetupRequired: vi.fn(),
        setPickerOpen: vi.fn(),
        onHidden: () => () => {},
      },
      codeAgents: {
        listProjects: async () => ({ projects: [] }),
        listModels: async () => ({
          status: "ok",
          models: [
            {
              engine: "codex-cli",
              engineLabel: "Test",
              model: "fixture",
              label: "Fixture",
              configured: true,
            },
          ],
          selected: { engine: "codex-cli", model: "fixture" },
        }),
      },
    },
  });
  window.history.replaceState({}, "", "/?surface=quick-prompt");
  const container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  const originalCreateRoot = ReactDOM.createRoot;
  let root: ReturnType<typeof ReactDOM.createRoot> | undefined;
  const createRoot = vi
    .spyOn(ReactDOM, "createRoot")
    .mockImplementation((...args) => {
      root = originalCreateRoot(...args);
      return root;
    });
  try {
    await act(async () => {
      await import("./main.js");
    });
    expect(
      container.querySelector('[role="dialog"][aria-label="Prompt"]'),
    ).not.toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(
      container.querySelector("[data-renderer-error-boundary]"),
    ).toBeNull();
  } finally {
    if (root) await act(async () => root?.unmount());
    createRoot.mockRestore();
    container.remove();
  }
  // The composer stack is slow to transform on a cold cache.
}, 120_000);

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
