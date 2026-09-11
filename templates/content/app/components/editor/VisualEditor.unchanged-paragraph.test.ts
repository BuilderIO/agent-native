// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { resolveMarkdownSuggestionRange } from "@shared/suggestion-rebase";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { suggestionPresentation } from "./DocumentEditor";
import { setSuggestionHighlights } from "./extensions/SuggestionHighlight";
import {
  createVisualEditorExtensions,
  suggestionHighlightSpec,
} from "./VisualEditor";

const saved =
  "This reads better compared to the original.\nEditors publish carefully.\nFinal sentence.";
const canonical =
  "This reads more clearly than the original.\u00a0Indeed.\nEditors publish carefully.\nAlso:\u00a0Final sentence.\u00a0Added words\u00a0revised\u00a0finally.";

describe("saved unchanged paragraph presentation", () => {
  it.each([false, true])(
    "keeps the remaining native marker through sequential decisions, reverse=%s",
    (reverse) => {
      const operations = [
        [52, 59, "review", "replace_text"],
        [44, 44, "Review note.\u00a0", "insert_text"],
      ] as const;
      const mount = document.createElement("div");
      document.body.append(mount);
      const editor = new Editor({
        element: mount,
        extensions: createVisualEditorExtensions(),
        content: nfmToDoc(canonical),
      });
      let current = canonical;
      try {
        for (const [from, to, inserted, kind] of reverse
          ? [...operations].reverse()
          : operations) {
          const operation = {
            ordinal: 0,
            kind,
            targetId: "body",
            schemaVersion: 1,
            before: { markdown: saved, changedText: saved.slice(from, to) },
            after: {
              markdown: saved.slice(0, from) + inserted + saved.slice(to),
              changedText: inserted,
            },
            anchor: {
              from,
              to,
              prefix: saved.slice(Math.max(0, from - 32), from),
              suffix: saved.slice(to, to + 32),
            },
          };
          const presentation = suggestionPresentation(
            { id: "sequential", status: "pending", operations: [operation] },
            current,
          );
          expect(presentation).not.toBeNull();
          const spec = suggestionHighlightSpec(editor.state.doc, presentation!);
          expect(spec).not.toBeNull();
          setSuggestionHighlights(editor.view, { specs: [spec!] });
          const marker = editor.view.dom.querySelector(
            '[data-suggestion-id="sequential"]',
          );
          expect(marker?.isConnected).toBe(true);
          expect(marker?.closest("p")).toBe(
            editor.view.dom.querySelectorAll("p")[1],
          );
          const range = resolveMarkdownSuggestionRange(current, operation)!;
          expect(current.slice(range.from, range.to)).toBe(
            operation.before.changedText,
          );
          current =
            current.slice(0, range.from) + inserted + current.slice(range.to);
          editor.commands.setContent(nfmToDoc(current));
        }
        expect(editor.view.dom.querySelectorAll("p")[1].textContent).toBe(
          "Review note.\u00a0Editors review carefully.",
        );
      } finally {
        editor.destroy();
        mount.remove();
      }
    },
  );
  it.each([
    [52, 59, "review", "replace_text", canonical],
    [44, 44, "Review note.\u00a0", "insert_text", canonical],
    [
      52,
      59,
      "review",
      "replace_text",
      canonical.replace("Editors", "Review note.\u00a0Editors"),
    ],
    [
      44,
      44,
      "Review note.\u00a0",
      "insert_text",
      canonical.replace("publish", "review"),
    ],
  ] as const)(
    "renders saved proposal %s on its retained paragraph",
    (from, to, inserted, kind, current) => {
      const operation = {
        ordinal: 0,
        kind,
        targetId: "body",
        schemaVersion: 1,
        before: { markdown: saved, changedText: saved.slice(from, to) },
        after: {
          markdown: saved.slice(0, from) + inserted + saved.slice(to),
          changedText: inserted,
        },
        anchor: {
          from,
          to,
          prefix: saved.slice(Math.max(0, from - 32), from),
          suffix: saved.slice(to, to + 32),
        },
      };
      const proposal = {
        id: "retained-paragraph",
        status: "pending" as const,
        operations: [operation],
      };
      const presentation = suggestionPresentation(proposal, current);
      expect(presentation).not.toBeNull();
      const mount = document.createElement("div");
      document.body.append(mount);
      const editor = new Editor({
        element: mount,
        extensions: createVisualEditorExtensions(),
        content: nfmToDoc(current),
      });
      try {
        const before = editor.getJSON();
        const spec = suggestionHighlightSpec(editor.state.doc, presentation!);
        expect(spec).not.toBeNull();
        setSuggestionHighlights(editor.view, { specs: [spec!] });
        const marker = editor.view.dom.querySelector(
          '[data-suggestion-id="retained-paragraph"]',
        );
        expect(marker?.isConnected).toBe(true);
        expect(marker?.closest("p")).toBe(
          editor.view.dom.querySelectorAll("p")[1],
        );
        expect(editor.getJSON()).toEqual(before);
      } finally {
        editor.destroy();
        mount.remove();
      }
    },
  );
});
