// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  preview: vi.fn(),
  color: vi.fn(),
  formatNumber: vi.fn((value: number) => `LOCAL:${value}`),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useFormatters: () => ({ formatNumber: readers.formatNumber }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/components/settings/EditorShaderPreferencesTab", () => ({
  EditorShaderPreferencesTab: ({
    liveDiagnostics,
  }: {
    liveDiagnostics: ReactNode;
  }) => <div>{liveDiagnostics}</div>,
}));
vi.mock("@/components/design/inspector/native-preview-policy-client", () => ({
  NativePreviewPolicyError: class NativePreviewPolicyError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  readNativePreviewStatusFromFrame: readers.preview,
}));
vi.mock("@/components/design/inspector/native-color-preview-client", () => ({
  NativeColorPreviewError: class NativeColorPreviewError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  readNativeColorCapability: readers.color,
}));

import { NativeColorPreviewError } from "../inspector/native-color-preview-client";
import { NativePreviewPolicyError } from "../inspector/native-preview-policy-client";
import { NativeShaderPreferencesFrameError } from "./native-shader-preferences-frame";
import { NativeShaderPreferencesDialog } from "./NativeShaderPreferencesDialog";

afterEach(() => {
  vi.useRealTimers();
  readers.preview.mockReset();
  readers.color.mockReset();
  readers.formatNumber.mockClear();
  document.body.replaceChildren();
});

it("reads only while open, rebinds on screen change, and leaves the canvas mounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const canvas = document.createElement("iframe");
  canvas.dataset.designPreviewIframe = "";
  canvas.dataset.screenIframeId = "screen-a";
  document.body.append(canvas);
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const other = document.createElement("iframe");
  readers.preview.mockImplementation((frame: HTMLIFrameElement) => ({
    requestedQuality: "auto",
    frameRateTarget: 60,
    devicePixelRatio: 2,
    effectivePixelRatio: frame === canvas ? 2 : 1,
    targetFrameIntervalMs: 16.67,
    rafIntervalMs: 17,
    renderWallMs: 4,
  }));
  readers.color.mockReturnValue({
    requested: "srgb",
    presented: "srgb",
    sourceGamut: "dom-srgb-only",
    requestedDynamicRange: "sdr",
    presentedDynamicRange: "sdr",
    displayDynamicRangeCapability: "standard-only",
    canvasToneMappingStandard: "observed",
  });
  const render = async (
    open: boolean,
    frameKey: string,
    frame: HTMLIFrameElement,
  ) => {
    await act(async () =>
      root.render(
        <NativeShaderPreferencesDialog
          open={open}
          onOpenChange={() => undefined}
          frameKey={frameKey}
          resolveFrame={() => frame}
        />,
      ),
    );
  };
  await render(true, "screen-a", canvas);
  expect(readers.preview).toHaveBeenCalledWith(canvas);
  expect(readers.formatNumber).toHaveBeenCalledWith(2, {
    maximumFractionDigits: 1,
  });
  expect(host.textContent).toContain(
    "editPanel.shaders.nativePreviewActualResolution",
  );
  const mountedCanvas = document.body.firstElementChild;
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(readers.preview).toHaveBeenCalledTimes(2);
  await render(true, "screen-b", other);
  expect(readers.preview).toHaveBeenLastCalledWith(other);
  await act(async () =>
    window.dispatchEvent(new Event("design-native-shader-frame-load")),
  );
  expect(readers.preview).toHaveBeenCalledTimes(4);
  await render(false, "screen-b", other);
  const count = readers.preview.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(4_000);
    window.dispatchEvent(new Event("design-native-shader-status"));
  });
  expect(readers.preview).toHaveBeenCalledTimes(count);
  expect(document.body.firstElementChild).toBe(mountedCanvas);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("preserves typed errors and does not infer SDR from absent legacy range", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const frame = document.createElement("iframe");
  readers.preview.mockReturnValue({
    requestedQuality: "auto",
    frameRateTarget: 60,
    devicePixelRatio: 2,
    effectivePixelRatio: 1,
    targetFrameIntervalMs: 16.67,
  });
  readers.color.mockReturnValue({
    requested: "srgb",
    presented: "srgb",
    sourceGamut: "dom-srgb-only",
    requestedDynamicRange: undefined,
    presentedDynamicRange: undefined,
    displayDynamicRangeCapability: "unreadable",
    canvasToneMappingStandard: "unreadable",
  });
  const render = async (
    frameKey: string,
    resolveFrame: () => HTMLIFrameElement,
  ) =>
    act(async () =>
      root.render(
        <NativeShaderPreferencesDialog
          open
          onOpenChange={() => undefined}
          frameKey={frameKey}
          resolveFrame={resolveFrame}
        />,
      ),
    );
  await render("screen-a", () => frame);
  expect(host.textContent).toContain("editPanel.shaders.nativeHdrUnavailable");
  expect(host.textContent).not.toContain(
    "editPanel.shaders.nativeDynamicRangeSdr",
  );
  expect(host.textContent).not.toContain(
    "editPanel.shaders.nativeToneMappingUnreadable",
  );
  readers.preview.mockImplementation(() => {
    throw new NativePreviewPolicyError("status-unreadable");
  });
  readers.color.mockImplementation(() => {
    throw new NativeColorPreviewError("capability-unreadable");
  });
  await act(async () =>
    window.dispatchEvent(new Event("design-native-shader-status")),
  );
  expect(
    host
      .querySelector("[data-native-preview-error]")
      ?.getAttribute("data-native-preview-error"),
  ).toBe("status-unreadable");
  expect(
    host
      .querySelector("[data-native-color-error]")
      ?.getAttribute("data-native-color-error"),
  ).toBe("capability-unreadable");
  await render("screen-b", () => {
    throw new NativeShaderPreferencesFrameError("frame-hidden");
  });
  expect(
    host
      .querySelector("[data-native-preview-error]")
      ?.getAttribute("data-native-preview-error"),
  ).toBe("frame-hidden");
  expect(host.textContent).not.toContain(
    "editPanel.shaders.nativePreviewActualResolution",
  );
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
