// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { renderProjectTitleControl } from "./project-title-control";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined, isError: false }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

it("focuses the original-sized rename input without opening a tooltip", async () => {
  const title = "A long design title that is being edited";
  const control = renderProjectTitleControl({
    editorCore: { t: (key: string) => key, id: "design-one" },
    editorGenerationAndAccess: {
      canEditDesign: true,
      canShareDesign: false,
      duplicateDesignMutation: { isPending: false },
    },
    editorFilesAndSaving: { titleEditing: true, titleDraft: title, files: [] },
    editorHistory: {},
    editorLiveEditsAndPresence: {},
    editorLayoutAndStructure: {},
    editorSourceAndSync: {},
    design: { title, data: {} },
    widgetEmbed: false,
  } as unknown as Parameters<typeof renderProjectTitleControl>[0]);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider delayDuration={0}>{control}</TooltipProvider>
        </MemoryRouter>,
      );
    });
    const input = host.querySelector("input");
    if (!input) throw new Error("Missing rename input");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(title);
    expect(input.className).toContain("h-7");
    expect(input.className).toContain("px-1");
    expect(input.className).toContain("py-0");
    expect(input.className).toContain("text-[13px]");
    expect(input.className).toContain("font-medium");
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
