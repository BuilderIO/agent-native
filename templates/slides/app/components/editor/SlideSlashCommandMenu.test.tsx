// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const labels = vi.hoisted(() => ({
  "slideSlashMenu.blocks": "Blocks",
  "slideSlashMenu.text": "Texto",
  "slideSlashMenu.plainParagraph": "Plain paragraph",
  "slideSlashMenu.heading1": "Heading 1",
  "slideSlashMenu.largeSlideHeading": "Large slide heading",
  "slideSlashMenu.heading2": "Heading 2",
  "slideSlashMenu.mediumHeading": "Medium heading",
  "slideSlashMenu.heading3": "Heading 3",
  "slideSlashMenu.smallHeading": "Small heading",
  "slideSlashMenu.bulletList": "Bullet List",
  "slideSlashMenu.unorderedList": "Unordered list",
  "slideSlashMenu.numberedList": "Numbered List",
  "slideSlashMenu.orderedList": "Ordered list",
  "slideSlashMenu.quote": "Quote",
  "slideSlashMenu.blockquote": "Blockquote",
  "slideSlashMenu.divider": "Divider",
  "slideSlashMenu.horizontalRule": "Horizontal rule",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => labels[key as keyof typeof labels] ?? key,
}));

vi.mock("@/components/ui/popover", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Popover: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    PopoverAnchor: ({
      virtualRef,
    }: {
      virtualRef: React.RefObject<{
        getBoundingClientRect: () => DOMRect;
      } | null>;
    }) => {
      const rect = virtualRef.current?.getBoundingClientRect();
      return (
        <span
          data-testid="caret-anchor"
          data-left={rect?.left}
          data-top={rect?.top}
        />
      );
    },
    PopoverContent: React.forwardRef<
      HTMLDivElement,
      {
        children: React.ReactNode;
        collisionPadding?: number;
        "data-slide-inline-edit-surface"?: string;
        onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
      }
    >(
      (
        {
          children,
          collisionPadding,
          "data-slide-inline-edit-surface": surfaceMarker,
          onPointerDown,
        },
        ref,
      ) => (
        <div
          ref={ref}
          data-testid="popover-content"
          data-collision-padding={collisionPadding}
          data-slide-inline-edit-surface={surfaceMarker}
          onPointerDown={onPointerDown}
        >
          {children}
        </div>
      ),
    ),
  };
});

import type { InPlaceTextAuthoringCommand } from "./in-place-text-session";
import { startInPlaceTextSession } from "./in-place-text-session";
import { SlideSlashCommandMenu } from "./SlideSlashCommandMenu";

const originalRangeRect = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
let scrolledOptionIds: string[] = [];

function renderMenu(text: string, caretOffset = text.length) {
  const editingEl = document.createElement("div");
  editingEl.setAttribute("contenteditable", "true");
  const block = document.createElement("p");
  const textNode = document.createTextNode(text);
  block.append(textNode);
  editingEl.append(block);
  document.body.append(editingEl);
  setCaret(textNode, caretOffset);
  editingEl.focus();

  const applyAuthoringCommand = vi.fn();
  const textSession = {
    isActive: true,
    commands: { applyAuthoringCommand },
  } as never;
  const view = render(
    <SlideSlashCommandMenu editingEl={editingEl} textSession={textSession} />,
  );

  return { ...view, editingEl, textNode, applyAuthoringCommand };
}

function fireInput(
  editingEl: HTMLElement,
  inputType: string,
  data: string | null,
) {
  fireEvent(
    editingEl,
    new InputEvent("input", {
      bubbles: true,
      inputType,
      data,
    }),
  );
}

function typeSlash(editingEl: HTMLElement, textNode: Text, offset: number) {
  fireEvent(
    editingEl,
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "/",
    }),
  );
  textNode.insertData(offset, "/");
  setCaret(textNode, offset + 1);
  fireInput(editingEl, "insertText", "/");
}

function typeLikeBrowser(editingEl: HTMLElement, data: string) {
  const beforeInput = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data,
  });
  editingEl.dispatchEvent(beforeInput);
  if (!beforeInput.defaultPrevented) {
    const selection = window.getSelection()!;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(data);
    range.insertNode(textNode);
    setCaret(textNode, data.length);
    fireInput(editingEl, "insertText", data);
  }
  return beforeInput;
}

