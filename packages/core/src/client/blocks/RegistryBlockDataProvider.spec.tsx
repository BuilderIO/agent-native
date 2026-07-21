// @vitest-environment happy-dom

import {
  useRegistryBlockData,
  type RegistryBlockDataValue,
} from "@agent-native/toolkit/editor/RegistryBlockContext";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { BlockRegistryProvider } from "./provider.js";
import { BlockRegistry } from "./registry.js";
import { RegistryBlockDataProvider } from "./RegistryBlockDataProvider.js";
import { defineBlock } from "./types.js";

interface TestBlock {
  id: string;
  type: string;
  title?: string;
  data: { body: string };
}

describe("RegistryBlockDataProvider", () => {
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

  it("binds Toolkit's portable side map to the Core block registry", () => {
    const registry = new BlockRegistry();
    registry.register(
      defineBlock({
        type: "note",
        schema: z.object({ body: z.string() }),
        mdx: {
          tag: "Note",
          toAttrs: (data) => ({ body: data.body }),
          fromAttrs: (attrs) => ({ body: attrs.string("body") ?? "" }),
        },
        Read: ({ data }) => <p>{data.body}</p>,
        placement: ["block"],
        label: "Note",
        description: "A note.",
      }),
    );

    const block: TestBlock = {
      id: "note-1",
      type: "note",
      data: { body: "Portable UI, Core registry" },
    };
    const value: RegistryBlockDataValue<TestBlock> = {
      editable: true,
      getBlock: (id) => (id === block.id ? block : undefined),
      onBlockDataChange: vi.fn(),
    };
    let resolved: RegistryBlockDataValue<TestBlock> | null = null;
    function Probe() {
      resolved = useRegistryBlockData<TestBlock>();
      return null;
    }

    act(() => {
      root.render(
        <BlockRegistryProvider registry={registry} ctx={{}}>
          <RegistryBlockDataProvider value={value}>
            <Probe />
          </RegistryBlockDataProvider>
        </BlockRegistryProvider>,
      );
    });

    const rendered = resolved?.renderRegisteredBlock?.(block, {
      blockType: "note",
      editable: false,
      selected: false,
      shellHovered: false,
      panelOpen: false,
      setPanelOpen: vi.fn(),
      onChange: vi.fn(),
    });
    expect(rendered).not.toBeNull();
    expect(renderToStaticMarkup(rendered?.body ?? null)).toContain(
      "Portable UI, Core registry",
    );
  });
});
