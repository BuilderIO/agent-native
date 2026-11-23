// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import {
  cellSchema,
  markdownCellContentsSchema,
  type Cell,
} from "@/lib/model/contracts";

import { NotebookCell } from "./NotebookCell";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function makeTextCell(
  text: string,
  overrides?: Partial<Cell["contents"]>,
): Cell {
  return cellSchema.parse({
    id: "cell",
    projectId: "project",
    versionId: "draft",
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    contents: {
      id: "cell",
      order: "a",
      label: "Summary note",
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      kind: "text",
      text,
      ...overrides,
    },
  });
}

async function openMenu() {
  const trigger = host.querySelector<HTMLElement>(
    '[aria-label^="More actions for"]',
  );
  assert(trigger);
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

it("renders the rich-text formatting toolbar for editable text cells and applies markdown formatting around selection", async () => {
  const original = "Revenue summary\nNet and gross";
  const cell = makeTextCell(original);

  function Harness() {
    const [draft, setDraft] = useState(original);
    return (
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <NotebookCell
          lineNumbers
          cell={cell}
          title="Summary note"
          connections={[]}
          canEdit
          busy={false}
          running={false}
          saving={false}
          deleting={false}
          connectionPending={false}
          connectionId={null}
          draftText={draft}
          dirty={draft !== original}
          stale={false}
          outputState={undefined}
          error={null}
          onTextChange={setDraft}
          onSaveDraft={() => {}}
          onRun={() => {}}
          onDiscard={() => {}}
          onOverwrite={() => {}}
          onDelete={() => {}}
          onSelectConnection={() => {}}
          onDismissError={() => {}}
        />
      </AgentNativeI18nProvider>
    );
  }

  await act(async () => root.render(<Harness />));
  const article = host.querySelector("article");
  assert(article);
  const editor = article.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Edit Summary note"]',
  );
  assert(editor);
  expect(editor.value).toBe(original);

  const toolbar = article.querySelector<HTMLElement>('[role="toolbar"]');
  assert(toolbar);
  const buttonLabels = [...toolbar.querySelectorAll("button")].map((button) =>
    button.getAttribute("aria-label"),
  );
  expect(buttonLabels).toEqual([
    "Bold",
    "Italic",
    "Heading",
    "Bullet list",
    "Code",
    "Link",
  ]);

  await act(async () => editor.focus());
  const grossStart = editor.value.indexOf("gross");
  editor.setSelectionRange(grossStart, grossStart + "gross".length);

  const boldButton = toolbar.querySelector<HTMLButtonElement>(
    'button[aria-label="Bold"]',
  );
  assert(boldButton);
  const mouseDown = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    boldButton.dispatchEvent(mouseDown);
    boldButton.click();
  });
  expect(mouseDown.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(editor);
  expect(editor.value).toBe("Revenue summary\nNet and **gross**");

  const headingButton = toolbar.querySelector<HTMLButtonElement>(
    'button[aria-label="Heading"]',
  );
  assert(headingButton);
  editor.setSelectionRange(0, 0);
  await act(async () => headingButton.click());
  expect(editor.value).toBe("## Revenue summary\nNet and **gross**");

  const listButton = toolbar.querySelector<HTMLButtonElement>(
    'button[aria-label="Bullet list"]',
  );
  assert(listButton);
  const netStart = editor.value.indexOf("Net");
  editor.setSelectionRange(netStart, netStart);
  await act(async () => listButton.click());
  expect(editor.value).toBe("## Revenue summary\n- Net and **gross**");
});

it("includes Convert to Markdown in a text cell menu and saves valid markdown contents", async () => {
  const draftText = "## Notes\n\n- Item one";
  const cell = makeTextCell("Initial text", { order: "b3", hidden: true });
  const onSaveContents = vi.fn<(contents: Cell["contents"]) => void>();

  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <NotebookCell
          cell={cell}
          title="Summary note"
          connections={[]}
          canEdit
          busy={false}
          running={false}
          saving={false}
          deleting={false}
          connectionPending={false}
          connectionId={null}
          draftText={draftText}
          dirty={false}
          stale={false}
          outputState={undefined}
          error={null}
          onTextChange={() => {}}
          onSaveDraft={() => {}}
          onSaveContents={onSaveContents}
          onRun={() => {}}
          onDiscard={() => {}}
          onOverwrite={() => {}}
          onDelete={() => {}}
          onSelectConnection={() => {}}
          onDismissError={() => {}}
        />
      </AgentNativeI18nProvider>,
    ),
  );

  await openMenu();
  const convertItem = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.trim() === "Convert to Markdown");
  assert(convertItem);
  await act(async () => convertItem.click());

  expect(onSaveContents).toHaveBeenCalledTimes(1);
  const saved = onSaveContents.mock.calls[0]?.[0];
  assert(saved);
  expect(saved).toEqual({
    id: "cell",
    order: "b3",
    label: "Summary note",
    hidden: true,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "markdown",
    markdown: draftText,
  });
  expect("text" in saved).toBe(false);
  expect(() => markdownCellContentsSchema.parse(saved)).not.toThrow();
});
