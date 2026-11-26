// oracle-change: Annotate and the Draw tool were removed from Design, so their assertions are gone
// oracle-change: the editor top bar was removed; the mode switch now sits in the bottom toolbar, so the top-bar exit assertions are gone
// oracle-change(templates/design/app/components/design/editor/EditorTopBar.test.tsx): the editor top bar was removed with its component; its controls moved to the column heads and the bottom toolbar
// oracle-change(templates/design/app/pages/design-editor/top-bar.test.ts): the top bar and its visibility rule were removed; no shell renders a top bar any more
// oracle-change(templates/design/app/components/design/editor/DesignWorkspaceRail.test.tsx): the left workspace rail was removed with its component; its panels and collapse moved into the left column
// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { InteractFloatingBar } from "./InteractControls";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TooltipProvider>{node}</TooltipProvider>);
  });
  return {
    host,
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

describe("InteractFloatingBar (minimal UI, no mode switch)", () => {
  it("keeps an explicit Exit and calls it", async () => {
    const onExit = vi.fn();
    const { host, unmount } = await mount(
      <InteractFloatingBar
        devicePicker={<span data-slot="device" />}
        themePicker={<span data-slot="theme" />}
        screenControls={<span data-slot="screens" />}
        onExit={onExit}
      />,
    );
    expect(host.querySelector("[data-slot=device]")).not.toBeNull();
    expect(host.querySelector("[data-slot=theme]")).not.toBeNull();
    expect(host.querySelector("[data-slot=screens]")).not.toBeNull();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          "button[aria-label='designEditor.responsiveInteract.exit']",
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
