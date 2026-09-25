// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/toolkit/design-system", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/toolkit/design-system")
    >();
  return {
    ...actual,
    // A native select stands in for the Radix one so the test can pick.
    Picker: ({
      options,
      value,
      onChange,
      "aria-label": ariaLabel,
    }: {
      options: { value: string; label: string }[];
      value: string | null;
      onChange: (value: string | null) => void;
      "aria-label"?: string;
    }) => (
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

vi.mock("./useBuilderStatus.js", () => ({
  useBuilderStatus: () => ({
    status: {
      configured: false,
      privateKeyConfigured: false,
      publicKeyConfigured: false,
    },
    refetch: vi.fn(),
  }),
  useBuilderConnectFlow: () => ({ start: vi.fn() }),
}));

vi.mock("./deferred-builder-connect-popover.js", () => ({
  DeferredBuilderConnectPopover: ({ children }: { children: unknown }) =>
    children,
}));

import { VoiceTranscriptionSection } from "./VoiceTranscriptionSection.js";

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
  const puts: unknown[] = [];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    puts.length = 0;
    prefsGet = () => json({ transcriptionMode: "mac-native" });
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
        if (url.endsWith("/voice-cleanup-prefs")) return json(null);
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
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(<VoiceTranscriptionSection compact />);
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
