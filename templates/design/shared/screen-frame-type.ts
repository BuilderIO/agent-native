import {
  HUBSPOT_EMAIL_FRAME_TYPE,
  isHubSpotEmailHtml,
} from "./hubspot-email.js";

export type ScreenFrameType = typeof HUBSPOT_EMAIL_FRAME_TYPE;

// "web" records that a screen was switched back from an email. Without it, a
// legacy screen whose HTML still carries the email meta marker would read as
// an email again.
export type StoredScreenFrameType = ScreenFrameType | "web";

export const STORED_SCREEN_FRAME_TYPES = [
  HUBSPOT_EMAIL_FRAME_TYPE,
  "web",
] as const satisfies readonly StoredScreenFrameType[];

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The frame type stored in design data, or undefined when none is stored. */
export function storedScreenFrameType(
  designData: unknown,
  fileId: string,
): StoredScreenFrameType | undefined {
  const value = record(
    record(record(designData)?.screenMetadata)?.[fileId],
  )?.frameType;
  return value === HUBSPOT_EMAIL_FRAME_TYPE || value === "web"
    ? value
    : undefined;
}

/**
 * A screen's frame type. Stored metadata wins; a screen with none falls back
 * to the legacy HTML meta marker when its content is at hand.
 */
export function resolveScreenFrameType({
  designData,
  fileId,
  content,
}: {
  designData: unknown;
  fileId: string;
  content?: string | null;
}): ScreenFrameType | null {
  const stored = storedScreenFrameType(designData, fileId);
  if (stored !== undefined) {
    return stored === HUBSPOT_EMAIL_FRAME_TYPE ? stored : null;
  }
  return typeof content === "string" && isHubSpotEmailHtml(content)
    ? HUBSPOT_EMAIL_FRAME_TYPE
    : null;
}

export function withStoredScreenFrameType<T extends Record<string, unknown>>(
  designData: T,
  fileId: string,
  frameType: StoredScreenFrameType,
): T {
  const screenMetadata = record(designData.screenMetadata) ?? {};
  return {
    ...designData,
    screenMetadata: {
      ...screenMetadata,
      [fileId]: { ...record(screenMetadata[fileId]), frameType },
    },
  };
}
