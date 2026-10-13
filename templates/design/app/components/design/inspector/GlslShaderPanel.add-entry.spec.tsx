// @vitest-environment jsdom
import { OWNED_PROCESSOR_DEFINITIONS } from "@shared/native-effect-owned-processors";
import { writeEffectsToHtml } from "@shared/native-effects";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const source = vi.hoisted(() => ({ content: "" }));
const edits = vi.hoisted(() => ({
  callAction: vi.fn(),
  mutateAsync: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: vi.fn(),
  callAction: edits.callAction,
  getBrowserTabId: () => "add-entry-tab",
  setClientAppState: vi.fn().mockResolvedValue(undefined),
  useActionMutation: () => ({ mutateAsync: edits.mutateAsync }),
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
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
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
  edits.callAction.mockReset().mockImplementation(async () => ({
    content: source.content,
    versionHash: "source-version",
  }));
  edits.mutateAsync.mockReset().mockImplementation(async () => ({
    content: source.content,
    instanceIds: ["existing-lift"],
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

it("toggles a native effect from its row through the existing edit action", async () => {
  await act(async () =>
    root.render(
      <TooltipProvider>
        <GlslShaderEffectSection
          context={context}
          pickerOpen={false}
          onPickerOpenChange={vi.fn()}
        />
      </TooltipProvider>,
    ),
  );
  const toggle = host.querySelector(
    '[aria-label="editPanel.shaders.enabled"]',
  ) as HTMLButtonElement;
  expect(toggle.disabled).toBe(false);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  await act(async () => toggle.click());
  expect(edits.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersionHash: "source-version",
      operation: {
        kind: "set-instance",
        instanceId: "existing-lift",
        enabled: false,
      },
    }),
  );
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

it("reports the visible shader title and resets it on Back", () => {
  const onActiveTitleChange = vi.fn();
  act(() =>
    root.render(
      <TooltipProvider>
        <GlslShaderPanel
          mode="effect"
          context={context}
          nativeInstanceId="existing-lift"
          onActiveTitleChange={onActiveTitleChange}
          onBack={() => undefined}
        />
      </TooltipProvider>,
    ),
  );
  expect(
    host.querySelector('[aria-label="editPanel.shaders.backToBrowser"]'),
  ).not.toBeNull();
  expect(host.querySelector('[data-testid="native-library"]')).toBeNull();
  const innerTitle = host.querySelector(".font-semibold")?.textContent;
  expect(onActiveTitleChange).toHaveBeenLastCalledWith(innerTitle);
  act(() =>
    (
      host.querySelector(
        '[aria-label="editPanel.shaders.backToBrowser"]',
      ) as HTMLButtonElement
    ).click(),
  );
  expect(onActiveTitleChange).toHaveBeenLastCalledWith(
    "editPanel.shaders.effectsTitle",
  );
  expect(host.querySelector('[data-testid="native-library"]')).not.toBeNull();
});
