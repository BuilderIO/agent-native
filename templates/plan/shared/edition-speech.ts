import type { EditionStoryCohort, EditionStoryData } from "./edition.js";

/**
 * Turn an edition into the sequence a screen reader or speech synthesiser
 * should speak.
 *
 * Built from the structured stories, never from the rendered page: the reader
 * shows real diffs, file trees and code, and reading those aloud is noise. The
 * spoken edition is the editorial layer only — headline, dek, what shipped, and
 * each cohort's one sentence.
 *
 * Returned as segments rather than one string because speech engines cap
 * utterance length and because a caller needs somewhere to stop and resume.
 */
export interface EditionSpeechInput {
  nameplate: string;
  dateline: string;
  /** e.g. "Issue 14" — omitted when the edition has no number. */
  issueLabel?: string | null;
  title: string;
  brief: string;
  stories: EditionStoryData[];
  /** Localised heading spoken before the quick-links tail. */
  alsoShippedLabel: string;
}

function sentence(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function cohortLine(cohort: EditionStoryCohort): string | null {
  const name = sentence(cohort.name);
  const body = sentence(cohort.sentence);
  if (!name && !body) return null;
  return [name, body].filter(Boolean).join(" ");
}

export function buildEditionSpeech(input: EditionSpeechInput): string[] {
  const segments: string[] = [];
  const opening = [
    sentence(input.nameplate),
    input.issueLabel ? sentence(input.issueLabel) : null,
    sentence(input.dateline),
  ]
    .filter(Boolean)
    .join(" ");
  if (opening) segments.push(opening);

  const standfirst = [sentence(input.title), sentence(input.brief)]
    .filter(Boolean)
    .join(" ");
  if (standfirst) segments.push(standfirst);

  const leads = input.stories.filter((story) => story.lead);
  for (const story of leads) {
    const head = [
      story.tags.length > 0 ? sentence(story.tags.join(", ")) : null,
      sentence(story.headline),
      sentence(story.dek),
    ]
      .filter(Boolean)
      .join(" ");
    if (head) segments.push(head);

    const shipped = sentence(story.whatShipped);
    if (shipped) segments.push(shipped);

    for (const cohort of story.cohorts) {
      const line = cohortLine(cohort);
      if (line) segments.push(line);
    }
  }

  const tail = input.stories.filter((story) => !story.lead);
  if (tail.length > 0) {
    segments.push(sentence(input.alsoShippedLabel) ?? input.alsoShippedLabel);
    for (const story of tail) {
      // The dek too, not just the headline: a list of titles read aloud is a
      // table of contents, and the listener learns nothing from it.
      const line = [
        story.tags[0] ? sentence(story.tags[0]) : null,
        sentence(story.headline),
        sentence(story.dek),
      ]
        .filter(Boolean)
        .join(" ");
      if (line) segments.push(line);
    }
  }

  return segments;
}

/**
 * Delivery direction for a neural voice. The voice alone still reads like a
 * screen reader; this is what makes it an anchor reading a bulletin.
 *
 * Not user-facing copy — it is a model instruction, so it stays in one
 * language and tells the model to follow the script's language instead.
 */
export const EDITION_SPEECH_INSTRUCTIONS =
  "Read this as an engineering newsroom anchor delivering a short daily bulletin: " +
  "measured, warm, and clear, with a beat of silence between stories. " +
  "Read in the same language as the text. Treat repository, package, and " +
  "identifier names as proper nouns, and never spell out punctuation or symbols.";

/**
 * Group segments into request-sized scripts without ever splitting one.
 *
 * A long edition exceeds a synthesis provider's per-request input limit, and
 * chunking on segment boundaries also lets playback start after the first
 * chunk instead of after the whole bulletin. A single segment longer than the
 * limit is returned whole so the caller fails loudly rather than narrating a
 * silently truncated edition.
 */
export function chunkEditionSpeech(
  segments: string[],
  maxChars: number,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const segment of segments) {
    const next = current ? `${current}\n\n${segment}` : segment;
    if (current && next.length > maxChars) {
      chunks.push(current);
      current = segment;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}
