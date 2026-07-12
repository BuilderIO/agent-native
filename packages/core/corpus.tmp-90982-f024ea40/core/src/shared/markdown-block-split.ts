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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (!inFence) {
      // Detect a fence opening: line starts with ``` or ~~~ (3+ chars)
      const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fenceMatch) {
        inFence = true;
        fenceMarker = fenceMatch[1].charAt(0).repeat(fenceMatch[1].length);
        // If there are pending blanks and existing content, flush the current
        // block before starting the fence block.
        if (pendingBlanks > 0 && currentBlockLines.length > 0) {
          completedBlocks.push(currentBlockLines.join("\n"));
          currentBlockLines = [];
        }
        pendingBlanks = 0;
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
        // We have a completed block followed by blank lines
        completedBlocks.push(currentBlockLines.join("\n"));
        currentBlockLines = [];
        pendingBlanks = 0;
      } else {
        pendingBlanks = 0;
      }
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
  let tail: string;
  if (!inFence && pendingBlanks > 0 && currentBlockLines.length > 0) {
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
