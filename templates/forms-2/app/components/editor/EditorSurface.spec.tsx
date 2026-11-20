// @vitest-environment happy-dom

// CEN-forms-2-001: once a block is selected, Backspace or Delete typed in any other
// field deleted that block instead of editing the text, and Enter jumped the caret into
// it. The window-level key listener never looked at what had focus.

import { createBlock, questionBlocks } from "@shared/form-model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { EditorSurface } from "./EditorSurface";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Doc = Parameters<typeof EditorSurface>[0]["doc"];

/** The question's two records share a group id, so a deletion removes both. */
const Q_ONE = ["q-one:title", "q-one:input"];
const Q_TWO = ["q-two:title", "q-two:input"];

function makeDoc() {
  const blocks = [
    createBlock("FORM_TITLE", { text: "Keys" }, { uuid: "form-title" }),
    ...questionBlocks({ type: "INPUT_EMAIL", title: "One", id: "q-one" }),
    ...questionBlocks({ type: "INPUT_TEXT", title: "Two", id: "q-two" }),
  ];
  const doc = {
    blocks,
    latest: { current: blocks },
    update: (fn: (current: typeof blocks) => typeof blocks) => {
      doc.latest.current = fn(doc.latest.current);
    },
  };
  const calls: number[] = [];
  const update = doc.update;
  doc.update = (fn: (current: typeof blocks) => typeof blocks) => {
    calls.push(1);
    update(fn);
  };
  return { doc, calls };
}

const uuids = (doc: { latest: { current: { uuid: string }[] } }) =>
  doc.latest.current.map((block) => block.uuid);

describe("editor keys while a block is selected", () => {
  let host: HTMLDivElement;
  let root: Root;
  let outside: HTMLTextAreaElement;
  let outsideInput: HTMLInputElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    // The Customize panel's fields mount as a sibling of the canvas.
    outside = document.createElement("textarea");
    document.body.append(outside);
    outsideInput = document.createElement("input");
    document.body.append(outsideInput);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    outside.remove();
    outsideInput.remove();
  });

  const key = (target: EventTarget, k: string) => {
    const event = new KeyboardEvent("keydown", {
      key: k,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  /** Escape in a question's title field selects that block and blurs the field. */
  async function selectFirstQuestion(doc: Doc) {
    await act(async () => {
      root.render(<EditorSurface doc={doc} />);
    });
    const title = host.querySelector<HTMLElement>(
      '[data-editable="q-one:title"]',
    );
    expect(title, "the first question's title field").toBeTruthy();
    await act(async () => {
      title!.focus();
      key(title!, "Escape");
    });
  }

  it("keeps the selection through field keys: Backspace, Delete and Enter edit the field", async () => {
    const { doc } = makeDoc();
    await selectFirstQuestion(doc as unknown as Doc);
    const before = uuids(doc);

    for (const target of [outside, outsideInput] as HTMLElement[]) {
      for (const k of ["Backspace", "Delete"]) {
        let event!: KeyboardEvent;
        await act(async () => {
          target.focus();
          event = key(target, k);
        });
        expect(event.defaultPrevented, `${k} in a field is not swallowed`).toBe(
          false,
        );
        expect(uuids(doc)).toEqual(before);
      }
    }

    // Enter in a textarea stays a newline, not a jump into the block.
    await act(async () => {
      outside.focus();
      const enter = key(outside, "Enter");
      expect(enter.defaultPrevented).toBe(false);
    });
    expect(document.activeElement).toBe(outside);
    expect(uuids(doc)).toEqual(before);
  });

  it("keeps the selection while the Add block search box is used", async () => {
    const { doc } = makeDoc();
    await selectFirstQuestion(doc as unknown as Doc);
    const before = uuids(doc);

    const row = host
      .querySelector('[data-editable="q-one:title"]')!
      .closest("[data-item]");
    expect(row, "the selected block's row").toBeTruthy();
    // React derives its hover state from a bubbling mouseover, which renders the
    // gutter holding the Add block button.
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const addBlock = host.querySelector<HTMLElement>(
      '[aria-label="forms.editor.addBlock"]',
    );
    expect(addBlock, "the Add block gutter button").toBeTruthy();
    await act(async () => {
      addBlock!.click();
    });

    const search = document.querySelector<HTMLInputElement>(
      '[aria-label="forms.editor.searchBlocks"]',
    );
    expect(search, "the Add block search box").toBeTruthy();
    await act(async () => {
      search!.focus();
      search!.value = "ab";
    });
    for (const k of ["Backspace", "Delete"]) {
      let event!: KeyboardEvent;
      await act(async () => {
        event = key(search!, k);
      });
      expect(event.defaultPrevented, `${k} in the search box`).toBe(false);
      expect(uuids(doc)).toEqual(before);
    }
  });

  it("still removes the selected block on Backspace outside any field", async () => {
    const { doc } = makeDoc();
    await selectFirstQuestion(doc as unknown as Doc);
    const before = uuids(doc);

    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      document.body.focus();
      const event = key(document.body, "Backspace");
      expect(event.defaultPrevented).toBe(true);
    });
    expect(uuids(doc)).toEqual(before.filter((uuid) => !Q_ONE.includes(uuid)));
    expect(uuids(doc)).toEqual(expect.arrayContaining(Q_TWO));
  });

  it("still removes the selected block on Delete outside any field", async () => {
    const { doc } = makeDoc();
    await selectFirstQuestion(doc as unknown as Doc);
    const before = uuids(doc);
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      document.body.focus();
      key(document.body, "Delete");
    });
    expect(uuids(doc)).toEqual(before.filter((u) => !Q_ONE.includes(u)));
  });

  it("still moves the caret into the block on Enter outside any field", async () => {
    const { doc } = makeDoc();
    await selectFirstQuestion(doc as unknown as Doc);
    const before = uuids(doc);
    await act(async () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      document.body.focus();
      const event = key(document.body, "Enter");
      expect(event.defaultPrevented).toBe(true);
    });
    expect(uuids(doc)).toEqual(before);
  });
});
