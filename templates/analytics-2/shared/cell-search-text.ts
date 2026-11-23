export function cellSearchText(contents: object): string | null {
  const value =
    "source" in contents
      ? contents.source
      : "markdown" in contents
        ? contents.markdown
        : "text" in contents
          ? contents.text
          : null;
  return typeof value === "string" ? value : null;
}
