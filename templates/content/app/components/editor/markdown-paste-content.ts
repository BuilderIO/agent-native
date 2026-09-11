import { createNodeFromContent } from "@tiptap/core";
import {
  Fragment,
  type Node as PMNode,
  type ParseOptions,
  type Schema,
} from "@tiptap/pm/model";

/**
 * Turns the HTML that `tiptap-markdown` produces for a pasted markdown payload
 * into editor content that `insertContent` can accept.
 *
 * Two hazards live on this path, and both only show up on real articles:
 *
 * 1. `tiptap-markdown` overrides `insertContentAt` to run the markdown parser
 *    over any *string* value. Handing it already-parsed HTML therefore parses
 *    the payload a second time, which re-emits raw HTML blocks and collapses
 *    fenced code containing a blank line. Passing ProseMirror content instead
 *    skips that override, so the payload is parsed exactly once.
 * 2. `insertContent` calls `Node.check()` on every top-level node regardless of
 *    `errorOnInvalidContent`, so one childless container (`<table></table>`,
 *    `<ul></ul>`) throws a `RangeError` out of the paste handler and loses the
 *    whole paste. ProseMirror's own clipboard path never throws because
 *    `Transform.replace` refits the slice.
 */
export type MarkdownPasteContent =
  | { status: "ready"; content: Fragment; repairedFrom: string | null }
  | { status: "unusable"; reason: string };

/** The parse options TipTap's own `insertContentAt` uses for an HTML string. */
function pasteParseOptions(editorParseOptions: ParseOptions): ParseOptions {
  return { preserveWhitespace: "full", ...editorParseOptions };
}

function toFragment(content: Fragment | PMNode): Fragment {
  return content instanceof Fragment ? content : Fragment.from(content);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The reason `insertContent` would reject `fragment`, or `null` when it would
 * accept it. Runs the same `Node.check()` TipTap runs before it dispatches.
 */
function schemaViolation(fragment: Fragment): string | null {
  try {
    fragment.forEach((node) => node.check());
    return null;
  } catch (error) {
    return describe(error);
  }
}

/**
 * Rebuild `fragment` so every node satisfies its content expression, using
 * `createAndFill` to supply whatever the schema requires and dropping nodes
 * nothing can satisfy. Valid subtrees are returned by identity, so repairing
 * one broken container never renormalizes the rest of the paste.
 */
export function repairSchemaInvalidFragment(fragment: Fragment): Fragment {
  const kept: PMNode[] = [];
  let changed = false;
  fragment.forEach((child) => {
    const repaired = repairSchemaInvalidNode(child);
    if (repaired !== child) changed = true;
    if (repaired) kept.push(repaired);
  });
  return changed ? Fragment.fromArray(kept) : fragment;
}

function repairSchemaInvalidNode(node: PMNode): PMNode | null {
  if (node.isText || node.isLeaf) return node;
  const content = repairSchemaInvalidFragment(node.content);
  if (node.type.validContent(content)) {
    return content === node.content ? node : node.copy(content);
  }
  return node.type.createAndFill(node.attrs, content, node.marks);
}

/**
 * ProseMirror content for markdown-derived `html`.
 *
 * An `unusable` result is not an empty paste: callers must leave the event to
 * ProseMirror's clipboard handling so the text still lands, and report the
 * reason rather than treating the paste as done.
 */
export function schemaSafePasteContent(
  html: string,
  schema: Schema,
  editorParseOptions: ParseOptions = {},
): MarkdownPasteContent {
  let parsed: Fragment;
  try {
    parsed = toFragment(
      createNodeFromContent(html, schema, {
        parseOptions: pasteParseOptions(editorParseOptions),
        errorOnInvalidContent: false,
      }) as Fragment | PMNode,
    );
  } catch (error) {
    return { status: "unusable", reason: describe(error) };
  }

  if (parsed.childCount === 0) {
    return {
      status: "unusable",
      reason: "markdown produced no editor content",
    };
  }

  const violation = schemaViolation(parsed);
  if (!violation)
    return { status: "ready", content: parsed, repairedFrom: null };

  const repaired = repairSchemaInvalidFragment(parsed);
  if (repaired.childCount === 0) {
    return { status: "unusable", reason: violation };
  }
  const repairedViolation = schemaViolation(repaired);
  if (repairedViolation) {
    return { status: "unusable", reason: repairedViolation };
  }
  return { status: "ready", content: repaired, repairedFrom: violation };
}
