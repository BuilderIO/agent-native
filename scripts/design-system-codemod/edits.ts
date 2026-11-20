/** A replacement of `text[start, end)`; an insertion has `start === end`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * The edits to one file. A transform that rebuilds a node from its pieces
 * takes them with `slice`, which applies and claims the edits already made
 * inside, so a site nested in another (a toast in a Button's handler) is
 * carried into the outer rewrite instead of colliding with it.
 */
export class Edits {
  private readonly list: Edit[] = [];

  constructor(readonly source: string) {}

  add(start: number, end: number, text: string) {
    this.list.push({ start, end, text });
  }

  get size() {
    return this.list.length;
  }

  slice(start: number, end: number): string {
    const inner = this.list.filter(
      (edit) => edit.start >= start && edit.end <= end,
    );
    for (const edit of inner) this.list.splice(this.list.indexOf(edit), 1);
    return splice(this.source.slice(start, end), inner, start);
  }

  apply(): string {
    return splice(this.source, this.list, 0);
  }
}

export class OverlappingEditsError extends Error {
  constructor(readonly position: number) {
    super(`overlapping edits at offset ${position}`);
  }
}

function splice(text: string, edits: Edit[], offset: number): string {
  // Ascending, insertions before a replacement that starts where they do.
  const sorted = [...edits].sort(
    (a, b) => a.start - b.start || a.end - a.start - (b.end - b.start),
  );
  let out = "";
  let at = offset;
  for (const edit of sorted) {
    if (edit.start < at) throw new OverlappingEditsError(edit.start);
    out += text.slice(at - offset, edit.start - offset) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at - offset);
}
