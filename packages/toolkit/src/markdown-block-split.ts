/** Stable top-level Markdown blocks plus the in-progress streaming tail. */
export interface MarkdownBlockSplit {
  completedBlocks: string[];
  tail: string;
}

const listMarker = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const continuationIndent = /^\s{2,}\S/;
const referenceDefinition = /^ {0,3}\[[^\]]+\]:\s*\S/;
const indentedCode = /^(?: {4}|\t)/;

/**
 * Splits streamed Markdown only at rendering-safe boundaries. Lists, indented
 * code, fences, and document-wide references remain intact so the streamed
 * and final trees have the same semantics.
 */
export function splitMarkdownBlocks(text: string): MarkdownBlockSplit {
  if (!text) return { completedBlocks: [], tail: "" };

  const lines = text.split("\n");
  const completedBlocks: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let currentBlockLines: string[] = [];
  let pendingBlanks = 0;
  let currentBlockIsList = false;
  let currentBlockIsIndentedCode = false;
  let sawReferenceDefinition = false;

  for (const line of lines) {
    const trimmed = line.trimStart();

    if (!inFence) {
      const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
      if (fenceMatch) {
        const marker = fenceMatch[1]!;
        const continuesListWithIndentedFence =
          pendingBlanks > 0 &&
          currentBlockLines.length > 0 &&
          currentBlockIsList &&
          continuationIndent.test(line);
        inFence = true;
        fenceMarker = marker.charAt(0).repeat(marker.length);
        if (
          pendingBlanks > 0 &&
          currentBlockLines.length > 0 &&
          !continuesListWithIndentedFence
        ) {
          completedBlocks.push(currentBlockLines.join("\n"));
          currentBlockLines = [];
        }
        if (continuesListWithIndentedFence) {
          for (let blank = 0; blank < pendingBlanks; blank += 1) {
            currentBlockLines.push("");
          }
        }
        pendingBlanks = 0;
        if (currentBlockLines.length === 0) currentBlockIsList = false;
        currentBlockLines.push(line);
        continue;
      }

      if (trimmed === "") {
        pendingBlanks += 1;
        continue;
      }

      if (pendingBlanks > 0 && currentBlockLines.length > 0) {
        const continuesList =
          currentBlockIsList &&
          (listMarker.test(line) || continuationIndent.test(line));
        const continuesIndentedCode =
          currentBlockIsIndentedCode && indentedCode.test(line);
        if (continuesList || continuesIndentedCode) {
          for (let blank = 0; blank < pendingBlanks; blank += 1) {
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
        currentBlockIsIndentedCode = indentedCode.test(line);
        currentBlockIsList =
          !currentBlockIsIndentedCode && listMarker.test(line);
      }
      if (referenceDefinition.test(line)) sawReferenceDefinition = true;
      currentBlockLines.push(line);
      continue;
    }

    currentBlockLines.push(line);
    const closeMatch = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
    if (!closeMatch) continue;
    const closeMarker = closeMatch[1]!;
    if (
      closeMarker.charAt(0) === fenceMarker.charAt(0) &&
      closeMarker.length >= fenceMarker.length
    ) {
      inFence = false;
      fenceMarker = "";
    }
  }

  if (sawReferenceDefinition) {
    return { completedBlocks: [], tail: text };
  }

  if (
    !inFence &&
    !currentBlockIsList &&
    !currentBlockIsIndentedCode &&
    pendingBlanks > 0 &&
    currentBlockLines.length > 0
  ) {
    completedBlocks.push(currentBlockLines.join("\n"));
    return { completedBlocks, tail: "" };
  }

  return { completedBlocks, tail: currentBlockLines.join("\n") };
}

export function joinMarkdownBlocks({
  completedBlocks,
  tail,
}: MarkdownBlockSplit): string {
  const parts = [...completedBlocks];
  if (tail) parts.push(tail);
  return parts.join("\n\n");
}
