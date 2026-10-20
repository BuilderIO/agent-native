// @vitest-environment happy-dom

import type { EffectColorStop } from "@shared/native-effects";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeShaderColorControls } from "./NativeShaderColorControls";

const initial: EffectColorStop[] = [
  {
    position: 0,
    color: { space: "srgb", components: [0.08, 0.24, 0.72], alpha: 0.35 },
  },
  {
    position: 0.25,
    color: { space: "srgb", components: [0.02, 0.72, 0.54], alpha: 0.8 },
  },
];

const property = {
  type: "color-ramp" as const,
  label: "Palette",
  default: initial,
  maxCount: 8,
};

function ControlledPalette({
  onCommit,
  starting = initial,
}: {
  onCommit: (stops: EffectColorStop[]) => void;
  starting?: EffectColorStop[];
}) {
  const [stops, setStops] = useState(starting);
  return (
    <NativeShaderColorControls
      label="Palette"
      property={property}
      value={stops}
      disabled={false}
      onChange={(next) => {
        if (Array.isArray(next)) setStops(next as EffectColorStop[]);
      }}
      onCommit={(next) => {
        if (Array.isArray(next)) onCommit(next as EffectColorStop[]);
      }}
    />
  );
}

describe("NativeShaderColorControls palette interactions", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("selects and focuses an added color, then removes only it while committing the full alpha palette", () => {
    const commits = vi.fn<(stops: EffectColorStop[]) => void>();
    act(() => root.render(<ControlledPalette onCommit={commits} />));

    const add = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add stop"]',
    );
    expect(add).not.toBeNull();
    act(() => add!.click());

    const rows = [
      ...container.querySelectorAll<HTMLElement>("[data-stop-row]"),
    ];
    expect(rows).toHaveLength(3);
    const selected = container.querySelector<HTMLElement>(
      "[data-stop-row][data-selected]",
    );
    expect(selected).toBe(rows[1]);
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-pressed="true"]'),
    );
    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls[0]![0]).toHaveLength(3);
    expect(commits.mock.calls[0]![0].map((stop) => stop.color.alpha)).toEqual([
      0.35, 0.575, 0.8,
    ]);
    expect(commits.mock.calls[0]![0].map((stop) => stop.position)).toEqual([
      0, 0.125, 0.25,
    ]);

    act(() => {
      selected
        ?.querySelector<HTMLButtonElement>('button[aria-label="Remove stop"]')
        ?.click();
    });

    expect(container.querySelectorAll("[data-stop-row]")).toHaveLength(2);
    expect(commits).toHaveBeenCalledTimes(2);
    expect(commits.mock.calls[1]![0]).toEqual(initial);
    expect(commits.mock.calls[1]![0].map((stop) => stop.color.alpha)).toEqual([
      0.35, 0.8,
    ]);
  });

  it("preserves exact color components when only a stop position changes", () => {
    const exactStops: EffectColorStop[] = [
      {
        position: 0,
        color: {
          space: "srgb",
          components: [0.081234, 0.243456, 0.725678],
          alpha: 0.351234,
        },
      },
      {
        position: 0.25,
        color: {
          space: "display-p3",
          components: [0.123456, 0.654321, 0.222222],
          alpha: 0.456789,
        },
      },
    ];
    const commits = vi.fn<(stops: EffectColorStop[]) => void>();
    act(() =>
      root.render(
        <ControlledPalette onCommit={commits} starting={exactStops} />,
      ),
    );

    const position = container.querySelector<HTMLInputElement>(
      'input[aria-label="Stop position"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(position).not.toBeNull();
    expect(setValue).toBeDefined();
    act(() => {
      setValue!.call(position, "8");
      position!.dispatchEvent(new Event("input", { bubbles: true }));
      position!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(commits).toHaveBeenCalledTimes(1);
    expect(commits.mock.calls[0]![0]).toEqual([
      { ...exactStops[0]!, position: 0.08 },
      exactStops[1],
    ]);
  });
});
