// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { beginEyedropperPick } from "./DesignColorControls";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import {
  nativeEffectColorChannel,
  nativeEffectColorCss,
  nativeColorFromHsv,
  nativeColorToHsv,
  PrecisionColorChannel,
  NativeEffectColorControl,
} from "./NativeEffectColorControl";

describe("native effect color channels", () => {
  const p3 = {
    space: "display-p3" as const,
    components: [0.123456, 0.654321, 0.876543] as [number, number, number],
    alpha: 0.345678,
  };

  it("preserves P3 and untouched floating channels during a channel edit", () => {
    expect(nativeEffectColorChannel(p3, 1, 0.25)).toEqual({
      space: "display-p3",
      components: [0.123456, 0.25, 0.876543],
      alpha: 0.345678,
    });
    expect(p3.components[1]).toBe(0.654321);
  });

  it("preserves channels and space during an alpha edit", () => {
    expect(nativeEffectColorChannel(p3, 3, 0.9)).toEqual({
      ...p3,
      alpha: 0.9,
    });
  });

  it("renders gamut values without quantizing to eight-bit hex", () => {
    expect(nativeEffectColorCss(p3)).toBe(
      "color(display-p3 0.123456 0.654321 0.876543 / 0.345678)",
    );
  });

  it("keeps P3 space and floating components through the shared color-plane model", () => {
    const same = nativeColorFromHsv(p3, nativeColorToHsv(p3));
    expect(same.space).toBe("display-p3");
    expect(same.alpha).toBe(p3.alpha);
    same.components.forEach((part, index) =>
      expect(part).toBeCloseTo(p3.components[index], 10),
    );
  });

  it("does not commit a precise channel on focus and blur, but commits a real edit", () => {
    const onCommit = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <PrecisionColorChannel
          label="Red"
          value={0.123456789}
          disabled={false}
          onCommit={onCommit}
        />,
      ),
    );
    const input = host.querySelector("input")!;
    act(() => {
      input.focus();
      input.blur();
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "0.25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.blur());
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.25);
    act(() => root.unmount());
    host.remove();
  });

  it("cancels a dirty precise channel with Escape and commits Enter only once", () => {
    const onCommit = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <PrecisionColorChannel
          label="Red"
          value={0.123456789}
          disabled={false}
          onCommit={onCommit}
        />,
      ),
    );
    const input = host.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const edit = (text: string) =>
      act(() => {
        input.focus();
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    edit("0.25");
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("0.123456789");
    edit("0.5");
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.5);
    act(() => root.unmount());
    host.remove();
  });

  it("surfaces an unexpected eyedropper rejection", async () => {
    vi.stubGlobal(
      "EyeDropper",
      class {
        open() {
          return Promise.reject(new Error("device failure"));
        }
      },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <NativeEffectColorControl
          label="Color"
          value={{ ...p3, space: "srgb" }}
          disabled={false}
          onChange={vi.fn()}
        />,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const picker = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) =>
      button.getAttribute("aria-label")?.toLowerCase().includes("eyedropper"),
    );
    expect(picker).toBeDefined();
    await act(async () => picker!.click());
    expect(toast.error).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("ignores late eyedropper results after a newer color or unmount", async () => {
    let resolvePick: ((result: { sRGBHex: string }) => void) | undefined;
    vi.stubGlobal(
      "EyeDropper",
      class {
        open() {
          return new Promise<{ sRGBHex: string }>((resolve) => {
            resolvePick = resolve;
          });
        }
      },
    );
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (red: number) =>
      root.render(
        <NativeEffectColorControl
          label="Color"
          value={{ ...p3, space: "srgb", components: [red, 0.3, 0.4] }}
          disabled={false}
          onChange={onChange}
        />,
      );
    await act(async () => render(0.1));
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    const picker = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button
            .getAttribute("aria-label")
            ?.toLowerCase()
            .includes("eyedropper"),
      )!;
    await act(async () => picker().click());
    await act(async () => render(0.2));
    await act(async () => resolvePick!({ sRGBHex: "#123456" }));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => picker().click());
    await act(async () => root.unmount());
    await act(async () => resolvePick!({ sRGBHex: "#654321" }));
    expect(onChange).not.toHaveBeenCalled();
    host.remove();
    vi.unstubAllGlobals();
  });

  it("treats only an AbortError as an eyedropper cancellation", async () => {
    vi.stubGlobal(
      "EyeDropper",
      class {
        open() {
          return Promise.reject(new DOMException("cancelled", "AbortError"));
        }
      },
    );
    await expect(beginEyedropperPick()).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});
