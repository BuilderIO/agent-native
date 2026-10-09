export interface JourneyCanvasMessages {
  observedSessionReference: string;
  sessionsOfAll: string;
  sessionsOfPrevious: string;
  sessionsOfParent: string;
  sessionsOfStep: string;
  partialSample: string;
  continuedOnUnpictured: string;
  noLaterStepObserved: string;
  examplePosition: string;
  showExample: string;
  screenshotExamples: string;
  screenshotAlt: string;
  screenshotMissing: string;
  recordingUnavailable: string;
  eventTime: string;
  generationCompletedEvent: string;
  replayObservation: string;
  utcTimestamp: string;
  recordingId: string;
  replayOffset: string;
  replayOffsetUnavailable: string;
  replaySeek: string;
  checkpointSeekTarget: string;
  analyticsCheckpointOffset: string;
  replayObserved: string;
  screenshotCaptured: string;
  screenshotExportTimestamp: string;
  output: string;
  outputTitle: string;
  observedState: string;
  actorRecording: string;
  actorSource: string;
  recordingMetadata: string;
  evidence: string;
  generationCompletedEvidence: string;
  renderedOutputEvidence: string;
  openFullPrompt: string;
  prompt: string;
  promptEnglish: string;
  promptSource: string;
  source: string;
  promptNotCaptured: string;
  journeyTitleSummary: string;
  sessionCount: string;
  otherPaths: string;
  capturedDate: string;
  additionalExamples: string;
  htmlLanguage: string;
}

export const enUSJourneyCanvasMessages: JourneyCanvasMessages = {
  observedSessionReference: "Observed session reference",
  sessionsOfAll: "{count} sessions · {percent} of all",
  sessionsOfPrevious: "{count} sessions · {percent} of previous",
  sessionsOfParent: "{count} sessions · {percent} of {label}",
  sessionsOfStep: "{count} sessions · {percent} of this step",
  partialSample: "partial sample",
  continuedOnUnpictured:
    "{count} continued on unpictured paths · {percent} of this step",
  noLaterStepObserved: "No later step observed",
  examplePosition: "Example {current} of {total}",
  showExample: "Show example {current} of {total}",
  screenshotExamples: "Screenshot examples",
  screenshotAlt: "{label}, example {current} of {total}, captured {date}",
  screenshotMissing: "No screenshot captured",
  recordingUnavailable: "unavailable",
  eventTime: "Event time (UTC)",
  generationCompletedEvent: "generation_completed event (UTC)",
  replayObservation: "Replay observation",
  utcTimestamp: "UTC timestamp",
  recordingId: "Recording ID",
  replayOffset: "Replay offset",
  replayOffsetUnavailable: "unavailable",
  replaySeek: "Replay seek",
  checkpointSeekTarget: "Checkpoint seek target",
  analyticsCheckpointOffset: "Analytics checkpoint offset",
  replayObserved: "Replay observed",
  screenshotCaptured: "Screenshot captured",
  screenshotExportTimestamp: "UTC screenshot export timestamp",
  output: "Output",
  outputTitle: "Output title",
  observedState: "Observed state",
  actorRecording: "Actor (recording)",
  actorSource: "Actor source",
  recordingMetadata: "recording metadata",
  evidence: "Evidence",
  generationCompletedEvidence: "generation_completed event",
  renderedOutputEvidence:
    "rendered output observed; no completion event claimed",
  openFullPrompt: "Open the full prompt",
  prompt: "Prompt",
  promptEnglish: "Prompt (English)",
  promptSource: "Prompt (source)",
  source: "Source",
  promptNotCaptured: "Prompt not captured",
  journeyTitleSummary: "{app} · {from} to {to} · {count} sessions{partial}",
  sessionCount: "{count} sessions",
  otherPaths: "Other paths",
  capturedDate: "Captured {date}{examples}",
  additionalExamples: " · {count} examples",
  htmlLanguage: "en-US",
};

export function interpolateJourneyCanvasMessage(
  value: string,
  values: Record<string, string | number>,
): string {
  return value.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) =>
    String(values[key] ?? `{${key}}`),
  );
}
