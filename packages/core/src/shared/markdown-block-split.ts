/**
 * Splits a markdown string into stable top-level blocks + an in-progress tail.
 *
 * During streaming, completed blocks are stable (their content never changes
 * once the block ends), so we can memoize per-block ReactMarkdown renders and
 * only re-render the tail on every commit.
 *
 * Rules:
 *  - Blocks are separated by one or more blank lines that appear OUTSIDE fenced
 *    code blocks.
 *  - An unterminated fenced code block at the end is included in the tail so
 *    it re-renders as the fence grows.
 *  - Joining completedBlocks with "\n\n" + tail re-produces the original text
 *    (modulo collapsed blank-line sequences, which don't affect rendered output).
 *
 * FIDELITY IS THE CONTRACT, not an optimization detail. Rendering the blocks
 * separately must produce what rendering the whole document produces, because
 * the same split drives both the streaming render and the final one. When the
 * split was allowed to diverge, two things broke at once: the streamed text was
 * visibly WRONG (a blank-line-separated list rendered as several one-item
 * lists, a link whose reference definition landed in a later block rendered as
 * literal `[text]`), and the end of the stream had to swap to a whole-document
 * render to fix it — which rebuilt the message's entire DOM and produced the
 * flash and scroll jump users reported. Two constructs reach across a blank
 * line, so neither may be split:
 *  - lists, which continue across blank lines (and become "loose"), including
 *    indented fenced code blocks nested inside a list item
 *  - link-reference and footnote definitions, which resolve document-wide
 * `markdown-block-split.spec.ts` asserts this parity construct by construct.
 * Do not add a split rule without adding its parity case.
 */
export interface MarkdownBlockSplit {
  /** Fully-terminated top-level blocks. Each element is the raw markdown for
   *  one block (no leading/trailing blank lines). These are stable once the
   *  block ends: the streaming source never changes a completed block. */
  completedBlocks: string[];
  /** The current in-progress block (may be an unterminated fence, partial
   *  list, etc.). Empty string when the text ends cleanly on a blank line. */
  tail: string;
}

/** A bullet or ordered list marker, at any indent depth. */
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;

/** An indented continuation line — a paragraph or nested block inside a list item. */
const CONTINUATION_INDENT = /^\s{2,}\S/;

/**
 * A link-reference or footnote definition (`[id]: url`, `[^1]: note`). These
 * resolve across the whole document, so any block boundary can orphan a
 * reference from its definition and render it as literal text.
 */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S/;

/**
 * An indented (4-space or tab) code block line. Like a list, an indented code
 * block continues across blank lines, so splitting on one turns a single code
 * block into several.
 */
const INDENTED_CODE = /^(?: {4}|\t)/;

/**
 * Split `text` into completed top-level markdown blocks and a trailing
 * in-progress tail.
 *
 * The split is purely syntactic (blank-line-based with fence awareness) and
 * does NOT parse full markdown AST — this keeps it synchronous and O(n).
 */
