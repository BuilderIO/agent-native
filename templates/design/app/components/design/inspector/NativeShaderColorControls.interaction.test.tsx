// @vitest-environment happy-dom

import type { EffectColor, EffectColorStop } from "@shared/native-effects";
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

const rampProperty = {
  type: "color-ramp" as const,
  label: "Palette",
  default: initial,
  maxCount: 8,
};

const spotColors: EffectColor[] = [
  {
    space: "display-p3",
    components: [0.123456, 0.654321, 0.222222],
    alpha: 0.456789,
  },
  { space: "srgb", components: [0.08, 0.24, 0.72], alpha: 0.35 },
  { space: "srgb", components: [0.9, 0.3, 0.1], alpha: 0.75 },
];

const spotProperty = {
  type: "color-array" as const,
  label: "Colors",
  default: spotColors,
  maxCount: 5,
};

function ControlledRamp({
  onCommit,
}: {
  onCommit: (stops: EffectColorStop[]) => void;
}) {
  const [stops, setStops] = useState(initial);
  return (
    <NativeShaderColorControls
      label="Palette"
      property={rampProperty}
      value={stops}
      disabled={false}
      onChange={(next) => setStops(next as EffectColorStop[])}
      onCommit={(next) => onCommit(next as EffectColorStop[])}
    />
  );
}

function ControlledPalette({
  onCommit,
}: {
  onCommit: (colors: EffectColor[]) => void;
}) {
  const [colors, setColors] = useState(spotColors);
  return (
    <NativeShaderColorControls
      label="Colors"
      property={spotProperty}
      value={colors}
      disabled={false}
      onChange={(next) => setColors(next as EffectColor[])}
      onCommit={(next) => onCommit(next as EffectColor[])}
    />
  );
}

describe("NativeShaderColorControls inline colors", () => {
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

  it("keeps a positioned ramp inline, with its existing add/remove behavior", () => {
    const commits = vi.fn<(stops: EffectColorStop[]) => void>();
    act(() => root.render(<ControlledRamp onCommit={commits} />));

    expect(container.querySelectorAll("[data-stop-row]")).toHaveLength(2);
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Stop position"]',
      ),
    ).not.toBeNull();
    const add = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add stop"]',
    );
    act(() => add!.click());
    expect(container.querySelectorAll("[data-stop-row]")).toHaveLength(3);
    expect(
      commits.mock.calls[commits.mock.calls.length - 1]![0].map(
        (stop) => stop.position,
      ),
    ).toEqual([0, 0.125, 0.25]);
    const selected = container.querySelector<HTMLElement>(
      "[data-stop-row][data-selected]",
    );
    act(() =>
      selected
        ?.querySelector<HTMLButtonElement>('button[aria-label="Remove stop"]')
        ?.click(),
    );
    expect(commits.mock.calls[commits.mock.calls.length - 1]![0]).toEqual(
      initial,
    );
  });

  it("keeps a generic color array in the shared inline palette editor", () => {
    const commits = vi.fn<(colors: EffectColor[]) => void>();
    act(() => root.render(<ControlledPalette onCommit={commits} />));

    expect(container.querySelectorAll("[data-stop-row]")).toHaveLength(3);
    expect(commits).not.toHaveBeenCalled();
  });
});
