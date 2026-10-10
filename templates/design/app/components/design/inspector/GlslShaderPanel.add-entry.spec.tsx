// @vitest-environment jsdom
import { OWNED_PROCESSOR_DEFINITIONS } from "@shared/native-effect-owned-processors";
import { writeEffectsToHtml } from "@shared/native-effects";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const source = vi.hoisted(() => ({ content: "" }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: vi.fn(),
  callAction: vi.fn(),
  getBrowserTabId: () => "add-entry-tab",
  setClientAppState: vi.fn().mockResolvedValue(undefined),
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  useActionQuery: () => ({
    data: { content: source.content },
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("./NativeShaderLibraryBrowser", () => ({
  NativeShaderLibraryBrowser: () => (
    <div data-testid="native-library">Catalog</div>
  ),
}));

import { GlslShaderEffectSection, GlslShaderPanel } from "./GlslShaderPanel";

const context = {
  designId: "design",
  fileId: "file",
  nodeId: "target",
  nativeOnly: true,
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  source.content = writeEffectsToHtml(
    '<div data-agent-native-node-id="target"></div>',
    {
      schemaVersion: 2,
      definitions: [
        OWNED_PROCESSOR_DEFINITIONS.find(
          (definition) => definition.id === "an-native-owned-shadow-lift",
        )!,
      ],
      instances: [
        {
          id: "existing-lift",
          nodeId: "target",
          definitionId: "an-native-owned-shadow-lift",
          definitionVersion: 1,
          placement: "layer",
          params: { lift: 0.12, pivot: 0.4 },
          enabled: true,
          opacity: 1,
          seed: 77,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: true, time: 0 },
        },
      ],
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
});

it("opens Add Effect → Shader at the catalog even when an effect exists", () => {
  act(() =>
    root.render(
      <TooltipProvider>
        <GlslShaderEffectSection
          context={context}
          pickerOpen
          onPickerOpenChange={vi.fn()}
        />
      </TooltipProvider>,
    ),
  );
  expect(
    document.body.querySelector('[data-testid="native-library"]'),
  ).not.toBeNull();
  expect(
    document.body.querySelector(
      '[aria-label="editPanel.shaders.backToBrowser"]',
    ),
  ).toBeNull();
});

it("opens an existing effect instance at its own controls", () => {
  act(() =>
    root.render(
      <TooltipProvider>
        <GlslShaderPanel
          mode="effect"
          context={context}
          nativeInstanceId="existing-lift"
          onBack={() => undefined}
        />
      </TooltipProvider>,
    ),
  );
  expect(
    host.querySelector('[aria-label="editPanel.shaders.backToBrowser"]'),
  ).not.toBeNull();
  expect(host.querySelector('[data-testid="native-library"]')).toBeNull();
});
