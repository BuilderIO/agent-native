import {
  DEFAULT_CLIPS_RECORDING_VISIBILITY,
  type ClipsDefaultVisibility,
  type ClipsUserPrefs,
} from "./clips-ai-prefs.js";

/** Speeds Settings offers as a default; the player accepts more. */
export const CLIPS_DEFAULT_PLAYBACK_SPEEDS = [
  "1",
  "1.2",
  "1.5",
  "1.75",
  "2",
] as const;

export type ClipsDefaultPlaybackSpeed =
  (typeof CLIPS_DEFAULT_PLAYBACK_SPEEDS)[number];

export const DEFAULT_CLIPS_PLAYBACK_SPEED: ClipsDefaultPlaybackSpeed = "1.2";

export const CLIPS_RECORDING_VISIBILITIES = [
  "private",
  "org",
  "public",
] as const satisfies readonly ClipsDefaultVisibility[];

/** Where the visibility new recordings get comes from. */
export type ClipsRecordingVisibilitySource =
  | "personal"
  | "organization"
  | "built-in";

export interface ClipsRecordingDefaults {
  defaultPlaybackSpeed: string;
  /** The user's own choice, or null while they follow the organization. */
  defaultRecordingVisibility: ClipsDefaultVisibility | null;
  /** The organization's saved default, or null when it never set one. */
  organizationDefaultVisibility: ClipsDefaultVisibility | null;
  /** The visibility a recording created now gets. */
  effectiveRecordingVisibility: ClipsDefaultVisibility;
  recordingVisibilitySource: ClipsRecordingVisibilitySource;
}

export interface ClipsRecordingDefaultsPatch {
  defaultPlaybackSpeed?: string;
  /** null clears the personal choice so the organization default applies. */
  defaultRecordingVisibility?: ClipsDefaultVisibility | null;
}

export function isClipsRecordingVisibility(
  value: unknown,
): value is ClipsDefaultVisibility {
  return (
    typeof value === "string" &&
    (CLIPS_RECORDING_VISIBILITIES as readonly string[]).includes(value)
  );
}

/**
 * The stored defaults, resolved the way new recordings are: the personal
 * visibility wins, then the organization's, then the built-in one.
 * `organizationDefault` is null when the organization never set one.
 */
export function getClipsRecordingDefaults(
  prefs: ClipsUserPrefs | Record<string, unknown> | null | undefined,
  organizationDefault: ClipsDefaultVisibility | null,
): ClipsRecordingDefaults {
  const speed = prefs?.defaultPlaybackSpeed;
  const stored = prefs?.defaultRecordingVisibility;
  const personal = isClipsRecordingVisibility(stored) ? stored : null;
  return {
    defaultPlaybackSpeed:
      typeof speed === "string" && speed ? speed : DEFAULT_CLIPS_PLAYBACK_SPEED,
    defaultRecordingVisibility: personal,
    organizationDefaultVisibility: organizationDefault,
    effectiveRecordingVisibility:
      personal ?? organizationDefault ?? DEFAULT_CLIPS_RECORDING_VISIBILITY,
    recordingVisibilitySource: personal
      ? "personal"
      : organizationDefault
        ? "organization"
        : "built-in",
  };
}

/** `current` with a patch applied, as the server returns it after saving. */
export function applyClipsRecordingDefaultsPatch(
  current: ClipsRecordingDefaults,
  patch: ClipsRecordingDefaultsPatch,
): ClipsRecordingDefaults {
  return getClipsRecordingDefaults(
    {
      defaultPlaybackSpeed:
        patch.defaultPlaybackSpeed ?? current.defaultPlaybackSpeed,
      defaultRecordingVisibility:
        patch.defaultRecordingVisibility === undefined
          ? current.defaultRecordingVisibility
          : patch.defaultRecordingVisibility,
    },
    current.organizationDefaultVisibility,
  );
}