function renderWithTypedSlash(prefix: string, query = "") {
  const result = renderMenu(prefix, prefix.length);
  typeSlash(result.editingEl, result.textNode, prefix.length);
  if (query) {
    result.textNode.insertData(prefix.length + 1, query);
    setCaret(result.textNode, prefix.length + 1 + query.length);
    fireInput(result.editingEl, "insertText", query);
  }
  return result;
}

function setCaret(textNode: Text, offset: number) {
  const selection = window.getSelection()!;
  selection.collapse(textNode, offset);
}

function keyDown(editingEl: HTMLElement, key: string) {
  return fireEvent.keyDown(editingEl, { key });
}

function expectActiveOption(editingEl: HTMLElement, option: HTMLElement) {
  const listId = editingEl.getAttribute("aria-controls");
  const activeId = editingEl.getAttribute("aria-activedescendant");
  const listbox = listId ? document.getElementById(listId) : null;
  const activeOption = activeId ? document.getElementById(activeId) : null;

  expect(listbox?.getAttribute("role")).toBe("listbox");
  expect(listbox?.getAttribute("aria-activedescendant")).toBe(option.id);
  expect(listbox?.contains(option)).toBe(true);
  expect(activeOption).toBe(option);
  expect(activeOption?.getAttribute("role")).toBe("option");
  expect(activeOption?.getAttribute("aria-selected")).toBe("true");
}

beforeEach(() => {
  scrolledOptionIds = [];
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(40, 50, 0, 20),
  });
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function (this: HTMLElement) {
      scrolledOptionIds.push(this.id);
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    delete (globalThis as Partial<typeof globalThis>).ResizeObserver;
  }
  if (originalScrollIntoView) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
  if (originalRangeRect) {
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      originalRangeRect,
    );
  } else {
    delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  }
});

