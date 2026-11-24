import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { renderProjectTitleControl } from "./project-title-control";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined, isError: false }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const title = "A long design title that must be available in a tooltip";
const brief = {
  source: "content",
  id: "page-one",
  url: "https://content.example.com/page-one",
};

describe("Design project title tooltip", () => {
  it.each([
    ["read-only", false, false, false],
    ["read-only with brief", false, true, false],
    ["editable", true, false, false],
    ["renaming", true, false, true],
  ])(
    "provides a keyboard-focusable tooltip trigger when %s",
    (_name, canEdit, hasBrief, editing) => {
      const control = renderProjectTitleControl({
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
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <TooltipProvider>{control}</TooltipProvider>
        </MemoryRouter>,
      );
      expect(html).toContain('data-state="closed"');
      expect(html).toContain(title);
      expect(html).toMatch(
        editing
          ? /<input\b/
          : canEdit || hasBrief
            ? /<button\b/
            : /tabindex="0"/,
      );
    },
  );
});
