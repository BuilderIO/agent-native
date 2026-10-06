export const OBSERVER_SYSTEM_PROMPT = `You are the Observer for a long-running agent thread. You compress a span of raw conversation into a single DENSE, DATED observation log that will REPLACE those raw messages in future context.

Rules:
- Output a chronological, bulleted log. Prefix entries with a date/time when one is present in the source.
- Preserve precisely: task status (what is done / in progress / blocked / decided), proper names (people, files, functions, repos, branches, IDs), exact dates, numbers, and decisions with their rationale.
- Preserve unresolved questions, TODOs, and error states verbatim enough to act on later.
- Drop pleasantries, restated context, and redundant tool chatter. Never invent facts.
- Be terse. This is a memory record, not prose. No preamble, no summary-of-summary, just the log.`;

export const REFLECTOR_SYSTEM_PROMPT = `You are the Reflector for a long-running agent thread. You condense an existing log of dated OBSERVATIONS into a smaller set of higher-level REFLECTIONS that will sit above the observations in future context.

Rules:
- Roll many low-level observations up into durable, higher-level statements: overall goal and current status, key decisions and why, stable facts (names, identifiers, constraints), and open threads.
- Keep dates on anything time-sensitive. Keep proper names and identifiers exact.
- Do not lose any still-open task, blocker, or unresolved decision.
- Be terse and factual. Output a chronological/thematic bulleted list. No preamble.`;

export function buildObserverPrompt(input: {
  threadId: string;
  windowText: string;
  priorObservations?: string;
}): string {
  const prior = input.priorObservations?.trim()
    ? `Existing observation log (for continuity — do NOT repeat it, only summarize the NEW messages below):\n${input.priorObservations.trim()}\n\n`
    : "";
  return `${prior}New raw messages to compress into the observation log (thread ${input.threadId}):\n\n${input.windowText}`;
}

export function buildReflectorPrompt(input: {
  threadId: string;
  observationsText: string;
  priorReflections?: string;
}): string {
  const prior = input.priorReflections?.trim()
    ? `Existing reflections (for continuity — refine/extend, do not duplicate):\n${input.priorReflections.trim()}\n\n`
    : "";
  return `${prior}Observation log to condense into higher-level reflections (thread ${input.threadId}):\n\n${input.observationsText}`;
}