describe("slide slash command menu", () => {
  it.each([
    ["p", "paragraph"],
    ["text", "paragraph"],
    ["paragraph", "paragraph"],
    ["h1", "heading1"],
    ["#", "heading1"],
    ["heading 1", "heading1"],
    ["heading1", "heading1"],
    ["h2", "heading2"],
    ["##", "heading2"],
    ["heading 2", "heading2"],
    ["heading2", "heading2"],
    ["h3", "heading3"],
    ["###", "heading3"],
    ["heading 3", "heading3"],
    ["heading3", "heading3"],
    ["ul", "bulletList"],
    ["bullet", "bulletList"],
    ["bullet list", "bulletList"],
    ["bulleted list", "bulletList"],
    ["-", "bulletList"],
    ["*", "bulletList"],
    ["+", "bulletList"],
    ["ol", "orderedList"],
    ["number", "orderedList"],
    ["numbered list", "orderedList"],
    ["ordered list", "orderedList"],
    ["1.", "orderedList"],
    ["1)", "orderedList"],
    ["quote", "quote"],
    ["blockquote", "quote"],
    ["block quote", "quote"],
    [">", "quote"],
    ["hr", "divider"],
    ["divider", "divider"],
    ["rule", "divider"],
    ["horizontal rule", "divider"],
    ["---", "divider"],
    ["***", "divider"],
    ["___", "divider"],
  ] as const)("matches /%s to %s with translated labels", (alias, kind) => {
    const labelKey = {
      paragraph: "slideSlashMenu.text",
      heading1: "slideSlashMenu.heading1",
      heading2: "slideSlashMenu.heading2",
      heading3: "slideSlashMenu.heading3",
      bulletList: "slideSlashMenu.bulletList",
      orderedList: "slideSlashMenu.numberedList",
      quote: "slideSlashMenu.quote",
      divider: "slideSlashMenu.divider",
    }[kind] as keyof typeof labels;
    const originalLabel = labels[labelKey];
    labels[labelKey] = "Etiqueta traducida";
    try {
      const { editingEl } = renderWithTypedSlash("", alias);
      const options = screen.getAllByRole("option");

      expect(options).toHaveLength(1);
      expect(options[0].getAttribute("data-value")).toBe(kind);
      expectActiveOption(editingEl, options[0]);
    } finally {
      labels[labelKey] = originalLabel;
    }
  });

  it("matches the Content heading alias across localized command labels", () => {
    const previousLabels = [
      labels["slideSlashMenu.heading1"],
      labels["slideSlashMenu.heading2"],
      labels["slideSlashMenu.heading3"],
    ];
    labels["slideSlashMenu.heading1"] = "Encabezado grande";
    labels["slideSlashMenu.heading2"] = "Encabezado mediano";
    labels["slideSlashMenu.heading3"] = "Encabezado pequeño";
    try {
      const { editingEl } = renderWithTypedSlash("", "heading");
      const options = screen.getAllByRole("option");

      expect(
        options.map((option) => option.getAttribute("data-value")),
      ).toEqual(["heading1", "heading2", "heading3"]);
      expect(options[0].getAttribute("aria-selected")).toBe("true");
      expectActiveOption(editingEl, options[0]);
    } finally {
      labels["slideSlashMenu.heading1"] = previousLabels[0];
      labels["slideSlashMenu.heading2"] = previousLabels[1];
      labels["slideSlashMenu.heading3"] = previousLabels[2];
    }
  });

  it.each([
    ["Step 1 / 3", 10],
    ["and / or", 5],
    ["Inputs / ", 9],
    ["https://slides.test", 8],
    ["Q1 / Q2", 4],
    ["Q1 / Q2", 5],
    ["Revenue and / or", 13],
    ["Revenue and / or", 14],
    ["Pros / ", 6],
    ["Pros / ", 7],
    ["Plan / h", 8],
  ])(
    "does not treat an existing slash in prose as a command: %s at %i",
    (text, caretOffset) => {
      const { editingEl, applyAuthoringCommand } = renderMenu(
        text,
        caretOffset,
      );
      fireEvent(document, new Event("selectionchange"));

      expect(screen.queryByRole("listbox")).toBeNull();
      expect(keyDown(editingEl, "Enter")).toBe(true);
      expect(keyDown(editingEl, "Tab")).toBe(true);
      expect(applyAuthoringCommand).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["", "head"],
    ["before ", "head"],
  ])(
    "opens for a newly typed slash at block start or after whitespace",
    (prefix, query) => {
      renderWithTypedSlash(prefix, query);

      expect(screen.getByRole("listbox")).toBeTruthy();
    },
  );

  it("opens after the browser completes the beforeinput microtask before inserting slash", async () => {
    const { editingEl, textNode } = renderMenu("", 0);
    editingEl.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "/",
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    textNode.insertData(0, "/");
    setCaret(textNode, 1);
    fireInput(editingEl, "insertText", "/");

    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(document.activeElement).toBe(editingEl);
  });

  it("opens for a newly typed slash after a soft line break", () => {
    const editingEl = document.createElement("div");
    editingEl.contentEditable = "true";
    const block = document.createElement("p");
    const firstLine = document.createTextNode("Before");
    const secondLine = document.createTextNode("");
    block.append(firstLine, document.createElement("br"), secondLine);
    editingEl.append(block);
    document.body.append(editingEl);
    setCaret(secondLine, secondLine.length);
    editingEl.focus();

    const applyAuthoringCommand = vi.fn();
    const textSession = {
      isActive: true,
      commands: { applyAuthoringCommand },
    } as never;
    render(
      <SlideSlashCommandMenu editingEl={editingEl} textSession={textSession} />,
    );

    typeSlash(editingEl, secondLine, secondLine.length);
    secondLine.insertData(secondLine.length, "heading\u00a02");
    setCaret(secondLine, secondLine.length);
    fireInput(editingEl, "insertText", "heading 2");

    expect(screen.getByRole("option", { name: /Heading 2/ })).toBeTruthy();
    expect(document.activeElement).toBe(editingEl);
    expect(applyAuthoringCommand).not.toHaveBeenCalled();

    keyDown(editingEl, "Enter");

    const [, range] = applyAuthoringCommand.mock.calls[0] as [
      InPlaceTextAuthoringCommand,
      Range,
    ];
    expect(range.startContainer).toBe(secondLine);
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(secondLine);
    expect(range.endOffset).toBe(secondLine.length);
    expect(range.toString()).toBe("/heading\u00a02");
  });

  it("closes when a whitespace query makes the slash literal", async () => {
    const { editingEl, textNode, applyAuthoringCommand } =
      renderWithTypedSlash("Step 1 ");

    textNode.appendData(" ");
    setCaret(textNode, textNode.length);
    fireInput(editingEl, "insertText", " ");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(applyAuthoringCommand).not.toHaveBeenCalled();
    expect(textNode.data).toBe("Step 1 / ");
    textNode.appendData("3");
    setCaret(textNode, textNode.length);
    fireInput(editingEl, "insertText", "3");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(textNode.data).toBe("Step 1 / 3");
    expect(keyDown(editingEl, "Enter")).toBe(true);
    expect(applyAuthoringCommand).not.toHaveBeenCalled();
  });

  it("filters commands as the user types and moves the active option", () => {
    const { editingEl, textNode } = renderWithTypedSlash("");

    textNode.appendData("head");
    setCaret(textNode, 5);
    fireInput(editingEl, "insertText", "head");

    expect(screen.getAllByRole("option")).toHaveLength(3);
    const event = fireEvent.keyDown(editingEl, { key: "ArrowDown" });

    expect(event).toBe(false);
    expect(
      screen
        .getByRole("option", { name: /Heading 2/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(editingEl, { key: "ArrowDown" });
    fireEvent.keyDown(editingEl, { key: "ArrowDown" });
    expect(
      screen
        .getByRole("option", { name: /Heading 1/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(editingEl, { key: "ArrowUp" });
    expect(
      screen
        .getByRole("option", { name: /Heading 3/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.activeElement).toBe(editingEl);
  });

  it("connects active descendants to real cmdk nodes and scrolls through wraparound", async () => {
    const { editingEl } = renderWithTypedSlash("");
    expect(screen.getByRole("combobox")).toBe(editingEl);
    expect(editingEl.getAttribute("aria-haspopup")).toBe("listbox");
    expect(editingEl.getAttribute("aria-autocomplete")).toBe("list");
    expect(editingEl.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "Blocks" })).toBeTruthy();
    const translatedOption = screen.getByRole("option", { name: /Texto/ });
    expect(translatedOption.getAttribute("aria-selected")).toBe("true");
    expectActiveOption(editingEl, translatedOption);
    const listboxId = editingEl.getAttribute("aria-controls");
    const paragraphId = translatedOption.id;
    expect(listboxId).toMatch(/^slide-slash-.+-listbox$/);
    expect(paragraphId).toMatch(/^slide-slash-.+-option-paragraph$/);

    scrolledOptionIds = [];
    keyDown(editingEl, "ArrowUp");
    const lastOption = screen.getByRole("option", { name: /Divider/ });
    expect(lastOption.getAttribute("aria-selected")).toBe("true");
    expectActiveOption(editingEl, lastOption);
    expect(editingEl.getAttribute("aria-controls")).toBe(listboxId);
    expect(translatedOption.id).toBe(paragraphId);
    await waitFor(() => expect(scrolledOptionIds).toContain(lastOption.id));

    scrolledOptionIds = [];
    keyDown(editingEl, "ArrowDown");
    expect(translatedOption.getAttribute("aria-selected")).toBe("true");
    expectActiveOption(editingEl, translatedOption);
    await waitFor(() =>
      expect(scrolledOptionIds).toContain(translatedOption.id),
    );
    expect(document.activeElement).toBe(editingEl);
  });

  it("uses the translated Blocks label as the listbox accessible name", () => {
    const originalLabel = labels["slideSlashMenu.blocks"];
    labels["slideSlashMenu.blocks"] = "Bloques";
    try {
      renderWithTypedSlash("");

      expect(screen.getByRole("listbox", { name: "Bloques" })).toBeTruthy();
    } finally {
      labels["slideSlashMenu.blocks"] = originalLabel;
    }
  });

  it("fuzzy-matches noncontiguous command text", () => {
    const { editingEl, textNode } = renderWithTypedSlash("");

    textNode.appendData("hd2");
    setCaret(textNode, 4);
    fireInput(editingEl, "insertText", "hd2");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Heading 2/ })).toBeTruthy();
  });

  it("keeps the menu open briefly, then closes after unmatched input", () => {
    const { editingEl, textNode } = renderWithTypedSlash("");

    textNode.appendData("zz");
    setCaret(textNode, 3);
    fireInput(editingEl, "insertText", "zz");
    expect(screen.getByRole("listbox")).toBeTruthy();

    textNode.appendData("z");
    setCaret(textNode, 4);
    fireInput(editingEl, "insertText", "z");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(textNode.data).toBe("/zzz");
    expect(document.activeElement).toBe(editingEl);
  });

  it("runs the active command with Enter and Tab without moving focus", () => {
    for (const key of ["Enter", "Tab"]) {
      const { editingEl, applyAuthoringCommand } = renderWithTypedSlash(
        "",
        "text",
      );
      const event = keyDown(editingEl, key);

      expect(event).toBe(false);
      expect(applyAuthoringCommand).toHaveBeenCalledWith(
        "paragraph" satisfies InPlaceTextAuthoringCommand,
        expect.any(Range),
      );
      expect(document.activeElement).toBe(editingEl);
      cleanup();
      document.body.replaceChildren();
    }
  });

  it("applies a list command to the selected styled row through the menu", async () => {
    const editingEl = document.createElement("div");
    const row = (text: string) => {
      const line = document.createElement("div");
      line.style.display = "flex";
      line.style.gap = "12px";
      line.style.fontSize = "28px";
      line.innerHTML = `<span>●</span><span>${text}</span>`;
      return line;
    };
    editingEl.append(row("One"), row("Two"), row("Three"));
    document.body.append(editingEl);
    const textNode = editingEl.children[1]!.lastChild!.firstChild as Text;
    setCaret(textNode, 0);
    const textSession = startInPlaceTextSession(editingEl);
    render(
      <SlideSlashCommandMenu editingEl={editingEl} textSession={textSession} />,
    );
    editingEl.focus();

    expect(typeLikeBrowser(editingEl, "/").defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    for (const character of "bul") typeLikeBrowser(editingEl, character);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").getAttribute("data-value")).toBe(
      "bulletList",
    );

    expect(keyDown(editingEl, "Enter")).toBe(false);
    expect((editingEl.textContent?.match(/●/g) ?? []).length).toBe(2);
    expect(editingEl.children[0]?.textContent).toBe("●One");
    expect(editingEl.children[1]?.textContent).toBe("Two");
    expect(editingEl.children[1]?.firstElementChild?.textContent).toBe("Two");
    expect(editingEl.children[2]?.textContent).toBe("●Three");
    expect(document.activeElement).toBe(editingEl);
    textSession.end();
  });

  it("keeps an Escape dismissal sticky while typing the slash as literal text", () => {
    const { editingEl, applyAuthoringCommand, textNode } = renderWithTypedSlash(
      "",
      "hea",
    );

    expect(keyDown(editingEl, "Escape")).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(applyAuthoringCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editingEl);
    fireEvent(document, new Event("selectionchange"));
    expect(screen.queryByRole("listbox")).toBeNull();
    textNode.appendData("d");
    setCaret(textNode, textNode.length);
    fireInput(editingEl, "insertText", "d");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(textNode.data).toBe("/head");
    setCaret(textNode, 3);
    fireEvent(document, new Event("selectionchange"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(keyDown(editingEl, "Enter")).toBe(true);
    expect(applyAuthoringCommand).not.toHaveBeenCalled();
  });

  it("restores authored accessibility attributes when the menu closes", () => {
    const { editingEl, textNode } = renderMenu("", 0);
    const authored = {
      role: "textbox",
      "aria-haspopup": "grid",
      "aria-autocomplete": "inline",
      "aria-expanded": "false",
      "aria-controls": "details-panel",
      "aria-activedescendant": "details-heading",
    };
    for (const [name, value] of Object.entries(authored)) {
      editingEl.setAttribute(name, value);
    }

    typeSlash(editingEl, textNode, 0);
    expect(editingEl.getAttribute("role")).toBe("combobox");
    expect(editingEl.getAttribute("aria-haspopup")).toBe("listbox");
    expect(editingEl.getAttribute("aria-autocomplete")).toBe("list");
    expect(editingEl.getAttribute("aria-expanded")).toBe("true");

    keyDown(editingEl, "Escape");
    for (const [name, value] of Object.entries(authored)) {
      expect(editingEl.getAttribute(name)).toBe(value);
    }
  });

  it("restores authored accessibility attributes before applying a retagging command", () => {
    const { editingEl, textNode, applyAuthoringCommand } = renderMenu("", 0);
    const authored = {
      role: "textbox",
      "aria-haspopup": "grid",
      "aria-autocomplete": "inline",
      "aria-expanded": "false",
      "aria-controls": "details-panel",
      "aria-activedescendant": "details-heading",
    };
    for (const [name, value] of Object.entries(authored)) {
      editingEl.setAttribute(name, value);
    }
    let retaggedAttributes: Record<string, string | null> = {};
    applyAuthoringCommand.mockImplementation(() => {
      const retagged = editingEl.cloneNode(true) as HTMLElement;
      retaggedAttributes = Object.fromEntries(
        Object.keys(authored).map((name) => [
          name,
          retagged.getAttribute(name),
        ]),
      );
    });

    typeSlash(editingEl, textNode, 0);
    expect(editingEl.getAttribute("role")).toBe("combobox");
    expect(editingEl.getAttribute("aria-controls")).toMatch(
      /^slide-slash-.+-listbox$/,
    );
    keyDown(editingEl, "Enter");

    expect(applyAuthoringCommand).toHaveBeenCalledOnce();
    expect(retaggedAttributes).toEqual(authored);
  });

  it("closes when the caret leaves the slash query or the slash is deleted", () => {
    const { textNode } = renderWithTypedSlash("before ", "heading");
    expect(screen.getByRole("listbox")).toBeTruthy();

    act(() => {
      setCaret(textNode, 2);
      fireEvent(document, new Event("selectionchange"));
    });
    expect(screen.queryByRole("listbox")).toBeNull();

    const slashEditor = renderWithTypedSlash("", "heading");
    expect(screen.getByRole("listbox")).toBeTruthy();
    act(() => {
      slashEditor.textNode.deleteData(0, 1);
      setCaret(slashEditor.textNode, 0);
      fireInput(slashEditor.editingEl, "deleteContentBackward", null);
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("anchors from the viewport caret rect and asks Radix to avoid viewport edges", () => {
    const transformedSlide = document.createElement("div");
    transformedSlide.style.transform = "scale(0.5)";
    document.body.append(transformedSlide);
    const { editingEl, unmount } = renderWithTypedSlash("");
    transformedSlide.append(editingEl);
    editingEl.focus();

    expect(screen.getByTestId("caret-anchor").getAttribute("data-left")).toBe(
      "40",
    );
    expect(screen.getByTestId("caret-anchor").getAttribute("data-top")).toBe(
      "70",
    );
    expect(
      screen
        .getByTestId("popover-content")
        .getAttribute("data-collision-padding"),
    ).toBe("8");
    const popoverContent = screen.getByTestId("popover-content");
    expect(
      popoverContent
        .querySelector(".p-1")
        ?.closest("[data-slide-inline-edit-surface='true']"),
    ).toBe(popoverContent);
    expect(document.activeElement).toBe(editingEl);
    unmount();
  });

  it("does not steal editor focus when a command is clicked", () => {
    const { editingEl, applyAuthoringCommand } = renderWithTypedSlash(
      "",
      "text",
    );
    const item = screen.getByRole("option", { name: /Texto/ });
    fireEvent.mouseDown(item);
    fireEvent.pointerDown(item);
    fireEvent.click(item);

    expect(applyAuthoringCommand).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(editingEl);
  });

  it("keeps the slash query and editor focus when popover padding is clicked", () => {
    const { editingEl, textNode, applyAuthoringCommand } = renderWithTypedSlash(
      "",
      "text",
    );
    const padding = screen
      .getByTestId("popover-content")
      .querySelector<HTMLElement>(".p-1")!;

    expect(fireEvent.pointerDown(padding)).toBe(false);
    fireEvent.click(padding);

    expect(textNode.data).toBe("/text");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(applyAuthoringCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editingEl);
  });

  it.each([
    ["group heading", "[cmdk-group-heading]"],
    ["list area", "[cmdk-list]"],
    ["menu padding", ".p-1"],
  ])(
    "keeps inline editing active for mousedown on the %s and exits outside",
    (_part, selector) => {
      const { editingEl } = renderWithTypedSlash("");
      const popoverContent = screen.getByTestId("popover-content");
      const inside = popoverContent.querySelector<HTMLElement>(selector)!;
      const outside = document.createElement("button");
      document.body.append(outside);
      const exitInlineEdit = vi.fn();
      const onDocumentMouseDown = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (editingEl.contains(target)) return;
        if (
          target.closest?.(
            "[data-block-bubble-menu], [data-slide-style-trigger], [data-slide-style-dock], [data-slide-inline-edit-surface]",
          )
        ) {
          return;
        }
        exitInlineEdit();
      };
      document.addEventListener("mousedown", onDocumentMouseDown);
      try {
        fireEvent.mouseDown(inside);
        expect(exitInlineEdit).not.toHaveBeenCalled();

        fireEvent.mouseDown(outside);
        expect(exitInlineEdit).toHaveBeenCalledOnce();
      } finally {
        document.removeEventListener("mousedown", onDocumentMouseDown);
      }
    },
  );
});
