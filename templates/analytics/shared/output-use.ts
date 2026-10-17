/**
 * "Made it, didn't use it": per app, the output a person makes, the events
 * that say they made one, and the events that say they used it. Opening an
 * output never counts as using it; a use shows the output to people or takes
 * it out of the app.
 */

/** A use counts only within this many days of the output being made. */
export const OUTPUT_USE_WINDOW_DAYS = 7;
export const OUTPUT_USE_WINDOW_MS = OUTPUT_USE_WINDOW_DAYS * 24 * 60 * 60_000;
/** A presentation shorter than this was a look, not a talk. */
export const MIN_PRESENTATION_MS = 30_000;
/** The most outputs one recording lists; the rest are counted, not listed. */
export const MAX_OUTPUTS_PER_RECORDING = 10;
/** Output ids are skipped past this length, never cut, like session ids. */
export const MAX_OUTPUT_ID_LENGTH = 256;
/** The Sessions URL param naming the app whose unused outputs to find. */
export const UNUSED_OUTPUT_PARAM = "unused";
/** Every generator sends this when it makes an output, so it marks an app that makes them. */
export const OUTPUT_MADE_EVENT = "generation_completed";

type EventProperties = Readonly<Record<string, unknown>>;

export interface OutputUseEvent {
  eventName: string;
  qualifies: (properties: EventProperties) => boolean;
}

export interface OutputUseRule {
  outputType: string;
  madeEvents: readonly string[];
  usedEvents: readonly OutputUseEvent[];
  /** The output's page, relative to its app's origin. */
  outputPath: (outputId: string) => string;
}

/** A missing or non-numeric property never proves a use. */
function atLeast(value: unknown, minimum: number): boolean {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum
  );
}

export const OUTPUT_USE_RULES = {
  slides: {
    outputType: "deck",
    madeEvents: [OUTPUT_MADE_EVENT],
    usedEvents: [
      {
        // Moving forward at least once means two or more slides were shown,
        // even when the presentation started mid-deck.
        eventName: "presentation_ended",
        qualifies: (properties) =>
          atLeast(properties.slides_advanced, 1) &&
          atLeast(properties.duration_ms, MIN_PRESENTATION_MS),
      },
      {
        // `slide_export_started` fires before the export runs, so only a
        // finished export of a deck with slides counts.
        eventName: "deck_exported",
        qualifies: (properties) =>
          properties.status === "completed" &&
          atLeast(properties.slide_count, 1),
      },
    ],
    outputPath: (outputId) => `/deck/${encodeURIComponent(outputId)}`,
  },
} as const satisfies Record<string, OutputUseRule>;

export type OutputUseApp = keyof typeof OUTPUT_USE_RULES;

export const OUTPUT_USE_APPS = Object.keys(OUTPUT_USE_RULES) as [
  OutputUseApp,
  ...OutputUseApp[],
];

export function isOutputUseApp(value: unknown): value is OutputUseApp {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(OUTPUT_USE_RULES, value)
  );
}

export function outputUseRule(
  app: string | null | undefined,
): OutputUseRule | null {
  return isOutputUseApp(app) ? OUTPUT_USE_RULES[app] : null;
}

/** Every event name any rule reads, for the catalog and for ingest. */
export const OUTPUT_USE_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(OUTPUT_USE_RULES).flatMap((rule: OutputUseRule) => [
    ...rule.madeEvents,
    ...rule.usedEvents.map((used) => used.eventName),
  ]),
);

export function outputIdOf(properties: EventProperties): string | null {
  const value = properties.output_id;
  if (typeof value !== "string") return null;
  const outputId = value.trim();
  return outputId && outputId.length <= MAX_OUTPUT_ID_LENGTH ? outputId : null;
}

/** Where a recording's session ran, as far as the recording shows. */
export interface OutputRecordingPages {
  firstUrl: string | null;
  lastUrl: string | null;
  /**
   * Origins the recording's replay key lists. An empty list accepts uploads
   * from anywhere, so it vouches for no origin and yields no link.
   */
  allowedOrigins: readonly string[];
}

function recordedPage(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "null" ? null : url;
    // coercion-ok: a recording without a parseable URL has no app to link to; the output id still shows.
  } catch {
    return null;
  }
}

/**
 * Where a session's output opens: the app origin the session was recorded on,
 * its mount path, and the output's page. The app checks access when it opens.
 * A recording's URLs are whatever its uploader sent, so only an origin the
 * replay key's owner allowed becomes a link; otherwise this is null.
 */
export function outputUrl(
  app: string,
  outputId: string,
  recording: OutputRecordingPages,
): string | null {
  const rule = outputUseRule(app);
  if (!rule) return null;
  const pages = [recording.firstUrl, recording.lastUrl].flatMap((value) => {
    const page = recordedPage(value);
    return page ? [page] : [];
  });
  // A recording's id lives in its tab's sessionStorage, which is per origin,
  // so a real recording never spans origins; pages on two came from a forged
  // upload, and neither can be trusted.
  const origin = pages[0]?.origin;
  if (
    !origin ||
    pages.some((page) => page.origin !== origin) ||
    !recording.allowedOrigins.includes(origin)
  ) {
    return null;
  }
  // A workspace deploy mounts each app at `/<app id>` on one origin, and a
  // tab's recording follows it from app to app, so either page may show the
  // mount. Reading that prefix as the mount assumes the app has no route of
  // its own there (Slides has none). The recording's app label can't decide
  // it: without a declared app it is the hostname's first label.
  const mount = `/${app}`;
  const mounted = pages.some(
    (page) => page.pathname === mount || page.pathname.startsWith(`${mount}/`),
  );
  return `${origin}${mounted ? mount : ""}${rule.outputPath(outputId)}`;
}

/**
 * What became of one output made in a session. `open` means the use window
 * has not closed yet; `unmeasured` means a failed write may have dropped a
 * use, so it cannot be called unused.
 */
export type SessionOutputStatus = "used" | "unused" | "open" | "unmeasured";

export interface SessionOutput {
  app: OutputUseApp;
  outputType: string;
  outputId: string;
  madeAt: string;
  useBy: string;
  status: SessionOutputStatus;
  /** The first qualifying use's event name, when it was used in time. */
  usedEvent: string | null;
  usedAt: string | null;
  url: string | null;
}

export interface SessionRecordingOutputs {
  /**
   * By recording id, for each requested recording the viewer can read: its
   * outputs, [] when it made none since coverage began, or null when they
   * are unknown: it was shared from another tenant, whose events a share does
   * not grant, its tenant has not started output tracking, or a batch lost in
   * ingest overlapped it and may have held an output it made. Ids the viewer
   * cannot read are absent.
   */
  outputs: Record<string, SessionOutput[] | null>;
  /**
   * How many more outputs a recording made than `outputs` lists, by
   * recording id; absent when none were left out. Unused outputs are listed
   * first.
   */
  omittedOutputs: Record<string, number>;
  /** When the viewer's output tracking began, or null before it has. */
  coverageStartedAt: string | null;
}
