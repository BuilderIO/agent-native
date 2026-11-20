// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pill's own chat tests replace AgentKitAssistantChat with a stub. This one
// mounts the real chat, which needs the React Query client from the window root.
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: (name: string, handler: (event: { payload?: unknown }) => void) => {
    mocks.listeners.set(name, handler);
    return Promise.resolve(() => {});
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerSize: async () => ({ width: 0, height: 0 }),
    scaleFactor: async () => 1,
    setSize: async () => undefined,
    onResized: async () => () => {},
    startDragging: async () => undefined,
  }),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../components/live-waveform", () => ({ LiveWaveform: () => null }));
vi.mock("../lib/url", () => ({
  loadStoredServerUrl: () => "https://example.test",
}));
vi.mock("./live-transcript", () => ({ LiveTranscript: () => null }));
vi.mock("./pill-logo", () => ({ PillLogo: () => null }));

function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError)
    return error.errors.flatMap(errorMessages);
  return [error instanceof Error ? error.message : String(error)];
}

describe("meeting pill with the real AgentKit chat", () => {
  let host: HTMLDivElement;
  let root: Root;
  let errors: string[];

  async function settle(work: () => void): Promise<void> {
    try {
      await act(async () => {
        work();
        await Promise.resolve();
        await Promise.resolve();
      });
    } catch (error) {
      errors.push(...errorMessages(error));
    }
  }

  async function startMeeting(tree: ReactElement): Promise<void> {
    await settle(() => root.render(tree));
    const onContext = mocks.listeners.get("clips:pill-context");
    expect(onContext).toBeDefined();
    await settle(() =>
      onContext?.({ payload: { mode: "meeting", meetingId: "meeting-1" } }),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.listeners.clear();
    errors = [];
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ configured: true, chatEligible: true }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host, {
      onUncaughtError: (error) => errors.push(...errorMessages(error)),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays mounted under the desktop window providers", async () => {
    const [{ DesktopProviders }, { MeetingPill }] = await Promise.all([
      import("../desktop-providers"),
      import("./recording-pill"),
    ]);

    await startMeeting(
      <DesktopProviders>
        <MeetingPill />
      </DesktopProviders>,
    );

    expect(errors).toEqual([]);
    expect(host.querySelector(".pill-agentkit-chat")).not.toBeNull();
    const composer = host.querySelector(".pill-agentkit-composer");
    expect(composer?.innerHTML).toContain("Ask anything");
    expect(composer?.innerHTML).not.toContain("Placeholder");
  });

  it("unmounts under the language provider alone", async () => {
    const [{ AgentNativeI18nProvider }, { i18nCatalog }, { MeetingPill }] =
      await Promise.all([
        import("@agent-native/core/client/i18n"),
        import("../../../app/i18n"),
        import("./recording-pill"),
      ]);

    await startMeeting(
      <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
        <MeetingPill />
      </AgentNativeI18nProvider>,
    );

    expect(
      errors.some((message) => message.includes("No QueryClient set")),
    ).toBe(true);
    expect(host.childElementCount).toBe(0);
  });
});
