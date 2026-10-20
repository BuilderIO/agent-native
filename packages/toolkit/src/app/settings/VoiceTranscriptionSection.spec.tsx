// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mountFailurePaths, builderStatusMock } = vi.hoisted(() => ({
  mountFailurePaths: new Set<string>(),
  builderStatusMock: {
    status: {
      configured: false,
      privateKeyConfigured: false,
      publicKeyConfigured: false,
    } as {
      configured: boolean;
      privateKeyConfigured: boolean;
      publicKeyConfigured: boolean;
    } | null,
    error: null as string | null,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => {
    if (mountFailurePaths.has(path))
      throw new Error("Workspace mount unavailable");
    return path;
  },
  appMountedPath: (path: string) => path,
}));

// A native select stands in for the Radix one so the test can pick. The
// options come from the SelectItems, the name from the SelectTrigger.
vi.mock("@agent-native/toolkit/ui/select", () => {
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const SelectTrigger = (_props: Props) => null;
  const SelectItem = (_props: Props) => null;
  const Passthrough = ({ children }: Props) => <>{children}</>;
  const collect = (
    children: React.ReactNode,
    found: { label?: string; options: { value: string; label: string }[] },
  ) => {
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement<Props>(child)) return;
      if (child.type === SelectTrigger) {
        found.label = child.props["aria-label"] as string;
      } else if (child.type === SelectItem) {
        found.options.push({
          value: child.props.value as string,
          label: String(child.props.children),
        });
      } else {
        collect(child.props.children, found);
      }
    });
    return found;
  };
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const { label, options } = collect(children, { options: [] });
      return (
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    },
    SelectContent: Passthrough,
    SelectGroup: Passthrough,
    SelectItem,
    SelectTrigger,
    SelectValue: () => null,
  };
});

vi.mock("./useBuilderStatus.js", () => ({
  useBuilderStatus: () => ({
    status: builderStatusMock.status,
    error: builderStatusMock.error,
    refetch: builderStatusMock.refetch,
  }),
  useBuilderConnectFlow: () => ({ start: vi.fn() }),
}));

vi.mock("./deferred-builder-connect-popover.js", () => ({
  DeferredBuilderConnectPopover: ({ children }: { children: unknown }) =>
    children,
}));

