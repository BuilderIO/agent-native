// @vitest-environment jsdom
import {
  OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
  OWNED_RENDERED_SURFACE_TEST_EFFECT,
} from "@shared/native-effect-owned-source-test-fixtures";
import type { EffectPreset, NativeSourceSizing } from "@shared/native-effects";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  content:
    '<img data-agent-native-node-id="first" src="/shaders/first.png"><img data-agent-native-node-id="second" src="/shaders/second.png">',
  mutation: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => null,
  callAction: () =>
    Promise.resolve({ content: state.content, versionHash: "source-v1" }),
  getBrowserTabId: () => "intrinsic-apply-tab",
  setClientAppState: () => Promise.resolve(),
  useActionMutation: () => ({ mutateAsync: state.mutation }),
  useActionQuery: () => ({ data: undefined, refetch: vi.fn() }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: state.error, success: vi.fn() } }));
vi.mock("./NativeShaderLibraryBrowser", () => ({
  NativeShaderLibraryBrowser: ({
    onApplySaved,
  }: {
    onApplySaved: (
      definition: typeof OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
      preset: EffectPreset,
    ) => Promise<boolean>;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "aria-label": "Apply intrinsic saved preset",
        onClick: () =>
          void onApplySaved(OWNED_INTRINSIC_IMAGE_TEST_EFFECT, {
            id: "intrinsic-preset",
            name: "Intrinsic test",
            definitionId: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.id,
            definitionVersion: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.version,
            placement: "layer",
            params: {},
            clip: "bounds",
            timing: { speed: 0.6, paused: false, time: 0 },
            provenance: { origin: "design-original" },
            sourceSizing: presetSizing,
          }),
      },
      "Apply intrinsic",
    ),
}));

import { GlslShaderPanel } from "./GlslShaderPanel";
import {
  defaultNativeIntrinsicSourceSizing,
  NativeIntrinsicSourceClientError,
  nativeApplySourceSizing,
} from "./native-intrinsic-source-client";

const presetSizing: NativeSourceSizing = {
  inputSpace: "rendered-surface",
  aspectRatio: 1,
  fit: "contain",
  worldSize: [0, 0],
  origin: [0.25, 0.75],
  offset: [0.1, -0.2],
  scale: 1.25,
  rotationDegrees: 15,
  sampling: { min: "nearest", mag: "linear", mipmap: "linear" },
};

function previewFrame(ids: readonly [string, number, number][]): {
  frame: HTMLIFrameElement;
  source: Document;
} {
  const source = document.implementation.createHTMLDocument("intrinsic");
  for (const [id, width, height] of ids) {
    const image = source.createElement("img");
    image.setAttribute("data-agent-native-node-id", id);
    image.src = new URL(`/shaders/${id}.png`, window.location.href).href;
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: width },
      naturalHeight: { value: height },
    });
    source.body.append(image);
  }
  const frame = document.createElement("iframe");
  frame.dataset.designPreviewIframe = "";
  frame.dataset.screenIframeId = "file";
  document.body.append(frame);
  Object.defineProperty(frame, "contentDocument", { value: source });
  Object.defineProperty(frame, "contentWindow", {
    value: { document: source },
  });
  return { frame, source };
}

