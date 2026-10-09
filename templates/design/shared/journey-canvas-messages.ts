export interface JourneyCanvasMessages {
  observedSessionReference: string;
  sessionsOfAll: string;
  sessionsOfAppRoot: string;
  sessionsOfPrevious: string;
  sessionsOfParent: string;
  observedContinuation: string;
  observedBranchLabel: string;
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
  actorUnavailable: string;
  replayDetails: string;
  sourceApp: string;
  route: string;
  routeUnavailable: string;
  captureSourceFingerprint: string;
  captureSourceUnavailable: string;
  recordingStarted: string;
  appBandHeading: string;
  journeyTitleSummary: string;
  journeyTitleAppBandsSummary: string;
  sessionCount: string;
  otherPaths: string;
  htmlLanguage: string;
}

export const enUSJourneyCanvasMessages: JourneyCanvasMessages = {
  observedSessionReference: "Observed session reference",
  sessionsOfAll: "{count} sessions · {percent} of all",
  sessionsOfAppRoot:
    "{count} sessions · {percent} of {app} cohort (n={rootCount})",
  sessionsOfPrevious: "{count} sessions · {percent} of previous",
  sessionsOfParent: "{count} sessions · {percent} of {label}",
  observedContinuation:
    "Same recording · example {fromExample} → example {toExample}",
  observedBranchLabel: "{label} · {percent}",
  sessionsOfStep: "{count} sessions · {percent} of this step",
  partialSample: "partial sample",
  continuedOnUnpictured:
    "{count} continued on unpictured paths · {percent} of this step",
  noLaterStepObserved: "No later step observed",
  examplePosition: "Example {current} of {total}",
  showExample: "Show source example {current}",
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
  actorUnavailable: "Actor unavailable",
  replayDetails: "Replay and source details",
  sourceApp: "Source app",
  route: "Current route at capture",
  routeUnavailable: "not verified in replay",
  captureSourceFingerprint: "Capture-source fingerprint",
  captureSourceUnavailable: "not recorded",
  recordingStarted: "Recording started",
  appBandHeading: "{app} · {count} sessions",
  journeyTitleSummary: "{app} · {from} to {to} · {count} sessions{partial}",
  journeyTitleAppBandsSummary:
    "{from} to {to} · separate per-app cohorts{partial}",
  sessionCount: "{count} sessions",
  otherPaths: "Other paths",
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
