// @vitest-environment jsdom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { cellSchema } from "@/lib/model/contracts";

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

function press(target: HTMLElement, key: string) {
  return act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

it.each(["markdown"] as const)(
  "previews a %s cell and returns to the preview after editing",
  async (kind) => {
    const original =
      "# Revenue\n\n**Net** and *gross*\n\n- [Guide](https://example.test/guide)";
    const cell = cellSchema.parse({
      id: "cell",
      projectId: "project",
      versionId: "draft",
      createdAt: "2026-11-19T00:00:00.000Z",
      updatedAt: "2026-11-19T00:00:00.000Z",
      contents: {
        id: "cell",
        order: "a",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        kind,
        [kind]: original,
      },
    });
    const save = vi.fn<(source: string) => void>();

    function Harness() {
      const [draft, setDraft] = useState(original);
      return (
        <AgentNativeI18nProvider
          catalog={{ messages }}
          persistPreference={false}
        >
          <NotebookCell
            lineNumbers
            cell={cell}
            title="Summary"
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
            onSaveDraft={() => save(draft)}
            onRun={() => {}}
            onDiscard={() => {}}
            onOverwrite={() => {}}
            onDelete={() => {}}
            onSelectConnection={() => {}}
            onDismissError={() => {}}
          />
          <button type="button">Outside the cell</button>
        </AgentNativeI18nProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const article = host.querySelector("article");
    const heading = host.querySelector<HTMLElement>(
      '[role="heading"][aria-level="1"]',
    );
    assert(article);
    assert(heading);
    expect(heading.textContent).toBe("Revenue");
    expect(article.querySelector("strong")?.textContent).toBe("Net");
    expect(article.querySelector("em")?.textContent).toBe("gross");
    const link = article.querySelector<HTMLAnchorElement>("ul li a");
    assert(link);
    expect(link.getAttribute("href")).toBe("https://example.test/guide");
    await act(async () => link.click());
    expect(article.querySelector("textarea, .nb-line-numbers")).toBeNull();

    await act(async () => heading.click());
    const editor = article.querySelector("textarea");
    assert(editor);
    expect(editor.value).toBe(original);
    expect(document.activeElement).toBe(editor);
    expect(article.querySelector('[role="heading"]')).toBeNull();

    await press(editor, "Escape");
    expect(article.querySelector("textarea")).toBeNull();
    expect(article.querySelector('[role="heading"]')?.textContent).toBe(
      "Revenue",
    );
    expect(document.activeElement).toBe(article);

    await press(article, "Enter");
    const keyboardEditor = article.querySelector("textarea");
    assert(keyboardEditor);
    expect(document.activeElement).toBe(keyboardEditor);
    await press(keyboardEditor, "Escape");

    const edit = article.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Summary"]',
    );
    assert(edit);
    expect(edit.textContent).toBe("Edit");
    await act(async () => edit.click());
    const reopened = article.querySelector("textarea");
    assert(reopened);
    expect(document.activeElement).toBe(reopened);
    const next = "## Updated revenue";
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    assert(setter);
    await act(async () => {
      setter.call(reopened, next);
      reopened.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => void reopened.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(false);
    const outside = host.querySelector<HTMLButtonElement>(":scope > button");
    assert(outside);
    await act(async () => outside.focus());
    expect(article.querySelector("textarea, .nb-line-numbers")).toBeNull();
    expect(
      article.querySelector('[role="heading"][aria-level="2"]')?.textContent,
    ).toBe("Updated revenue");
    expect(save).toHaveBeenLastCalledWith(next);
  },
);
