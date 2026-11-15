export function parseMemoryIndex(
  content: string,
  indexPath = "memory/MEMORY.md",
): Array<{ name: string; path: string; description: string }> {
  const directory = indexPath.slice(0, indexPath.lastIndexOf("/") + 1);
  const entries: Array<{ name: string; path: string; description: string }> =
    [];
  for (const line of content.split("\n")) {
    const match = /^\s*-\s+\[([^\]]+)\]\(([^)]+\.md)\)\s*[—-]\s*(.+)$/.exec(
      line,
    );
    if (!match) continue;
    const name = match.at(1);
    const linkedName = match.at(2)?.replace(/^memory\//, "");
    const description = match.at(3);
    if (
      !name ||
      !linkedName ||
      !description ||
      linkedName.includes("..") ||
      /[\\/]/.test(linkedName) ||
      !/^[a-zA-Z0-9._-]+\.md$/.test(linkedName)
    ) {
      continue;
    }
    entries.push({ name, path: `${directory}${linkedName}`, description });
  }
  return entries;
}
