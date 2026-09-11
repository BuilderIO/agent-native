export function normalizeTitleText(value: string) {
  return value.replace(/\s*\r?\n\s*/g, " ");
}

export function stripMarkdownHeadingPrefixFromTitlePaste(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, ""))
    .join("\n");
}