beforeEach(() => {
  state.mutation.mockReset();
  state.error.mockReset();
  state.mutation.mockResolvedValue({ content: state.content, instanceIds: [] });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("native intrinsic source apply", () => {
  it("uses only an opted-in definition sampler for newly derived IMG sizing", () => {
    previewFrame([
      ["first", 300, 200],
      ["second", 120, 240],
    ]);
    const definition = {
      ...OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
      sourceSizing: {
        uv: "paper-image" as const,
        intrinsicEncoding: "srgb-encoded-straight" as const,
        defaultSampling: {
          min: "linear" as const,
          mag: "linear" as const,
          mipmap: "linear" as const,
        },
      },
    };
    const fresh = nativeApplySourceSizing({
      definition,
      fileId: "file",
      boardFile: false,
      nodeIds: ["first", "second"],
    });
    expect(fresh.sourceSizingByNodeId).toMatchObject({
      first: {
        aspectRatio: 1.5,
        sampling: { min: "linear", mag: "linear", mipmap: "linear" },
      },
      second: {
        aspectRatio: 0.5,
        sampling: { min: "linear", mag: "linear", mipmap: "linear" },
      },
    });
    const explicit = nativeApplySourceSizing({
      definition,
      presetSizing,
      fileId: "file",
      boardFile: false,
      nodeIds: ["first"],
    });
    expect(explicit.sourceSizing).toMatchObject({
      aspectRatio: 1.5,
      sampling: presetSizing.sampling,
    });
  });

  it("derives each aspect from the exact loaded IMG while preserving preset controls", () => {
    previewFrame([
      ["first", 300, 200],
      ["second", 120, 240],
    ]);
    const patch = nativeApplySourceSizing({
      definition: OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
      presetSizing,
      fileId: "file",
      boardFile: false,
      nodeIds: ["first", "second"],
    });
    expect(patch.sourceSizing).toBeUndefined();
    expect(patch.sourceSizingByNodeId).toEqual({
      first: {
        ...presetSizing,
        inputSpace: "intrinsic-image",
        aspectRatio: 1.5,
      },
      second: {
        ...presetSizing,
        inputSpace: "intrinsic-image",
        aspectRatio: 0.5,
      },
    });
    expect(
      nativeApplySourceSizing({
        definition: OWNED_RENDERED_SURFACE_TEST_EFFECT,
        presetSizing,
        fileId: "file",
        boardFile: false,
        nodeIds: ["first", "second"],
      }),
    ).toEqual({ sourceSizing: presetSizing });
  });

  it("rejects a missing, duplicated, cross-origin, or non-IMG target before mutation", () => {
    const { source } = previewFrame([["first", 300, 200]]);
    const read = (nodeIds: string[]) =>
      defaultNativeIntrinsicSourceSizing({
        fileId: "file",
        boardFile: false,
        nodeIds,
      });
    expect(() => read(["first", "missing"])).toThrowError(
      NativeIntrinsicSourceClientError,
    );
    const duplicate = source.createElement("img");
    duplicate.setAttribute("data-agent-native-node-id", "first");
    source.body.append(duplicate);
    expect(() => read(["first"])).toThrowError(
      NativeIntrinsicSourceClientError,
    );
    duplicate.remove();
    const image = source.body.querySelector("img")!;
    image.setAttribute("src", "https://other.example/image.png");
    expect(() => read(["first"])).toThrowError(
      NativeIntrinsicSourceClientError,
    );
    image.replaceWith(source.createElement("div"));
    source.body.firstElementChild!.setAttribute(
      "data-agent-native-node-id",
      "first",
    );
    expect(() => read(["first"])).toThrowError(
      NativeIntrinsicSourceClientError,
    );
  });

  it("submits one atomic per-node source-sizing map from the normal saved-library panel", async () => {
    previewFrame([
      ["first", 300, 200],
      ["second", 120, 240],
    ]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(GlslShaderPanel, {
            mode: "effect",
            onBack: () => undefined,
            context: {
              designId: "design",
              fileId: "file",
              nodeId: "first",
              nodeIds: ["first", "second"],
              nativeOnly: true,
              content: state.content,
            },
          }),
        );
      });
      await act(async () => {
        (
          host.querySelector(
            '[aria-label="Apply intrinsic saved preset"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });
      expect(state.mutation).toHaveBeenCalledTimes(1);
      expect(state.mutation.mock.calls[0][0].operation).toMatchObject({
        kind: "apply-many",
        nodeIds: ["first", "second"],
        timing: { speed: 0.6, paused: false, time: 0 },
        sourceSizingByNodeId: {
          first: { aspectRatio: 1.5, fit: "contain" },
          second: { aspectRatio: 0.5, fit: "contain" },
        },
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("forwards saved preset timing with a single intrinsic image", async () => {
    previewFrame([["first", 300, 200]]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(GlslShaderPanel, {
            mode: "effect",
            onBack: () => undefined,
            context: {
              designId: "design",
              fileId: "file",
              nodeId: "first",
              nativeOnly: true,
              content: state.content,
            },
          }),
        );
      });
      await act(async () => {
        (
          host.querySelector(
            '[aria-label="Apply intrinsic saved preset"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });
      expect(state.mutation).toHaveBeenCalledTimes(1);
      expect(state.mutation.mock.calls[0][0].operation).toMatchObject({
        kind: "apply",
        nodeId: "first",
        timing: { speed: 0.6, paused: false, time: 0 },
        sourceSizing: { inputSpace: "intrinsic-image", aspectRatio: 1.5 },
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("leaves the canonical mutation untouched when one selected target has no loaded image", async () => {
    previewFrame([["first", 300, 200]]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(GlslShaderPanel, {
            mode: "effect",
            onBack: () => undefined,
            context: {
              designId: "design",
              fileId: "file",
              nodeId: "first",
              nodeIds: ["first", "second"],
              nativeOnly: true,
              content: state.content,
            },
          }),
        );
      });
      await act(async () => {
        (
          host.querySelector(
            '[aria-label="Apply intrinsic saved preset"]',
          ) as HTMLButtonElement
        ).click();
        await Promise.resolve();
      });
      expect(state.mutation).not.toHaveBeenCalled();
      expect(state.error).toHaveBeenCalledWith(
        "editPanel.shaders.intrinsicImageRequired",
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});
