export function skillNamesFromInstructions(
  content: string,
  knownSkillNames?: Iterable<string>,
): string[] {
  const names = new Set<string>();
  const known = new Set(knownSkillNames ?? []);
  const searchableContent = content
    .split(/(?=^## )/m)
    .filter(
      (section) =>
        !/^## (?:Framework Docs|Documentation lookup)\b/m.test(section),
    )
    .map((section) =>
      section
        .split(/\n\s*\n/)
        .filter((paragraph) => !/docs-search/i.test(paragraph))
        .join("\n\n"),
    )
    .join("\n");
  const headings = [...searchableContent.matchAll(/^#{1,3} .*$/gm)];
  const skillHeading = headings.find((match) =>
    /^#{2,3} Skills\b/.test(match[0]),
  );
  const nextHeading = headings.find(
    (match) => skillHeading && (match.index ?? 0) > (skillHeading.index ?? 0),
  );
  const skillSection = skillHeading
    ? searchableContent.slice(skillHeading.index, nextHeading?.index)
    : "";

  for (const paragraph of skillSection.split(/\n\s*\n/)) {
    if (
      /(?:scaffold|workspace) ships|exposes this workspace set|Shared app guides:/i.test(
        paragraph,
      )
    ) {
      for (const match of paragraph.matchAll(/`([a-z0-9-]+)`/g)) {
        names.add(match[1]);
      }
    }
    for (const line of paragraph.split("\n")) {
      const listedSkills = line.match(
        /^\s*[-*]\s+((?:`[a-z0-9-]+`(?:\s*(?:,\s*|and\s+))?)+)/,
      )?.[1];
      if (listedSkills) {
        for (const match of listedSkills.matchAll(/`([a-z0-9-]+)`/g)) {
          names.add(match[1]);
        }
      }
    }
  }

  for (const match of searchableContent.matchAll(
    /(?:packages\/shared\/)?\.agents\/skills\/([a-z0-9-]+)(?:\/SKILL\.md)?/g,
  )) {
    names.add(match[1]);
  }
  for (const match of searchableContent.matchAll(
    /\b(?:read|see|follow|consult)\s+(?:the\s+)?`([a-z0-9-]+)`\s+(?:skill|guide)\b/gi,
  )) {
    names.add(match[1]);
  }
  if (known.size > 0) {
    for (const match of searchableContent.matchAll(
      /\b(?:read|see|follow|consult)\s+(?:the\s+)?`([a-z0-9-]+)`/gi,
    )) {
      if (known.has(match[1])) names.add(match[1]);
    }
  }
  return [...names].sort();
}

export function missingInstructionSkillReferences(
  content: string,
  shippedSkills: Iterable<string>,
  knownSkillNames?: Iterable<string>,
): string[] {
  const shipped = new Set(shippedSkills);
  return skillNamesFromInstructions(content, knownSkillNames).filter(
    (skill) => !shipped.has(skill),
  );
}
