// @vitest-environment happy-dom

import type { Attachment } from "@assistant-ui/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PastedTextChip } from "./PastedTextChip.js";
import { ComposerRuntimeAdaptersProvider } from "./runtime-adapters.js";

describe("PastedTextChip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("formats pasted-text counts with the runtime locale formatter", async () => {
    const text = Array.from({ length: 12_345 }, () => "line").join("\n");
    const attachment = {
      id: "pasted-1",
      type: "file",
      name: "pasted-text-1.txt",
      content: [{ type: "text", text }],
    } as Attachment;

    await act(async () => {
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            formatNumber: (value) =>
              new Intl.NumberFormat("de-DE").format(value),
            translate: (key, options) =>
              key === "agentChat.pastedText.lines"
                ? `${String(options?.formattedCount)} lines`
                : String(options?.defaultValue ?? key),
          }}
        >
          <PastedTextChip attachment={attachment} />
        </ComposerRuntimeAdaptersProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("12.345 lines");
    });
  });

  it("makes Remove its own button beside the preview trigger", async () => {
    const onRemove = vi.fn();
    const attachment = {
      id: "pasted-2",
      type: "file",
      name: "pasted-text-2.txt",
      content: [{ type: "text", text: "hello" }],
    } as Attachment;

    await act(async () => {
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            formatNumber: (value) => String(value),
            translate: (key, options) => String(options?.defaultValue ?? key),
          }}
        >
          <PastedTextChip attachment={attachment} onRemove={onRemove} />
        </ComposerRuntimeAdaptersProvider>,
      );
    });

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove pasted text"]',
    );
    const preview = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Preview pasted text"]',
    );
    expect(remove?.tabIndex).toBe(0);
    expect(preview?.contains(remove ?? null)).toBe(false);

    await act(async () => remove?.click());
    expect(onRemove).toHaveBeenCalledWith("pasted-2");
    expect(preview?.getAttribute("aria-expanded")).toBe("false");
  });
});
