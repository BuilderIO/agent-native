// @vitest-environment happy-dom

import type { PlanBlock, PlanContent } from "@shared/plan-content";
import { act, createElement, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => ({
    data: { configured: true },
    isSuccess: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { PlanDocumentEditor } from "./PlanDocumentEditor";

const CALLOUT = {
  id: "divider",
  type: "callout",
  data: { tone: "info", body: "Separator callout." },
} as PlanBlock;

const content: PlanContent = {
  version: 2,
  blocks: [
    { id: "alpha", type: "rich-text", data: { markdown: "Alpha block seed." } },
    CALLOUT,
    { id: "bravo", type: "rich-text", data: { markdown: "Bravo block seed." } },
  ],
};

let container: HTMLElement;
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
  vi.restoreAllMocks();
});

async function flushEditorEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PlanDocumentEditor save reader", () => {
  it("keeps a callout's data when the pending blocks it is given are empty", async () => {
    const reader: MutableRefObject<
      ((pending: PlanBlock[]) => PlanBlock[] | null) | null
    > = { current: null };
    act(() => {
      root.render(
        createElement(PlanDocumentEditor, {
          content,
          editable: true,
          onBlocksChange: vi.fn(),
          blocksReaderRef: reader,
        }),
      );
    });
    await flushEditorEffects();
    await flushEditorEffects();

    const saved = reader.current?.([]);

    expect(saved?.map((block) => block.id)).toEqual([
      "alpha",
      "divider",
      "bravo",
    ]);
    expect(saved?.find((block) => block.id === "divider")).toEqual(CALLOUT);
  });

  it("uses adopted structured data ahead of an older pending snapshot", async () => {
    const reader: MutableRefObject<
      ((pending: PlanBlock[]) => PlanBlock[] | null) | null
    > = { current: null };
    act(() => {
      root.render(
        createElement(PlanDocumentEditor, {
          content,
          editable: true,
          onBlocksChange: vi.fn(),
          blocksReaderRef: reader,
        }),
      );
    });
    await flushEditorEffects();
    await flushEditorEffects();

    const staleCallout = {
      id: CALLOUT.id,
      type: "callout",
      data: { tone: "info", body: "Stale pending body." },
    } as PlanBlock;
    const saved = reader.current?.([staleCallout]);

    expect(saved?.find((block) => block.id === "divider")).toEqual(CALLOUT);
  });
});
