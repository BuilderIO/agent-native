import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

export type ComposeAutocompleteOptions = {
  enabled: boolean;
  isMobile: boolean;
};

export type ComposeAutocompleteSuggestion = {
  position: number;
  text: string;
};

type ComposeAutocompletePluginState = {
  suggestion: ComposeAutocompleteSuggestion | null;
};

type ComposeAutocompleteMeta = {
  dismiss?: boolean;
  refresh?: boolean;
};

const autocompletePluginKey = new PluginKey<ComposeAutocompletePluginState>(
  "composeAutocomplete",
);

const commonPhraseCompletions = [
  { trigger: "please let me know", completion: " if you have any questions." },
  { trigger: "looking forward", completion: " to hearing from you." },
  { trigger: "thanks for", completion: " taking the time." },
  { trigger: "thank you", completion: " for getting back to me." },
  { trigger: "i appreciate", completion: " you taking a look." },
  { trigger: "let me know", completion: " what works best for you." },
  { trigger: "i will", completion: " get back to you shortly." },
  { trigger: "i'll", completion: " follow up as soon as I have an update." },
  { trigger: "happy to", completion: " help." },
  { trigger: "could you", completion: " let me know what you think?" },
  { trigger: "does that", completion: " work for you?" },
  { trigger: "thanks", completion: " for reaching out." },
  { trigger: "thank", completion: " you for reaching out." },
  { trigger: "appreciat", completion: "e your help with this." },
  { trigger: "best reg", completion: "ards," },
].sort((left, right) => right.trigger.length - left.trigger.length);

export function getCommonPhraseCompletion(textBeforeCursor: string) {
  const text = textBeforeCursor.trimEnd();
  if (!text || /[.!?,:;]$/u.test(text)) return null;

  const lowerText = text.toLowerCase();
  const trailingSpace = textBeforeCursor.length > text.length;
  for (const { trigger, completion } of commonPhraseCompletions) {
    const start = lowerText.length - trigger.length;
    if (start < 0 || !lowerText.endsWith(trigger)) continue;
    if (start > 0 && /(?:\p{L}|\p{M}|\p{N})$/u.test(text.slice(0, start)))
      continue;
    return trailingSpace ? completion.trimStart() : completion;
  }
  return null;
}

function findSuggestion(
  state: EditorState,
  options: ComposeAutocompleteOptions,
): ComposeAutocompleteSuggestion | null {
  if (!options.enabled || options.isMobile || !state.selection.empty) {
    return null;
  }

  const { $from } = state.selection;
  if (
    $from.parent.type.name !== "paragraph" ||
    $from.parentOffset !== $from.parent.content.size
  ) {
    return null;
  }

  const marks = state.storedMarks ?? $from.marks();
  if (
    marks.some((mark) => mark.type.name === "code" || mark.type.name === "link")
  ) {
    return null;
  }

  const textBeforeCursor = $from.parent.textBetween(
    0,
    $from.parentOffset,
    "\n",
  );
  const text = getCommonPhraseCompletion(textBeforeCursor);
  return text ? { position: $from.pos, text } : null;
}

export function getComposeAutocompleteSuggestion(state: EditorState) {
  return autocompletePluginKey.getState(state)?.suggestion ?? null;
}

export function createComposeAutocompletePlugin(
  getOptions: () => ComposeAutocompleteOptions,
) {
  let lastUserInputAt = 0;

  return new Plugin<ComposeAutocompletePluginState>({
    key: autocompletePluginKey,
    state: {
      init: () => ({ suggestion: null }),
      apply: (transaction, previous, _oldState, newState) => {
        const meta = transaction.getMeta(autocompletePluginKey) as
          | ComposeAutocompleteMeta
          | undefined;
        if (meta?.dismiss) return { suggestion: null };
        if (
          !transaction.docChanged &&
          !transaction.selectionSet &&
          !meta?.refresh
        ) {
          return previous;
        }

        const options = getOptions();
        if (!options.enabled || options.isMobile) {
          return { suggestion: null };
        }
        if (meta?.refresh) {
          return {
            suggestion: findSuggestion(newState, options),
          };
        }
        if (transaction.selectionSet && !transaction.docChanged) {
          return { suggestion: null };
        }
        if (Date.now() - lastUserInputAt > 1_000) {
          return { suggestion: null };
        }
        return {
          suggestion: findSuggestion(newState, options),
        };
      },
    },
    props: {
      decorations: (state) => {
        const suggestion = autocompletePluginKey.getState(state)?.suggestion;
        const options = getOptions();
        if (
          !suggestion ||
          !options.enabled ||
          options.isMobile ||
          !state.selection.empty ||
          state.selection.from !== suggestion.position
        ) {
          return null;
        }

        return DecorationSet.create(state.doc, [
          Decoration.widget(
            suggestion.position,
            () => {
              const ghost = document.createElement("span");
              ghost.className = "compose-autocomplete-ghost";
              ghost.setAttribute("aria-hidden", "true");
              ghost.contentEditable = "false";
              ghost.textContent = suggestion.text;
              return ghost;
            },
            { key: `${suggestion.position}:${suggestion.text}`, side: 1 },
          ),
        ]);
      },
      handleTextInput: () => {
        lastUserInputAt = Date.now();
        return false;
      },
      handlePaste: () => {
        lastUserInputAt = Date.now();
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Backspace" || event.key === "Delete") {
          lastUserInputAt = Date.now();
        }
        return false;
      },
    },
  });
}

export function createComposeAutocompleteExtension(
  getOptions: () => ComposeAutocompleteOptions,
) {
  return Extension.create({
    name: "composeAutocomplete",
    addProseMirrorPlugins() {
      return [createComposeAutocompletePlugin(getOptions)];
    },
  });
}

export function refreshComposeAutocomplete(editorView: EditorView) {
  editorView.dispatch(
    editorView.state.tr.setMeta(autocompletePluginKey, { refresh: true }),
  );
}

export function handleComposeAutocompleteKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  getOptions: () => ComposeAutocompleteOptions,
) {
  if (event.isComposing) return false;

  const options = getOptions();
  if (!options.enabled || options.isMobile) return false;

  const suggestion = getComposeAutocompleteSuggestion(view.state);
  if (!suggestion) return false;

  if (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (event.key === "Tab" || event.key === "ArrowRight")
  ) {
    if (
      view.state.selection.empty &&
      view.state.selection.from === suggestion.position
    ) {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch(
        view.state.tr.insertText(suggestion.text, suggestion.position),
      );
      return true;
    }
  }

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    view.dispatch(
      view.state.tr.setMeta(autocompletePluginKey, { dismiss: true }),
    );
    return true;
  }

  return false;
}
