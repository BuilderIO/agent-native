// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const title = "A long design title that must be available in a tooltip";
const brief = {
  source: "content",
  id: "page-one",
  url: "https://content.example.com/page-one",
};

function titleControl(canEdit: boolean, hasBrief: boolean, editing: boolean) {
  return renderProjectTitleControl({
    editorCore: { t: (key: string) => key, id: "design-one" },
    editorGenerationAndAccess: {
      canEditDesign: canEdit,
      canShareDesign: false,
      duplicateDesignMutation: { isPending: false },
    },
    editorFilesAndSaving: {
      titleEditing: editing,
      titleDraft: title,
      files: [],
    },
    editorHistory: {},
    editorLiveEditsAndPresence: {},
    editorLayoutAndStructure: {},
    editorSourceAndSync: {},
    design: { title, data: { briefs: hasBrief ? [brief] : [] } },
    widgetEmbed: false,
  } as unknown as Parameters<typeof renderProjectTitleControl>[0]);
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("Design project title tooltip", () => {
  it.each([
    ["read-only", false, false, false],
    ["read-only with brief", false, true, false],
    ["editable", true, false, false],
  ])(
    "provides a keyboard-focusable tooltip trigger when %s",
    (_name, canEdit, hasBrief, editing) => {
      const control = titleControl(canEdit, hasBrief, editing);
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <TooltipProvider>{control}</TooltipProvider>
        </MemoryRouter>,
      );
      expect(html).toContain('data-state="closed"');
      expect(html).toContain(title);
      expect(html).toMatch(canEdit || hasBrief ? /<button\b/ : /tabindex="0"/);
    },
  );

  it.each([
    ["read-only", false, false],
    ["read-only with brief", false, true],
    ["editable", true, false],
  ])(
    "shows the full title in a tooltip on hover when %s",
    async (_name, canEdit, hasBrief) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <MemoryRouter>
            <TooltipProvider delayDuration={0}>
              {titleControl(canEdit, hasBrief, false)}
            </TooltipProvider>
          </MemoryRouter>,
        );
      });
      cleanup = () => act(async () => root.unmount()).then(() => host.remove());
      const trigger = host.querySelector('[data-state="closed"]');
      if (!trigger) throw new Error("Missing tooltip trigger");
      expect(trigger.textContent).toBe(title);

      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerType: "mouse",
          }),
        );
      });

      await vi.waitFor(() => {
        const tooltip = document.body.querySelector(
          '[data-agent-native-tooltip="true"]',
        );
        expect(tooltip?.textContent).toContain(title);
      });
    },
  );
});
