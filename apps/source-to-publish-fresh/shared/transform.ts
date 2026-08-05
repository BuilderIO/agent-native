export const RECIPE_VALUES = [
  "blog",
  "decision-brief",
  "social",
  "x-thread",
] as const;

export type Recipe = (typeof RECIPE_VALUES)[number];

export interface TransformSourceInput {
  recipe: Recipe;
  sourceText: string;
  sourceTitle?: string;
}

export interface TransformSourceResult {
  body: string;
  recipe: Recipe;
  recipeLabel: string;
  sourceTitle: string;
  summary: string;
  title: string;
  wordCount: number;
}

export const RECIPE_LABELS: Record<Recipe, string> = {
  blog: "Blog post",
  "decision-brief": "Decision brief",
  social: "Social posts",
  "x-thread": "X thread",
};

function cleanText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function sourceTitleFor(input: TransformSourceInput, text: string) {
  const explicitTitle = input.sourceTitle?.trim();
  if (explicitTitle) return explicitTitle;

  const firstLine = text.split("\n").find((line) => line.trim());
  if (firstLine && firstLine.length <= 90) {
    return firstLine.replace(/^#+\s*/, "").trim();
  }

  const firstSentence = sentences(text)[0] ?? "Untitled source";
  return firstSentence.slice(0, 72).replace(/[,:;.!?]+$/, "");
}

function paragraphs(value: string) {
  const blocks = value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks;

  const splitSentences = sentences(value);
  const grouped: string[] = [];
  for (let index = 0; index < splitSentences.length; index += 2) {
    grouped.push(splitSentences.slice(index, index + 2).join(" "));
  }
  return grouped.length ? grouped : [value];
}

function excerpt(value: string, length = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) return normalized;
  return `${normalized.slice(0, length - 1).trimEnd()}…`;
}

function listFromSource(text: string) {
  return sentences(text)
    .slice(0, 4)
    .map((sentence) => `- ${excerpt(sentence, 150)}`)
    .join("\n");
}

function buildBody(recipe: Recipe, title: string, text: string) {
  const blocks = paragraphs(text);
  const lead = excerpt(blocks[0] ?? text, 220);
  const supporting = excerpt(blocks[1] ?? blocks[0] ?? text, 220);
  const takeaway = excerpt(blocks[2] ?? blocks[1] ?? blocks[0] ?? text, 220);

  switch (recipe) {
    case "blog":
      return [
        `# ${title}`,
        "",
        lead,
        "",
        "## The signal",
        "",
        supporting,
        "",
        "## What changed",
        "",
        takeaway,
        "",
        "## The takeaway",
        "",
        "A clear source becomes useful when the reader can see what matters, what moved, and what to do next.",
      ].join("\n");
    case "decision-brief":
      return [
        `# Decision brief: ${title}`,
        "",
        "## Recommendation",
        "",
        `Move forward with the direction described in the source, with one owner accountable for the next review. ${lead}`,
        "",
        "## Decisions to carry forward",
        "",
        listFromSource(text),
        "",
        "## Open questions",
        "",
        "- What needs a final owner before this is shared?",
        "- Which assumption should be tested first?",
        "",
        "## Next steps",
        "",
        "- Confirm the decision and owner.",
        "- Share the brief with the working group.",
      ].join("\n");
    case "social":
      return [
        `# Social posts: ${title}`,
        "",
        "## Post 1",
        "",
        `${lead} The useful part is not the announcement - it is the change that follows.`,
        "",
        "## Post 2",
        "",
        `A quick takeaway from ${title.toLowerCase()}: ${supporting}`,
        "",
        "## Post 3",
        "",
        `The question worth carrying forward: what would you change if you had to make this simpler? ${takeaway}`,
      ].join("\n");
    case "x-thread":
      return [
        `# ${title}`,
        "",
        `1/ The short version: ${lead}`,
        "",
        `2/ What changed: ${supporting}`,
        "",
        `3/ The detail worth keeping: ${takeaway}`,
        "",
        "4/ The practical next step is to make the owner and the first test explicit.",
        "",
        "5/ Keep the thread useful: one idea, one proof point, one next move.",
      ].join("\n");
  }
}

export function buildDraft(input: TransformSourceInput): TransformSourceResult {
  const sourceText = cleanText(input.sourceText);
  const sourceTitle = sourceTitleFor(input, sourceText);
  const title =
    input.recipe === "decision-brief"
      ? `Decision brief: ${sourceTitle}`
      : input.recipe === "social"
        ? `Social posts: ${sourceTitle}`
        : sourceTitle;
  const body = buildBody(input.recipe, sourceTitle, sourceText);

  return {
    body,
    recipe: input.recipe,
    recipeLabel: RECIPE_LABELS[input.recipe],
    sourceTitle,
    summary: excerpt(sentences(sourceText)[0] ?? sourceText, 140),
    title,
    wordCount: sourceText.split(/\s+/).filter(Boolean).length,
  };
}
