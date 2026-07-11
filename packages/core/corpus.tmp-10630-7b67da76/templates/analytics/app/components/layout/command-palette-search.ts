export function commandPaletteKeywords(
  ...parts: Array<string | null | undefined>
): string[] {
  const variants = new Set<string>();

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    variants.add(trimmed);
    variants.add(trimmed.toLowerCase());
  };

  for (const part of parts) {
    if (!part) continue;

    add(part);

    const spaced = part.replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
    const hyphenated = spaced.trim().replace(/\s+/g, "-");
    const compact = spaced.trim().replace(/\s+/g, "");

    add(spaced);
    add(hyphenated);
    add(compact);
  }

  return Array.from(variants);
}
