export interface StepGuideSource {
  id: string;
  title: string;
}

export interface StepGuideStep<T extends StepGuideSource = StepGuideSource> {
  number: number;
  title: string;
  recording: T;
}

const STEP_PREFIX = /^\s*(\d+)\.\s+(.*\S)\s*$/s;

export function parseStepTitle(title: string): {
  stepNumber: number | null;
  title: string;
} {
  const match = STEP_PREFIX.exec(title);
  if (!match) return { stepNumber: null, title: title.trim() };
  const [, stepNumber = "", rest = ""] = match;
  return { stepNumber: Number(stepNumber), title: rest };
}

export function buildStepGuide<T extends StepGuideSource>(
  recordings: readonly T[],
): StepGuideStep<T>[] {
  return recordings
    .map((recording, index) => ({
      recording,
      index,
      ...parseStepTitle(recording.title),
    }))
    .sort((a, b) => {
      if (a.stepNumber !== null && b.stepNumber !== null) {
        return a.stepNumber - b.stepNumber || a.index - b.index;
      }
      if (a.stepNumber !== null) return -1;
      if (b.stepNumber !== null) return 1;
      return a.index - b.index;
    })
    .map((entry, position) => ({
      number: position + 1,
      title: entry.title,
      recording: entry.recording,
    }));
}

export interface StepGuideMarkdownStep {
  number: number;
  title: string;
  imageUrl: string | null;
  linkUrl: string;
}

function escapeHeading(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^#+\s*/, "");
}

function escapeAlt(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\\[\]]/g, "\\$&");
}

export function stepGuideMarkdown(params: {
  title: string;
  steps: readonly StepGuideMarkdownStep[];
}): string {
  const blocks = [`# ${escapeHeading(params.title)}`];
  for (const step of params.steps) {
    const title = step.title || `Step ${step.number}`;
    blocks.push(`## Step ${step.number}: ${escapeHeading(title)}`);
    blocks.push(
      step.imageUrl
        ? `[![${escapeAlt(title)}](<${step.imageUrl}>)](<${step.linkUrl}>)`
        : `[Open step ${step.number}](<${step.linkUrl}>)`,
    );
  }
  return `${blocks.join("\n\n")}\n`;
}