export function splitMarkdownBlocks(text: string): MarkdownBlockSplit {
  if (!text) {
    return { completedBlocks: [], tail: "" };
  }

  const lines = text.split("\n");
  const completedBlocks: string[] = [];

  let inFence = false;
  let fenceMarker = ""; // the opening marker: ``` or ~~~
  let currentBlockLines: string[] = [];
  let pendingBlanks = 0; // blank lines accumulated between blocks
  // Whether the block being accumulated started as a list. A list swallows
  // blank lines and keeps going, so its boundary is not decidable until a
  // non-list, non-indented line arrives.
  let currentBlockIsList = false;
  // Same for an indented code block, which also swallows blank lines.
  let currentBlockIsIndentedCode = false;
  // Reference definitions are detected during the scan, NOT with a regex over
  // the raw text: `[key: string]: string` inside a ```ts fence looks exactly
  // like `[id]: url`, and this product emits TypeScript constantly. Testing the
  // raw text disabled splitting for those whole messages, so every commit
  // re-parsed the entire document — O(n²) rendering, which is its own jank.
  let sawReferenceDefinition = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inFence) {
      // Detect a fence opening: line starts with ``` or ~~~ (3+ chars)
      const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fenceMatch) {
        // An indented fence after a blank line is still a child of the active
        // list item. Flushing here would render it as a top-level fence.
        const continuesListWithIndentedFence =
          pendingBlanks > 0 &&
          currentBlockLines.length > 0 &&
          currentBlockIsList &&
          CONTINUATION_INDENT.test(line);
        inFence = true;
        fenceMarker = fenceMatch[1].charAt(0).repeat(fenceMatch[1].length);
        // If there are pending blanks and existing content, flush the current
        // block before starting the fence block.
        if (
          pendingBlanks > 0 &&
          currentBlockLines.length > 0 &&
          !continuesListWithIndentedFence
        ) {
          completedBlocks.push(currentBlockLines.join("\n"));
          currentBlockLines = [];
        }
        if (continuesListWithIndentedFence) {
          for (let blank = 0; blank < pendingBlanks; blank++) {
            currentBlockLines.push("");
          }
        }
        pendingBlanks = 0;
        if (currentBlockLines.length === 0) currentBlockIsList = false;
        currentBlockLines.push(line);
        continue;
      }

      if (trimmed === "") {
        // Blank line: potential block separator
        pendingBlanks++;
        continue;
      }

      // Non-blank, non-fence line outside a fence
      if (pendingBlanks > 0 && currentBlockLines.length > 0) {
        // A list continues across blank lines: a following list marker is the
        // next item, and an indented line is a continuation paragraph inside
        // the current item. Splitting either one produces several separate
        // lists instead of one, and drops continuation text out of its item.
        const continuesList =
          currentBlockIsList &&
          (LIST_MARKER.test(line) || CONTINUATION_INDENT.test(line));
        const continuesIndentedCode =
          currentBlockIsIndentedCode && INDENTED_CODE.test(line);
        if (continuesList || continuesIndentedCode) {
          // Keep the blank lines: they are what makes the list "loose", which
          // changes how it renders.
          for (let blank = 0; blank < pendingBlanks; blank++) {
            currentBlockLines.push("");
          }
        } else {
          completedBlocks.push(currentBlockLines.join("\n"));
          currentBlockLines = [];
        }
        pendingBlanks = 0;
      } else {
        pendingBlanks = 0;
      }
      if (currentBlockLines.length === 0) {
        currentBlockIsIndentedCode = INDENTED_CODE.test(line);
        currentBlockIsList =
          !currentBlockIsIndentedCode && LIST_MARKER.test(line);
      }
      if (REFERENCE_DEFINITION.test(line)) sawReferenceDefinition = true;
      currentBlockLines.push(line);
    } else {
      // Inside a fence: look for the closing marker
      currentBlockLines.push(line);
      // Closing marker: a line whose trimmed content is the same marker char
      // repeated >= the opening length, with nothing else.
      const closeMatch = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (closeMatch) {
        const closeChar = closeMatch[1].charAt(0);
        const closeLen = closeMatch[1].length;
        const openChar = fenceMarker.charAt(0);
        const openLen = fenceMarker.length;
        if (closeChar === openChar && closeLen >= openLen) {
          inFence = false;
          fenceMarker = "";
          // Fence is now closed; block continues (may have more content after)
        }
      }
    }
  }

  // If we ended outside a fence with trailing blank lines, the last content
  // block is complete — flush it and return an empty tail.
  // A definition makes every boundary unsafe: the reference may sit in any
  // other block, and splitting orphans it into literal `[text]`.
  if (sawReferenceDefinition) {
    return { completedBlocks: [], tail: text };
  }

  let tail: string;
  if (
    !inFence &&
    !currentBlockIsList &&
    !currentBlockIsIndentedCode &&
    pendingBlanks > 0 &&
    currentBlockLines.length > 0
  ) {
    // A trailing blank line does not end a list — the next streamed chunk may
    // add another item. Leave it in the tail so it stays one list.
    completedBlocks.push(currentBlockLines.join("\n"));
    tail = "";
  } else {
    // Whatever remains is the in-progress tail.
    tail = currentBlockLines.join("\n");
  }

  return { completedBlocks, tail };
}

/**
 * Rejoin a split result back into the original text (for final render parity).
 * Blocks are joined with double newlines; tail is appended with a double
 * newline separator when both parts are non-empty.
 */
export function joinMarkdownBlocks({
  completedBlocks,
  tail,
}: MarkdownBlockSplit): string {
  const parts = [...completedBlocks];
  if (tail) parts.push(tail);
  return parts.join("\n\n");
}
