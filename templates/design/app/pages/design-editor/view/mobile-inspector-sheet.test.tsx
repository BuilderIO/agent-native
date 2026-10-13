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

function sheetArgs(overrides: {
  minimalUi: boolean;
  motionDockOpen?: boolean;
}): SheetArgs {
  return {
    editorCore: {
      t: (key: string) => key,
      mode: "edit",
      hostOwnsChrome: false,
    } as unknown as EditorCore,
    editorHistory: {
      minimalUi: overrides.minimalUi,
      motionDockOpen: overrides.motionDockOpen ?? false,
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
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
    const trigger = document.querySelector(
      'button[aria-label="editPanel.properties"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).toContain("w-[min(92vw,360px)]");
    await unmount();
  });

  it("keeps the inspector non-modal and above the Motion dock", async () => {
    const { unmount } = await mount(
      sheetArgs({ minimalUi: false, motionDockOpen: true }),
    );
    const trigger = document.querySelector(
      'button[aria-label="editPanel.properties"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBeNull();
    expect(dialog?.className).toContain("w-[min(max(240px,48vw),360px)]");
    expect(dialog?.style.height).toBe("auto");
    expect(document.querySelector("[data-radix-dialog-overlay]")).toBeNull();

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await unmount();
  });
});
