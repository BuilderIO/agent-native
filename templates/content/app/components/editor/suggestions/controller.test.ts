import { describe, expect, it } from "vitest";

import {
  addPendingSuggestion,
  createSuggestionDraft,
  previewSuggestionDraft,
  removePendingSuggestion,
  suggestionDraftDecorations,
} from "./controller";
import { digest, makeAnchor, textContent, type SuggestionNode } from "./model";

const makeDoc = (text: string): SuggestionNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("suggestion draft controller", () => {
  it("keeps canonical content unchanged while deriving a preview", () => {
    const canonical = makeDoc("Hello");
    const draft = createSuggestionDraft(canonical);
    const next = addPendingSuggestion(draft, {
      id: "add-1",
      kind: "insert_text",
      from: 5,
      to: 5,
      before: "",
      after: " world",
      baseDigest: digest(textContent(canonical)),
      anchor: makeAnchor("Hello", 5, 5),
    });

    expect(textContent(previewSuggestionDraft(next))).toBe("Hello world");
    expect(textContent(canonical)).toBe("Hello");
    expect(next.pending).toHaveLength(1);
    expect(suggestionDraftDecorations(next)[0]).toMatchObject({
      operationId: "add-1",
      className: "suggestion-change",
    });
  });

  it("removes a pending operation without changing the baseline", () => {
    const canonical = makeDoc("Hello");
    const draft = createSuggestionDraft(canonical);
    const operation = {
      id: "delete-1",
      kind: "delete_text" as const,
      from: 0,
      to: 5,
      before: "Hello",
      after: "",
      baseDigest: digest("Hello"),
      anchor: makeAnchor("Hello", 0, 5),
    };
    const pending = addPendingSuggestion(draft, operation);
    const restored = removePendingSuggestion(pending, operation.id);
    expect(textContent(previewSuggestionDraft(restored))).toBe("Hello");
    expect(restored.pending).toEqual([]);
  });
});
