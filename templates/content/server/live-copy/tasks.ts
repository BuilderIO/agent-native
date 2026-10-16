import {
  defineLiveCopyTasks,
  type LiveCopyTaskRefusal,
} from "@agent-native/core/collab/live-copy-tasks";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  initProseMirrorDoc,
  prosemirrorToYXmlFragment,
  updateYFragment,
} from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema.js";
import {
  LIVE_BODY_FIELD,
  materializeLiveBody,
} from "../../shared/live-body.js";
import { docToNfm, nfmToDoc } from "../../shared/nfm.js";
import {
  APPLY_SUGGESTION_EDIT,
  applySuggestionEdit,
  type ApplySuggestionInput,
} from "./apply-suggestion-edit.js";

// The worker half of Content's live copy: every handler here runs in the
// bounded task runner, so import only what a worker bundle can carry.

let structuralSchema: Schema | undefined;

function schema(): Schema {
  structuralSchema ??= createContentEditorStructuralSchema();
  return structuralSchema;
}

function refused(reason: string, detail?: string): LiveCopyTaskRefusal {
  return { kind: "refused", reason, ...(detail ? { detail } : {}) };
}

function assertBodyField(field: string): void {
  if (field !== LIVE_BODY_FIELD) {
    throw new Error(
      `Content's live copy binds "${LIVE_BODY_FIELD}", not "${field}".`,
    );
  }
}

function deriveBody(doc: Y.Doc, field: string): string | LiveCopyTaskRefusal {
  assertBodyField(field);
  // Building the tree deletes what the schema rejects, and derive must not
  // edit the doc it is given.
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const body = materializeLiveBody(copy);
    if (body.kind === "lossy") {
      return refused("lossy", "the page schema cannot carry part of the body");
    }
    if (body.kind === "uninitialized") return refused("empty");
    return body.markdown;
  } finally {
    copy.destroy();
  }
}

/**
 * The tree a Markdown body becomes in the editor. A body the schema cannot
 * represent in full is refused: the live copy would keep the rest and the
 * page would lose that part on its next commit.
 */
function buildBody(markdown: string): PMNode | LiveCopyTaskRefusal {
  const parsed = nfmToDoc(markdown);
  let root: PMNode;
  try {
    root = schema().nodeFromJSON(parsed);
    root.check();
  } catch (error) {
    return refused(
      "unrepresentable",
      error instanceof Error ? error.message : undefined,
    );
  }
  if (docToNfm(root.toJSON()) !== docToNfm(parsed)) {
    return refused("lossy", "the page schema drops part of this body");
  }
  return root;
}

function replaceBodyInput(
  input: unknown,
): { content: string; expected?: string } | LiveCopyTaskRefusal {
  if (typeof input !== "object" || input === null) {
    return refused("invalid_input", "expected { content, expected? }");
  }
  const { content, expected } = input as Record<string, unknown>;
  if (typeof content !== "string") {
    return refused("invalid_input", "content must be a string");
  }
  if (expected !== undefined && typeof expected !== "string") {
    return refused("invalid_input", "expected must be a string");
  }
  return expected === undefined ? { content } : { content, expected };
}

function applySuggestionInput(
  input: unknown,
): ApplySuggestionInput | LiveCopyTaskRefusal {
  const steps = (input as { steps?: unknown } | null)?.steps;
  if (
    !Array.isArray(steps) ||
    !steps.every(
      (step) =>
        typeof step === "object" &&
        step !== null &&
        typeof step.operation === "object" &&
        step.operation !== null &&
        Array.isArray(step.acceptedSiblingRanges),
    )
  ) {
    return refused(
      "invalid_input",
      "expected { steps: [{ operation, acceptedSiblingRanges }] }",
    );
  }
  return { steps };
}

function isRefusal(value: unknown): value is LiveCopyTaskRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "refused"
  );
}

export const tasks = defineLiveCopyTasks({
  derive: deriveBody,

  seed(doc, field, source) {
    assertBodyField(field);
    const root = buildBody(source);
    if (isRefusal(root)) return root;
    prosemirrorToYXmlFragment(root, doc.getXmlFragment(field));
  },

  edits: {
    /**
     * Makes the body `content`, editing only the blocks that differ so open
     * editors keep their place. With `expected`, refuses `base_changed`
     * unless the current body is exactly that text.
     */
    "replace-body"(doc, field, input) {
      const parsed = replaceBodyInput(input);
      if (isRefusal(parsed)) return parsed;
      if (parsed.expected !== undefined) {
        const current = deriveBody(doc, field);
        if (isRefusal(current)) return current;
        if (current !== parsed.expected) return refused("base_changed");
      }
      const root = buildBody(parsed.content);
      if (isRefusal(root)) return root;
      const fragment = doc.getXmlFragment(field);
      const { meta } = initProseMirrorDoc(fragment, schema());
      updateYFragment(doc, fragment, root, meta);
    },

    /** Accepts suggestions; see `applySuggestionEdit`. */
    [APPLY_SUGGESTION_EDIT](doc, field, input) {
      const parsed = applySuggestionInput(input);
      if (isRefusal(parsed)) return parsed;
      return applySuggestionEdit(doc, field, parsed);
    },
  },
});
