/**
 * A folder of screenshots read as one numbered how-to guide.
 *
 * A step capture uploads each step as a screenshot titled `N. <title>` into a
 * fresh folder (`desktop/src-tauri/src/step_capture/upload.rs`). The guide
 * view orders by that number, renumbers from 1 so a deleted step leaves no
 * gap, and shows the title without the prefix. Screenshots without a number,
 * such as ones the user filed into the folder by hand, keep their upload
 * order after the numbered ones.
 */

export interface StepGuideSource {
  id: string;
  title: string;
}

export interface StepGuideStep<T extends StepGuideSource = StepGuideSource> {
  /** 1-based position in the guide. */
  number: number;
  /** The title without its `N. ` prefix. */
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
  return { stepNumber: Number(match[1]), title: match[2] };
}

/** Order `recordings`, given oldest first, into guide steps. */
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
  /** Absolute URL of the step's screenshot. */
  imageUrl: string | null;
  /** Absolute URL of the step's page in Clips. */
  linkUrl: string;
}

function escapeHeading(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^#+\s*/, "");
}

function escapeAlt(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\\[\]]/g, "\\$&");
}

/**
 * The guide as Markdown. Images point at Clips itself, so they show only for
 * readers who can open those screenshots.
 */
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
