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
import { bodyHoldsChanges } from "../../shared/document-intent-merge.js";
import {
  LIVE_BODY_FIELD,
  materializeLiveBody,
} from "../../shared/live-body.js";
import { docToNfm, nfmToDoc } from "../../shared/nfm.js";
import { rebaseBodyEdit, type BodyTextRange } from "./rebase.js";
import { CONTENT_HOLDS_BODY_TASK, type HoldsBodyResult } from "./task-names.js";

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

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Whether the parse of `markdown` lost words of it, such as an unindented
 * callout child. Comparing two serializations of the parse cannot see that,
 * since both have already lost them. A structure the parse changes with
 * every word kept, such as a flattened list, still passes.
 */
function parseDropsText(markdown: string): boolean {
  const kept = new Map<string, number>();
  for (const word of docToNfm(nfmToDoc(markdown)).match(WORD) ?? []) {
    kept.set(word, (kept.get(word) ?? 0) + 1);
  }
  for (const word of markdown.match(WORD) ?? []) {
    const count = kept.get(word) ?? 0;
    if (count === 0) return true;
    kept.set(word, count - 1);
  }
  return false;
}

/**
 * The tree a Markdown body becomes in the editor. A body the parse or the
 * schema cannot represent in full is refused: the live copy would keep the
 * rest and the page would lose that part on its next commit.
 */
function buildBody(markdown: string): PMNode | LiveCopyTaskRefusal {
  if (parseDropsText(markdown)) {
    return refused("lossy", "the Markdown parser drops part of this body");
  }
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

type BodyEdit = {
  base: string;
  candidate: string;
  authored: BodyTextRange[];
};

function isTextRange(value: unknown, length: number): value is BodyTextRange {
  const { start, end } = (value ?? {}) as Record<string, unknown>;
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    0 <= (start as number) &&
    (start as number) <= (end as number) &&
    (end as number) <= length
  );
}

function bodyEdit(value: unknown): BodyEdit | undefined {
  const { base, candidate, authored } = (value ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof base !== "string" || typeof candidate !== "string") {
    return undefined;
  }
  if (authored === undefined) return { base, candidate, authored: [] };
  if (
    !Array.isArray(authored) ||
    !authored.every((range) => isTextRange(range, base.length))
  ) {
    return undefined;
  }
  const ranges = authored
    .map(({ start, end }) => ({ start, end }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  // The rebase probes each range at its offsets in base, which an
  // overlapping range's replacement would move.
  if (
    ranges.some(
      (range, index) => index > 0 && range.start < ranges[index - 1].end,
    )
  ) {
    return undefined;
  }
  return { base, candidate, authored: ranges };
}

function rebaseBodyInput(input: unknown): BodyEdit | LiveCopyTaskRefusal {
  return (
    bodyEdit(input) ??
    refused(
      "invalid_input",
      "expected { base, candidate } as strings, with authored? as ranges of base that don't overlap",
    )
  );
}

function isRefusal(value: unknown): value is LiveCopyTaskRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "refused"
  );
}

function isCanonical(markdown: string): boolean {
  try {
    return docToNfm(nfmToDoc(markdown)) === markdown;
  } catch {
    // coercion-ok: a body the parser rejects is not canonical, and its save keeps its draft.
    return false;
  }
}

function holdsBodyInput(input: unknown): {
  base: string;
  stored: string;
  candidate: string;
} {
  const { base, stored, candidate } = (input ?? {}) as Record<string, unknown>;
  if (
    typeof base !== "string" ||
    typeof stored !== "string" ||
    typeof candidate !== "string"
  ) {
    throw new TypeError("expected { base, stored, candidate } as strings");
  }
  return { base, stored, candidate };
}

const liveCopyTasks = defineLiveCopyTasks({
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

    /**
     * Applies the blocks `candidate` changed from `base` to the current body
     * (`rebaseBodyEdit`), so a writer's edit keeps what tabs typed since its
     * base. Refuses `conflict` when the edit's place in the current body is
     * ambiguous, or when a tab changed a block the edit's `authored` ranges
     * of `base` touch. A peer's commit that overtakes it runs it again on
     * the peer's body.
     */
    "rebase-body"(doc, field, input) {
      const edit = rebaseBodyInput(input);
      if (isRefusal(edit)) return edit;
      const current = deriveBody(doc, field);
      if (isRefusal(current)) return current;
      // The rebase keeps the candidate's blocks in their parsed form, which
      // has already lost whatever the parse drops.
      if (parseDropsText(edit.candidate)) {
        return refused("lossy", "the Markdown parser drops part of this body");
      }
      const content =
        current === edit.base
          ? edit.candidate
          : rebaseBodyEdit(edit.base, edit.candidate, current, edit.authored);
      if (content === null) return refused("conflict");
      const root = buildBody(content);
      if (isRefusal(root)) return root;
      const fragment = doc.getXmlFragment(field);
      const { meta } = initProseMirrorDoc(fragment, schema());
      updateYFragment(doc, fragment, root, meta);
    },
  },
});

export const tasks = {
  ...liveCopyTasks,
  /** Whether the stored body holds every change `candidate` made to `base`. */
  async [CONTENT_HOLDS_BODY_TASK](input: unknown): Promise<HoldsBodyResult> {
    const { base, stored, candidate } = holdsBodyInput(input);
    // The comparison reads the candidate in its parsed form, and a parse can
    // drop text, such as an unindented callout child. Only an editor's own
    // serialization says what the save holds.
    if (!isCanonical(candidate)) return "noncanonical";
    return bodyHoldsChanges(base, stored, candidate) ? "held" : "unheld";
  },
};
