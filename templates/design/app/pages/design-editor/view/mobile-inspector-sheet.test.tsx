// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import { renderMobileInspectorSheet } from "./mobile-inspector-sheet";

vi.mock("@/components/design/EditPanel", () => ({
  EditPanel: () => <div data-slot="edit-panel" />,
}));

type SheetArgs = Parameters<typeof renderMobileInspectorSheet>[0];

function sheetArgs(overrides: { minimalUi: boolean }): SheetArgs {
  return {
    editorCore: {
      t: (key: string) => key,
      mode: "edit",
      hostOwnsChrome: false,
    } as unknown as EditorCore,
    editorHistory: {
      minimalUi: overrides.minimalUi,
    } as unknown as EditorHistory,
    editorLiveEditsAndPresence: {
      initialGenerationChromeLimited: false,
    } as unknown as EditorLiveEditsAndPresence,
    editorContentAndComponents: {
      uiHidden: false,
    } as unknown as EditorContentAndComponents,
    editPanelProps: {} as SheetArgs["editPanelProps"],
  };
}

async function mount(args: SheetArgs) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<>{renderMobileInspectorSheet(args)}</>);
  });
  return {
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

describe("mobile inspector sheet", () => {
  it("never slides over a narrow minimal-UI canvas: the floating inspector panel carries the selection", async () => {
    const { unmount } = await mount(sheetArgs({ minimalUi: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-slot="edit-panel"]')).toBeNull();
    await unmount();
  });

  it("stays a closed sheet with its trigger on the docked layout", async () => {
    const { unmount } = await mount(sheetArgs({ minimalUi: false }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      document.querySelector('button[aria-label="editPanel.properties"]'),
    ).not.toBeNull();
    await unmount();
  });
});
