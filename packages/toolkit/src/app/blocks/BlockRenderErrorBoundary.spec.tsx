// @vitest-environment happy-dom

import type { BlockSpec } from "@agent-native/core/blocks/server";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { BlockRenderErrorBoundary } from "./BlockRenderErrorBoundary.js";
import { BlockView } from "./BlockView.js";

const catalog = createToolkitI18nCatalog({ messages: {} });

describe("BlockRenderErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    { blockId: "block-2", blockType: "note" },
    { blockId: "block-1", blockType: "callout" },
  ])("clears a render error when block identity changes: %o", (identity) => {
    const resetKey = { body: "unchanged" };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    function MaybeFail({ fail }: { fail: boolean }) {
      if (fail) throw new Error("renderer failed");
      return <p>Recovered block</p>;
    }

    const render = (blockId: string, blockType: string, fail: boolean) => {
      root.render(
        <BlockRenderErrorBoundary
          blockId={blockId}
          blockType={blockType}
          resetKey={resetKey}
        >
          <MaybeFail fail={fail} />
        </BlockRenderErrorBoundary>,
      );
    };

    try {
      act(() => render("block-1", "note", true));
      expect(
        container.querySelector("[data-block-render-error]"),
      ).not.toBeNull();

      act(() => render(identity.blockId, identity.blockType, false));

      expect(container.textContent).toContain("Recovered block");
      expect(container.querySelector("[data-block-render-error]")).toBeNull();
    } finally {
      logError.mockRestore();
    }
  });
});

describe("BlockRenderSuspenseFallback", () => {
  it("contains a block renderer exception during server rendering", () => {
    function FailingRead() {
      throw new Error("renderer failed");
    }

    const markup = renderToString(
      <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
        <BlockView
          spec={
            {
              type: "note",
              label: "Note",
              placement: [],
              Read: FailingRead,
            } as unknown as BlockSpec<{}>
          }
          block={{ id: "note-1", data: {} }}
          editing={false}
          ctx={{}}
        />
      </AgentNativeI18nProvider>,
    );

    expect(markup).toContain("data-block-render-error");
    expect(markup).toContain("This block is temporarily unavailable.");
  });
});
