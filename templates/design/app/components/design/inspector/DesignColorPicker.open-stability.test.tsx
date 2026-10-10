// @vitest-environment happy-dom

import { editNativeEffectHtml } from "@shared/native-effect-edits";
import { GRAIN_GRADIENT_EFFECT } from "@shared/native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "@shared/native-effects";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DesignColorPicker } from "./DesignColorPicker";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(documentColors: string[], open: boolean) {
  act(() => {
    root.render(
      <TooltipProvider>
        <DesignColorPicker
          value="#ff0000"
          onChange={() => {}}
          open={open}
          onOpenChange={() => {}}
          documentColors={documentColors}
          trigger={<button type="button">Open picker</button>}
        />
      </TooltipProvider>,
    );
  });
}

const swatchCount = () =>
  document.querySelectorAll(".grid.grid-cols-8 > *").length;

it("keeps the document palette fixed while the picker is open", () => {
  render(["#111111", "#222222"], true);
  expect(swatchCount()).toBe(2);

  render(["#111111", "#222222", "#333333"], true);
  expect(swatchCount()).toBe(2);

  render(["#111111", "#222222", "#333333"], false);
  render(["#111111", "#222222", "#333333"], true);
  expect(swatchCount()).toBe(3);
});

it("a press on the saturation field does not start a text selection", () => {
  render([], true);
  const field = document.querySelector<HTMLElement>(
    '[aria-label="Saturation and brightness"]',
  )!;
  field.setPointerCapture = () => {};
  const press = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
  });
  act(() => {
    field.dispatchEvent(press);
  });
  expect(press.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(field);
});

it("opens saved native fill controls after the screen source arrives", async () => {
  const queryClient = new QueryClient();
  const onChange = vi.fn();
  const plain =
    '<html><body><div data-agent-native-node-id="card"></div></body></html>';
  const applied = applyNativeEffectToHtml(plain, {
    nodeId: "card",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  });
  expect(applied.errors).toEqual([]);
  const renderWithSource = async (content: string) => {
    await act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <DesignColorPicker
              value="#ffffff"
              onChange={onChange}
              open
              onOpenChange={() => {}}
              glslShaderContext={{
                designId: "design",
                fileId: "board",
                nodeId: "card",
                content,
              }}
              trigger={<button type="button">Open picker</button>}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  };
  await renderWithSource(plain);
  expect(document.querySelector('[aria-label="Remove shader"]')).toBeNull();
  await renderWithSource(applied.html);
  expect(document.querySelector('[aria-label="Remove shader"]')).not.toBeNull();
  const solid = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Solid"]',
  );
  expect(solid).not.toBeNull();
  act(() => solid!.click());
  expect(onChange).toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Remove shader"]')).toBeNull();
  await renderWithSource(plain);
  await renderWithSource(applied.html);
  expect(document.querySelector('[aria-label="Remove shader"]')).not.toBeNull();
});

it("shows persisted native fill opacity instead of transparent authored CSS alpha", async () => {
  const queryClient = new QueryClient();
  const saved = applyNativeEffectToHtml(
    '<html><body><div data-agent-native-node-id="card"></div></body></html>',
    {
      nodeId: "card",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    },
  );
  expect(saved.errors).toEqual([]);
  const withOpacity = editNativeEffectHtml(saved.html, {
    kind: "set-instance",
    instanceId: parseEffectsFromHtml(saved.html).document!.instances[0]!.id,
    opacity: 0.35,
  });
  expect(withOpacity.errors).toEqual([]);
  const renderSource = async (content: string) => {
    await act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <DesignColorPicker
              value="transparent"
              onChange={() => {}}
              glslShaderContext={{
                designId: "design",
                fileId: "board",
                nodeId: "card",
                content,
              }}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  };
  await renderSource(saved.html);
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Open color picker"]',
  );
  expect(trigger?.textContent).toContain("100%");
  await renderSource(withOpacity.html);
  expect(trigger?.textContent).toContain("35%");
});