import { createToolkitI18nCatalog } from "../i18n.js";
import { VoiceTranscriptionSection } from "./VoiceTranscriptionSection.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VoiceTranscriptionSection compact picker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let prefsGet: Handler;
  let prefsPut: Handler;
  let cleanupPrefsGet: Handler;
  const puts: unknown[] = [];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mountFailurePaths.clear();
    builderStatusMock.status = {
      configured: false,
      privateKeyConfigured: false,
      publicKeyConfigured: false,
    };
    builderStatusMock.error = null;
    builderStatusMock.refetch.mockClear();
    puts.length = 0;
    prefsGet = () => json({ transcriptionMode: "mac-native" });
    cleanupPrefsGet = () => json(null);
    prefsPut = (init) => {
      puts.push(JSON.parse(String(init?.body)));
      return json({ ok: true });
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/voice-transcription-prefs")) {
          return init?.method === "PUT" ? prefsPut(init) : prefsGet(init);
        }
        if (url.endsWith("/voice-cleanup-prefs")) return cleanupPrefsGet(init);
        if (url.endsWith("/voice-providers/status")) {
          return json({
            builder: false,
            gemini: false,
            openai: false,
            groq: false,
            googleRealtime: false,
            browser: true,
          });
        }
        return json(null, 404);
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mountFailurePaths.clear();
    vi.unstubAllGlobals();
  });

  async function render(compact = true) {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitI18nCatalog}
          persistPreference={false}
        >
          <VoiceTranscriptionSection compact={compact} />
        </AgentNativeI18nProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function select() {
    return container.querySelector<HTMLSelectElement>(
      'select[aria-label="Voice transcription"]',
    );
  }

  async function choose(value: string) {
    await act(async () => {
      const element = select()!;
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("renders one row anchored for the Preferences search entry", async () => {
    await render();
    const row = container.querySelector("#voice");
    expect(row?.textContent).toContain("Voice transcription");
    expect(row?.textContent).toContain(
      "Choose how voice input is transcribed.",
    );
    expect(select()?.value).toBe("mac-native");
    expect([...select()!.options].map((option) => option.textContent)).toEqual([
      "Mac Native",
      "Google Realtime",
      "Batch",
    ]);
  });

  it("saves the chosen mode with its matching batch provider", async () => {
    await render();
    await choose("batch");
    expect(select()?.value).toBe("batch");
    expect(puts).toEqual([
      { transcriptionMode: "batch", provider: "auto", instructions: "" },
    ]);
  });

  it("rolls back and says so when the save fails", async () => {
    prefsPut = () => json({ error: "nope" }, 500);
    await render();
    await choose("batch");
    expect(select()?.value).toBe("mac-native");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not save your voice transcription setting.",
    );
  });

  it("shows a read failure instead of presenting Batch as the saved choice", async () => {
    prefsGet = () => json({ error: "down" }, 500);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not load your voice transcription setting.",
    );
    expect(select()).toBeNull();
  });

  it("shows and retries a synchronous preference mount-resolution failure", async () => {
    mountFailurePaths.add(
      "/_agent-native/application-state/voice-transcription-prefs",
    );

    await render();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load your voice transcription setting.",
    );
    expect(select()).toBeNull();
    expect(container.textContent).not.toContain("Batch");

    mountFailurePaths.clear();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(select()?.value).toBe("mac-native");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not present the default mode as saved in full settings after a read failure", async () => {
    mountFailurePaths.add(
      "/_agent-native/application-state/voice-transcription-prefs",
    );

    await render(false);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load your voice transcription setting.",
    );
    expect(container.textContent).not.toContain("Batch");

    mountFailurePaths.clear();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Batch");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows provider-status mount failures and recovers on retry", async () => {
    mountFailurePaths.add("/_agent-native/voice-providers/status");

    await render(false);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load this. Please try again.",
    );
    expect(container.textContent).not.toContain("Configure");

    mountFailurePaths.clear();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows and retries a synchronous cleanup preference mount failure", async () => {
    mountFailurePaths.add(
      "/_agent-native/application-state/voice-cleanup-prefs",
    );

    await render(false);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load this. Please try again.",
    );

    mountFailurePaths.clear();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[aria-label="AI cleanup"]')).toBeTruthy();
  });

  it("treats an empty cleanup preference response as unset", async () => {
    cleanupPrefsGet = () => new Response(null, { status: 200 });

    await render(false);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[aria-label="AI cleanup"]')).toBeTruthy();
  });

  it("offers a retry when Builder status fails before cleanup can default", async () => {
    builderStatusMock.status = null;
    builderStatusMock.error = "Builder status unavailable";

    await render(false);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Couldn't load this. Please try again.",
    );
    const retry = Array.from(alert?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeTruthy();

    await act(async () => {
      retry?.click();
    });

    expect(builderStatusMock.refetch).toHaveBeenCalledTimes(1);
  });

  it("rolls back and recovers when saving preferences hits a synchronous mount failure", async () => {
    await render();
    mountFailurePaths.add(
      "/_agent-native/application-state/voice-transcription-prefs",
    );

    await choose("batch");

    expect(select()?.value).toBe("mac-native");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not save your voice transcription setting.",
    );

    mountFailurePaths.clear();
    await choose("batch");

    expect(select()?.value).toBe("batch");
    expect(puts).toEqual([
      { transcriptionMode: "batch", provider: "auto", instructions: "" },
    ]);
  });

  it("rolls back and recovers when cleanup save hits a synchronous mount failure", async () => {
    await render(false);
    mountFailurePaths.add(
      "/_agent-native/application-state/voice-cleanup-prefs",
    );

    const cleanupSwitch = container.querySelector<HTMLButtonElement>(
      '[aria-label="AI cleanup"]',
    );
    expect(cleanupSwitch).toBeTruthy();
    await act(async () => {
      cleanupSwitch!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not save your voice transcription setting.",
    );

    mountFailurePaths.clear();
    await act(async () => {
      cleanupSwitch!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["an empty 200, as the server sends for a missing key", ""],
    ["a JSON null", "null"],
  ])(
    "treats a never-saved preference (%s) as the Batch default",
    async (_label, body) => {
      prefsGet = () => new Response(body, { status: 200 });
      await render();
      expect(select()?.value).toBe("batch");
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it("shows a read failure for a body that is not JSON", async () => {
    prefsGet = () => new Response("<html>", { status: 200 });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not load your voice transcription setting.",
    );
  });
});
