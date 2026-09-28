// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: {
    data: { status: "candidate", role: "generated" },
    isError: false,
    isPending: false,
  },
  save: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  setContext: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => undefined,
  useActionMutation: (name: string) =>
    name === "save-generated-image" ? mocks.save : mocks.update,
  useActionQuery: () => mocks.query,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  setAgentChatContextItem: mocks.setContext,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { resolveToolRenderer } from "@agent-native/core/client/chat";

import "@/lib/register-chat-renderers";
import { ASSETS_VARIATION_GRID_RENDERER } from "@shared/action-ui";

import { VariationGridWidget } from "./VariationGridWidget";

function widgetContext(
  images: Array<Record<string, unknown>> = [
    {
      ok: true,
      slotId: "first",
      id: "asset-1",
      libraryId: "library-1",
      previewUrl: "/api/assets/asset-1/content",
    },
    {
      ok: true,
      slotId: "second",
      id: "asset-2",
      libraryId: "library-1",
      previewUrl: "/api/assets/asset-2/content",
    },
  ],
) {
  return {
    toolName: "generate-image-batch",
    args: {
      slots: [
        { slotId: "first", prompt: "First direction" },
        { slotId: "second", prompt: "Second direction" },
      ],
    },
    resultJson: { images },
    isRunning: false,
  };
}

describe("Assets variation grid widget", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.query.data = { status: "candidate", role: "generated" };
    mocks.query.isError = false;
    mocks.query.isPending = false;
    mocks.save.mutate.mockReset();
    mocks.update.mutate.mockReset();
    mocks.setContext.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("registers with the shared action chat renderer used by AgentKit", () => {
    expect(
      resolveToolRenderer({
        toolName: "generate-image-batch",
        args: {},
        resultJson: {},
        isRunning: false,
        chatUI: { renderer: ASSETS_VARIATION_GRID_RENDERER },
      }),
    ).not.toBeNull();
  });

  it("shows the generated candidates and runs save, reference, and refine actions", () => {
    act(() =>
      root.render(
        createElement(VariationGridWidget, {
          context: widgetContext(),
        } as any),
      ),
    );

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);

    const selection = container.querySelectorAll<HTMLButtonElement>(
      "button[aria-pressed]",
    )[1];
    act(() => selection.click());
    expect(
      container
        .querySelector('[aria-pressed="true"]')
        ?.getAttribute("aria-label"),
    ).toBe("library.selectAsset");

    const buttons = Array.from(container.querySelectorAll("button"));
    act(() =>
      buttons.find((button) => button.textContent === "library.save")?.click(),
    );
    expect(mocks.save.mutate).toHaveBeenCalledWith(
      { assetId: "asset-2" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    act(() =>
      buttons
        .find((button) => button.textContent === "library.addToReferences")
        ?.click(),
    );
    expect(mocks.update.mutate).toHaveBeenCalledWith(
      { id: "asset-2", role: "style_reference", status: "reference" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    act(() =>
      buttons
        .find((button) => button.textContent === "library.refine")
        ?.click(),
    );
    expect(mocks.setContext).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "refine-asset:asset-2",
        context: expect.stringContaining("Asset ID: asset-2"),
        openSidebar: true,
      }),
    );
  });

  it("withholds save and reference controls for draft-only results", () => {
    act(() =>
      root.render(
        createElement(VariationGridWidget, {
          context: widgetContext([
            {
              ok: true,
              slotId: "first",
              id: "draft-1",
              libraryId: "library-1",
              previewUrl: "/api/assets/draft-1/content",
              draftPendingApproval: true,
            },
          ]),
        } as any),
      ),
    );

    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent,
    );
    expect(labels).not.toContain("library.save");
    expect(labels).not.toContain("library.addToReferences");
    expect(labels).toContain("library.refine");
  });

  it("does not offer actions again when the asset is already a reference", () => {
    mocks.query.data = { status: "reference", role: "style_reference" };
    act(() =>
      root.render(
        createElement(VariationGridWidget, {
          context: widgetContext([
            {
              ok: true,
              slotId: "first",
              id: "asset-ref",
              libraryId: "library-1",
              previewUrl: "/api/assets/asset-ref/content",
            },
          ]),
        } as any),
      ),
    );

    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent,
    );
    expect(labels).not.toContain("library.save");
    expect(labels).not.toContain("library.addToReferences");
    expect(labels).toContain("library.refine");
  });
});
