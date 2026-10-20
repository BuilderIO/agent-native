function skillFrontmatterName(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return undefined;

  const lines = match[1].replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; ) {
    const field = lines[index].match(/^name:\s*(.*)$/);
    if (!field) {
      index += 1;
      continue;
    }

    let value = field[1].trim();
    if ([">-", ">", "|", "|-"].includes(value)) {
      const continued: string[] = [];
      index += 1;
      while (index < lines.length && /^\s+/.test(lines[index])) {
        continued.push(lines[index].trim());
        index += 1;
      }
      value = continued.join(" ");
    } else {
      index += 1;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
    }
    return value.trim() || undefined;
  }

  return undefined;
}

export function uploadedSkillSlug(fileName: string, content: string): string {
  const name = skillFrontmatterName(content);
  const baseName = fileName.replace(/\.[^./]+$/, "");
  const fallback =
    baseName.toLowerCase() === "skill" ? "uploaded-skill" : baseName;
  return (
    (name || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "uploaded-skill"
  );
}
