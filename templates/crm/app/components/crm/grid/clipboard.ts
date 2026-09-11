/**
 * TSV that survives a round trip through Sheets and Excel.
 *
 * Both quote a cell containing a tab, newline, or quote character and double
 * embedded quotes inside it. Splitting on `\t` and `\n` without honouring that
 * silently shreds one pasted cell into several — which lands wrong values in
 * the wrong columns and looks like a successful paste.
 */

const NEEDS_QUOTING = /[\t\n\r"]/;

export function encodeTsvCell(value: string): string {
  if (!NEEDS_QUOTING.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function encodeTsv(rows: string[][]): string {
  return rows.map((row) => row.map(encodeTsvCell).join("\t")).join("\n");
}

/**
 * Parse TSV into a rectangle of raw cell strings. Ragged input stays ragged —
 * padding here would invent empty values the source never had.
 */
export function decodeTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === "\t") {
      endCell();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  // A trailing newline ends the last row; anything else leaves a pending cell.
  if (cell !== "" || row.length > 0 || rows.length === 0) endRow();
  return rows;
}
