import { OWNED_PROCESSOR_DEFINITIONS } from "@shared/native-effect-owned-processors";
import { writeEffectsToHtml } from "@shared/native-effects";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ content: "" }));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: vi.fn(),
  callAction: vi.fn(),
  getBrowserTabId: () => "history-tab",
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
vi.mock("./NativeEffectControls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./NativeEffectControls")>()),
  NativeEffectControls: ({
    values,
    onValueChange,
  }: {
    values: Record<string, number>;
    onValueChange: (
      name: string,
      value: number,
      phase: "preview" | "commit",
    ) => void;
  }) => (
    <button
      type="button"
      aria-label="Preview lift"
      onClick={() => onValueChange("lift", 0.22, "preview")}
    >
      {values.lift}
    </button>
  ),
}));

import { GlslShaderPanel } from "./GlslShaderPanel";

function content(lift: number, enabled = true): string {
  const result = writeEffectsToHtml(
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
          id: "lift-instance",
          nodeId: "target",
          definitionId: "an-native-owned-shadow-lift",
          definitionVersion: 1,
          placement: "layer",
          params: { lift, pivot: 0.4 },
          enabled,
          opacity: 1,
          seed: 77,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: true, time: 0 },
        },
      ],
    },
  );
  return result;
}

beforeEach(() => {
  source.content = content(0.12);
});

it("shows fetched authoritative undo and redo values after a parameter preview", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    root.render(
      <GlslShaderPanel
        mode="effect"
        onBack={() => undefined}
        nativeInstanceId="lift-instance"
        context={{
          designId: "design",
          fileId: "file",
          nodeId: "target",
          nativeOnly: true,
        }}
      />,
    );
  try {
    act(render);
    expect(host.textContent).not.toContain("editPanel.shaders.speed");
    expect(host.textContent).not.toContain("designEditor.motion.play");
    expect(host.textContent).not.toContain("designEditor.motion.resetPlayhead");
    const value = () =>
      host.querySelector('[aria-label="Preview lift"]')!.textContent;
    expect(value()).toBe("0.12");
    act(() =>
      (
        host.querySelector('[aria-label="Preview lift"]') as HTMLButtonElement
      ).click(),
    );
    expect(value()).toBe("0.22");
    source.content = content(0.22);
    act(render);
    expect(value()).toBe("0.22");
    source.content = content(0.12);
    act(render);
    expect(value()).toBe("0.12");
    source.content = content(0.22);
    act(render);
    expect(value()).toBe("0.22");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("shows disabled for an off instance but keeps enabled missing-mount failures visible", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    root.render(
      <GlslShaderPanel
        mode="effect"
        onBack={() => undefined}
        nativeInstanceId="lift-instance"
        context={{
          designId: "design",
          fileId: "file",
          nodeId: "target",
          nativeOnly: true,
        }}
      />,
    );
  const missingMount = () =>
    window.dispatchEvent(
      new CustomEvent("design-native-shader-status", {
        detail: {
          type: "native-shader-status",
          schemaVersion: 1,
          designId: "design",
          fileId: "file",
          runtimeEpoch: "epoch-1",
          instanceId: "lift-instance",
          nodeId: "target",
          status: "unavailable",
          backend: "unavailable",
          code: "instance-not-mounted",
          frames: 0,
          sourceCaptures: 0,
          estimatedResourceBytes: 0,
        },
      }),
    );
  const status = () => host.querySelector("[data-native-runtime-status]");
  try {
    act(render);
    act(missingMount);
    expect(status()?.getAttribute("data-native-runtime-status")).toBe(
      "unavailable",
    );
    expect(status()?.textContent).toContain("instance-not-mounted");

    source.content = content(0.12, false);
    act(render);
    expect(status()?.getAttribute("data-native-runtime-status")).toBe(
      "disabled",
    );
    expect(status()?.textContent).toContain(
      "editPanel.interactionStates.disabled",
    );
    expect(status()?.textContent).not.toContain("instance-not-mounted");

    source.content = content(0.12, true);
    act(render);
    act(missingMount);
    expect(status()?.getAttribute("data-native-runtime-status")).toBe(
      "unavailable",
    );
    expect(status()?.textContent).toContain("instance-not-mounted");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
