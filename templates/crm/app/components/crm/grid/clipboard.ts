const NEEDS_QUOTING = /[\t\n\r"]/;

export function encodeTsvCell(value: string): string {
  if (!NEEDS_QUOTING.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function encodeTsv(rows: string[][]): string {
  return rows.map((row) => row.map(encodeTsvCell).join("\t")).join("\n");
}

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
  if (cell !== "" || row.length > 0 || rows.length === 0) endRow();
  return rows;
}
