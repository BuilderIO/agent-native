// @vitest-environment happy-dom

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import {
  createComposeAutocompletePlugin,
  getCommonPhraseCompletion,
  getComposeAutocompleteSuggestion,
  handleComposeAutocompleteKeyDown,
} from "./compose-autocomplete";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

function createState(
  plugin: ReturnType<typeof createComposeAutocompletePlugin>,
  text = "",
) {
  const paragraph = schema.node(
    "paragraph",
    null,
    text ? [schema.text(text)] : [],
  );
  const doc = schema.node("doc", null, [paragraph]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1 + text.length),
    plugins: [plugin],
  });
}

function createView(initialState: EditorState) {
  let currentState = initialState;
  const view = {
    get state() {
      return currentState;
    },
    dispatch(transaction: Parameters<EditorState["apply"]>[0]) {
      currentState = currentState.apply(transaction);
    },
  } as unknown as EditorView;
  return view;
}

function typeText(
  plugin: ReturnType<typeof createComposeAutocompletePlugin>,
  view: EditorView,
  text: string,
) {
  plugin.props.handleTextInput?.call(
    plugin,
    view,
    view.state.selection.from,
    view.state.selection.to,
    text,
    () => view.state.tr,
  );
  view.dispatch(
    view.state.tr.insertText(
      text,
      view.state.selection.from,
      view.state.selection.to,
    ),
  );
}

function keyboardEvent(key: string) {
  return new KeyboardEvent("keydown", { key, cancelable: true });
}

describe("compose autocomplete", () => {
  it("completes phrase and partial-word prefixes without learning mailbox text", () => {
    expect(getCommonPhraseCompletion("Thanks for")).toBe(" taking the time.");
    expect(getCommonPhraseCompletion("Appreciat")).toBe(
      "e your help with this.",
    );
    expect(getCommonPhraseCompletion("private mailbox data")).toBeNull();
  });

  it("keeps an existing trailing space from being duplicated", () => {
    expect(getCommonPhraseCompletion("Thanks ")).toBe("for reaching out.");
  });

  it("does not suggest after punctuation or inside another word", () => {
    expect(getCommonPhraseCompletion("Thanks.")).toBeNull();
    expect(getCommonPhraseCompletion("unthanks")).toBeNull();
    expect(getCommonPhraseCompletion("éthanks")).toBeNull();
    expect(getCommonPhraseCompletion("𐐀thanks")).toBeNull();
    expect(getCommonPhraseCompletion("e\u0301thanks")).toBeNull();
  });

  it("offers a desktop suggestion and accepts it once with Tab", () => {
    const plugin = createComposeAutocompletePlugin(() => ({
      enabled: true,
      isMobile: false,
    }));
    const view = createView(createState(plugin));
    typeText(plugin, view, "Thanks");

    expect(getComposeAutocompleteSuggestion(view.state)?.text).toBe(
      " for reaching out.",
    );
    expect(
      handleComposeAutocompleteKeyDown(
        view,
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          shiftKey: true,
          cancelable: true,
        }),
        () => ({ enabled: true, isMobile: false }),
      ),
    ).toBe(false);
    const event = keyboardEvent("Tab");
    expect(
      handleComposeAutocompleteKeyDown(view, event, () => ({
        enabled: true,
        isMobile: false,
      })),
    ).toBe(true);
    expect(view.state.doc.textContent).toBe("Thanks for reaching out.");
    expect(getComposeAutocompleteSuggestion(view.state)).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it("accepts with Right Arrow and dismisses with Escape without editing the draft", () => {
    const plugin = createComposeAutocompletePlugin(() => ({
      enabled: true,
      isMobile: false,
    }));
    const view = createView(createState(plugin));
    typeText(plugin, view, "Thanks");

    expect(
      handleComposeAutocompleteKeyDown(view, keyboardEvent("Escape"), () => ({
        enabled: true,
        isMobile: false,
      })),
    ).toBe(true);
    expect(view.state.doc.textContent).toBe("Thanks");
    expect(getComposeAutocompleteSuggestion(view.state)).toBeNull();
    expect(
      handleComposeAutocompleteKeyDown(view, keyboardEvent("Escape"), () => ({
        enabled: true,
        isMobile: false,
      })),
    ).toBe(false);

    typeText(plugin, view, " Thank you");
    expect(
      handleComposeAutocompleteKeyDown(
        view,
        keyboardEvent("ArrowRight"),
        () => ({ enabled: true, isMobile: false }),
      ),
    ).toBe(true);
    expect(view.state.doc.textContent).toBe(
      "Thanks Thank you for getting back to me.",
    );
  });

  it("keeps Tab native when off, on mobile, or without an active suggestion", () => {
    const options = { enabled: false, isMobile: false };
    const plugin = createComposeAutocompletePlugin(() => options);
    const view = createView(createState(plugin));
    typeText(plugin, view, "Thanks");
    expect(getComposeAutocompleteSuggestion(view.state)).toBeNull();
    expect(
      handleComposeAutocompleteKeyDown(
        view,
        keyboardEvent("Tab"),
        () => options,
      ),
    ).toBe(false);

    const mobilePlugin = createComposeAutocompletePlugin(() => ({
      enabled: true,
      isMobile: true,
    }));
    const mobileView = createView(createState(mobilePlugin));
    typeText(mobilePlugin, mobileView, "Thanks");
    expect(getComposeAutocompleteSuggestion(mobileView.state)).toBeNull();
  });
});
